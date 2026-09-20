import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlobPriceRepository,type PriceBlobStore,type PriceRecord} from '../lib/prices';

const id=(n:number)=>`gid://shopify/ProductVariant/${n}`;
const key=(value:string)=>'variant-'+Buffer.from(value).toString('base64url');
const record=(price:number):PriceRecord=>({price,updatedAt:'2026-09-20T00:00:00.000Z'});

class MemoryStore implements PriceBlobStore {
 data=new Map<string,{data:unknown;etag:string}>();
 revision=0;legacyReads=0;indexReads=0;listReads=0;indexWrites=0;
 failRead:string|null=null;failWrite:string|null=null;rejectCacheWrites=false;
 seed(name:string,data:unknown){this.data.set(name,{data:structuredClone(data),etag:`etag-${++this.revision}`});}
 async getWithMetadata(name:string){
  if(name.startsWith('variant-'))this.legacyReads++;else this.indexReads++;
  if(name===this.failRead)throw new Error('read failed');
  return structuredClone(this.data.get(name)||null);
 }
 async get(name:string){return (await this.getWithMetadata(name))?.data??null;}
 async *list({prefix}:{prefix:string;paginate:true}){
  this.listReads++;
  const blobs=[...this.data].filter(([name])=>name.startsWith(prefix)).map(([name,value])=>({key:name,etag:value.etag}));
  for(let offset=0;offset<blobs.length;offset+=1000)yield {blobs:blobs.slice(offset,offset+1000)};
 }
 async setJSON(name:string,data:unknown,condition?:{onlyIfMatch:string}|{onlyIfNew:true}){
  if(name===this.failWrite)throw new Error('write failed');
  if(!name.startsWith('variant-')){this.indexWrites++;if(this.rejectCacheWrites)return {modified:false};}
  const current=this.data.get(name);
  if(condition&&'onlyIfNew'in condition&&current)return {modified:false};
  if(condition&&'onlyIfMatch'in condition&&current?.etag!==condition.onlyIfMatch)return {modified:false};
  this.seed(name,data);return {modified:true};
 }
 async delete(name:string){this.data.delete(name);}
 resetCounts(){this.legacyReads=0;this.indexReads=0;this.listReads=0;this.indexWrites=0;}
}

test('5,000 saved prices warm once; subsequent range reads fetch no individual unchanged prices',async()=>{
 const store=new MemoryStore();
 for(let n=1;n<=5000;n++)store.seed(key(id(n)),record(n));
 const prices=createBlobPriceRepository(store);
 assert.equal(Object.keys(await prices.records()).length,5000);
 assert.equal(store.legacyReads,5000);assert.equal(store.indexWrites,1);
 // Original blobs are retained. No cutover or deletion is required.
 assert.equal(store.data.size,5001);
 store.resetCounts();
 const second=await prices.records();
 assert.equal(second[id(5000)].price,5000);
 assert.equal(store.legacyReads,0);assert.equal(store.indexReads,1);
 assert.equal(store.listReads,1);assert.equal(store.indexWrites,0);

 // Older deployments use the same individual records: changes and deletions
 // must show up despite a previously populated index.
 store.seed(key(id(10)),record(700));store.seed(key(id(20)),record(800));
 await store.delete(key(id(30)));store.resetCounts();
 const third=await prices.records();
 assert.equal(third[id(10)].price,700);assert.equal(third[id(20)].price,800);
 assert.equal(third[id(30)],undefined);assert.equal(Object.keys(third).length,4999);
 assert.equal(store.legacyReads,2);
});

test('simultaneous single and batch writes retain unrelated prices and report partial failures',async()=>{
 const store=new MemoryStore(),prices=createBlobPriceRepository(store);
 store.seed(key(id(1)),record(10));await prices.records();
 const [batch,single]=await Promise.all([
  prices.update(new Map(Array.from({length:1000},(_,n)=>[id(n+100),n+1000]))),
  prices.update(new Map([[id(2),2222]])),
 ]);
 assert.equal(batch.updated.length,1000);assert.equal(single.updated.length,1);
 const all=await prices.records();
 assert.equal(Object.keys(all).length,1002);assert.equal(all[id(1)].price,10);
 assert.equal(all[id(2)].price,2222);assert.equal(all[id(1099)].price,1999);
 store.failWrite=key(id(7));
 const result=await prices.update(new Map([[id(6),600],[id(7),700]]));
 assert.deepEqual(result.updated,[id(6)]);assert.equal(result.failed[0].id,id(7));
 assert.equal((await prices.records())[id(6)].price,600);
});

test('cache conflicts and failures cannot lose or conceal primary price changes',async()=>{
 const store=new MemoryStore(),prices=createBlobPriceRepository(store);
 store.seed(key(id(1)),record(100));await prices.records();
 store.rejectCacheWrites=true;store.seed(key(id(1)),record(200));
 assert.equal((await prices.records())[id(1)].price,200);
 store.seed(key(id(1)),record(300));
 assert.equal((await prices.records())[id(1)].price,300);
 store.rejectCacheWrites=false;store.failWrite='price-index-v1';
 store.seed(key(id(1)),record(400));
 assert.equal((await prices.records())[id(1)].price,400);
 assert.equal((await prices.selected([id(1)]))[id(1)],400);
});

test('interrupted initial cache build preserves records and succeeds on retry',async()=>{
 const store=new MemoryStore(),prices=createBlobPriceRepository(store);
 store.seed(key(id(1)),record(100));store.seed(key(id(2)),record(200));
 store.failRead=key(id(2));
 await assert.rejects(()=>prices.records(),/read failed/);
 assert.equal(store.data.size,2);assert.equal(store.indexWrites,0);
 store.failRead=null;
 assert.equal(Object.keys(await prices.records()).length,2);
 store.seed('price-index-v1',{version:99,records:{}});
 assert.equal((await prices.records())[id(2)].price,200);
});
