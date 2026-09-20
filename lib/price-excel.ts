import type {CellValue, Workbook, Worksheet} from 'exceljs';

export const MAX_PRICE_ROWS = 5000;
export const PRICE_BATCH_SIZE = 100;
export const MAX_PRICE_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_PRICE_EXPANDED_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 512;
export const PRICE_HEADERS = ['Varyasyon ID', 'Ürün adı', 'Barkod', 'Mevcut fiyat (TL)', 'Yeni fiyat (TL)'];
export const VARIANT_ID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const MAX_PRICE_CENTS = 100_000_000_000;

export type PriceImportRow = {
  row: number;
  id: string;
  title: string;
  barcode: string;
  previousPrice: number | null;
  price: number | null;
  error: string;
};
export type PriceImport = {rows: PriceImportRow[]; skipped: number};
export type PriceUpdate = {row: number; id: string; price: number};
export type PriceBatchResult = {
  updated: string[];
  failed: {id: string; row: number; error: string}[];
};

/** Excel numbers are TL; the catalog stores integer kuruş. Blank means skip. */
export function parsePrice(value: unknown): {price: number | null; error: string} {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    return {price: null, error: ''};
  }
  let numeric: number;
  if (typeof value === 'number') {
    numeric = value;
  } else if (typeof value === 'string') {
    const text = value.trim().replace(/\s/g, '').replace(/^₺/, '').replace(/TL$/i, '');
    let normalized: string;
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(text)) normalized = text.replace(/\./g, '').replace(',', '.');
    else if (/^\d+(?:[.,]\d{1,2})?$/.test(text)) normalized = text.replace(',', '.');
    else return {price: null, error: 'Geçerli bir TL fiyatı yazın (ör. 1.234,56).'};
    numeric = Number(normalized);
  } else {
    return {price: null, error: 'Fiyat hücresi yalnızca sayı veya düz metin olmalı.'};
  }
  const price = Math.round(numeric * 100);
  if (!Number.isFinite(numeric) || numeric < 0 || !Number.isSafeInteger(price) || price > MAX_PRICE_CENTS) {
    return {price: null, error: 'Fiyat 0 ile 1.000.000.000 TL arasında olmalı.'};
  }
  if (Math.abs(numeric * 100 - price) > 0.0001) return {price: null, error: 'Fiyat en fazla iki ondalık basamak içerebilir.'};
  return {price, error: ''};
}

function textCell(value: CellValue) {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}
function formulaCell(value: CellValue) {
  return !!value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value);
}

type PriceZipEntry = {method: number; start: number; end: number; expanded: number};
const invalidZip = () => new Error('Excel arşiv yapısı geçersiz. Dosyayı Excel’de yeniden .xlsx olarak kaydedin.');
const oversizedZip = () => new Error('Excel içeriği açıldığında 32 MB sınırını aşıyor. Gereksiz sayfa ve görselleri kaldırın.');

