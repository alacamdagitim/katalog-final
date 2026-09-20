import {getAllPrices, getPrices} from './prices';
import {catalogText, quotedSearchValue, storefrontQuery} from './catalog-filters';
import {HttpError} from './http';
import {productDescription} from './product-description';
import {getVisibleIds,getVisibility} from './catalog-visibility';
import type {CatalogFilters} from './catalog-filters';
import {createHash} from 'node:crypto';

export type CatalogItem = {id:string;productId:string;handle:string;title:string;vendor:string;type:string;description:string;barcode:string;catalogPrice:number|null;image:string;available:boolean;storefrontUrl:string;tags?:string[];catalogVisible?:boolean};
export type CatalogPage = {items:CatalogItem[];cursor:string|null;hasNextPage:boolean;vendors:string[];types:string[];tags?:string[]};
type Variant = {id:string;title:string;barcode?:string|null;availableForSale:boolean;image?:{url:string}|null};
type PageInfo={hasNextPage:boolean;endCursor:string|null};
type Product = {id:string;handle:string;title:string;vendor:string;productType:string;description:string;descriptionHtml?:string;tags?:string[];featuredImage?:{url:string}|null;variants:{nodes:Variant[];pageInfo?:PageInfo}};
type VariantNode = Variant & {product:Omit<Product,'variants'>};
const productFields = 'id handle title vendor productType description descriptionHtml tags featuredImage{url}';
const variantFields = 'id title barcode availableForSale image{url}';
const sorted = (values:string[]) => [...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'tr'));

function item(product:Omit<Product,'variants'>,variant:Variant,price:number|null):CatalogItem {
  return {
    id:variant.id,productId:product.id,handle:product.handle,
    title:variant.title==='Default Title'?product.title:`${product.title} · ${variant.title}`,
    vendor:product.vendor||'',type:product.productType||'',description:productDescription(product.descriptionHtml,product.description||''),
    barcode:variant.barcode||'',catalogPrice:price,image:variant.image?.url||product.featuredImage?.url||'',
    available:variant.availableForSale,tags:product.tags||[],
    storefrontUrl:`https://alacamdagitim.com/products/${encodeURIComponent(product.handle)}?variant=${variant.id.split('/').pop()}`,
  };
}

function page(items:CatalogItem[],cursor:string|null,hasNextPage:boolean):CatalogPage {
  return {
    items,cursor,hasNextPage,vendors:sorted(items.map(value=>value.vendor)),
    types:sorted(items.map(value=>value.type)),tags:sorted(items.flatMap(value=>value.tags||[])),
  };
}

function priceBound(value:string|null):number|null {
  if(value===null||!value.trim())return null;
  const decimal=value.trim().replace(',','.');
  if(!/^\d+(?:\.\d{1,2})?$/.test(decimal))throw new HttpError(400,'Fiyatı 1250 veya 1250,50 şeklinde girin.');
  const cents=Math.round(Number(decimal)*100);
  if(!Number.isSafeInteger(cents)||cents>100000000000)throw new HttpError(400,'Geçerli bir fiyat aralığı girin.');
  return cents;
}

async function completeVariants(products:Product[]) {
  const pending=products.filter(product=>product.variants.pageInfo?.hasNextPage);
  for(let offset=0;offset<pending.length;offset+=4){
    await Promise.all(pending.slice(offset,offset+4).map(async product=>{
      let pages=0;
      while(product.variants.pageInfo?.hasNextPage){
        if(pages++>=24)throw new HttpError(502,'Ürünün seçenek listesi tamamlanamadı. Lütfen yeniden deneyin.');
        const data=await storefrontQuery<{product:{variants:{nodes:Variant[];pageInfo:PageInfo}}|null}>(
          `query CatalogVariants($id:ID!,$after:String!){product(id:$id){variants(first:100,after:$after){nodes{${variantFields}} pageInfo{hasNextPage endCursor}}}}`,
          {id:product.id,after:product.variants.pageInfo.endCursor},
        );
        if(!data.product){product.variants.nodes=[];break;}
        product.variants.nodes.push(...data.product.variants.nodes);
        product.variants.pageInfo=data.product.variants.pageInfo;
      }
    }));
  }
}

