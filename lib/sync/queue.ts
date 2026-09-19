import {database as db,Statement} from '../database';
export type Task={id:string;kind:string;dedupeKey:string;productId:string|null;payload:string;leaseToken:string;generation:number;attempts:number;createdAt:string};
export async function setting(key:string){return (await db.prepare('SELECT value FROM settings WHERE key=?').bind(key).first<{value:string}>())?.value}
export function setSetting(key:string,value:string){return db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,value)}
export function enqueueStatement(kind:string,dedupeKey:string,payload:unknown={},productId:string|null=null,priority=0){
 const now=new Date().toISOString();
 return db.prepare(`INSERT INTO sync_tasks(id,kind,dedupeKey,productId,payload,createdAt,updatedAt,priority) VALUES(?,?,?,?,?,?,?,?)
 ON CONFLICT(dedupeKey) DO UPDATE SET generation=generation+1,
 state=CASE WHEN sync_tasks.state='running' THEN 'running' ELSE 'pending' END,
 payload=CASE WHEN sync_tasks.state='running' THEN sync_tasks.payload ELSE excluded.payload END,
 priority=CASE WHEN sync_tasks.state='done' THEN excluded.priority ELSE MIN(sync_tasks.priority,excluded.priority) END,
 nextAt=CASE WHEN sync_tasks.state='running' THEN nextAt ELSE 0 END,updatedAt=excluded.updatedAt`).bind(crypto.randomUUID(),kind,dedupeKey,productId,JSON.stringify(payload),now,now,priority);
}
export async function enqueueProduct(id:string){await enqueueStatement('product','product:'+id,{},id).run()}
export async function initialSync(){
 const now=new Date().toISOString();
 await db.batch([setSetting('sync_enabled','1'),setSetting('delta_since',now),enqueueStatement('full','scan:full',{startedAt:now}),enqueueStatement('delta','scan:delta',{startedAt:now,since:new Date(Date.now()-120000).toISOString()})]);
}
export async function claim(kind:string):Promise<Task|null>{
 const now=Date.now(),token=crypto.randomUUID();
 return db.prepare(`UPDATE sync_tasks SET state='running',leaseToken=?,leaseUntil=?,updatedAt=?
 WHERE id=(SELECT id FROM sync_tasks WHERE kind=? AND nextAt<=? AND (state='pending' OR (state='running' AND leaseUntil<?)) ORDER BY priority,nextAt,createdAt LIMIT 1) RETURNING *`).bind(token,now+90000,new Date().toISOString(),kind,now,now).first<Task>();
}
export const fence="EXISTS(SELECT 1 FROM sync_tasks WHERE id=? AND leaseToken=? AND state='running' AND leaseUntil>?)";
export const fenceArgs=(t:Task)=>[t.id,t.leaseToken,Date.now()];
export async function commit(t:Task,writes:Statement[]){
 // A lost/expired lease fails the CHECK and rolls back the entire batch, including enqueued work.
 await db.batch([db.prepare('INSERT OR REPLACE INTO sync_commit_guard SELECT CASE WHEN '+fence+' THEN 1 ELSE 0 END').bind(...fenceArgs(t)),...writes]);
}
export function finishStatement(t:Task,payload:unknown,complete:boolean){
 return db.prepare(`UPDATE sync_tasks SET state=CASE WHEN ?=1 AND generation=? THEN 'done' ELSE 'pending' END,
 payload=CASE WHEN ?=1 AND generation<>? THEN '{}' ELSE ? END,
 leaseToken=NULL,leaseUntil=0,attempts=0,nextAt=0,lastError=NULL,updatedAt=? WHERE id=? AND leaseToken=?`).bind(complete?1:0,t.generation,complete?1:0,t.generation,JSON.stringify(payload),new Date().toISOString(),t.id,t.leaseToken);
}
export async function retry(t:Task,error:unknown){
 const e=error as {status?:number;retryAfter?:number};
 const delay=Math.max(e.retryAfter||0,Math.min(900000,2000*2**Math.min(t.attempts,9)))+Math.floor(Math.random()*1000);
 const message=e.status===429?'Shopify hız sınırı; otomatik yeniden denenecek.':e.status===401||e.status===403?'Shopify bağlantı izni kontrol edilmeli.':'Geçici bağlantı veya işlem hatası; otomatik yeniden denenecek.';
 await db.prepare("UPDATE sync_tasks SET state='pending',attempts=attempts+1,nextAt=?,leaseToken=NULL,leaseUntil=0,lastError=?,updatedAt=? WHERE id=? AND leaseToken=?").bind(Date.now()+delay,message,new Date().toISOString(),t.id,t.leaseToken).run();
 if(e.status===429)await setSetting('shopify_cooldown',String(Date.now()+delay)).run();
}
