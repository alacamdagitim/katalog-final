import {createHmac,timingSafeEqual} from 'node:crypto';
import {database as db} from '../database';
import {accessToken,decryptSecret,shopDomain} from '../shopify-auth';
import {enqueueStatement,setSetting} from './queue';
const topics=['PRODUCTS_CREATE','PRODUCTS_UPDATE','PRODUCTS_DELETE','APP_UNINSTALLED','INVENTORY_LEVELS_UPDATE','INVENTORY_LEVELS_CONNECT','INVENTORY_LEVELS_DISCONNECT'];
export function validHmac(body:Buffer,signature:string,secret:string){
 const expected=createHmac('sha256',secret).update(body).digest();
 const supplied=Buffer.from(signature,'base64');return supplied.length===expected.length&&timingSafeEqual(expected,supplied);
}
export async function webhookSecret(){const row=await db.prepare("SELECT value FROM settings WHERE key='shopify_auth'").first<{value:string}>();if(!row)return null;const auth=JSON.parse(await decryptSecret(row.value));return auth.mode==='client_credentials'?auth.clientSecret:null}
export async function receiveWebhook(eventId:string,topic:string,body:any){
 if(!/^[\w-]{8,150}$/.test(eventId))throw new Error('Invalid event id');
 if(!['products/create','products/update','products/delete','app/uninstalled','inventory_levels/update','inventory_levels/connect','inventory_levels/disconnect'].includes(topic))return;
 const existing=await db.prepare('SELECT id FROM webhook_receipts WHERE id=?').bind(eventId).first();if(existing)return;
 // Receipt and work commit together. Concurrent duplicate deliveries can only enqueue the same idempotent work.
 const statements=[db.prepare('INSERT OR IGNORE INTO webhook_receipts VALUES(?,?)').bind(eventId,Date.now())];
 if(topic==='app/uninstalled')statements.push(setSetting('sync_enabled','0'));
 else if(topic.startsWith('inventory_levels/')){
  const id=String(body.inventory_item_id||'');if(!/^\d+$/.test(id))throw new Error('Invalid inventory item');
  statements.push(enqueueStatement('inventory','inventory:'+id,{},'gid://shopify/InventoryItem/'+id));
 }else{
  const id=String(body.admin_graphql_api_id||'gid://shopify/Product/'+body.id);
  if(!/^gid:\/\/shopify\/Product\/\d+$/.test(id))throw new Error('Invalid product id');
  // Even deletes are re-read: a delayed old notification cannot overwrite a newer product state.
  statements.push(enqueueStatement('product','product:'+id,{},id));
 }
 await db.batch(statements);
}
export async function registerWebhooks(){
 const appUrl=new URL(process.env.APP_URL||'');
 if(appUrl.protocol!=='https:')throw new Error('Webhooks require a public HTTPS APP_URL');
 const uri=new URL('/api/webhooks/shopify',appUrl).href;
 const token=await accessToken();
 // This private function only manages this app's subscriptions. Product/order mutations remain blocked.
 async function send(query:string,variables:unknown){const r=await fetch(`https://${shopDomain}/admin/api/2026-07/graphql.json`,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('Webhook registration request failed');const data:any=await r.json();if(data.errors?.length)throw new Error('Webhook registration failed');return data.data;}
 const current=[] as any[];let after:string|null=null;
 do{const data=await send('query Subscriptions($after:String){webhookSubscriptions(first:100,after:$after){nodes{id topic uri} pageInfo{hasNextPage endCursor}}}',{after});current.push(...data.webhookSubscriptions.nodes);after=data.webhookSubscriptions.pageInfo.hasNextPage?data.webhookSubscriptions.pageInfo.endCursor:null;}while(after);
 for(const topic of topics){if(current.some(s=>s.topic===topic&&s.uri===uri))continue;
  const result=await send('mutation RegisterCatalogWebhook($topic:WebhookSubscriptionTopic!,$input:WebhookSubscriptionInput!){webhookSubscriptionCreate(topic:$topic,webhookSubscription:$input){webhookSubscription{id} userErrors{field message}}}',{topic,input:{uri,format:'JSON'}});
  if(result.webhookSubscriptionCreate.userErrors?.length)throw new Error('Webhook registration rejected; verify read_products and read_inventory scopes');
  return false; // At most one subscription write per server invocation.
 }
 await setSetting('webhooks_registered_at',new Date().toISOString()).run();
 return true;
}
