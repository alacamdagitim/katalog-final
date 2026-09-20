import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rm,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

// prices.ts resolves its development file at import time. Import it only after
// entering a test-owned directory; never read or restore the owner's live file.
const originalCwd=process.cwd();
const originalNetlify=process.env.NETLIFY,originalSite=process.env.NETLIFY_SITE_ID,originalRuntimeSite=process.env.SITE_ID;
const originalVercel=process.env.VERCEL,originalVercelEnv=process.env.VERCEL_ENV;
let testDirectory:string;
before(async()=>{testDirectory=await mkdtemp(join(tmpdir(),'alacam-catalog-test-'));delete process.env.NETLIFY;delete process.env.NETLIFY_SITE_ID;delete process.env.SITE_ID;delete process.env.VERCEL;delete process.env.VERCEL_ENV;process.chdir(testDirectory);});
after(async()=>{
 process.chdir(originalCwd);
 if(originalNetlify===undefined)delete process.env.NETLIFY;else process.env.NETLIFY=originalNetlify;
 if(originalSite===undefined)delete process.env.NETLIFY_SITE_ID;else process.env.NETLIFY_SITE_ID=originalSite;
 if(originalRuntimeSite===undefined)delete process.env.SITE_ID;else process.env.SITE_ID=originalRuntimeSite;
 if(originalVercel===undefined)delete process.env.VERCEL;else process.env.VERCEL=originalVercel;
 if(originalVercelEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=originalVercelEnv;
 if(testDirectory)await rm(testDirectory,{recursive:true,force:true});
});

test('live Shopify catalog merges only the private catalog price',async()=>{
 const priceFile=join(process.cwd(),'.local','prices.json');let backup:string|undefined;
 try{backup=await readFile(priceFile,'utf8')}catch{}
 const original=globalThis.fetch,variant='gid://shopify/ProductVariant/11';
 globalThis.fetch=async()=>Response.json({data:{products:{nodes:[{id:'gid://shopify/Product/1',handle:'dogus-cay',title:'Doğuş Çay',vendor:'Doğuş',productType:'Siyah Çay',description:'Canlı açıklama',featuredImage:{url:'https://cdn.example/image.jpg'},variants:{nodes:[{id:variant,title:'Default Title',barcode:'00123',availableForSale:true,image:null}]}}],pageInfo:{hasNextPage:false,endCursor:'end'}}}});
 try{
  const {setPrice}=await import('../lib/prices');const {liveCatalog}=await import('../lib/live-catalog');
  await setPrice(variant,12590);const result=await liveCatalog(new URLSearchParams('q=çay'));
  assert.equal(result.items.length,1);assert.equal(result.items[0].title,'Doğuş Çay');assert.equal(result.items[0].catalogPrice,12590);assert.equal(result.items[0].barcode,'00123');assert.deepEqual(result.vendors,['Doğuş']);
 }finally{globalThis.fetch=original;if(backup===undefined)await rm(priceFile,{force:true});else{await mkdir(join(process.cwd(),'.local'),{recursive:true});await writeFile(priceFile,backup)}}
});

test('catalog filters use Shopify search conditions and only matching available variants',async()=>{
 const original=globalThis.fetch;
 let query='';
 globalThis.fetch=async(_url,init)=>{
  query=JSON.parse(String(init?.body)).variables.query;
  return Response.json({data:{products:{nodes:[{id:'gid://shopify/Product/1',handle:'cay',title:'Çay',vendor:'Doğuş',productType:'Siyah Çay',description:'',tags:['Bergamotlu'],variants:{nodes:[{id:'gid://shopify/ProductVariant/901',title:'1 Koli',availableForSale:true},{id:'gid://shopify/ProductVariant/902',title:'3 Koli',availableForSale:false}]}}],pageInfo:{hasNextPage:false,endCursor:null}}}});
 };
 try{
  const {liveCatalog}=await import('../lib/live-catalog');
  const result=await liveCatalog(new URLSearchParams({vendor:'Doğuş',type:'Siyah Çay',tag:'Bergamotlu',stock:'available'}));
  assert.match(query,/vendor:"Doğuş"/);assert.match(query,/product_type:"Siyah Çay"/);
  assert.match(query,/tag:"Bergamotlu"/);assert.match(query,/available_for_sale:true/);
  assert.equal(result.items.length,1);assert.equal(result.items[0].available,true);
  await assert.rejects(()=>liveCatalog(new URLSearchParams('minPrice=250&maxPrice=100')),/büyük olamaz/);
 }finally{globalThis.fetch=original;}
});

test('sold-out filtering keeps mixed-stock products and follows later variant pages',async()=>{
 const original=globalThis.fetch;let nextVariantPage=false;
 globalThis.fetch=async(_url,init)=>{
  const request=JSON.parse(String(init?.body));
  if(request.query.includes('CatalogVariants')){
   nextVariantPage=true;assert.equal(request.variables.after,'variant-next');
   return Response.json({data:{product:{variants:{nodes:[{id:'gid://shopify/ProductVariant/903',title:'3 Koli',availableForSale:false}],pageInfo:{hasNextPage:false,endCursor:null}}}}});
  }
  assert.ok(!String(request.variables.query).includes('available_for_sale:false'));
  return Response.json({data:{products:{nodes:[{id:'gid://shopify/Product/1',handle:'cay',title:'Çay',vendor:'Doğuş',productType:'Siyah Çay',description:'',variants:{nodes:[{id:'gid://shopify/ProductVariant/901',title:'1 Koli',availableForSale:true}],pageInfo:{hasNextPage:true,endCursor:'variant-next'}}}],pageInfo:{hasNextPage:false,endCursor:null}}}});
 };
 try{
  const {liveCatalog}=await import('../lib/live-catalog');
  const result=await liveCatalog(new URLSearchParams('stock=unavailable'));
  assert.equal(nextVariantPage,true);assert.equal(result.items.length,1);
  assert.equal(result.items[0].id,'gid://shopify/ProductVariant/903');
 }finally{globalThis.fetch=original;}
});

test('price filtering covers saved prices beyond a product page and paginates without duplicates',async()=>{
 const priceFile=join(process.cwd(),'.local','prices.json');let backup:string|undefined;
 try{backup=await readFile(priceFile,'utf8')}catch{}
 const original=globalThis.fetch;
 const ids=Array.from({length:30},(_,index)=>`gid://shopify/ProductVariant/${900000+index}`);
 let productPageRequested=false;
 globalThis.fetch=async(_url,init)=>{
  const request=JSON.parse(String(init?.body));
  if(request.query.includes('products('))productPageRequested=true;
  return Response.json({data:{nodes:request.variables.ids.map((id:string)=>ids.includes(id)?{
   id,title:'Default Title',availableForSale:true,
   product:{id:'gid://shopify/Product/99',handle:'test',title:'DaVinci Şurup',vendor:'DaVinci Gourmet',productType:'Şurup',description:'',tags:['Vegan']},
  }:null)}});
 };
 try{
  const {setPrices}=await import('../lib/prices');const {liveCatalog}=await import('../lib/live-catalog');
  await setPrices(ids.map(id=>({id,price:12550})));
  const params=new URLSearchParams({minPrice:'125,50',maxPrice:'125.50',q:'Da Vinci',tag:'Vegan',stock:'available'});
  const first=await liveCatalog(params);
  assert.equal(first.items.length,24);assert.equal(first.hasNextPage,true);
  params.set('after',first.cursor!);const second=await liveCatalog(params);
  assert.equal(second.items.length,6);assert.equal(second.hasNextPage,false);
  assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,30);
  assert.equal(productPageRequested,false);
  assert.ok([...first.items,...second.items].every(item=>item.catalogPrice===12550));
  params.set('maxPrice','126');await assert.rejects(()=>liveCatalog(params),/sonuç sayfası geçersiz/);
 }finally{globalThis.fetch=original;if(backup===undefined)await rm(priceFile,{force:true});else{await mkdir(join(process.cwd(),'.local'),{recursive:true});await writeFile(priceFile,backup)}}
});

