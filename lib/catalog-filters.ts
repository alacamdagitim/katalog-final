import {HttpError} from './http';

export type CatalogFilters = {
  vendors: string[];
  types: string[];
  tags: string[];
  limits: {vendors: boolean; types: boolean; tags: boolean};
};

type Facet = {id: string; values: {label: string; input: string}[]};
const FACET_LIMIT = 100;
const facetFields = 'productFilters{id values{label input}}';
const sorted = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
export const catalogText = (value: string | null, max = 120) => (value || '').trim().slice(0, max);
export const quotedSearchValue = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export async function storefrontQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const domain = process.env.SHOPIFY_SHOP_DOMAIN || 'dx0nin-1q.myshopify.com';
  const response = await fetch(`https://${domain}/api/2026-07/graphql.json`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({query, variables}), cache: 'no-store', signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new HttpError(502, 'Shopify kataloğuna şu anda ulaşılamıyor.');
  const json = await response.json() as {data?: T; errors?: unknown[]};
  if (json.errors?.length || !json.data) throw new HttpError(502, 'Shopify ürün araması tamamlanamadı.');
  return json.data;
}

function values(facets: Facet[], id: string, field: string) {
  const facet = facets.find(item => item.id === id);
  return (facet?.values || []).map(value => {
    try { return String((JSON.parse(value.input) as Record<string, unknown>)[field] || value.label); }
    catch { return value.label; }
  });
}

async function readFacets(query: string): Promise<Facet[]> {
  const result = await storefrontQuery<{search: {productFilters: Facet[]}}>(
    `query CatalogFilters($query:String!){search(query:$query,first:1,types:[PRODUCT],unavailableProducts:SHOW){${facetFields}}}`,
    {query},
  );
  return result.search.productFilters;
}

const cache = new Map<string, {expires: number; value: Promise<CatalogFilters>}>();

/** Only lightweight Shopify facet labels are cached; no product snapshot or synchronization. */
export async function catalogFilters(params = new URLSearchParams()): Promise<CatalogFilters> {
  const q = catalogText(params.get('q'));
  const vendor = catalogText(params.get('vendor'));
  const type = catalogText(params.get('type'));
  const cacheKey = JSON.stringify([process.env.SHOPIFY_SHOP_DOMAIN, q, vendor, type]);
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;
  const pending = loadFilters(q, vendor, type);
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(cacheKey, {expires: Date.now() + 60_000, value: pending});
  try { return await pending; }
  catch (error) { cache.delete(cacheKey); throw error; }
}

async function loadFilters(q: string, vendor: string, type: string): Promise<CatalogFilters> {
  // A selected brand narrows types and tags, but must not hide the other brand choices.
  const baseQuery = q || '*';
  const contextualQuery = vendor ? `(${baseQuery}) AND vendor:${quotedSearchValue(vendor)}` : baseQuery;
  const [base, context, allTypes, tagContext] = await Promise.all([
    readFacets(baseQuery),
    vendor ? readFacets(contextualQuery) : Promise.resolve(null),
    !q && !vendor ? storefrontQuery<{productTypes: {nodes: string[]; pageInfo: {hasNextPage: boolean}}}>(
      '{productTypes(first:250){nodes pageInfo{hasNextPage}}}',
    ) : Promise.resolve(null),
    type ? readFacets(`(${contextualQuery}) AND product_type:${quotedSearchValue(type)}`) : Promise.resolve(null),
  ]);
  let vendors = values(base, 'filter.p.vendor', 'productVendor');
  let vendorLimit = vendors.length >= FACET_LIMIT;
  // Vendors are mutually exclusive on a product. Excluding previously returned
  // vendors allows us to read the next facet values without fetching products.
  for (let page = 1; vendorLimit && page < 4; page++) {
    const exclusions = vendors.map(value => `-vendor:${quotedSearchValue(value)}`).join(' ');
    const next = values(await readFacets(`(${baseQuery}) ${exclusions}`), 'filter.p.vendor', 'productVendor');
    const fresh = next.filter(value => !vendors.includes(value));
    vendors = [...vendors, ...fresh];
    vendorLimit = next.length >= FACET_LIMIT;
    if (!fresh.length) break;
  }
  const facets = context || base;
  const types = allTypes?.productTypes.nodes || values(facets, 'filter.p.product_type', 'productType');
  const tags = values(tagContext || facets, 'filter.p.tag', 'tag');
  return {
    vendors: sorted(vendors), types: sorted(types), tags: sorted(tags),
    limits: {
      vendors: vendorLimit,
      types: allTypes ? allTypes.productTypes.pageInfo.hasNextPage : types.length >= FACET_LIMIT,
      tags: tags.length >= FACET_LIMIT,
    },
  };
}
