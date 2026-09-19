import type {Product} from './model';

// Verified primary-domain redirect of this catalog's connected Shopify store.
export const storefrontOrigin='https://alacamdagitim.com';
export function productStorefrontUrl(product:Pick<Product,'handle'|'shopifyVariantId'>):string|null{
 const handle=product.handle?.trim();
 if(!handle||handle==='.'||handle==='..')return null;
 const url=new URL('/products/'+encodeURIComponent(handle),storefrontOrigin);
 const variant=product.shopifyVariantId?.match(/^gid:\/\/shopify\/ProductVariant\/([1-9]\d*)$/)?.[1];
 if(variant)url.searchParams.set('variant',variant);
 return url.toString();
}
