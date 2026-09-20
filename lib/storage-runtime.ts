/** Netlify Functions exposes SITE_ID at runtime; NETLIFY is only guaranteed at
 * build time. Keep local next dev/start on files unless Netlify is identified.
 * Shared by every catalog store so prices and approvals cannot diverge.
 */
export function isNetlifyRuntime(environment:Record<string,string|undefined>=process.env):boolean{
 return environment.NETLIFY==='true'||Boolean(environment.SITE_ID?.trim()||environment.NETLIFY_SITE_ID?.trim());
}

export type StorageReadiness={provider:'vercel'|'netlify'|'local';configured:boolean;durable:boolean;reason:string|null};
export function storageReadiness(environment:Record<string,string|undefined>=process.env):StorageReadiness{
 // Vercel wins over stale Netlify variables copied during a hosting migration.
 if(environment.VERCEL==='1'||environment.VERCEL_ENV==='production'||environment.VERCEL_ENV==='preview'){
  const configured=Boolean(environment.BLOB_READ_WRITE_TOKEN?.trim());
  return {provider:'vercel',configured,durable:configured,reason:configured?null:'Kalıcı katalog deposu bağlı değil. Vercel Storage bölümünde Private Blob deposunu projeye bağlayıp BLOB_READ_WRITE_TOKEN değişkenini etkinleştirin ve yeniden yayınlayın.'};
 }
 if(isNetlifyRuntime(environment))return {provider:'netlify',configured:true,durable:true,reason:null};
 return {provider:'local',configured:true,durable:false,reason:'Yerel önizleme kayıtları yalnız bu bilgisayarda saklanır.'};
}

export function configuredStorageProvider():StorageReadiness['provider']{
 const storage=storageReadiness();
 if(!storage.configured)throw new HttpError(503,storage.reason!);
 return storage.provider;
}
import {HttpError} from './http';