test('quote validation rejects oversized, empty, duplicate, and malformed lists without truncation',async()=>{
 const {liveQuote}=await import('../lib/live-catalog');
 const line={id:'gid://shopify/ProductVariant/910001',title:'Test',quantity:1};
 const invalid=[
  {lines:[]},{lines:[...Array.from({length:101},(_,n)=>({...line,id:`gid://shopify/ProductVariant/${920000+n}`}))]},
  {lines:[line,line]},{lines:[{...line,id:'gid://shopify/ProductVariant/not-an-id'}]},
  ...[0,-1,1.5,100001,'2',Infinity].map(quantity=>({lines:[{...line,quantity}]})),
 ];
 for(const body of invalid)await assert.rejects(()=>liveQuote(body),(error:unknown)=>(error as {status?:number}).status===400);
});

test('quote totals distinguish unknown prices, mixed subtotals, and a valid zero price',async()=>{
 const {setPrices}=await import('../lib/prices');const {liveQuote}=await import('../lib/live-catalog');
 const {setVisibility}=await import('../lib/catalog-visibility');
 const known='gid://shopify/ProductVariant/910001',zero='gid://shopify/ProductVariant/910002',unknown='gid://shopify/ProductVariant/910003';
 const original=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>Response.json({data:{nodes:JSON.parse(String(init?.body)).variables.ids.map((id:string)=>({id,__typename:'ProductVariant',title:'Default Title',product:{id:'gid://shopify/Product/1',title:'Shopify ürün adı'}}))}});
 try{
  await setVisibility([known,zero,unknown],true);
  await setPrices([{id:known,price:123450},{id:zero,price:0}]);
  const allUnknown=await liveQuote({lines:[{id:unknown,quantity:2,title:'Fiyat bekleyen'}]});
  assert.match(allUnknown.text,/Toplam: Fiyat teyidi istenecek/);assert.equal(allUnknown.lines[0].price,null);
  const mixed=await liveQuote({lines:[{id:known,quantity:2,title:'Fiyatlı'},{id:unknown,quantity:1,title:'Fiyatsız'}]});
  assert.equal(mixed.total,246900);assert.match(mixed.text,/Fiyatı belli ürünlerin ara toplamı:/);
  assert.match(mixed.text,/Diğer ürünler için fiyat teyidi/);assert.equal(mixed.lines.length,2);
  assert.equal(mixed.lines[0].title,'Shopify ürün adı');
  const free=await liveQuote({lines:[{id:zero,quantity:1,title:'Sıfır fiyat'}]});
  assert.equal(free.lines[0].price,0);assert.ok(free.text.includes('Toplam: '));assert.ok(!free.text.includes('Fiyat teyidi istenecek'));
 }finally{globalThis.fetch=original;}
});
