import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Capture all import-time development paths only inside this test-owned folder.
const originalCwd=process.cwd(),originalFetch=globalThis.fetch;
const originalNetlify=process.env.NETLIFY,originalSite=process.env.NETLIFY_SITE_ID,originalRuntimeSite=process.env.SITE_ID;
const sandbox=await mkdtemp(join(tmpdir(),'approved-catalog-test-'));
delete process.env.NETLIFY;delete process.env.NETLIFY_SITE_ID;delete process.env.SITE_ID;
process.chdir(sandbox);
const {publicCatalog,publicCatalogFilters,liveQuote}=await import('../lib/live-catalog');
const {setPrices}=await import('../lib/prices');
const {setVisibility}=await import('../lib/catalog-visibility');
after(async()=>{
 globalThis.fetch=originalFetch;process.chdir(originalCwd);
 if(originalNetlify===undefined)delete process.env.NETLIFY;else process.env.NETLIFY=originalNetlify;
 if(originalSite===undefined)delete process.env.NETLIFY_SITE_ID;else process.env.NETLIFY_SITE_ID=originalSite;
 if(originalRuntimeSite===undefined)delete process.env.SITE_ID;else process.env.SITE_ID=originalRuntimeSite;
 await rm(sandbox,{recursive:true,force:true});
});
beforeEach(async()=>{
 globalThis.fetch=originalFetch;
 await rm(join(sandbox,'.local'),{recursive:true,force:true});
});

const id=(n:number)=>`gid://shopify/ProductVariant/${n}`;
const node=(n:number)=>({
 id:id(n),__typename:'ProductVariant',title:'Default Title',barcode:`009${n}`,availableForSale:n%2===0,
 product:{id:`gid://shopify/Product/${n}`,handle:`urun-${n}`,title:`Ürün ${n}`,vendor:n%2===0?'Doğuş':'DaVinci Gourmet',productType:n%2===0?'Siyah Çay':'Şurup',description:'Canlı ürün açıklaması',tags:n%2===0?['Bergamotlu']:['Vegan']},
});
function mockNodes(values:ReturnType<typeof node>[]){
 const all=new Map(values.map(value=>[value.id,value]));
 const requested:string[][]=[];
 globalThis.fetch=async(_url,init)=>{
  const request=JSON.parse(String(init?.body));
  assert.ok(Array.isArray(request.variables.ids),'No unrestricted product query is allowed on the public path.');
  requested.push(request.variables.ids);
  return Response.json({data:{nodes:request.variables.ids.map((value:string)=>all.get(value)||null)}});
 };
 return requested;
}

test('public catalog defaults hidden even when prices exist and makes no Shopify read',async()=>{
 await setPrices([{id:id(1),price:10000}]);
 globalThis.fetch=async()=>{throw new Error('Unexpected Shopify request');};
 assert.deepEqual((await publicCatalog(new URLSearchParams())).items,[]);
 assert.deepEqual(await publicCatalogFilters(),{vendors:[],types:[],tags:[],limits:{vendors:false,types:false,tags:false}});
 await assert.rejects(liveQuote({lines:[{id:id(1),quantity:1}]}),{status:409});
});

test('public pagination spans every approved ID; prices never approve hidden products',async()=>{
 const approved=Array.from({length:30},(_,n)=>node(1000+n));
 const hidden=node(1999),requested=mockNodes([...approved,hidden]);
 await setVisibility(approved.map(value=>value.id),true);
 await setPrices([{id:approved[0].id,price:12550},{id:hidden.id,price:9900}]);
 const params=new URLSearchParams();
 const first=await publicCatalog(params);
 assert.equal(first.items.length,24);assert.equal(first.hasNextPage,true);
 params.set('after',first.cursor!);
 const second=await publicCatalog(params);
 assert.equal(second.items.length,6);assert.equal(second.hasNextPage,false);
 const all=[...first.items,...second.items];
 assert.equal(new Set(all.map(value=>value.id)).size,30);
 assert.equal(all.find(value=>value.id===approved[0].id)?.catalogPrice,12550);
 assert.ok(all.some(value=>value.catalogPrice===null));
 assert.ok(all.every(value=>value.catalogVisible===true));
 assert.ok(requested.flat().every(value=>value!==hidden.id));
});

