import {after} from 'next/server';
import {currentMember,ok,fail,requirePermission,sameOrigin,jsonBody,HttpError} from '@/lib/server';
import {shopify,shopDomain} from '@/lib/shopify';
import {authInfo,exchangeCredentials,checkReadScopes,saveAuth} from '@/lib/shopify-auth';
import {enqueueStatement,initialSync,setting} from '@/lib/sync/queue';
import {runSync,syncStatus} from '@/lib/sync/engine';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(){try{requirePermission(await currentMember(),'shopify.sync');return ok({domain:shopDomain,...await authInfo(),sync:await syncStatus(),webhooksRegistered:await setting('webhooks_registered_at')||null})}catch(e){return fail(e)}}
export async function POST(req:Request){try{
 sameOrigin(req);const user=await currentMember();requirePermission(user,'shopify.sync');const body=await jsonBody(req);
 if(user.role!=='owner')throw new HttpError(403,'Bağlantıyı yalnızca firma sahibi kurabilir.');
 if(body.action!=='connect')throw new HttpError(400,'Eşitlemeyi sunucu otomatik yönetir.');
 if(typeof body.clientId!=='string'||typeof body.clientSecret!=='string')throw new HttpError(400,'Bağlantı bilgilerini girin.');
 const auth=await exchangeCredentials(body.clientId.trim(),body.clientSecret.trim());
 const result=await shopify('query ConnectionTest{shop{name} currentAppInstallation{accessScopes{handle}}}',{},auth.accessToken);
 checkReadScopes(result.currentAppInstallation.accessScopes.map((s:any)=>s.handle));
 await saveAuth(auth);await initialSync();await enqueueStatement('register','webhooks').run();
 after(async()=>{await runSync().catch(()=>console.error('initial sync pickup deferred'))});
 return ok({connected:true,name:result.shop.name,queued:true});
}catch(e){return fail(e)}}