/** ZIP structures follow PKWARE APPNOTE sections 4.3.7, 4.3.12 and 4.3.16. */
function inspectPriceZip(data: ArrayBuffer): PriceZipEntry[] {
  if (data.byteLength > MAX_PRICE_FILE_BYTES) throw new Error('Excel dosyası en fazla 5 MB olabilir.');
  if (data.byteLength < 22) throw invalidZip();
  const view = new DataView(data), bytes = new Uint8Array(data), names = new Set<string>();
  let end = -1;
  // EOCD may be followed only by its declared comment (maximum 65,535 bytes).
  for (let offset = data.byteLength - 22; offset >= Math.max(0, data.byteLength - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === data.byteLength) { end = offset; break; }
  }
  if (end < 0) throw invalidZip();
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true), directoryStart = view.getUint32(end + 16, true);
  if (count === 0xffff || directorySize === 0xffffffff || directoryStart === 0xffffffff
    || (end >= 20 && view.getUint32(end - 20, true) === 0x07064b50)) throw new Error('ZIP64 Excel dosyaları desteklenmiyor. Standart .xlsx şablonunu kullanın.');
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count) throw invalidZip();
  if (!count || count > MAX_ZIP_ENTRIES) throw new Error('Excel dosyası çok fazla iç dosya içeriyor. Gereksiz sayfa ve görselleri kaldırın.');
  if (directoryStart + directorySize !== end || directorySize < count * 46) throw invalidZip();
  const entries: PriceZipEntry[] = [], localRanges: {start: number; end: number}[] = [];
  let position = directoryStart, expandedTotal = 0;
  function checkExtras(start: number, length: number) {
    const boundary = start + length;
    for (let cursor = start; cursor < boundary;) {
      if (cursor + 4 > boundary) throw invalidZip();
      const field = view.getUint16(cursor, true), size = view.getUint16(cursor + 2, true);
      if (field === 0x0001) throw new Error('ZIP64 Excel dosyaları desteklenmiyor. Standart .xlsx şablonunu kullanın.');
      cursor += 4 + size;
      if (cursor > boundary) throw invalidZip();
    }
  }
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50) throw invalidZip();
    const flags = view.getUint16(position + 8, true), method = view.getUint16(position + 10, true);
    const compressed = view.getUint32(position + 20, true), expanded = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true), extraLength = view.getUint16(position + 30, true), commentLength = view.getUint16(position + 32, true);
    const local = view.getUint32(position + 42, true), next = position + 46 + nameLength + extraLength + commentLength;
    if (compressed === 0xffffffff || expanded === 0xffffffff || local === 0xffffffff) throw new Error('ZIP64 Excel dosyaları desteklenmiyor. Standart .xlsx şablonunu kullanın.');
    if (flags & 0x2041) throw new Error('Şifrelenmiş Excel dosyaları desteklenmiyor. Şifreyi kaldırıp yeniden yükleyin.');
    if ((method !== 0 && method !== 8) || view.getUint16(position + 34, true) || !nameLength || next > end) throw invalidZip();
    expandedTotal += expanded;
    if (expandedTotal > MAX_PRICE_EXPANDED_BYTES) throw oversizedZip();
    if (method === 0 && compressed !== expanded) throw invalidZip();
    const name = new TextDecoder().decode(bytes.subarray(position + 46, position + 46 + nameLength));
    if (names.has(name) || name.includes('\\') || name.includes('\0') || name.startsWith('/') || name.split('/').includes('..')) throw invalidZip();
    names.add(name);
    checkExtras(position + 46 + nameLength, extraLength);
    if (local + 30 > directoryStart || view.getUint32(local, true) !== 0x04034b50) throw invalidZip();
    if (view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method) throw invalidZip();
    const localNameLength = view.getUint16(local + 26, true), localExtraLength = view.getUint16(local + 28, true);
    const start = local + 30 + localNameLength + localExtraLength;
    if (localNameLength !== nameLength || start + compressed > directoryStart) throw invalidZip();
    for (let character = 0; character < nameLength; character++) {
      if (bytes[local + 30 + character] !== bytes[position + 46 + character]) throw invalidZip();
    }
    checkExtras(local + 30 + localNameLength, localExtraLength);
    const localCompressed = view.getUint32(local + 18, true), localExpanded = view.getUint32(local + 22, true);
    if (localCompressed === 0xffffffff || localExpanded === 0xffffffff) throw invalidZip();
    // Streamed archives may leave local sizes zero and carry them in a descriptor.
    if (flags & 8) {
      if ((localCompressed && localCompressed !== compressed) || (localExpanded && localExpanded !== expanded)) throw invalidZip();
    } else if (localCompressed !== compressed || localExpanded !== expanded) throw invalidZip();
    entries.push({method, start, end: start + compressed, expanded});
    localRanges.push({start: local, end: start + compressed});
    position = next;
  }
  if (position !== end || !names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) throw invalidZip();
  localRanges.sort((a, b) => a.start - b.start);
  if (localRanges.some((range, index) => index > 0 && range.start < localRanges[index - 1].end)) throw invalidZip();
  return entries;
}