export async function liveCatalog(params:URLSearchParams):Promise<CatalogPage> {
  const q=catalogText(params.get('q')),vendor=catalogText(params.get('vendor')),type=catalogText(params.get('type'));
  const tag=catalogText(params.get('tag')),stock=params.get('stock')||'';
  if(stock&&!['available','unavailable'].includes(stock))throw new HttpError(400,'Geçersiz stok filtresi.');
  const minPrice=priceBound(params.get('minPrice')),maxPrice=priceBound(params.get('maxPrice'));
  if(minPrice!==null&&maxPrice!==null&&minPrice>maxPrice)throw new HttpError(400,'En düşük fiyat, en yüksek fiyattan büyük olamaz.');
  if(minPrice!==null||maxPrice!==null)return pricedCatalog(params,{q,vendor,type,tag,stock,minPrice,maxPrice});

  const parts:string[]=[];
  if(q)parts.push(`(${q})`);
  if(vendor)parts.push(`vendor:${quotedSearchValue(vendor)}`);
  if(type)parts.push(`product_type:${quotedSearchValue(type)}`);
  if(tag)parts.push(`tag:${quotedSearchValue(tag)}`);
  if(stock==='available')parts.push('available_for_sale:true');
  // An unavailable variant may belong to a product whose other variants are
  // available, so product-level available_for_sale:false would lose records.
  let after=params.get('after')||null;
  let pageInfo:PageInfo={hasNextPage:false,endCursor:null};
  const products:Product[]=[];
  for(let scan=0;scan<(stock==='unavailable'?4:1);scan++){
    const data=await storefrontQuery<{products:{nodes:Product[];pageInfo:PageInfo}}>(
      `query LiveCatalog($after:String,$query:String){products(first:24,after:$after,sortKey:TITLE,query:$query){nodes{${productFields} variants(first:100){nodes{${variantFields}} pageInfo{hasNextPage endCursor}}} pageInfo{hasNextPage endCursor}}}`,
      {after,query:parts.join(' AND ')||null},
    );
    await completeVariants(data.products.nodes);
    products.push(...data.products.nodes);
    pageInfo=data.products.pageInfo;
    if(stock!=='unavailable'||products.some(product=>product.variants.nodes.some(variant=>!variant.availableForSale))||!pageInfo.hasNextPage)break;
    after=pageInfo.endCursor;
  }
  const ids=products.flatMap(product=>product.variants.nodes.map(variant=>variant.id));
  const prices=await getPrices(ids);
  const items=products.flatMap(product=>product.variants.nodes
    .filter(variant=>!stock||(stock==='available')===variant.availableForSale)
    .map(variant=>item(product,variant,prices[variant.id]??null)));
  return page(items,pageInfo.endCursor||null,!!pageInfo.hasNextPage);
}

type PriceFilters={q:string;vendor:string;type:string;tag:string;stock:string;minPrice:number|null;maxPrice:number|null};
const normalized=(value:string)=>value.toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');

async function pricedCatalog(params:URLSearchParams,filters:PriceFilters):Promise<CatalogPage> {
  const prices=await getAllPrices();
  // Select from every saved price before fetching products, not only the current Shopify page.
  const ids=Object.keys(prices).filter(id=>prices[id]>=(filters.minPrice??0)&&prices[id]<=(filters.maxPrice??Infinity)).sort();
  return selectedCatalog(params,filters,ids,'catalog-price',prices);
}

