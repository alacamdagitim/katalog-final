import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {
  inspectPriceSheet, makePriceWorkbook, parsePrice, preflightPriceWorkbook, readPriceWorkbook, validatePriceBatch,
} from '../lib/price-excel';

const id = (number: number) => `gid://shopify/ProductVariant/${number}`;

test('Excel TL parsing preserves blanks and zero, handles Turkish thousands, rejects ambiguous or unsafe prices', () => {
  for (const [input, expected] of [[null, null], ['', null], ['  ', null], [0, 0], ['0,00', 0], ['1.234,56', 123456], ['1234.56', 123456], ['1.234', 123400], ['1.234.567,89', 123456789], [125.9, 12590]] as const) {
    assert.deepEqual(parsePrice(input), {price: expected, error: ''});
  }
  for (const input of ['1,234.56', '-1', -0.1, '1,234', 1.234, '=1+1', Infinity, NaN, 1_000_000_001]) {
    assert.ok(parsePrice(input).error, String(input));
  }
});

test('a real 3,000-row xlsx round trip preserves IDs/barcodes and numeric prices', async () => {
  const items = Array.from({length: 3000}, (_, index) => ({id: id(index + 1), title: `Ürün ${index + 1}`, barcode: '0001234567890', catalogPrice: 123456}));
  const workbook = await makePriceWorkbook(items);
  const sheet = workbook.getWorksheet('Fiyatlar')!;
  assert.equal(sheet.getCell('A2').type, 3); // ExcelJS string, never scientific numeric ID.
  assert.equal(sheet.getCell('C2').value, '0001234567890');
  assert.equal(sheet.getCell('D2').value, 1234.56);
  for (let row = 2; row <= 3001; row++) sheet.getCell(row, 5).value = row === 2 ? 0 : 2000.5;
  sheet.getCell(3001, 5).value = null;
  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer);
  const parsed = await readPriceWorkbook(bytes.buffer as ArrayBuffer);
  assert.equal(parsed.rows.length, 3000);
  assert.equal(parsed.rows.filter(row => row.error).length, 0);
  assert.equal(parsed.rows[0].price, 0);
  assert.equal(parsed.rows[1].price, 200050);
  assert.equal(parsed.rows[0].barcode, '0001234567890');
  assert.equal(parsed.skipped, 1);
});

test('duplicate IDs and formula cells block import even with cached numeric formula results', async () => {
  const workbook = await makePriceWorkbook([
    {id: id(1), title: 'Bir', barcode: '001', catalogPrice: 100},
    {id: id(1), title: 'Tekrar', barcode: '001', catalogPrice: 100},
    {id: id(2), title: 'İki', barcode: '002', catalogPrice: 100},
  ]);
  const sheet = workbook.getWorksheet('Fiyatlar')!;
  sheet.getCell('E2').value = 20;
  sheet.getCell('E3').value = 25;
  sheet.getCell('E4').value = {formula: '10+10', result: 20};
  const parsed = inspectPriceSheet(sheet);
  assert.match(parsed.rows[0].error, /birden fazla/);
  assert.match(parsed.rows[1].error, /birden fazla/);
  assert.match(parsed.rows[2].error, /Formül/);
});

test('server price payload accepts only valid integer cents and rejects extra fields before any writes', () => {
  const valid = {row: 2, id: id(1), price: 0};
  assert.deepEqual(validatePriceBatch({rows: [valid]}), [valid]);
  for (const body of [
    {rows: [{...valid, title: 'changed'}]}, {rows: [{...valid, price: '=10+2'}]},
    {rows: [{...valid, price: null}]}, {rows: [{...valid, price: 1.5}]},
    {rows: [{...valid, id: 'gid://shopify/Product/1'}]},
    {rows: [valid, valid]}, {rows: [valid], vendor: 'changed'},
    {rows: Array.from({length: 101}, (_, index) => ({...valid, id: id(index + 1)}))},
  ]) assert.throws(() => validatePriceBatch(body));
});

