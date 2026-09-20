import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {VisibilityBlobStore} from '../lib/catalog-visibility';

// Capture the module's local path only after changing to a dedicated sandbox.
const originalCwd = process.cwd();
const sandbox = await mkdtemp(join(tmpdir(), 'catalog-visibility-test-'));
const oldNetlify = process.env.NETLIFY, oldSite = process.env.NETLIFY_SITE_ID, oldRuntimeSite = process.env.SITE_ID;
delete process.env.NETLIFY; delete process.env.NETLIFY_SITE_ID; delete process.env.SITE_ID;
process.chdir(sandbox);
const visibility = await import('../lib/catalog-visibility');
after(async () => {
  process.chdir(originalCwd);
  if (oldNetlify === undefined) delete process.env.NETLIFY; else process.env.NETLIFY = oldNetlify;
  if (oldSite === undefined) delete process.env.NETLIFY_SITE_ID; else process.env.NETLIFY_SITE_ID = oldSite;
  if (oldRuntimeSite === undefined) delete process.env.SITE_ID; else process.env.SITE_ID = oldRuntimeSite;
  await rm(sandbox, {recursive: true, force: true});
});

const id = (n: number | string) => `gid://shopify/ProductVariant/${n}`;
const key = (value: string) => 'approved-variant-' + Buffer.from(value).toString('base64url');
const approval = () => ({visible: true as const, updatedAt: '2026-09-20T00:00:00.000Z'});
const request = (body: unknown) => new Request('https://example.com/api/admin/catalog/visibility', {
  method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
});

