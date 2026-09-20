import {identity} from '@/lib/auth';
import {storefrontQuery} from '@/lib/catalog-filters';
import {liveVisibilityIds, readVisibilityRequest, setVisibility, type VisibilityNode} from '@/lib/catalog-visibility';
import {fail, HttpError, ok, sameOrigin} from '@/lib/http';

export async function PATCH(req: Request) {
  try {
    sameOrigin(req);
    if (!await identity()) throw new HttpError(401, 'Yönetici girişi gerekli.');
    const {ids, visible} = await readVisibilityRequest(req);
    const data = await storefrontQuery<{nodes: VisibilityNode[]}>(
      'query ValidateVisibilityVariants($ids:[ID!]!){nodes(ids:$ids){id __typename ... on ProductVariant{product{id __typename}}}}',
      {ids},
    );
    const valid = liveVisibilityIds(ids, data.nodes);
    const known = new Set(valid);
    const result = valid.length ? await setVisibility(valid, visible) : {updated: [], failed: []};
    return ok({
      updated: result.updated,
      failed: [...result.failed, ...ids.filter(id => !known.has(id)).map(id => ({
        id, error: 'Ürün Shopify’ın yayınlı kataloğunda bulunamadı. Kimliği ve yayın durumunu kontrol edin.',
      }))],
    });
  } catch (error) { return fail(error); }
}