test('wrong headers and oversized templates are rejected', async () => {
  const workbook = await makePriceWorkbook([{id: id(1), title: 'Bir', barcode: '001', catalogPrice: null}]);
  const sheet = workbook.getWorksheet('Fiyatlar')!;
  sheet.getCell('E1').value = 'Fiyat';
  assert.throws(() => inspectPriceSheet(sheet), /sütunları/);
  sheet.getCell('E1').value = 'Yeni fiyat (TL)';
  sheet.getCell(5002, 1).value = id(5001);
  assert.throws(() => inspectPriceSheet(sheet), /5.000/);
});

function testArchive(overrides: {expanded?: number; flags?: number; extra?: Buffer; contents?: string} = {}) {
  const localParts: Buffer[] = [], directoryParts: Buffer[] = [], offsets: number[] = [];
  let localOffset = 0;
  for (const filename of ['[Content_Types].xml', 'xl/workbook.xml']) {
    const name = Buffer.from(filename), contents = Buffer.from(overrides.contents || '<xml/>');
    const compressed = deflateRawSync(contents), extra = overrides.extra || Buffer.alloc(0);
    const local = Buffer.alloc(30), directory = Buffer.alloc(46), expanded = overrides.expanded ?? contents.length;
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(overrides.flags || 0, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(expanded, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(extra.length, 28);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(overrides.flags || 0, 8); directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(expanded, 24);
    directory.writeUInt16LE(name.length, 28); directory.writeUInt16LE(extra.length, 30);
    directory.writeUInt32LE(localOffset, 42);
    offsets.push(localOffset);
    localParts.push(local, name, extra, compressed);
    directoryParts.push(directory, name, extra);
    localOffset += local.length + name.length + extra.length + compressed.length;
  }
  const central = Buffer.concat(directoryParts), footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0); footer.writeUInt16LE(2, 8); footer.writeUInt16LE(2, 10);
  footer.writeUInt32LE(central.length, 12); footer.writeUInt32LE(localOffset, 16);
  const bytes = new Uint8Array(Buffer.concat([...localParts, central, footer]));
  return {data: bytes.buffer as ArrayBuffer, central: localOffset, footer: bytes.length - 22, locals: offsets};
}

test('ZIP preflight accepts normal bounded archives and rejects excess declared/actual expansion', async () => {
  await preflightPriceWorkbook(testArchive().data);
  await assert.rejects(preflightPriceWorkbook(testArchive({expanded: 17 * 1024 * 1024}).data), /32 MB/);
  // A forged small directory size must not let a compressed payload bypass the bound.
  await assert.rejects(preflightPriceWorkbook(testArchive({expanded: 1, contents: 'x'.repeat(100_000)}).data), /arşiv yapısı/);
});

test('ZIP preflight rejects encrypted, ZIP64, truncated and inconsistent archives before workbook parsing', async () => {
  await assert.rejects(preflightPriceWorkbook(testArchive({flags: 1}).data), /Şifrelenmiş/);
  await assert.rejects(preflightPriceWorkbook(testArchive({expanded: 0xffffffff}).data), /ZIP64/);
  await assert.rejects(preflightPriceWorkbook(testArchive({extra: Buffer.from([1, 0, 0, 0])}).data), /ZIP64/);
  await assert.rejects(preflightPriceWorkbook(new ArrayBuffer(10)), /arşiv yapısı/);
  const count = testArchive();
  new DataView(count.data).setUint16(count.footer + 10, 513, true);
  new DataView(count.data).setUint16(count.footer + 8, 513, true);
  await assert.rejects(preflightPriceWorkbook(count.data), /çok fazla/);
  const bounds = testArchive();
  new DataView(bounds.data).setUint32(bounds.central + 42, bounds.central - 2, true);
  await assert.rejects(preflightPriceWorkbook(bounds.data), /arşiv yapısı/);
  const mismatched = testArchive();
  new DataView(mismatched.data).setUint32(mismatched.locals[0] + 22, 123, true);
  await assert.rejects(preflightPriceWorkbook(mismatched.data), /arşiv yapısı/);
});
