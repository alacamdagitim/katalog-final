import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {get,put,BlobPreconditionFailedError,BlobServiceRateLimited} from '@vercel/blob';
import {CatalogDocumentConflict,CatalogDocumentRateLimit,createVercelDocumentDriver,createVercelMapRepository,type CatalogDocumentDriver,type StoredDocument} from '../lib/vercel-catalog-store';

const id=(n:number)=>`gid://shopify/ProductVariant/${n}`;
type RecordValue={price:number};
const valid=(value:unknown):value is RecordValue=>!!value&&typeof value==='object'&&Number.isSafeInteger((value as RecordValue).price);
class MemoryDocuments implements CatalogDocumentDriver{
 records=new Map<string,StoredDocument>();writes=0;reads=0;revision=0;
 failWrites=false;conflictForever=false;rateLimitOnce=false;
 async read(path:string){this.reads++;return structuredClone(this.records.get(path)||null);}
 async write(path:string,data:string,etag:string|null){
  if(this.failWrites)throw new Error('write failed');
  if(this.rateLimitOnce){this.rateLimitOnce=false;throw new CatalogDocumentRateLimit(1100);}
  if(this.conflictForever||(this.records.get(path)?.etag??null)!==etag)throw new CatalogDocumentConflict();
  this.writes++;this.records.set(path,{data:JSON.parse(data),etag:String(++this.revision)});
 }
}
function timing(){let time=100000;const waits:number[]=[];return {now:()=>time,pause:async(ms:number)=>{waits.push(ms);time+=ms;},waits};}

test('5,000 price entries use one durable document write and one read without product persistence',async()=>{
 const driver=new MemoryDocuments(),clock=timing(),repo=createVercelMapRepository('prices',valid,driver,clock);
 await repo.update(new Map(Array.from({length:5000},(_,n)=>[id(n),{price:n}])));
 assert.equal(driver.writes,1);
 const entries=await repo.entries();assert.equal(Object.keys(entries).length,5000);assert.equal(entries[id(4999)].price,4999);
 assert.equal(driver.reads,2);assert.deepEqual(Object.keys(driver.records.get('prices')!.data as object).sort(),['entries','modifiedAt','version']);
});

test('independent function instances merge concurrent creation, bulk and single edits without losing unrelated records',async()=>{
 const driver=new MemoryDocuments(),clock=timing();
 const a=createVercelMapRepository('prices',valid,driver,clock),b=createVercelMapRepository('prices',valid,driver,clock);
 await Promise.all([a.update(new Map([[id(1),{price:100}]])),b.update(new Map([[id(2),{price:200}]]))]);
 assert.deepEqual(await a.entries(),{[id(1)]:{price:100},[id(2)]:{price:200}});
 await Promise.all([a.update(new Map([[id(1),null],[id(3),{price:300}]])),b.update(new Map([[id(2),{price:220}],[id(4),{price:400}]]))]);
 assert.deepEqual(await b.entries(),{[id(2)]:{price:220},[id(3)]:{price:300},[id(4)]:{price:400}});
 assert.ok(clock.waits.some(ms=>ms>=1000));
});

test('visibility document is independent of prices and revocation is visible to the next fresh read',async()=>{
 const driver=new MemoryDocuments(),clock=timing();
 const prices=createVercelMapRepository('prices',valid,driver,clock);
 const visibility=createVercelMapRepository('visibility',(value:unknown):value is {visible:true}=>!!value&&typeof value==='object'&&(value as {visible:unknown}).visible===true,driver,clock);
 await prices.update(new Map([[id(1),{price:0}]]));assert.deepEqual(await visibility.entries(),{});
 await visibility.update(new Map([[id(1),{visible:true}]]));assert.deepEqual(Object.keys(await visibility.entries()),[id(1)]);
 await visibility.update(new Map([[id(1),null]]));assert.deepEqual(await visibility.entries(),{});
 assert.deepEqual(await prices.entries(),{[id(1)]:{price:0}});
});

test('corrupt documents and failed writes never reset existing data; repeated conflicts are bounded',async()=>{
 const driver=new MemoryDocuments(),clock=timing(),repo=createVercelMapRepository('prices',valid,driver,clock);
 await repo.update(new Map([[id(1),{price:50}]]));const saved=structuredClone(driver.records.get('prices'));
 driver.failWrites=true;await assert.rejects(repo.update(new Map([[id(2),{price:10}]])),/write failed/);
 assert.deepEqual(driver.records.get('prices'),saved);
 driver.failWrites=false;driver.conflictForever=true;
 await assert.rejects(repo.update(new Map([[id(2),{price:10}]])),{status:409});assert.deepEqual(driver.records.get('prices'),saved);
 driver.conflictForever=false;driver.records.set('prices',{data:{version:1,modifiedAt:0,entries:{[id(1)]:{price:'bad'}}},etag:'corrupt'});
 await assert.rejects(repo.entries(),{status:503});await assert.rejects(repo.update(new Map([[id(2),{price:10}]])),{status:503});
 assert.equal(driver.records.get('prices')?.etag,'corrupt');
});

