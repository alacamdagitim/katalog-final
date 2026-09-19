import {database as db,Statement} from '../database';
import {shopify} from '../shopify';
import {normalize} from '../model';
import {registerWebhooks} from './webhooks';
import {claim,commit,enqueueStatement,fence,fenceArgs,finishStatement,retry,setting,setSetting,Task} from './queue';

async function scan(t:Task){
 const state=JSON.parse(t.payload),incremental=t.kind==='delta';
 if(state.phase==='missing'){
  const missing=await db.prepare("SELECT DISTINCT shopifyProductId id FROM products WHERE source='shopify' AND shopifyProductId>? AND shopifyProductId NOT IN (SELECT productId FROM sync_seen WHERE scanId=?) ORDER BY shopifyProductId LIMIT 100").bind(state.missingAfter||'',t.id).all<{id:string}>();
  const writes=missing.results.map(p=>enqueueStatement('product','product:'+p.id,{},p.id,100));
  const complete=missing.results.length<100;
  if(complete)writes.push(setSetting('last_full_scan',new Date().toISOString()),db.prepare('DELETE FROM sync_seen WHERE scanId=?').bind(t.id));
  writes.push(finishStatement(t,{...state,missingAfter:missing.results.at(-1)?.id},complete));
  await commit(t,writes);return;
 }
 const start=state.startedAt||new Date().toISOString();
 const since=state.since||await setting('delta_since')||start;
 const filter=incremental?`updated_at:>='${since}' AND updated_at:<='${start}'`:null;
 const data=await shopify(`query Discover($after:String,$filter:String){products(first:100,after:$after,sortKey:${incremental?'UPDATED_AT':'ID'},query:$filter){nodes{id} pageInfo{hasNextPage endCursor}}}`,{after:state.after||null,filter});
 const page=data.products,writes:Statement[]=[];
 // Every discovered product gets its own resumable task; deltas never wait for the full scan.
 for(const p of page.nodes){
  writes.push(enqueueStatement('product','product:'+p.id,{},p.id,incremental?0:100));
  if(!incremental)writes.push(db.prepare('INSERT OR IGNORE INTO sync_seen VALUES(?,?)').bind(t.id,p.id));
 }
 if(!page.pageInfo.hasNextPage){
  if(incremental)writes.push(setSetting('delta_since',new Date(Date.parse(start)-120000).toISOString()),setSetting('last_delta_scan',new Date().toISOString()));
  // Full scan enters bounded reconciliation; missing products are fetched again before archiving.
 }
 if(page.pageInfo.hasNextPage&&(!page.pageInfo.endCursor||page.pageInfo.endCursor===state.after))throw new Error('Shopify discovery cursor stalled');
 writes.push(finishStatement(t,{startedAt:start,since,after:page.pageInfo.endCursor,...(!incremental&&!page.pageInfo.hasNextPage?{phase:'missing'}:{})},incremental&&!page.pageInfo.hasNextPage));
 await commit(t,writes);
}

async function product(t:Task){
 const state=JSON.parse(t.payload);
 // Always refresh from Shopify, never apply possibly out-of-order webhook payloads.
 const data=await shopify(`query RefreshProduct($id:ID!,$after:String){product(id:$id){id handle title vendor productType tags description status updatedAt featuredMedia{preview{image{url}}} variants(first:50,after:$after){nodes{id title sku barcode inventoryQuantity image{url}} pageInfo{hasNextPage endCursor}}}}`,{id:t.productId,after:state.after||null});
 const p=data.product,now=new Date().toISOString(),writes:Statement[]=[];
 if(!p){
  writes.push(db.prepare("UPDATE products SET status='archived',stock=0,version=version+1,lastActor='system',updatedAt=? WHERE shopifyProductId=? AND "+fence).bind(now,t.productId,...fenceArgs(t)));
  writes.push(finishStatement(t,{},true));await commit(t,writes);return;
 }
 // Restart this product if metadata changed between variant pages, rather than mixing snapshots.
 if(state.after&&state.sourceUpdatedAt!==p.updatedAt){await commit(t,[finishStatement(t,{},false)]);return;}
 const scanId=state.scanId||crypto.randomUUID();
 for(const v of p.variants.nodes){
  const title=v.title==='Default Title'?p.title:`${p.title} · ${v.title}`;
  const fields={id:v.id,shopifyProductId:p.id,shopifyVariantId:v.id,handle:p.handle,title,vendor:p.vendor||'',type:p.productType||'',tags:p.tags.join(', '),description:p.description||'',sku:v.sku||'',barcode:v.barcode||'',stock:v.inventoryQuantity,visible:0,status:p.status.toLowerCase(),image:v.image?.url||p.featuredMedia?.preview?.image?.url||'',source:'shopify',version:1,search:normalize([title,p.handle,p.vendor,p.productType,p.tags.join(' '),v.sku,v.barcode].join(' ')),seenAt:scanId,updatedAt:now};
  const cols=Object.keys(fields),updates=cols.filter(k=>!['id','visible','version'].includes(k));
  writes.push(db.prepare(`INSERT INTO products(${cols.map(k=>'"'+k+'"').join(',')}) SELECT ${cols.map(()=>'?').join(',')} WHERE ${fence}
  ON CONFLICT(shopifyVariantId) DO UPDATE SET ${updates.map(k=>'"'+k+'"=excluded."'+k+'"').join(',')},version=products.version+1,lastActor='system'`).bind(...Object.values(fields),...fenceArgs(t)));
 }
 const more=p.variants.pageInfo.hasNextPage;
 if(more&&(!p.variants.pageInfo.endCursor||p.variants.pageInfo.endCursor===state.after))throw new Error('Shopify variant cursor stalled');
 if(!more){
  writes.push(db.prepare("UPDATE products SET status='archived',stock=0,version=version+1,lastActor='system',updatedAt=? WHERE shopifyProductId=? AND seenAt<>? AND status<>'archived' AND "+fence).bind(now,p.id,scanId,...fenceArgs(t)));
  writes.push(setSetting('last_product_sync',now));
 }
 writes.push(finishStatement(t,more?{after:p.variants.pageInfo.endCursor,scanId,sourceUpdatedAt:p.updatedAt}:{},!more));
 await commit(t,writes);
}