test('bounded sparse pages retain later matching approvals and never silently truncate',async()=>{
 const approved=Array.from({length:270},(_,n)=>node(3000+n));
 for(let offset=0;offset<approved.length;offset+=100)await setVisibility(approved.slice(offset,offset+100).map(value=>value.id),true);
 const requested=mockNodes(approved),params=new URLSearchParams({q:'3269'});
 const first=await publicCatalog(params);
 assert.equal(first.items.length,0);assert.equal(first.hasNextPage,true);
 assert.equal(requested.flat().length,256);
 params.set('after',first.cursor!);
 const second=await publicCatalog(params);
 assert.deepEqual(second.items.map(value=>value.id),[id(3269)]);assert.equal(second.hasNextPage,false);
 params.set('q','3268');await assert.rejects(publicCatalog(params),{status:400});
});

test('approval-first filters match barcode, type, tag, availability and only catalog prices',async()=>{
 const approved=[node(4000),node(4001),node(4002)],hidden=node(4999);
 mockNodes([...approved,hidden]);
 await setVisibility(approved.map(value=>value.id),true);
 await setPrices([{id:id(4000),price:12550},{id:id(4001),price:9900},{id:hidden.id,price:10000}]);
 const barcode=await publicCatalog(new URLSearchParams({q:'0094000'}));
 assert.deepEqual(barcode.items.map(value=>value.id),[id(4000)]);
 const ranged=await publicCatalog(new URLSearchParams({vendor:'Doğuş',type:'Siyah Çay',tag:'Bergamotlu',stock:'available',minPrice:'125,50',maxPrice:'125.50'}));
 assert.deepEqual(ranged.items.map(value=>value.id),[id(4000)]);
 assert.deepEqual((await publicCatalog(new URLSearchParams({stock:'unavailable'}))).items.map(value=>value.id),[id(4001)]);
 assert.deepEqual((await publicCatalog(new URLSearchParams({minPrice:'99',maxPrice:'100'}))).items.map(value=>value.id),[id(4001)]);
 await assert.rejects(publicCatalog(new URLSearchParams({minPrice:'2',maxPrice:'1'})),{status:400});
 await assert.rejects(publicCatalog(new URLSearchParams({stock:'maybe'})),{status:400});
});

test('public facet lists contain only approved live products and revocation invalidates labels',async()=>{
 const approved=[node(5000),node(5001)],hidden=node(5999);
 hidden.product.vendor='Gizli Marka';hidden.product.tags=['Gizli etiket'];
 const requests=mockNodes([...approved,hidden]);
 await setVisibility(approved.map(value=>value.id),true);
 const all=await publicCatalogFilters();
 assert.deepEqual(all.vendors,['DaVinci Gourmet','Doğuş']);
 assert.deepEqual(all.tags,['Bergamotlu','Vegan']);
 const context=await publicCatalogFilters(new URLSearchParams({vendor:'Doğuş',type:'Siyah Çay'}));
 assert.deepEqual(context.vendors,['DaVinci Gourmet','Doğuş']);
 assert.deepEqual(context.types,['Siyah Çay']);assert.deepEqual(context.tags,['Bergamotlu']);
 const barcode=await publicCatalogFilters(new URLSearchParams({q:'0095001'}));
 assert.deepEqual(barcode.vendors,['DaVinci Gourmet']);
 assert.deepEqual(barcode.tags,['Vegan']);
 await setVisibility([id(5001)],false);
 const revoked=await publicCatalogFilters();
 assert.deepEqual(revoked.vendors,['Doğuş']);assert.deepEqual(revoked.tags,['Bergamotlu']);
 assert.ok(requests.flat().every(value=>value!==hidden.id));
});

test('quotes refuse hidden, revoked or unpublished IDs and take product names from Shopify',async()=>{
 mockNodes([node(6000)]);
 await setVisibility([id(6000),id(6001)],true);
 await setPrices([{id:id(6000),price:10000}]);
 const quote=await liveQuote({lines:[{id:id(6000),quantity:3,title:'Forged title'}]});
 assert.equal(quote.lines[0].title,'Ürün 6000');assert.equal(quote.total,30000);
 await assert.rejects(liveQuote({lines:[{id:id(6001),quantity:1}]}),{status:409});
 await setVisibility([id(6000)],false);
 await assert.rejects(liveQuote({lines:[{id:id(6000),quantity:1}]}),{status:409});
 await assert.rejects(liveQuote({lines:[{id:id(6000)+'\n',quantity:1}]}),{status:400});
});

test('visibility storage failures fail closed rather than expose the unrestricted catalog',async()=>{
 await setVisibility([id(7000)],true);
 await writeFile(join(sandbox,'.local','visibility.json'),'{broken');
 globalThis.fetch=async()=>{throw new Error('Unexpected Shopify request');};
 await assert.rejects(publicCatalog(new URLSearchParams()),/okunamadı/);
 await assert.rejects(publicCatalogFilters(),/okunamadı/);
 await assert.rejects(liveQuote({lines:[{id:id(7000),quantity:1}]}),/okunamadı/);
});
