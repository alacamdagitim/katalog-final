import {getStore} from '@netlify/blobs';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {isNetlifyRuntime} from './storage-runtime';

export type PriceRecord={price:number;updatedAt:string};
export type PriceUpdate={id:string;price:number|null};
export type PriceUpdateResult={updated:string[];failed:{id:string;error:string}[]};
type PriceRecords=Record<string,PriceRecord>;
type CachedPriceRecord=PriceRecord&{etag:string};
type PriceIndex={version:1;records:Record<string,CachedPriceRecord>};
type StoredIndex={data:unknown;etag?:string};
type WriteCondition={onlyIfMatch:string}|{onlyIfNew:true};
export type PriceBlobStore={
 getWithMetadata(key:string,options:{type:'json'}):Promise<StoredIndex|null>;
 get(key:string,options:{type:'json'}):Promise<unknown>;
 list(options:{prefix:string;paginate:true}):AsyncIterable<{blobs:{key:string;etag?:string}[]}>;
 setJSON(key:string,data:unknown,options?:WriteCondition):Promise<{modified:boolean}>;
 delete(key:string):Promise<void>;
};

const INDEX_KEY='price-index-v1';
const localFile=join(process.cwd(),'.local','prices.json');
const key=(variantId:string)=>'variant-'+Buffer.from(variantId).toString('base64url');
const validId=(id:string)=>/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(id);
const validPrice=(price:unknown):price is number=>Number.isSafeInteger(price)&&Number(price)>=0&&Number(price)<=100000000000;
const storageError=()=>new Error('Katalog fiyatları okunamadı. Lütfen yeniden deneyin.');

function priceRecord(value:unknown):value is PriceRecord{
 if(!value||typeof value!=='object')return false;
 const record=value as Partial<PriceRecord>;
 return validPrice(record.price)&&typeof record.updatedAt==='string';
}

function indexRecords(value:unknown):Record<string,CachedPriceRecord>{
 if(!value||typeof value!=='object')return {};
 const index=value as Partial<PriceIndex>;
 if(index.version!==1||!index.records||typeof index.records!=='object'||Array.isArray(index.records))return {};
 for(const [id,record] of Object.entries(index.records))if(!validId(id)||!priceRecord(record)||!record.etag)return {};
 return index.records;
}

async function localPrices():Promise<PriceRecords>{
 try{return JSON.parse(await readFile(localFile,'utf8')) as PriceRecords;}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {};throw storageError();}
}

// @netlify/blobs 11.1 can report modified:true for failed conditional PUTs.
// Reject non-success responses before they reach that SDK branch; 412 remains
// an ordinary compare-and-swap conflict handled by the retry below.
const checkedBlobFetch:typeof fetch=async(input,init)=>{
 const response=await fetch(input,init);
 const headers=new Headers(init?.headers);
 if(init?.method?.toUpperCase()==='PUT'&&(headers.has('if-match')||headers.has('if-none-match'))&&!response.ok&&response.status!==412){
  throw new Error('Fiyat kaydı depoya yazılamadı.');
 }
 return response;
};

/** A version-checked price cache avoids thousands of blob reads per range query.
 * Individual variant blobs remain authoritative, including writes from older
 * deployments. Never use an index entry without matching the current blob ETag.
 */
