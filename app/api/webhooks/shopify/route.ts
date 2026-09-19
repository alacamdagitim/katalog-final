import {after} from 'next/server';
import {shopDomain} from '@/lib/shopify-auth';
import {receiveWebhook,validHmac,webhookSecret} from '@/lib/sync/webhooks';
import {runSync} from '@/lib/sync/engine';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(req:Request){
 if(process.env.SYNC_ENABLED!=='true')return new Response('Disabled',{status:503});
 if(req.headers.get('x-shopify-shop-domain')!==shopDomain)return new Response('Unauthorized',{status:401});
 if(Number(req.headers.get('content-length')||0)>2000000)return new Response('Too large',{status:413});
 const chunks:Uint8Array[]=[];let size=0;
 const reader=req.body?.getReader();if(!reader)return new Response('Bad request',{status:400});
 while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2000000){await reader.cancel();return new Response('Too large',{status:413})}chunks.push(part.value)}
 const bytes=Buffer.concat(chunks);
 try{
  const secret=await webhookSecret();if(!secret||!validHmac(bytes,req.headers.get('x-shopify-hmac-sha256')||'',secret))return new Response('Unauthorized',{status:401});
  const body=JSON.parse(bytes.toString('utf8'));
  await receiveWebhook(req.headers.get('x-shopify-webhook-id')||'',req.headers.get('x-shopify-topic')||'',body);
  // Best-effort immediate pickup; durable scheduler handles retries, timeouts and process termination.
  after(async()=>{await runSync().catch(()=>console.error('sync pickup deferred'))});
  return new Response(null,{status:200});
 }catch{return new Response('Please retry',{status:503})}
}