function matchesProduct(filters:PriceFilters,product:Omit<Product,'variants'>,variant:Pick<Variant,'title'|'availableForSale'|'barcode'>){
  if(filters.vendor&&normalized(product.vendor)!==normalized(filters.vendor))return false;
  if(filters.type&&normalized(product.productType)!==normalized(filters.type))return false;
  if(filters.tag&&!(product.tags||[]).some(tag=>normalized(tag)===normalized(filters.tag)))return false;
  if(filters.stock&&(filters.stock==='available')!==variant.availableForSale)return false;
  const words=normalized(filters.q).replace(/["'()]/g,' ').split(/\s+/).filter(Boolean);
  const searchable=normalized([product.title,variant.title,variant.barcode||'',product.vendor,product.productType,product.description,...(product.tags||[])].join(' '));
  const compact=searchable.replace(/\s/g,'');
  return !words.some(word=>!searchable.includes(word)&&!compact.includes(word));
}

async function selectedCatalog(params:URLSearchParams,filters:PriceFilters,ids:string[],kind:'catalog-price'|'catalog-visible',prices?:Record<string,number>):Promise<CatalogPage>{
  const fingerprint=JSON.stringify(filters);
  let offset=0;
  const after=params.get('after');
  if(after){
    try{
      const decoded=JSON.parse(Buffer.from(after,'base64url').toString()) as {kind?:string;offset?:number;filter?:string};
      if(decoded.kind!==kind||decoded.filter!==fingerprint||!Number.isSafeInteger(decoded.offset)||decoded.offset!<0)throw new Error();
      offset=decoded.offset!;
    }catch{throw new HttpError(400,'Bu sonuç sayfası geçersiz. Filtreleri yeniden uygulayın.');}
  }
  const items:CatalogItem[]=[];
  // Read no more than 256 selected variants per request. Selection happens
  // before paging, so an approved item beyond Shopify's first page is included.
  let batches=0;
  while(offset<ids.length&&items.length<24&&batches++<4){
    const batch=ids.slice(offset,offset+64);
    const data=await storefrontQuery<{nodes:(VariantNode|null)[]}>(
      `query PricedCatalog($ids:[ID!]!){nodes(ids:$ids){... on ProductVariant{${variantFields} product{${productFields}}}}}`,
      {ids:batch},
    );
    for(const node of data.nodes){
      offset++;
      if(!node)continue;
      const product=node.product;
      if(!matchesProduct(filters,product,node))continue;
      items.push({...item(product,node,prices?.[node.id]??null),...(kind==='catalog-visible'?{catalogVisible:true}:{})});
      if(items.length===24)break;
    }
  }
  const hasNextPage=offset<ids.length;
  if(!prices&&items.length){
    const currentPrices=await getPrices(items.map(value=>value.id));
    for(const value of items)value.catalogPrice=currentPrices[value.id]??null;
  }
  const cursor=hasNextPage?Buffer.from(JSON.stringify({kind,offset,filter:fingerprint})).toString('base64url'):null;
  return page(items,cursor,hasNextPage);
}

function publicParameters(params:URLSearchParams):PriceFilters{
  const minPrice=priceBound(params.get('minPrice')),maxPrice=priceBound(params.get('maxPrice'));
  const stock=params.get('stock')||'';
  if(stock&&!['available','unavailable'].includes(stock))throw new HttpError(400,'Geçersiz stok filtresi.');
  if(minPrice!==null&&maxPrice!==null&&minPrice>maxPrice)throw new HttpError(400,'En düşük fiyat, en yüksek fiyattan büyük olamaz.');
  return {q:catalogText(params.get('q')),vendor:catalogText(params.get('vendor')),type:catalogText(params.get('type')),tag:catalogText(params.get('tag')),stock,minPrice,maxPrice};
}

/** The public catalog is always an explicit allow-list, independent of price. */
export async function publicCatalog(params:URLSearchParams):Promise<CatalogPage>{
  const filters=publicParameters(params);
  let ids=(await getVisibleIds()).sort();
  let prices:Record<string,number>|undefined;
  if(filters.minPrice!==null||filters.maxPrice!==null){
    prices=await getAllPrices();
    ids=ids.filter(id=>prices![id]!==undefined&&prices![id]>=(filters.minPrice??0)&&prices![id]<=(filters.maxPrice??Infinity));
  }
  if(!ids.length)return page([],null,false);
  return selectedCatalog(params,filters,ids,'catalog-visible',prices);
}

const publicFacetCache=new Map<string,{expires:number;value:Promise<CatalogFilters>}>();
export async function publicCatalogFilters(params=new URLSearchParams()):Promise<CatalogFilters>{
  const ids=(await getVisibleIds()).sort();
  if(!ids.length)return {vendors:[],types:[],tags:[],limits:{vendors:false,types:false,tags:false}};
  const filters=publicParameters(new URLSearchParams({q:params.get('q')||'',vendor:params.get('vendor')||'',type:params.get('type')||''}));
  // Visibility is reread on every call. Revocation changes this cache key, so
  // cached labels can never publish a product that is no longer approved.
  const key=createHash('sha256').update(JSON.stringify([process.env.SHOPIFY_SHOP_DOMAIN,ids,filters])).digest('hex');
  const cached=publicFacetCache.get(key);
  if(cached&&cached.expires>Date.now())return cached.value;
  const pending=(async()=>{
    const vendors=new Set<string>(),types=new Set<string>(),tags=new Set<string>();
    for(let offset=0;offset<ids.length;offset+=400){
      await Promise.all(Array.from({length:4},(_,batch)=>ids.slice(offset+batch*100,offset+(batch+1)*100)).filter(batch=>batch.length).map(async batch=>{
        const data=await storefrontQuery<{nodes:(VariantNode|null)[]}>(
          'query ApprovedCatalogFacets($ids:[ID!]!){nodes(ids:$ids){... on ProductVariant{id title barcode availableForSale product{id title vendor productType description tags}}}}',
          {ids:batch},
        );
        for(const node of data.nodes){
          if(!node||!matchesProduct({...filters,vendor:'',type:''},node.product,node))continue;
          if(node.product.vendor)vendors.add(node.product.vendor);
          if(filters.vendor&&normalized(node.product.vendor)!==normalized(filters.vendor))continue;
          if(node.product.productType)types.add(node.product.productType);
          if(filters.type&&normalized(node.product.productType)!==normalized(filters.type))continue;
          for(const tag of node.product.tags||[])if(tag)tags.add(tag);
        }
      }));
    }
    return {vendors:sorted([...vendors]),types:sorted([...types]),tags:sorted([...tags]),limits:{vendors:false,types:false,tags:false}};
  })();
  if(publicFacetCache.size>=50)publicFacetCache.delete(publicFacetCache.keys().next().value!);
  publicFacetCache.set(key,{expires:Date.now()+60_000,value:pending});
  try{return await pending;}catch(error){publicFacetCache.delete(key);throw error;}
}

export async function liveQuote(body:unknown){
  if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'Geçersiz sipariş listesi.');
  const input=body as {lines?:unknown;name?:unknown;note?:unknown};
  if(!Array.isArray(input.lines)||input.lines.length===0)throw new HttpError(400,'Sipariş listesine en az bir ürün ekleyin.');
  if(input.lines.length>100)throw new HttpError(400,'Bir sipariş listesinde en fazla 100 farklı ürün seçeneği olabilir.');
  if((input.name!==undefined&&typeof input.name!=='string')||(input.note!==undefined&&typeof input.note!=='string'))throw new HttpError(400,'Firma adı ve not metin olmalıdır.');
  const seen=new Set<string>();
  const lines=input.lines.map(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'Geçersiz sipariş satırı.');
    const line=value as {id?:unknown;quantity?:unknown;title?:unknown};
    if(typeof line.id!=='string'||!/^gid:\/\/shopify\/ProductVariant\/\d{1,20}(?![\s\S])/.test(line.id))throw new HttpError(400,'Sipariş listesindeki ürün seçeneği geçersiz.');
    if(typeof line.quantity!=='number'||!Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>100000)throw new HttpError(400,'Ürün adedi 1 ile 100.000 arasında tam sayı olmalıdır.');
    if(seen.has(line.id))throw new HttpError(400,'Aynı ürün seçeneği listede birden fazla kez bulunamaz.');
    if(line.title!==undefined&&typeof line.title!=='string')throw new HttpError(400,'Ürün adı metin olmalıdır.');
    seen.add(line.id);
    return {id:line.id,quantity:line.quantity,title:typeof line.title==='string'?line.title.trim().slice(0,200)||'Ürün':'Ürün'};
  });
  const visible=await getVisibility(lines.map(line=>line.id));
  if(lines.some(line=>!visible[line.id]))throw new HttpError(409,'Sepetteki bazı ürünler artık katalogda bulunmuyor. Lütfen sepetinizi güncelleyin.');
  const live=await storefrontQuery<{nodes:({id:string;__typename:string;title:string;product?:{id:string;title:string}}|null)[]}>(
    'query QuoteProducts($ids:[ID!]!){nodes(ids:$ids){id __typename ... on ProductVariant{title product{id title}}}}',
    {ids:lines.map(line=>line.id)},
  );
  const liveById=new Map(live.nodes.filter(node=>node?.__typename==='ProductVariant'&&node.product?.id).map(node=>[node!.id,node!]));
  if(lines.some(line=>!liveById.has(line.id)))throw new HttpError(409,'Sepetteki bazı ürünler artık satış kataloğunda bulunmuyor. Lütfen sepetinizi güncelleyin.');
  for(const line of lines){const node=liveById.get(line.id)!;line.title=node.title==='Default Title'?node.product!.title:`${node.product!.title} · ${node.title}`;}
  const prices=await getPrices(lines.map(line=>line.id));
  const priced=lines.map(line=>({...line,price:prices[line.id]??null}));
  const total=priced.reduce((sum,line)=>sum+(line.price??0)*line.quantity,0);
  const known=priced.filter(line=>line.price!==null).length;
  const money=(value:number)=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY'}).format(value/100);
  const totalText=known===0?'Toplam: Fiyat teyidi istenecek':known<priced.length?`Fiyatı belli ürünlerin ara toplamı: ${money(total)}`:`Toplam: ${money(total)}`;
  const text=[
    'Alaçam Dağıtım ürün talebi',input.name?`Firma / kişi: ${String(input.name).slice(0,120)}`:'',
    ...priced.map((line,index)=>`${index+1}. ${line.title} — ${line.quantity.toLocaleString('tr-TR')} adet — ${line.price===null?'Fiyat sorunuz':money(line.price*line.quantity)}`),
    totalText,known>0&&known<priced.length?'Diğer ürünler için fiyat teyidi istenecek.':'',
    input.note?`Not: ${String(input.note).slice(0,500)}`:'',
    'Fiyat, stok, KDV ve teslimat satıcı teyidiyle kesinleşir.',
  ].filter(Boolean).join('\n');
  return {lines:priced,total,text};
}
