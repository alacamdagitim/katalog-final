import test from 'node:test';
import assert from 'node:assert/strict';
import type {CatalogItem, CatalogPage} from '../lib/live-catalog';
import {collectMatchingProducts, previewBulkPrices, previewCatalogVisibility} from '../lib/admin-bulk-prices';

const item = (number: number, price: number | null = 10000): CatalogItem => ({
  id: `gid://shopify/ProductVariant/${number}`, productId: `gid://shopify/Product/${number}`,
  title: `Ürün ${number}`, catalogPrice: price, handle: `urun-${number}`, vendor: 'DaVinci Gourmet',
  type: 'Şurup', description: '', barcode: '', image: '', available: true, storefrontUrl: '',
});
const page = (items: CatalogItem[], cursor: string | null = null): CatalogPage => ({items, cursor, hasNextPage: cursor !== null, vendors: [], types: []});

test('bulk percentages use exact kuruş rounding and preserve zero and unpriced exclusions', () => {
  const preview = previewBulkPrices([item(1, 10000), item(2, 101), item(3, null), item(4, 0)], 'percent-up', '5');
  assert.equal(preview.error, '');
  assert.deepEqual(preview.rows.map(row => [row.next, row.status]), [[10500, 'change'], [106, 'change'], [null, 'skip'], [0, 'skip']]);
  assert.equal(previewBulkPrices([item(1, 1)], 'percent-up', '50').rows[0].next, 2);
  assert.equal(previewBulkPrices([item(1, 10001)], 'percent-up', '5,25').rows[0].next, 10526);
  assert.equal(previewBulkPrices([item(1, 101)], 'percent-down', '100').rows[0].next, 0);
  assert.ok(previewBulkPrices([item(1)], 'percent-down', '100,01').error);
});

test('TL adjustments and setting one price validate bounds, amounts and missing prices', () => {
  assert.equal(previewBulkPrices([item(1)], 'amount-up', '1.234,56').rows[0].next, 133456);
  assert.equal(previewBulkPrices([item(1)], 'amount-down', '100').rows[0].next, 0);
  assert.equal(previewBulkPrices([item(1)], 'amount-down', '100,01').rows[0].status, 'error');
  assert.equal(previewBulkPrices([item(1, 100_000_000_000)], 'percent-up', '1').rows[0].status, 'error');
  assert.deepEqual(previewBulkPrices([item(1, null), item(2, 100)], 'set', '0').rows.map(row => [row.next, row.status]), [[0, 'change'], [0, 'change']]);
  for (const value of ['', '-5', '2,555', '=1+1']) assert.ok(previewBulkPrices([item(1)], 'percent-up', value).error);
  assert.ok(previewBulkPrices([item(1), item(1)], 'set', '5').error);
});

test('all-match selection visits every cursor with a stable filter and deduplicates variants', async () => {
  const requests: Record<string, string>[] = [], progress: {items: number; pages: number}[] = [];
  const pages = [page([item(1), item(2)], 'second'), page([item(2), item(3)], 'third'), page([item(4)])];
  const products = await collectMatchingProducts({q: '', vendor: 'DaVinci Gourmet', type: 'Şurup', tag: 'Meyveli'}, async params => {
    requests.push(Object.fromEntries(params));
    return pages[requests.length - 1];
  }, new AbortController().signal, result => progress.push(result));
  assert.deepEqual(products.map(product => product.id), [item(1).id, item(2).id, item(3).id, item(4).id]);
  assert.deepEqual(requests.map(request => request.after), [undefined, 'second', 'third']);
  assert.ok(requests.every(request => request.vendor === 'DaVinci Gourmet' && request.type === 'Şurup' && request.tag === 'Meyveli' && request.q === ''));
  assert.deepEqual(progress, [{items: 2, pages: 1}, {items: 3, pages: 2}, {items: 4, pages: 3}]);
});

test('all-match cancellation, cursor loops and 5,000 limit cannot return a misleading partial selection', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(collectMatchingProducts({q: 'test', vendor: '', type: ''}, async () => {
    calls++; return page([item(1)], 'next');
  }, controller.signal, () => controller.abort()), {name: 'AbortError'});
  assert.equal(calls, 1);
  await assert.rejects(collectMatchingProducts({q: 'test', vendor: '', type: ''}, async () => page([item(1)], 'repeat'), new AbortController().signal, () => {}), /Sonraki sonuç/);
  await assert.rejects(collectMatchingProducts({q: 'test', vendor: '', type: ''}, async () => page(Array.from({length: 5001}, (_, index) => item(index + 1))), new AbortController().signal, () => {}), /5.000/);
});

test('a 3,000-product preview calculates all changes without mutating source prices', () => {
  const products = Array.from({length: 3000}, (_, index) => item(index + 1, 10000));
  const result = previewBulkPrices(products, 'percent-up', '5');
  assert.equal(result.rows.length, 3000);
  assert.ok(result.rows.every(row => row.status === 'change' && row.next === 10500));
  assert.ok(products.every(product => product.catalogPrice === 10000));
});

test('visibility defaults hidden regardless of price, previews changes explicitly and leaves price records untouched', () => {
  const products = [item(1, 10000), {...item(2, null), catalogVisible: true}, {...item(3, 0), catalogVisible: false}];
  const publish = previewCatalogVisibility(products, true);
  assert.deepEqual(publish.map(row => [row.current, row.next, row.changed]), [[false, true, true], [true, true, false], [false, true, true]]);
  const hide = previewCatalogVisibility(products, false);
  assert.deepEqual(hide.map(row => row.changed), [false, true, false]);
  assert.deepEqual(products.map(product => product.catalogPrice), [10000, null, 0]);
  assert.equal(previewCatalogVisibility([products[0], products[0]], true).length, 1);
});

test('selection and visibility operate on variant options, never silently on every option of a product', async () => {
  const first = item(1), second = {...item(2), productId: first.productId};
  const results = await collectMatchingProducts({q: 'Ürün', vendor: '', type: '', tag: ''}, async () => page([first, second]), new AbortController().signal, () => {});
  assert.equal(new Set(results.map(result => result.productId)).size, 1);
  assert.equal(results.length, 2);
  assert.deepEqual(previewCatalogVisibility([first], true).map(row => row.id), [first.id]);
  assert.deepEqual(previewBulkPrices([second], 'set', '150').rows.map(row => row.id), [second.id]);
});