/** Check declared AND actual expansion before ExcelJS allocates workbook objects. */
export async function preflightPriceWorkbook(data: ArrayBuffer): Promise<void> {
  const entries = inspectPriceZip(data);
  let total = 0;
  for (const entry of entries) {
    if (entry.method === 0) { total += entry.expanded; continue; }
    let decompressor: DecompressionStream;
    try { decompressor = new DecompressionStream('deflate-raw'); }
    catch { throw new Error('Güvenli Excel okuma için güncel bir Chrome, Edge veya Safari tarayıcısı kullanın.'); }
    const reader = new Blob([data.slice(entry.start, entry.end)]).stream().pipeThrough(decompressor).getReader();
    let expanded = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        expanded += chunk.value.byteLength;
        total += chunk.value.byteLength;
        if (total > MAX_PRICE_EXPANDED_BYTES) throw oversizedZip();
        if (expanded > entry.expanded) throw invalidZip();
      }
      if (expanded !== entry.expanded) throw invalidZip();
    } catch (error) {
      if (error instanceof Error && /Excel/.test(error.message)) throw error;
      throw invalidZip();
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}

export function inspectPriceSheet(sheet: Worksheet): PriceImport {
  if (sheet.rowCount > MAX_PRICE_ROWS + 1) throw new Error(`Bir dosyada en fazla ${MAX_PRICE_ROWS.toLocaleString('tr-TR')} satır olabilir.`);
  if (PRICE_HEADERS.some((header, index) => textCell(sheet.getCell(1, index + 1).value) !== header)) {
    throw new Error('Excel sütunları şablonla eşleşmiyor. Şablonu indirip yalnızca “Yeni fiyat (TL)” sütununu düzenleyin.');
  }
  const rows: PriceImportRow[] = [];
  const idRows = new Map<string, PriceImportRow[]>();
  for (let number = 2; number <= sheet.rowCount; number++) {
    const cells = Array.from({length: PRICE_HEADERS.length}, (_, index) => sheet.getCell(number, index + 1).value);
    if (cells.every(value => value === null || value === undefined || value === '')) continue;
    const id = textCell(cells[0]);
    const parsed = parsePrice(cells[4]);
    const current = parsePrice(cells[3]);
    const row: PriceImportRow = {
      row: number, id, title: textCell(cells[1]).slice(0, 500), barcode: textCell(cells[2]).slice(0, 100),
      previousPrice: current.price, price: parsed.price,
      error: cells.some(formulaCell) ? 'Formül kullanılamaz; hücreleri değer olarak yapıştırın.' :
        !VARIANT_ID.test(id) ? 'Varyasyon ID geçersiz. Şablondaki kimliği değiştirmeyin.' : parsed.error,
    };
    rows.push(row);
    if (id) idRows.set(id, [...(idRows.get(id) || []), row]);
  }
  for (const duplicates of idRows.values()) if (duplicates.length > 1) {
    for (const row of duplicates) row.error = 'Aynı varyasyon birden fazla satırda bulunuyor; tekrarları kaldırın.';
  }
  if (!rows.length) throw new Error('Dosyada ürün satırı bulunamadı. Ürün aradıktan sonra sonuçları Excel olarak indirin.');
  return {rows, skipped: rows.filter(row => !row.error && row.price === null).length};
}

export async function readPriceWorkbook(data: ArrayBuffer): Promise<PriceImport> {
  await preflightPriceWorkbook(data);
  const {Workbook} = (await import('exceljs')).default;
  const workbook = new Workbook();
  try { await workbook.xlsx.load(data as unknown as Parameters<typeof workbook.xlsx.load>[0]); }
  catch { throw new Error('Dosya okunamadı. Geçerli bir .xlsx Excel dosyası seçin.'); }
  const sheet = workbook.getWorksheet('Fiyatlar') || workbook.worksheets[0];
  if (!sheet) throw new Error('Excel dosyasında çalışma sayfası bulunamadı.');
  return inspectPriceSheet(sheet);
}

