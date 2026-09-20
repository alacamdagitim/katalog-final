import type {CatalogItem, CatalogPage} from './live-catalog';
import {MAX_PRICE_ROWS, parsePrice} from './price-excel';

export type BulkPriceOperation = 'percent-up' | 'percent-down' | 'amount-up' | 'amount-down' | 'set';
export type BulkPriceItem = Pick<CatalogItem, 'id' | 'title' | 'catalogPrice'>;
export type BulkPricePreviewRow = {
  id: string; title: string; current: number | null; next: number | null;
  status: 'change' | 'skip' | 'error'; reason: string;
};
export type BulkPricePreview = {rows: BulkPricePreviewRow[]; error: string};
const MAX_CENTS = 100_000_000_000;
const OPERATIONS: BulkPriceOperation[] = ['percent-up', 'percent-down', 'amount-up', 'amount-down', 'set'];

export function previewBulkPrices(items: BulkPriceItem[], operation: BulkPriceOperation, input: string): BulkPricePreview {
  if (!OPERATIONS.includes(operation)) return {rows: [], error: 'Geçerli bir fiyat işlemi seçin.'};
  if (!items.length || items.length > MAX_PRICE_ROWS) return {rows: [], error: '1 ile 5.000 arasında ürün seçin.'};
  const amount = parsePrice(input);
  if (amount.error || amount.price === null) return {rows: [], error: amount.error || 'İşlem için bir değer girin.'};
  if (operation === 'percent-down' && amount.price > 10000) return {rows: [], error: 'Yüzde indirimi %100’den fazla olamaz.'};
  if (new Set(items.map(item => item.id)).size !== items.length) return {rows: [], error: 'Seçimde tekrar eden ürünler var. Seçimi yenileyin.'};
  const rows = items.map((item): BulkPricePreviewRow => {
    const base = {id: item.id, title: item.title, current: item.catalogPrice, next: null};
    if (operation !== 'set' && item.catalogPrice === null) return {...base, status: 'skip', reason: 'Özel fiyatı yok; atlanacak.'};
    if (item.catalogPrice !== null && (!Number.isSafeInteger(item.catalogPrice) || item.catalogPrice < 0 || item.catalogPrice > MAX_CENTS)) {
      return {...base, status: 'error', reason: 'Mevcut fiyat geçersiz; ürünü yeniden yükleyin.'};
    }
    let next: number;
    if (operation === 'set') next = amount.price!;
    else if (operation === 'amount-up') next = item.catalogPrice! + amount.price!;
    else if (operation === 'amount-down') next = item.catalogPrice! - amount.price!;
    else {
      // Exact integer kuruş arithmetic also avoids floating-point overflow at the upper price bound.
      const factor = BigInt(10000) + BigInt(operation === 'percent-up' ? amount.price! : -amount.price!);
      next = Number((BigInt(item.catalogPrice!) * factor + BigInt(5000)) / BigInt(10000));
    }
    if (!Number.isSafeInteger(next) || next < 0 || next > MAX_CENTS) return {...base, next, status: 'error', reason: 'Sonuç 0–1.000.000.000 TL aralığında olmalı.'};
    if (next === item.catalogPrice) return {...base, next, status: 'skip', reason: 'Fiyat değişmiyor.'};
    return {...base, next, status: 'change', reason: ''};
  });
  return {rows, error: ''};
}

export type BulkSelectionFilter = {q: string; vendor: string; type: string; tag?: string};
export async function collectMatchingProducts(
  filters: BulkSelectionFilter,
  loadPage: (params: URLSearchParams, signal: AbortSignal) => Promise<CatalogPage>,
  signal: AbortSignal,
  onProgress: (progress: {items: number; pages: number}) => void,
): Promise<CatalogItem[]> {
  // Commit selection only after all pages succeed; cancellation/error must not claim complete selection.
  const selected = new Map<string, CatalogItem>(), visited = new Set<string>();
  let cursor = '', pages = 0;
  for (;;) {
    signal.throwIfAborted();
    if (++pages > 500) throw new Error('Sonuçların tamamı doğrulanamadı. Filtreyi daraltıp yeniden deneyin.');
    const params = new URLSearchParams({q: filters.q, vendor: filters.vendor, type: filters.type, tag: filters.tag || ''});
    if (cursor) params.set('after', cursor);
    const page = await loadPage(params, signal);
    signal.throwIfAborted();
    for (const product of page.items) {
      selected.set(product.id, product);
      if (selected.size > MAX_PRICE_ROWS) throw new Error('Eşleşme sayısı 5.000 sınırını aşıyor. Marka veya tür filtresini daraltın; tüm eşleşenler seçilmedi.');
    }
    onProgress({items: selected.size, pages});
    if (!page.hasNextPage) return [...selected.values()];
    if (!page.cursor || page.cursor === cursor || visited.has(page.cursor)) throw new Error('Sonraki sonuç sayfası doğrulanamadı. Seçim tamamlanmadı; yeniden deneyin.');
    cursor = page.cursor;
    visited.add(cursor);
  }
}

export type CatalogVisibilityItem = {id: string; title: string; catalogVisible?: boolean};
export function previewCatalogVisibility(items: CatalogVisibilityItem[], visible: boolean) {
  return [...new Map(items.map(item => [item.id, item])).values()].map(item => ({
    id: item.id, title: item.title, current: item.catalogVisible === true, next: visible,
    changed: (item.catalogVisible === true) !== visible,
  }));
}
