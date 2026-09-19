import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';

test('durable sync: discovery, concurrent changes, retry, delete, prices, leases and HMAC',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'alacam-sync-test-'));
 process.env.DATABASE_URL='file:'+join(dir,'test.db');process.env.SYNC_ENABLED='true';
 process.env.SHOPIFY_TOKEN_KEY=Buffer.alloc(32,3).toString('base64');
 const {databaseClient,database:db}=await import('../lib/database');
 const {saveAuth}=await import('../lib/shopify-auth');
 const {runSync}=await import('../lib/sync/engine');
 const {initialSync,enqueueProduct,claim,commit,finishStatement,setting}=await import('../lib/sync/queue');
 const {validHmac,receiveWebhook}=await import('../lib/sync/webhooks');
 const {validatePatch,HttpError}=await import('../lib/server');
 const {hashPassword,verifyPassword}=await import('../lib/password.mjs');
 const client=databaseClient();
 for(const file of (await readdir('drizzle')).filter(p=>p.endsWith('.sql')).sort()){
  const sql=await readFile('drizzle/'+file,'utf8');await client.batch(sql.split('--> statement-breakpoint').filter(s=>s.trim()),'write');
 }
 const pid='gid://shopify/Product/1',vid='gid://shopify/ProductVariant/11';
 const fixture={id:pid,handle:'deneme-urun-katalog',title:'Deneme ürün katalog',vendor:'Alaçam',productType:'Test',tags:['Test'],description:'Açıklama',status:'ACTIVE',updatedAt:'2026-09-20T10:00:00Z',featuredMedia:null,variants:{nodes:[{id:vid,title:'Default Title',sku:'',barcode:'0012345678901',inventoryQuantity:50,image:null}],pageInfo:{hasNextPage:false,endCursor:'v1'}}};
 let deleted=false,throttle=false,calls=0;const fetchOriginal=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));assert.ok(body.query.startsWith('query'));assert.ok(!/\b(price|mutation)\b/.test(body.query));
  if(throttle)return Response.json({errors:[{extensions:{code:'THROTTLED'}}]});
  if(body.query.includes('Discover'))return Response.json({data:{products:{nodes:deleted?[]:[{id:pid}],pageInfo:{hasNextPage:false,endCursor:'p1'}}}});
  if(body.query.includes('RefreshProduct'))return Response.json({data:{product:deleted?null:fixture}});
  throw new Error('Unexpected query');
 };
 try{
  await saveAuth({mode:'legacy',accessToken:'test-token-not-real'});await initialSync();
  await runSync();assert.ok(calls>0);
  let row=await db.prepare('SELECT * FROM products WHERE shopifyVariantId=?').bind(vid).first<any>();
  assert.equal(row.title,fixture.title);assert.equal(row.visible,0);assert.equal(row.catalogPrice,null);assert.equal(row.barcode,'0012345678901');
  await db.prepare('UPDATE products SET catalogPrice=98765,visible=1 WHERE id=?').bind(row.id).run();
  fixture.description='Yeni açıklama';fixture.variants.nodes[0].inventoryQuantity=23;
  await receiveWebhook('event-update-001','products/update',{admin_graphql_api_id:pid});
  await receiveWebhook('event-update-001','products/update',{admin_graphql_api_id:pid});
  await runSync();row=await db.prepare('SELECT * FROM products WHERE id=?').bind(vid).first<any>();
  assert.equal(row.description,'Yeni açıklama');assert.equal(row.stock,23);assert.equal(row.catalogPrice,98765);assert.equal(row.visible,1);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM products').first<any>()).n,1);
  await enqueueProduct(pid);throttle=true;await runSync();
  let task=await db.prepare("SELECT * FROM sync_tasks WHERE kind='product'").first<any>();assert.equal(task.state,'pending');assert.ok(task.nextAt>Date.now());assert.ok(task.attempts>0);
  throttle=false;await db.prepare("DELETE FROM settings WHERE key='shopify_cooldown'").run();await db.prepare('UPDATE sync_tasks SET nextAt=0').run();await runSync();
  assert.equal((await db.prepare("SELECT state FROM sync_tasks WHERE kind='product'").first<any>()).state,'done');
  // A new event while a page is in flight survives completion and forces a fresh read.
  await enqueueProduct(pid);const claimed=(await claim('product'))!;await enqueueProduct(pid);await commit(claimed,[finishStatement(claimed,{},true)]);
  assert.equal((await db.prepare("SELECT state FROM sync_tasks WHERE kind='product'").first<any>()).state,'pending');
  // An obsolete lease cannot commit any side effect, including settings/checkpoints.
  const stale=(await claim('product'))!;await db.prepare('UPDATE sync_tasks SET leaseToken=? WHERE id=?').bind('replacement',stale.id).run();
  await assert.rejects(commit(stale,[db.prepare("INSERT INTO settings VALUES('should-not-commit','1')"),finishStatement(stale,{},true)]));assert.equal(await setting('should-not-commit'),undefined);
  await db.prepare("UPDATE sync_tasks SET state='pending',leaseUntil=0,leaseToken=NULL").run();
  deleted=true;await receiveWebhook('event-delete-001','products/delete',{id:1});await runSync();
  row=await db.prepare('SELECT * FROM products WHERE id=?').bind(vid).first<any>();assert.equal(row.status,'archived');assert.equal(row.catalogPrice,98765);assert.equal(row.visible,1);
  const bytes=Buffer.from('{"id":1}'),signature=createHmac('sha256','secret').update(bytes).digest('base64');assert.equal(validHmac(bytes,signature,'secret'),true);assert.equal(validHmac(Buffer.from('{}'),signature,'secret'),false);assert.equal(validHmac(bytes,'garbage','secret'),false);
  const owner={id:'owner',email:'owner@example.test',name:'Test',role:'owner',permissions:[],active:1};
  assert.throws(()=>validatePatch(owner,{title:'Cannot change'}),HttpError);assert.deepEqual(validatePatch(owner,{catalogPrice:123,visible:1}),{catalogPrice:123,visible:1});
  const password='local-test-passphrase';const hash=await hashPassword(password);assert.equal(await verifyPassword(password,hash),true);assert.equal(await verifyPassword('wrong',hash),false);
 }finally{globalThis.fetch=fetchOriginal;client.close();await rm(dir,{recursive:true,force:true});}
});