async function schedule(){
 for(const [kind,key,period]of [['full','last_full_scan',86400000],['delta','last_delta_scan',60000]] as const){
  const active=await db.prepare("SELECT id FROM sync_tasks WHERE dedupeKey=? AND state<>'done'").bind('scan:'+kind).first();
  if(!active&&Date.now()-Date.parse(await setting(key)||'1970-01-01')>period)await enqueueStatement(kind,'scan:'+kind,{startedAt:new Date().toISOString()}).run();
 }
}
export async function runSync(budgetMs=18000){
 if(process.env.SYNC_ENABLED!=='true'||await setting('sync_enabled')!=='1')return {state:'disabled',processed:0};
 const now=Date.now(),lock=crypto.randomUUID();
 // One global runner shares Shopify's quota; work remains durably queued between invocations.
 const acquired=await db.prepare("INSERT INTO sync_product_locks VALUES('runner',?,?) ON CONFLICT(productId) DO UPDATE SET token=excluded.token,until=excluded.until WHERE until<? RETURNING token").bind(lock,now+60000,now).first();
 if(!acquired)return {state:'busy',processed:0};
 let processed=0;
 try{
  await setSetting('worker_heartbeat',new Date().toISOString()).run();
  if(Number(await setting('shopify_cooldown')||0)>Date.now())return {state:'backoff',processed};
  await schedule();
  // Fair scheduling: discovery and refresh both progress, even during the initial import.
  const order=['delta','product','full','inventory','register','product','product','product'];let empty=0;
  for(let turn=0;turn<200;turn++){
   const kind=order[turn%order.length];
   if(Date.now()-now>=budgetMs)break;
   const task=await claim(kind);if(!task){if(++empty>=order.length)break;continue;}empty=0;
   try{
    if(kind==='product')await product(task);
    else if(kind==='register'){const complete=await registerWebhooks();await commit(task,[finishStatement(task,{},complete)]);}
    else if(kind==='inventory'){
     const data=await shopify('query InventoryProduct($id:ID!){inventoryItem(id:$id){variant{product{id}}}}',{id:task.productId});
     const id=data.inventoryItem?.variant?.product?.id;
     await commit(task,[...(id?[enqueueStatement('product','product:'+id,{},id)]:[]),finishStatement(task,{},true)]);
    }else await scan(task);processed++;
   }
   catch(e){await retry(task,e);if((e as any).status===429)break;}
  }
  await db.batch([db.prepare('DELETE FROM webhook_receipts WHERE receivedAt<?').bind(Date.now()-7*86400000),db.prepare('DELETE FROM sessions WHERE expiresAt<?').bind(Date.now()),db.prepare('DELETE FROM login_attempts WHERE windowStart<?').bind(Date.now()-86400000)]);
  return {state:'ok',processed};
 }finally{await db.prepare("DELETE FROM sync_product_locks WHERE productId='runner' AND token=?").bind(lock).run()}
}
export async function syncStatus(){
 const totals=await db.prepare("SELECT COUNT(*) total,COUNT(DISTINCT shopifyProductId) products FROM products WHERE source='shopify'").first<any>();
 const pending=await db.prepare("SELECT COUNT(*) n FROM sync_tasks WHERE state<>'done'").first<any>();
 const error=await db.prepare("SELECT lastError FROM sync_tasks WHERE state<>'done' AND lastError IS NOT NULL ORDER BY updatedAt DESC LIMIT 1").first<any>();
 return {products:totals.products,variants:totals.total,pending:pending.n,error:error?.lastError||'',heartbeat:await setting('scheduler_heartbeat')||null,lastProductSync:await setting('last_product_sync')||null,lastFullScan:await setting('last_full_scan')||null,lastDeltaScan:await setting('last_delta_scan')||null,enabled:process.env.SYNC_ENABLED==='true'&&await setting('sync_enabled')==='1'};
}