export async function makePriceWorkbook(items: Array<{
  id: string; title: string; barcode: string; catalogPrice: number | null;
}>): Promise<Workbook> {
  if (items.length > MAX_PRICE_ROWS) throw new Error('Şablon en fazla 5.000 ürün içerebilir.');
  const {Workbook} = (await import('exceljs')).default;
  const workbook = new Workbook();
  workbook.creator = 'Alaçam Dağıtım';
  const sheet = workbook.addWorksheet('Fiyatlar', {views: [{state: 'frozen', ySplit: 1}]});
  sheet.columns = [
    {header: PRICE_HEADERS[0], key: 'id', width: 48, style: {numFmt: '@'}},
    {header: PRICE_HEADERS[1], key: 'title', width: 60},
    {header: PRICE_HEADERS[2], key: 'barcode', width: 22, style: {numFmt: '@'}},
    {header: PRICE_HEADERS[3], key: 'current', width: 23, style: {numFmt: '#,##0.00'}},
    {header: PRICE_HEADERS[4], key: 'next', width: 23, style: {numFmt: '#,##0.00'}},
  ];
  items.forEach(item => sheet.addRow({id: item.id, title: item.title, barcode: item.barcode,
    current: item.catalogPrice === null ? null : item.catalogPrice / 100, next: null}));
  sheet.getRow(1).font = {bold: true, color: {argb: 'FF111111'}};
  sheet.getRow(1).fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FFF5C842'}};
  sheet.getRow(1).height = 24;
  sheet.autoFilter = {from: 'A1', to: `E${Math.max(1, items.length + 1)}`};
  const instructions = workbook.addWorksheet('Nasıl kullanılır');
  instructions.getColumn(1).width = 110;
  [
    'Yalnızca Fiyatlar sayfasındaki Yeni fiyat (TL) sütununu değiştirin.',
    'Varyasyon ID değişmemeli. Ürün adı ve barkod yalnızca tanıma amaçlıdır.',
    'Boş yeni fiyat mevcut fiyatı korur. 0 geçerli bir fiyattır. Fiyat silme bu şablonda yoktur.',
    'Sayı kullanın; örnek: 1234,56. Formül varsa Excel’de değer olarak yapıştırın.',
    'Aynı varyasyon ID dosyada yalnızca bir kez bulunmalı.',
    'Dosya başına en fazla 5.000 satır. 2.000–3.000 satır desteklenir.',
    'Dosyayı yükleyince önce önizlemeyi kontrol edin, ardından fiyatları uygulayın.',
    'Yalnızca özel katalog fiyatları değişir. Shopify’a hiçbir bilgi yazılmaz.',
  ].forEach(line => instructions.addRow([line]));
  return workbook;
}

/** Server-side allowlist: names, barcodes and other product fields cannot be written. */
export function validatePriceBatch(body: unknown): PriceUpdate[] {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'rows')) throw new Error('Geçersiz fiyat güncelleme isteği.');
  const raw = (body as {rows?: unknown}).rows;
  if (!Array.isArray(raw) || !raw.length || raw.length > PRICE_BATCH_SIZE) throw new Error(`Her istekte 1–${PRICE_BATCH_SIZE} fiyat gönderilebilir.`);
  const ids = new Set<string>();
  return raw.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['row', 'id', 'price'].includes(key))) throw new Error('Yalnızca varyasyon kimliği ve fiyat güncellenebilir.');
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'string' || !VARIANT_ID.test(item.id) || item.id.length > 90) throw new Error('Geçersiz varyasyon kimliği.');
    if (ids.has(item.id)) throw new Error('İstek aynı varyasyonu birden fazla kez içeriyor.');
    ids.add(item.id);
    if (typeof item.price !== 'number' || !Number.isSafeInteger(item.price) || item.price < 0 || item.price > MAX_PRICE_CENTS) throw new Error('Geçersiz fiyat; kuruş cinsinden pozitif bir tam sayı veya sıfır olmalı.');
    if (typeof item.row !== 'number' || !Number.isInteger(item.row) || item.row < 2 || item.row > MAX_PRICE_ROWS + 1) throw new Error('Geçersiz Excel satır numarası.');
    return {id: item.id, price: item.price, row: item.row};
  });
}