test('rate limit delays retry with fresh version instead of dropping the bulk operation',async()=>{
 const driver=new MemoryDocuments(),clock=timing(),repo=createVercelMapRepository('prices',valid,driver,clock);
 driver.rateLimitOnce=true;
 await repo.update(new Map([[id(1),{price:25}]]));
 assert.deepEqual(await repo.entries(),{[id(1)]:{price:25}});assert.ok(clock.waits.includes(1100));assert.equal(driver.writes,1);
});

test('SDK adapter requires private access, uncached reads, create-only first write and exact ETag overwrite',async()=>{
 const reads:Parameters<typeof get>[1][]=[],writes:Parameters<typeof put>[2][]=[];
 let data='{"version":1,"modifiedAt":0,"entries":{}}',etag='version-1';
 const sdk={
  get:async(_path:string,options:Parameters<typeof get>[1])=>{reads.push(options);return {statusCode:200,stream:new Blob([data]).stream(),blob:{etag,size:data.length}} as Awaited<ReturnType<typeof get>>;},
  put:async(_path:string,body:Parameters<typeof put>[1],options:Parameters<typeof put>[2])=>{writes.push(options);data=String(body);etag='version-2';return {} as Awaited<ReturnType<typeof put>>;},
 };
 const driver=createVercelDocumentDriver('synthetic-token',sdk);
 assert.equal((await driver.read('prices'))?.etag,'version-1');
 await driver.write('prices','{}',null);await driver.write('prices','{}','version-2');
 assert.equal(reads[0].access,'private');assert.equal(reads[0].useCache,false);
 assert.equal(writes[0].access,'private');assert.equal(writes[0].allowOverwrite,false);assert.equal(writes[0].addRandomSuffix,false);
 assert.equal(writes[1].ifMatch,'version-2');assert.equal(writes[1].allowOverwrite,true);
});

test('SDK create race becomes a safe CAS retry; auth and conditional failures are not reported as success',async()=>{
 let exists=false;
 const sdk={get:async()=>exists?({statusCode:200,stream:new Blob(['{}']).stream(),blob:{etag:'race',size:2}} as Awaited<ReturnType<typeof get>>):null,
  put:async()=>{exists=true;throw new Error('already exists');},
 };
 const driver=createVercelDocumentDriver('synthetic-token',sdk);
 await assert.rejects(driver.write('prices','{}',null),CatalogDocumentConflict);
 sdk.put=async()=>{throw new BlobPreconditionFailedError();};await assert.rejects(driver.write('prices','{}','old'),CatalogDocumentConflict);
 sdk.put=async()=>{throw new BlobServiceRateLimited(1);};await assert.rejects(driver.write('prices','{}','old'),CatalogDocumentRateLimit);
 sdk.put=async()=>{throw new Error('invalid token with private detail');};
 await assert.rejects(driver.write('prices','{}','old'),(error:unknown)=>(error as {status:number}).status===503&&!String(error).includes('private detail'));
});

test('missing private document is empty, while token errors and aborted reads fail closed',async()=>{
 const sdk={get:async()=>null as Awaited<ReturnType<typeof get>>,put:async()=>{throw new Error('No writes allowed');}};
 const driver=createVercelDocumentDriver('synthetic-token',sdk);
 assert.equal(await driver.read('missing'),null);
 sdk.get=async()=>{throw new Error('Invalid token: confidential detail');};
 await assert.rejects(driver.read('private'),(error:unknown)=>(error as {status:number}).status===503&&!String(error).includes('confidential'));
 sdk.get=async()=>{throw new DOMException('aborted','AbortError');};
 await assert.rejects(driver.read('aborted'),{status:503});
});

test('oversized private documents cancel their response stream without writing or parsing it',async()=>{
 let cancelled=false;
 const sdk={get:async()=>({statusCode:200,stream:new ReadableStream({cancel(){cancelled=true;}}),blob:{etag:'oversized',size:9*1024*1024}} as Awaited<ReturnType<typeof get>>),put:async()=>{throw new Error('No writes allowed');}};
 await assert.rejects(createVercelDocumentDriver('synthetic-token',sdk).read('oversized'),{status:503});
 assert.equal(cancelled,true);
});

test('Vercel missing private-store token refuses reads and writes without touching local user files',async()=>{
 const cwd=process.cwd(),directory=await mkdtemp(join(tmpdir(),'vercel-storage-missing-'));
 const previous={VERCEL:process.env.VERCEL,VERCEL_ENV:process.env.VERCEL_ENV,BLOB_READ_WRITE_TOKEN:process.env.BLOB_READ_WRITE_TOKEN};
 process.chdir(directory);process.env.VERCEL='1';delete process.env.BLOB_READ_WRITE_TOKEN;
 try{
  const {getPrices,getAllPrices,setPrices}=await import('../lib/prices');
  const {getVisibleIds,getVisibility,setVisibility}=await import('../lib/catalog-visibility');
  for(const operation of [()=>getPrices([id(1)]),()=>getAllPrices(),()=>setPrices([{id:id(1),price:100}]),()=>getVisibleIds(),()=>getVisibility([id(1)]),()=>setVisibility([id(1)],true)]){
   await assert.rejects(operation(),(error:unknown)=>(error as {status:number}).status===503&&String(error).includes('BLOB_READ_WRITE_TOKEN'));
  }
  assert.deepEqual(await readdir(directory),[]);
 }finally{
  process.chdir(cwd);for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await rm(directory,{recursive:true,force:true});
 }
});
