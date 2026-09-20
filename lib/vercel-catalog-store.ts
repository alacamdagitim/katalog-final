import {get,put,BlobPreconditionFailedError,BlobServiceRateLimited} from '@vercel/blob';
import {HttpError} from './http';

// These are catalog-owned settings only, never Shopify product copies. A batch
// changes one small document rather than spending one Blob PUT per variant.
const MAX_DOCUMENT_BYTES=8*1024*1024;
const MAX_RECORDS=100_000;
const MAX_ATTEMPTS=6;
const MIN_WRITE_INTERVAL=1100;
const VARIANT_ID=/^gid:\/\/shopify\/ProductVariant\/\d{1,20}(?![\s\S])/;
const unavailable=()=>new HttpError(503,'Vercel özel katalog deposuna erişilemedi. Private Blob bağlantısını, sunucu erişim anahtarını ve kullanım kotasını kontrol edin. Kayıtlar yerel dosyaya yazılmadı.');
const corrupt=()=>new HttpError(503,'Kalıcı katalog kaydı okunamadı; mevcut veri güvenliği için üzerine yazılmadı.');

export type StoredDocument={data:unknown;etag:string};
export interface CatalogDocumentDriver{
 read(path:string):Promise<StoredDocument|null>;
 write(path:string,data:string,etag:string|null):Promise<void>;
}
export class CatalogDocumentConflict extends Error{}
export class CatalogDocumentRateLimit extends Error{constructor(public retryAfterMs:number){super('Storage rate limit');}}

async function boundedText(stream:ReadableStream<Uint8Array>):Promise<string>{
 const reader=stream.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{
  for(;;){
   const result=await reader.read();if(result.done)break;
   size+=result.value.byteLength;
   if(size>MAX_DOCUMENT_BYTES){await reader.cancel();throw corrupt();}
   chunks.push(result.value);
  }
 }finally{reader.releaseLock();}
 return Buffer.concat(chunks).toString('utf8');
}

export function createVercelDocumentDriver(token:string,sdk:{get:typeof get;put:typeof put}={get,put}):CatalogDocumentDriver{
 if(!token.trim())throw unavailable();
 const read=async(path:string):Promise<StoredDocument|null>=>{
  try{
   // Private no-cache reads hit origin storage. CDN-stale approvals are unsafe.
   const result=await sdk.get(path,{access:'private',token,useCache:false,abortSignal:AbortSignal.timeout(8000)});
   if(!result)return null;
   if(result.statusCode!==200||!result.stream||!result.blob.etag||(result.blob.size??0)>MAX_DOCUMENT_BYTES){
    await result.stream?.cancel();
    throw corrupt();
   }
   return {data:JSON.parse(await boundedText(result.stream)),etag:result.blob.etag};
  }catch(error){
   if(error instanceof HttpError)throw error;
   if(error instanceof BlobServiceRateLimited)throw new CatalogDocumentRateLimit(Math.max(1100,error.retryAfter*1000));
   throw unavailable();
  }
 };
 return {read,async write(path,data,etag){
  try{
   await sdk.put(path,data,{access:'private',token,addRandomSuffix:false,allowOverwrite:etag!==null,...(etag?{ifMatch:etag}:{}),contentType:'application/json',cacheControlMaxAge:60,abortSignal:AbortSignal.timeout(8000)});
  }catch(error){
   if(error instanceof BlobPreconditionFailedError)throw new CatalogDocumentConflict();
   if(error instanceof BlobServiceRateLimited)throw new CatalogDocumentRateLimit(Math.max(1100,error.retryAfter*1000));
   // Creating a missing document uses allowOverwrite:false. If another writer
   // won first, reread/merge; NEVER retry with unconditional overwrite.
   if(etag===null&&await read(path))throw new CatalogDocumentConflict();
   throw unavailable();
  }
 }};
}

type CatalogDocument<T>={version:1;modifiedAt:number;entries:Record<string,T>};
function parseDocument<T>(value:unknown,valid:(record:unknown)=>record is T):CatalogDocument<T>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw corrupt();
 const document=value as Partial<CatalogDocument<T>>;
 if(document.version!==1||!Number.isSafeInteger(document.modifiedAt)||document.modifiedAt!<0||!document.entries||typeof document.entries!=='object'||Array.isArray(document.entries))throw corrupt();
 const entries=Object.entries(document.entries);
 if(entries.length>MAX_RECORDS||entries.some(([id,record])=>!VARIANT_ID.test(id)||!valid(record)))throw corrupt();
 return document as CatalogDocument<T>;
}

/** Per-document optimistic concurrency also protects across independent function
 * instances. No process-local lock or shared whole-file last-write-wins cache.
 */
export function createVercelMapRepository<T>(path:string,valid:(record:unknown)=>record is T,driver:CatalogDocumentDriver,options:{now?:()=>number;pause?:(ms:number)=>Promise<void>}={}){
 const now=options.now||Date.now,pause=options.pause||((ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)));
 return {
  async entries():Promise<Record<string,T>>{
   try{const current=await driver.read(path);return current?parseDocument(current.data,valid).entries:{};}
   catch(error){if(error instanceof CatalogDocumentRateLimit)throw new HttpError(429,'Katalog deposunun istek sınırına ulaşıldı. Biraz sonra yeniden deneyin.');throw error;}
  },
  async update(changes:Map<string,T|null>):Promise<void>{
   if(!changes.size)return;
   if([...changes].some(([id,value])=>!VARIANT_ID.test(id)||(value!==null&&!valid(value))))throw new HttpError(400,'Geçersiz katalog kaydı.');
   const deadline=now()+20_000;
   for(let attempt=0;attempt<MAX_ATTEMPTS;attempt++){
    try{
     const current=await driver.read(path);
     const previous=current?parseDocument(current.data,valid):null;
     // Conservative same-path pacing, including sequential Excel chunks and
     // other instances. CAS still handles overlap during this short wait.
     if(previous){const wait=Math.min(MIN_WRITE_INTERVAL,Math.max(0,previous.modifiedAt+MIN_WRITE_INTERVAL-now()));if(wait)await pause(wait);}
     const entries={...previous?.entries};
     for(const [id,value] of changes){if(value===null)delete entries[id];else entries[id]=value;}
     if(Object.keys(entries).length>MAX_RECORDS)throw new HttpError(413,'Katalog ayarları kayıt sınırına ulaştı.');
     const data=JSON.stringify({version:1,modifiedAt:now(),entries} satisfies CatalogDocument<T>);
     if(Buffer.byteLength(data)>MAX_DOCUMENT_BYTES)throw new HttpError(413,'Katalog ayarları dosya sınırına ulaştı.');
     await driver.write(path,data,current?.etag??null);
     return;
    }catch(error){
     const retryable=error instanceof CatalogDocumentConflict||error instanceof CatalogDocumentRateLimit;
     if(!retryable)throw error;
     const wait=error instanceof CatalogDocumentRateLimit?error.retryAfterMs:50+attempt*75;
     if(attempt+1===MAX_ATTEMPTS||now()+wait>deadline)throw new HttpError(409,'Katalog kaydı başka bir işlemle çakıştı veya depo meşgul. Değişiklikler kaydedilmedi; yeniden deneyin.');
     await pause(wait);
    }
   }
  },
 };
}

export function vercelCatalogMap<T>(name:'prices'|'visibility',valid:(record:unknown)=>record is T){
 const token=process.env.BLOB_READ_WRITE_TOKEN?.trim()||'';
 return createVercelMapRepository(`catalog-settings/v1/${name}.json`,valid,createVercelDocumentDriver(token));
}