export function createBlobPriceRepository(store:PriceBlobStore){
 return {
  async records():Promise<PriceRecords>{
   // Cache outages/corruption may cost extra reads but must not hide saved prices.
   const existing=await store.getWithMetadata(INDEX_KEY,{type:'json'}).catch(()=>null);
   const cached=indexRecords(existing?.data),records:PriceRecords={},next:Record<string,CachedPriceRecord>={};
   let changed=!existing;
   for await(const page of store.list({prefix:'variant-',paginate:true})){
    for(let offset=0;offset<page.blobs.length;offset+=16){
     await Promise.all(page.blobs.slice(offset,offset+16).map(async blob=>{
      const id=Buffer.from(blob.key.slice('variant-'.length),'base64url').toString();
      if(!validId(id))return;
      if(blob.etag&&cached[id]?.etag===blob.etag){
       next[id]=cached[id];records[id]={price:cached[id].price,updatedAt:cached[id].updatedAt};return;
      }
      changed=true;
      // Data and ETag must come from the same response. If a write overlaps the
      // list request, a later request notices its new ETag and refreshes again.
      const current=await store.getWithMetadata(blob.key,{type:'json'});
      if(!current)return;
      if(!priceRecord(current.data))throw storageError();
      records[id]=current.data;
      if(current.etag)next[id]={...current.data,etag:current.etag};
     }));
    }
   }
   changed ||= Object.keys(cached).length!==Object.keys(next).length;
   if(changed&&(!existing||existing.etag)){
    // The index is disposable: a conflicting or failed write never changes the
    // returned prices. A subsequent read checks ETags before trusting it again.
    await store.setJSON(INDEX_KEY,{version:1,records:next} satisfies PriceIndex,
     existing?{onlyIfMatch:existing.etag!}:{onlyIfNew:true}).catch(()=>{});
   }
   return records;
  },
  async selected(ids:string[]):Promise<Record<string,number|null>>{
   const result:Record<string,number|null>={};
   for(let offset=0;offset<ids.length;offset+=16){
    await Promise.all(ids.slice(offset,offset+16).map(async id=>{
     const record=await store.get(key(id),{type:'json'});
     if(record!==null&&!priceRecord(record))throw storageError();
     result[id]=record?.price??null;
    }));
   }
   return result;
  },
  async update(changes:Map<string,number|null>):Promise<PriceUpdateResult>{
   const result:PriceUpdateResult={updated:[],failed:[]},entries=[...changes];
   for(let offset=0;offset<entries.length;offset+=16){
    await Promise.all(entries.slice(offset,offset+16).map(async([id,price])=>{
     try{
      if(price===null)await store.delete(key(id));
      else await store.setJSON(key(id),{price,updatedAt:new Date().toISOString()} satisfies PriceRecord);
      result.updated.push(id);
     }catch{result.failed.push({id,error:'Fiyat kaydedilemedi. Yeniden deneyin.'});}
    }));
   }
   return result;
  },
 };
}

function blobPrices(){return createBlobPriceRepository(getStore({name:'catalog-prices',consistency:'strong',fetch:checkedBlobFetch}));}
async function allRecords(){return isNetlifyRuntime()?blobPrices().records():localPrices();}

export async function getPrices(ids:string[]){
 if(isNetlifyRuntime())return blobPrices().selected([...new Set(ids)]);
 const all=await allRecords(),result:Record<string,number|null>={};
 for(const id of new Set(ids))result[id]=all[id]?.price??null;
 return result;
}

/** Reads only catalog-owned prices; Shopify products are never persisted here. */
export async function getAllPrices():Promise<Record<string,number>>{
 const result:Record<string,number>={};
 for(const [id,record] of Object.entries(await allRecords()))if(validPrice(record.price))result[id]=record.price;
 return result;
}

let localWrite:Promise<unknown>=Promise.resolve();
export async function setPrices(rows:PriceUpdate[]):Promise<PriceUpdateResult>{
 if(rows.length>1000)throw new Error('Tek seferde en fazla 1.000 fiyat güncellenebilir.');
 const result:PriceUpdateResult={updated:[],failed:[]},valid=new Map<string,number|null>();
 for(const row of rows){
  if(!validId(row.id)){result.failed.push({id:row.id,error:'Geçersiz ürün seçeneği.'});continue;}
  if(row.price!==null&&!validPrice(row.price)){result.failed.push({id:row.id,error:'Geçersiz fiyat.'});continue;}
  valid.set(row.id,row.price);
 }
 if(!valid.size)return result;
 if(!isNetlifyRuntime()){
  const operation=localWrite.catch(()=>{}).then(async()=>{
   const all=await localPrices(),updatedAt=new Date().toISOString();
   for(const [id,price] of valid){if(price===null)delete all[id];else all[id]={price,updatedAt};}
   await mkdir(join(process.cwd(),'.local'),{recursive:true});
   const temporary=`${localFile}.${randomUUID()}.tmp`;
   await writeFile(temporary,JSON.stringify(all,null,2));
   await rename(temporary,localFile);
  });
  localWrite=operation;
  try{await operation;result.updated.push(...valid.keys());}
  catch{for(const id of valid.keys())result.failed.push({id,error:'Fiyat kaydedilemedi. Yeniden deneyin.'});}
  return result;
 }
 try{const remote=await blobPrices().update(valid);result.updated.push(...remote.updated);result.failed.push(...remote.failed);}
 catch{for(const id of valid.keys())result.failed.push({id,error:'Fiyat kaydedilemedi. Yeniden deneyin.'});}
 return result;
}

export async function setPrice(variantId:string,price:number|null){
 const result=await setPrices([{id:variantId,price}]);
 if(result.failed.length)throw new Error(result.failed[0].error);
}
