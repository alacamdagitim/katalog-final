import {db,HttpError} from './server';
import {normalize} from './model';
import {accessToken,shopDomain} from './shopify-auth';
export {shopDomain} from './shopify-auth';
export async function shopify(query:string,variables:Record<string,any>={},providedToken?:string){
 if(!query.trim().startsWith('query')||/\bmutation\b/i.test(query))throw new Error('Shopify writes are disabled');
 const send=(token:string)=>fetch(`https://${shopDomain}/admin/api/2026-07/graphql.json`,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(8000)});
 let response=await send(providedToken||await accessToken());
 if(response.status===401&&!providedToken)response=await send(await accessToken(true));
 if(response.status>=300&&response.status<400)throw new HttpError(502,'Shopify beklenmeyen bir yönlendirme döndürdü. Güvenlik için bağlantı durduruldu.');
 if(!response.ok)throw new HttpError(response.status===429?429:400,response.status===429?'Shopify yoğun. Biraz sonra devam edin.':'Shopify bağlantısı doğrulanamadı. Bağlantı bilgilerini ve okuma izinlerini kontrol edin.');
 const data:any=await response.json();
 if(data.errors?.some((e:any)=>e.extensions?.code==='THROTTLED'))throw new HttpError(429,'Shopify istek sınırına ulaşıldı. Aktarım kısa bir beklemeden sonra devam edecek.');
 if(data.errors?.length)throw new HttpError(400,'Shopify verileri okunamadı. Ürün okuma izinlerini kontrol edin.');return data.data;
}
// Up to 24 products per request; the variant/write budget stays bounded at 48.
export async function syncStep(job:any){
 const database=db(),state=JSON.parse(job.payload),now=new Date().toISOString();
 let count=job.done;
 const leaseSql="EXISTS (SELECT 1 FROM jobs WHERE id=? AND leaseUntil=? AND state='running')";
 const leaseParams=[job.id,job.leaseUntil];
 if(!state.queue?.length){
  if(state.finished){
   const checkpoint=new Date(state.startedAt||job.createdAt).toISOString();
   const result=await database.batch([
    ...(!state.incremental?[database.prepare("UPDATE products SET status='archived',version=version+1,lastActor='system' WHERE source='shopify' AND seenAt<>? AND status<>'archived' AND "+leaseSql).bind(job.id,...leaseParams)]:[]),
    database.prepare("INSERT INTO settings(key,value) SELECT ?,? WHERE "+leaseSql+" ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(state.incremental?'last_changes_sync':'last_sync',now,...leaseParams),
    database.prepare("INSERT INTO settings(key,value) SELECT 'shopify_changes_since',? WHERE "+leaseSql+" ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(checkpoint,...leaseParams),
    database.prepare("UPDATE jobs SET state='done',leaseUntil=0,updatedAt=? WHERE id=? AND leaseUntil=? AND state='running'").bind(now,...leaseParams)
   ]);
   if(!result[result.length-1].meta.changes)throw new HttpError(409,'Aktarım başka bir pencerede devam ediyor.');
   return {done:count,state:'done'};
  }
  const result=await shopify(`query CatalogProducts($after:String,$filter:String){products(first:48,after:$after,sortKey:${state.incremental?'UPDATED_AT':'ID'},query:$filter){nodes{id handle title descriptionHtml description vendor productType tags status featuredMedia{preview{image{url}}}} pageInfo{hasNextPage endCursor}}}`,{after:state.after||null,filter:state.incremental?`updated_at:>='${state.since}'`:null});
  state.queue=result.products.nodes;state.after=result.products.pageInfo.endCursor;state.finished=!result.products.pageInfo.hasNextPage;
 }
 // Upgrade an in-progress single-product checkpoint without restarting the job.
 if(state.variantAfter&&state.queue.length)state.queue[0]._variantAfter=state.variantAfter;
 delete state.variantAfter;
 const group=state.queue.slice(0,24),rows:{p:any;v:any;single:boolean}[]=[],pending:any[]=[];
 if(group.length){
  const limit=Math.floor(48/group.length),variables:Record<string,any>={};
  const declarations=group.map((p:any,i:number)=>{variables['id'+i]=p.id;variables['after'+i]=p._variantAfter||null;return '$id'+i+':ID!,$after'+i+':String'}).join(',');
  const selections=group.map((_:any,i:number)=>'p'+i+':product(id:$id'+i+'){variants(first:'+limit+',after:$after'+i+'){nodes{id title sku barcode inventoryQuantity image{url} selectedOptions{name value}} pageInfo{hasNextPage endCursor}}}').join(' ');
  const result=await shopify('query CatalogVariantBatch('+declarations+'){'+selections+'}',variables);
  for(let i=0;i<group.length;i++){
   const {_variantAfter,...p}=group[i],product=result['p'+i];
   if(!product)continue;
   const variants=product.variants,single=!_variantAfter&&!variants.pageInfo.hasNextPage&&variants.nodes.length===1;
   for(const v of variants.nodes)rows.push({p,v,single});
   if(variants.pageInfo.hasNextPage){
    if(!variants.pageInfo.endCursor||variants.pageInfo.endCursor===_variantAfter)throw new HttpError(502,'Shopify aktarım sayfası ilerlemedi. Tekrar deneyin.');
    pending.push({...p,_variantAfter:variants.pageInfo.endCursor});
   }
  }
 }
 state.queue=[...pending,...state.queue.slice(group.length)];
 const writes:import('./database').Statement[]=[];
 if(rows.length){
  const variantIds=rows.map(r=>r.v.id),handles=[...new Set(rows.filter(r=>r.single).map(r=>r.p.handle))];
  const lookups=[database.prepare('SELECT id,shopifyVariantId,title,type,tags FROM products WHERE shopifyVariantId IN ('+variantIds.map(()=>'?').join(',')+')').bind(...variantIds)];
  if(handles.length)lookups.push(database.prepare("SELECT id,handle,title,type,tags FROM products WHERE source='csv' AND shopifyVariantId IS NULL AND handle IN ("+handles.map(()=>'?').join(',')+')').bind(...handles));
  const found=await database.batch<any>(lookups);
  const byVariant=new Map(found[0].results.map((p:any)=>[p.shopifyVariantId,p]));
  const byHandle=new Map<string,any[]>();
  for(const p of found[1]?.results||[]){const matches=byHandle.get(p.handle)||[];matches.push(p);byHandle.set(p.handle,matches);}
  for(const {p,v,single} of rows){
   const matches=single?byHandle.get(p.handle):null;
   const previous:any=byVariant.get(v.id)||(matches?.length===1?matches[0]:null);
   const id=previous?.id||v.id,title=v.title==='Default Title'?p.title:`${p.title} · ${v.title}`;
   const image=v.image?.url||p.featuredMedia?.preview?.image?.url||'';
   const fields={id,shopifyProductId:p.id,shopifyVariantId:v.id,handle:p.handle,title,vendor:p.vendor,type:p.productType,tags:p.tags.join(', '),description:p.description,sku:v.sku||'',barcode:v.barcode||'',stock:v.inventoryQuantity,visible:0,status:p.status.toLowerCase(),image,source:'shopify',version:1,search:normalize([title,p.handle,p.vendor,p.productType,p.tags.join(' '),v.sku,v.barcode].join(' ')),raw:JSON.stringify({product:p,variant:v}),seenAt:job.id,updatedAt:now};
   const cols=Object.keys(fields),updates=cols.filter(k=>!['id','visible','version'].includes(k));
   // Explicit column list never changes catalog prices or the owner's selection.
   const changed=state.incremental?' WHERE '+updates.filter(k=>!['seenAt','updatedAt','raw','search'].includes(k)).map(k=>`products."${k}" IS NOT excluded."${k}"`).join(' OR '):'';
   writes.push(database.prepare(`INSERT INTO products(${cols.map(k=>'"'+k+'"').join(',')}) SELECT ${cols.map(()=>'?').join(',')} WHERE ${leaseSql} ON CONFLICT(id) DO UPDATE SET ${updates.map(k=>`"${k}"=excluded."${k}"`).join(',')},version=products.version+1,lastActor='system'${changed}`).bind(...Object.values(fields),...leaseParams));
  }
  count+=rows.length;
 }
 // Product writes and the cursor commit together: retrying cannot skip a half-written page.
 writes.push(database.prepare("UPDATE jobs SET payload=?,done=?,leaseUntil=0,updatedAt=? WHERE id=? AND leaseUntil=? AND state='running'").bind(JSON.stringify(state),count,now,...leaseParams));
 const saved=await database.batch(writes);
 if(!saved[saved.length-1].meta.changes)throw new HttpError(409,'Aktarım başka bir pencerede devam ediyor.');
 return {done:count,state:'running'};
}
