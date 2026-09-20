import {identity} from '@/lib/auth';
import {storefrontQuery} from '@/lib/catalog-filters';
import {setPrice} from '@/lib/prices';
import {parsePrice, VARIANT_ID} from '@/lib/price-excel';
import {sameOrigin, ok, fail, HttpError} from '@/lib/http';

const MAX_BODY_BYTES = 4096;

async function readPriceRequest(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'JSON biçiminde fiyat gerekli.');
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY_BYTES) throw new HttpError(413, 'Fiyat isteği çok büyük.');
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, 'Fiyat isteği boş.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, 'Fiyat isteği çok büyük.');
      }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new HttpError(400, 'Fiyat isteği okunamadı.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['id', 'price'].includes(key))
    || !Object.hasOwn(body, 'id') || !Object.hasOwn(body, 'price')) {
    throw new HttpError(400, 'Yalnızca varyasyon kimliği ve katalog fiyatı gönderilebilir.');
  }
  return body as Record<string, unknown>;
}

export async function PATCH(req: Request) {
  try {
    sameOrigin(req);
    if (!await identity()) throw new HttpError(401, 'Yönetici girişi gerekli.');
    const body = await readPriceRequest(req);
    if (typeof body.id !== 'string' || body.id.length > 90 || !VARIANT_ID.test(body.id)) throw new HttpError(400, 'Geçersiz varyasyon kimliği.');
    const {price, error} = parsePrice(body.price);
    if (error) throw new HttpError(400, error);
    const data = await storefrontQuery<{node: {id: string; __typename: string; product?: {id: string}} | null}>(
      'query ValidatePriceVariant($id:ID!){node(id:$id){id __typename ... on ProductVariant{product{id}}}}',
      {id: body.id},
    );
    if (data.node?.__typename !== 'ProductVariant' || data.node.id !== body.id || !data.node.product?.id) {
      throw new HttpError(422, 'Ürün Shopify’ın yayınlı kataloğunda bulunamadı. Kimliği ve yayın durumunu kontrol edin.');
    }
    // The individual editor keeps its existing explicit blank/null = delete behavior.
    await setPrice(body.id, price);
    return ok({saved: true, price});
  } catch (error) { return fail(error); }
}
