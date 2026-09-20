import {getStore} from '@netlify/blobs';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {HttpError} from './http';
import {isNetlifyRuntime} from './storage-runtime';

type Approval = {visible: true; updatedAt: string};
type Approvals = Record<string, Approval>;
export type VisibilityResult = {updated: string[]; failed: {id: string; error: string}[]};
export type VisibilityBlobStore = {
  get(key: string, options: {type: 'json'}): Promise<unknown>;
  list(options: {prefix: string; paginate: true}): AsyncIterable<{blobs: {key: string}[]}>;
  setJSON(key: string, value: Approval): Promise<unknown>;
  delete(key: string): Promise<void>;
};
export type VisibilityNode = {id: string; __typename: string; product?: {id: string; __typename: string}} | null;

const VARIANT_ID = /^gid:\/\/shopify\/ProductVariant\/\d{1,20}(?![\s\S])/;
const PRODUCT_ID = /^gid:\/\/shopify\/Product\/\d{1,20}(?![\s\S])/;
const MAX_IDS = 100;
const MAX_BODY_BYTES = 16 * 1024;
// Key membership in this dedicated namespace is the remote approval itself.
// Only explicit approvals create a key; revocation deletes it, never writes false.
const PREFIX = 'approved-variant-';
const localFile = join(process.cwd(), '.local', 'visibility.json');
const key = (id: string) => PREFIX + Buffer.from(id).toString('base64url');
const approved = (value: unknown): value is Approval => !!value && typeof value === 'object'
  && (value as Partial<Approval>).visible === true && typeof (value as Partial<Approval>).updatedAt === 'string';
const storageError = () => new Error('Katalog yayın onayları okunamadı. Lütfen yeniden deneyin.');

function validateInput(ids: unknown, visible: unknown): asserts ids is string[] {
  if (typeof visible !== 'boolean' || !Array.isArray(ids) || !ids.length || ids.length > MAX_IDS
    || ids.some(id => typeof id !== 'string' || !VARIANT_ID.test(id)) || new Set(ids).size !== ids.length) {
    throw new HttpError(400, 'Bir ile 100 arasında, tekrarsız ve geçerli ürün seçeneği ile yayın durumu gönderin.');
  }
}

/** Bound the actual streamed bytes, including requests without Content-Length. */
export async function readVisibilityRequest(req: Request): Promise<{ids: string[]; visible: boolean}> {
  if (req.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'JSON biçiminde yayın onayı gerekli.');
  }
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY_BYTES) throw new HttpError(413, 'Yayın onayı isteği çok büyük.');
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, 'Yayın onayı isteği boş.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, 'Yayın onayı isteği çok büyük.');
      }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { throw new HttpError(400, 'Yayın onayı isteği okunamadı.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 2 || !Object.hasOwn(body, 'ids') || !Object.hasOwn(body, 'visible')) {
    throw new HttpError(400, 'Yalnızca ürün seçeneği kimlikleri ve yayın durumu gönderilebilir.');
  }
  const input = body as Record<string, unknown>;
  validateInput(input.ids, input.visible);
  return {ids: input.ids, visible: input.visible as boolean};
}

/** An inaccessible/wrong-kind node never becomes an approval, in either direction. */
export function liveVisibilityIds(ids: string[], nodes: VisibilityNode[]): string[] {
  const live = new Set(nodes.filter(node => node?.__typename === 'ProductVariant'
    && node.product?.__typename === 'Product' && PRODUCT_ID.test(node.product.id)).map(node => node!.id));
  return ids.filter(id => live.has(id));
}

async function localApprovals(): Promise<Approvals> {
  let data: unknown;
  try { data = JSON.parse(await readFile(localFile, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw storageError(); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw storageError();
  return Object.fromEntries(Object.entries(data).filter(([id, record]) => VARIANT_ID.test(id) && approved(record)));
}

/** Dedicated approval records only: neither Shopify products nor prices are stored. */
export function createVisibilityRepository(store: VisibilityBlobStore) {
  return {
    async visibleIds(): Promise<string[]> {
      const ids = new Set<string>();
      for await (const page of store.list({prefix: PREFIX, paginate: true})) {
        for (const blob of page.blobs) {
          const id = Buffer.from(blob.key.slice(PREFIX.length), 'base64url').toString();
          if (VARIANT_ID.test(id) && key(id) === blob.key) ids.add(id);
        }
      }
      return [...ids].sort();
    },
    async selected(ids: string[]): Promise<Record<string, boolean>> {
      const result: Record<string, boolean> = {}, unique = [...new Set(ids)];
      for (let offset = 0; offset < unique.length; offset += 16) {
        await Promise.all(unique.slice(offset, offset + 16).map(async id => {
          result[id] = VARIANT_ID.test(id) && approved(await store.get(key(id), {type: 'json'}));
        }));
      }
      return result;
    },
    async update(ids: string[], visible: boolean): Promise<VisibilityResult> {
      validateInput(ids, visible);
      const result: VisibilityResult = {updated: [], failed: []};
      for (let offset = 0; offset < ids.length; offset += 16) {
        await Promise.all(ids.slice(offset, offset + 16).map(async id => {
          try {
            if (visible) await store.setJSON(key(id), {visible: true, updatedAt: new Date().toISOString()});
            else await store.delete(key(id));
            result.updated.push(id);
          } catch { result.failed.push({id, error: 'Yayın durumu kaydedilemedi. Yeniden deneyin.'}); }
        }));
      }
      return result;
    },
  };
}

const blobVisibility = () => createVisibilityRepository(getStore({name: 'catalog-visibility', consistency: 'strong'}));

export async function getVisibleIds(): Promise<string[]> {
  return isNetlifyRuntime() ? blobVisibility().visibleIds() : Object.keys(await localApprovals()).sort();
}

export async function getVisibility(ids: string[]): Promise<Record<string, boolean>> {
  if (isNetlifyRuntime()) return blobVisibility().selected(ids);
  const records = await localApprovals();
  return Object.fromEntries([...new Set(ids)].map(id => [id, VARIANT_ID.test(id) && approved(records[id])]));
}

let localWrite: Promise<unknown> = Promise.resolve();
export async function setVisibility(ids: string[], visible: boolean): Promise<VisibilityResult> {
  validateInput(ids, visible);
  if (isNetlifyRuntime()) {
    try { return await blobVisibility().update(ids, visible); }
    catch { return {updated: [], failed: ids.map(id => ({id, error: 'Yayın durumu kaydedilemedi. Yeniden deneyin.'}))}; }
  }
  const operation = localWrite.catch(() => {}).then(async () => {
    const records = await localApprovals();
    for (const id of ids) {
      if (visible) records[id] = {visible: true, updatedAt: new Date().toISOString()};
      else delete records[id];
    }
    await mkdir(join(process.cwd(), '.local'), {recursive: true});
    const temporary = `${localFile}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(records, null, 2));
    await rename(temporary, localFile);
  });
  localWrite = operation;
  try { await operation; return {updated: [...ids], failed: []}; }
  catch { return {updated: [], failed: ids.map(id => ({id, error: 'Yayın durumu kaydedilemedi. Yeniden deneyin.'}))}; }
}