test('visibility defaults hidden; concurrent approvals and revocation persist only approval metadata', async () => {
  assert.deepEqual(await visibility.getVisibleIds(), []);
  assert.deepEqual(await visibility.getVisibility([id(1), id(2)]), {[id(1)]: false, [id(2)]: false});
  const changes = await Promise.all([visibility.setVisibility([id(1)], true), visibility.setVisibility([id(2)], true)]);
  assert.ok(changes.every(result => result.failed.length === 0));
  assert.deepEqual(await visibility.getVisibleIds(), [id(1), id(2)]);
  await visibility.setVisibility([id(1)], false);
  assert.deepEqual(await visibility.getVisibility([id(1), id(2)]), {[id(1)]: false, [id(2)]: true});
  const saved = JSON.parse(await readFile(join(sandbox, '.local', 'visibility.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved), [id(2)]);
  assert.deepEqual(Object.keys(saved[id(2)]).sort(), ['updatedAt', 'visible']);
  assert.deepEqual(await readdir(join(sandbox, '.local')), ['visibility.json']);
});

test('strict request validation rejects duplicate/invalid IDs, coercion, extra fields and oversized streams', async () => {
  assert.deepEqual(await visibility.readVisibilityRequest(request({ids: [id(1)], visible: false})), {ids: [id(1)], visible: false});
  const invalid = [
    {ids: [], visible: true}, {ids: [id(1), id(1)], visible: true},
    {ids: [id('1x')], visible: true}, {ids: [id('1'.repeat(21))], visible: true},
    {ids: [id('1\n')], visible: true}, {ids: [id('1 ')], visible: true},
    {ids: ['gid://shopify/Product/1'], visible: true}, {ids: [id(1)], visible: 'true'},
    {ids: [id(1)], visible: true, price: 50}, {ids: [1], visible: true},
    {ids: Array.from({length: 101}, (_, n) => id(n)), visible: true},
  ];
  for (const body of invalid) await assert.rejects(visibility.readVisibilityRequest(request(body)), {status: 400});
  const oversized = request({ids: [id(1)], visible: true, padding: 'ş'.repeat(9000)});
  assert.equal(oversized.headers.get('content-length'), null);
  await assert.rejects(visibility.readVisibilityRequest(oversized), {status: 413});
  await assert.rejects(visibility.readVisibilityRequest(new Request('https://example.com', {method: 'PATCH', body: '{}'})), {status: 415});
});

test('live validation accepts only requested variants with a verified Shopify product node', () => {
  assert.deepEqual(visibility.liveVisibilityIds([id(1), id(2), id(3), id(4)], [
    {id: id(1), __typename: 'ProductVariant', product: {id: 'gid://shopify/Product/11', __typename: 'Product'}},
    null,
    {id: id(2), __typename: 'Product'},
    {id: id(3), __typename: 'ProductVariant', product: {id: 'wrong', __typename: 'Product'}},
    {id: id(4), __typename: 'ProductVariant', product: {id: 'gid://shopify/Product/14', __typename: 'Collection'}},
    {id: id(99), __typename: 'ProductVariant', product: {id: 'gid://shopify/Product/99', __typename: 'Product'}},
  ]), [id(1)]);
});

class MemoryStore implements VisibilityBlobStore {
  records = new Map<string, unknown>();
  failWrite: string | null = null;
  failRead = false;
  pages = 0; reads = 0;
  async get(name: string) { this.reads++; if (this.failRead) throw new Error('unavailable'); return this.records.get(name) ?? null; }
  async *list({prefix}: {prefix: string; paginate: true}) {
    if (this.failRead) throw new Error('unavailable');
    for (const name of this.records.keys()) if (name.startsWith(prefix)) { this.pages++; yield {blobs: [{key: name}]}; }
  }
  async setJSON(name: string, value: unknown) { if (this.failWrite === name) throw new Error('failed'); this.records.set(name, value); }
  async delete(name: string) { if (this.failWrite === name) throw new Error('failed'); this.records.delete(name); }
}

test('remote approval membership paginates without payload reads, revokes and reports failures', async () => {
  const store = new MemoryStore(), repository = visibility.createVisibilityRepository(store);
  store.records.set(key(id(1)), approval());
  store.records.set('variant-' + Buffer.from(id(2)).toString('base64url'), {visible: false, updatedAt: 'now'});
  store.records.set('variant-' + Buffer.from(id(3)).toString('base64url'), {visible: 'true', updatedAt: 'now'});
  store.records.set('approved-variant-invalid', approval());
  assert.deepEqual(await repository.visibleIds(), [id(1)]);
  assert.equal(store.pages, 2);
  assert.equal(store.reads, 0);
  assert.deepEqual(await repository.selected([id(1), id(2), id(9)]), {[id(1)]: true, [id(2)]: false, [id(9)]: false});
  store.failWrite = key(id(5));
  const result = await repository.update([id(4), id(5)], true);
  assert.deepEqual(result.updated, [id(4)]);
  assert.equal(result.failed[0].id, id(5));
  await repository.update([id(1)], false);
  assert.deepEqual(await repository.visibleIds(), [id(4)]);
  store.failRead = true;
  await assert.rejects(repository.visibleIds(), /unavailable/);
  await assert.rejects(repository.selected([id(4)]), /unavailable/);
});

test('5,000 approval keys need no per-variant payload reads and next list reflects revocation', async () => {
  const store = new MemoryStore(), repository = visibility.createVisibilityRepository(store);
  for (let n = 1; n <= 5000; n++) store.records.set(key(id(n)), approval());
  assert.equal((await repository.visibleIds()).length, 5000);
  assert.equal(store.reads, 0);
  await repository.update([id(2500)], false);
  const next = await repository.visibleIds();
  assert.equal(next.length, 4999);
  assert.equal(next.includes(id(2500)), false);
  assert.equal(store.reads, 0);
});

test('corrupt local visibility cannot approve products or be overwritten by a later save', async () => {
  const path = join(sandbox, '.local', 'visibility.json');
  await writeFile(path, '{broken');
  await assert.rejects(visibility.getVisibleIds(), /okunamadı/);
  const result = await visibility.setVisibility([id(8)], true);
  assert.deepEqual(result.updated, []);
  assert.equal(result.failed[0].id, id(8));
  assert.equal(await readFile(path, 'utf8'), '{broken');
});
