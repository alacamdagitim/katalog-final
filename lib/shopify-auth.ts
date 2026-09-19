import {db,HttpError} from './server';

export const shopDomain=process.env.SHOPIFY_SHOP_DOMAIN||'dx0nin-1q.myshopify.com';
if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain))throw new Error('Invalid Shopify shop domain');
export type ShopifyAuth={mode:'client_credentials';clientId:string;clientSecret:string;accessToken:string;expiresAt:number}|{mode:'legacy';accessToken:string};
async function key(){
 const secret=process.env.SHOPIFY_TOKEN_KEY;
 if(!secret)throw new HttpError(503,'Güvenli bağlantı alanı henüz etkinleştirilmedi.');
 return crypto.subtle.importKey('raw',Uint8Array.from(atob(secret),c=>c.charCodeAt(0)),'AES-GCM',false,['encrypt','decrypt']);
}
export async function encryptSecret(value:string){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(),new TextEncoder().encode(value));
 return JSON.stringify({iv:Array.from(iv),data:Array.from(new Uint8Array(data))});
}
export async function decryptSecret(value:string){
 const data=JSON.parse(value);
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(data.iv)},await key(),new Uint8Array(data.data));
 return new TextDecoder().decode(plain);
}
export function checkReadScopes(scopes:string[]){
 if(!scopes.includes('read_inventory'))throw new HttpError(400,'Otomatik stok takibi için uygulamaya read_inventory iznini ekleyip mağazada onaylayın.');
 if(!scopes.includes('read_products'))throw new HttpError(400,'Uygulamanıza read_products iznini ekleyin, sürümü yayınlayın ve mağazada onaylayın.');
 if(scopes.some(s=>s.startsWith('write_')))throw new HttpError(400,'Bu katalog için yazma izni olmayan ayrı bir uygulama kullanın. Yalnızca read_products izni yeterlidir.');
}
export async function exchangeCredentials(clientId:string,clientSecret:string):Promise<ShopifyAuth>{
 if(!/^[a-zA-Z0-9_-]{8,200}$/.test(clientId)||clientSecret.length<16||clientSecret.length>1000)throw new HttpError(400,'Geçerli Client ID ve Client secret bilgilerini girin.');
 let response:Response;
 // Workers supports manual redirects; never forward credentials to a redirect target.
 try{response=await fetch(`https://${shopDomain}/admin/oauth/access_token`,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret}),signal:AbortSignal.timeout(20000)});}catch{throw new HttpError(502,'Shopify’a şu anda ulaşılamıyor. Bağlantıyı tekrar deneyin.');}
 if(response.status>=300&&response.status<400)throw new HttpError(502,'Shopify beklenmeyen bir yönlendirme döndürdü. Güvenlik için bağlantı durduruldu.');
 let data:any;try{data=await response.json()}catch{throw new HttpError(502,'Shopify geçerli bir yanıt vermedi. Tekrar deneyin.');}
 if(!response.ok){
  if(response.status===429)throw new HttpError(429,'Shopify istek sınırına ulaşıldı. Biraz sonra tekrar deneyin.');
  const code=String(data?.error||'');
  if(code.includes('shop_not_permitted')||String(data?.error_description||'').includes('shop_not_permitted'))throw new HttpError(400,'Uygulama ve mağaza aynı Shopify kuruluşunda değil. Doğru kuruluşu seçin; farklı kuruluşlar için ayrı OAuth bağlantısı kurulması gerekir.');
  throw new HttpError(400,'Bağlantı doğrulanamadı. Uygulamanın bu mağazada kurulu olduğunu ve Client ID / Client secret bilgilerini kontrol edin.');
 }
 if(typeof data?.access_token!=='string'||!data.access_token||!Number.isFinite(data.expires_in)||data.expires_in<120)throw new HttpError(502,'Shopify erişim süresi doğrulanamadı.');
 checkReadScopes(String(data.scope||'').split(',').map(s=>s.trim()));
 return {mode:'client_credentials',clientId,clientSecret,accessToken:data.access_token,expiresAt:Date.now()+data.expires_in*1000};
}
export async function saveAuth(auth:ShopifyAuth){
 const encrypted=await encryptSecret(JSON.stringify(auth));
 await db().batch([
  db().prepare("INSERT INTO settings(key,value) VALUES('shopify_auth',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(encrypted),
  db().prepare("INSERT INTO settings(key,value) VALUES('shopify_connected',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(new Date().toISOString())
 ]);
}
export async function authInfo(){
 const row=await db().prepare("SELECT value FROM settings WHERE key='shopify_auth'").first<{value:string}>();
 if(row){const a=JSON.parse(await decryptSecret(row.value)) as ShopifyAuth;return {connected:true,mode:a.mode,autoRenew:a.mode==='client_credentials'};}
 const legacy=await db().prepare("SELECT key FROM settings WHERE key='shopify_token'").first();
 return {connected:!!legacy,mode:legacy?'legacy':null,autoRenew:false};
}
export async function accessToken(forceRefresh=false):Promise<string>{
 const row=await db().prepare("SELECT value FROM settings WHERE key='shopify_auth'").first<{value:string}>();
 if(!row){const legacy=await db().prepare("SELECT value FROM settings WHERE key='shopify_token'").first<{value:string}>();if(legacy)return decryptSecret(legacy.value);throw new HttpError(400,'Önce Shopify bağlantısını kurun.');}
 const auth=JSON.parse(await decryptSecret(row.value)) as ShopifyAuth;
 if(auth.mode==='legacy')return auth.accessToken;
 if(!forceRefresh&&Date.now()<auth.expiresAt-60000)return auth.accessToken;
 const renewed=await exchangeCredentials(auth.clientId,auth.clientSecret);
 const encrypted=await encryptSecret(JSON.stringify(renewed));
 // A stale request must never overwrite a connection replaced by the owner.
 const saved=await db().prepare("UPDATE settings SET value=? WHERE key='shopify_auth' AND value=?").bind(encrypted,row.value).run();
 if(!saved.meta.changes){const current=await db().prepare("SELECT value FROM settings WHERE key='shopify_auth'").first<{value:string}>();if(!current)throw new HttpError(409,'Bağlantı değişti. Yeniden deneyin.');const latest=JSON.parse(await decryptSecret(current.value)) as ShopifyAuth;return latest.accessToken;}
 return renewed.accessToken;
}
