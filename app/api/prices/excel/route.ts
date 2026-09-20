import {identity} from '@/lib/auth';
import {storefrontQuery} from '@/lib/catalog-filters';
import {sameOrigin, ok, fail, HttpError} from '@/lib/http';
import {setPrices} from '@/lib/prices';
import {validatePriceBatch} from '@/lib/price-excel';

const MAX_BODY_BYTES = 64 * 1024;

async function readBody(req: Request): Promise<unknown> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'JSON biçiminde fiyat listesi gerekli.');
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY_BYTES) throw new HttpError(413, 'Fiyat güncelleme isteği çok büyük.');
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, 'Fiyat listesi boş.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, 'Fiyat güncelleme isteği çok büyük.');
      }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new HttpError(400, 'Fiyat listesi okunamadı.'); }
}

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    if (!await identity()) throw new HttpError(401, 'Yönetici girişi gerekli.');
    const body = await readBody(req);
    let rows;
    try { rows = validatePriceBatch(body); }
    catch (error) { throw new HttpError(400, (error as Error).message); }

    const data = await storefrontQuery<{nodes: Array<{id: string; __typename: string; product?: {id: string}} | null>}>(
      'query ValidatePriceVariants($ids:[ID!]!){nodes(ids:$ids){id __typename ... on ProductVariant{product{id}}}}',
      {ids: rows.map(row => row.id)},
    );
    const valid = new Set(data.nodes.filter(node => node?.__typename === 'ProductVariant' && node.product?.id).map(node => node!.id));
    const unknown = rows.filter(row => !valid.has(row.id));
    if (unknown.length) return ok({
      updated: [],
      failed: unknown.map(row => ({id: row.id, row: row.row, error: 'Ürün Shopify’ın yayınlı kataloğunda bulunamadı. Kimliği ve yayın durumunu kontrol edin.'})),
      error: 'Bu grupta tanınmayan ürün bulundu; gruptaki hiçbir fiyat kaydedilmedi.',
    }, {status: 422});

    const result = await setPrices(rows.map(({id, price}) => ({id, price})));
    return ok({...result, failed: result.failed.map(failure => ({...failure, row: rows.find(row => row.id === failure.id)!.row}))});
  } catch (error) { return fail(error); }
}
