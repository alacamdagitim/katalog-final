import {timingSafeEqual} from 'node:crypto';
import {runSync} from '@/lib/sync/engine';
import {setSetting} from '@/lib/sync/queue';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(req:Request){
 const key=process.env.CRON_SECRET||'',header=req.headers.get('authorization')||'';
 const expected=Buffer.from('Bearer '+key),actual=Buffer.from(header);
 if(key.length<32||actual.length!==expected.length||!timingSafeEqual(actual,expected))return Response.json({error:'Unauthorized'},{status:401});
 try{await setSetting('scheduler_heartbeat',new Date().toISOString()).run();return Response.json(await runSync(),{headers:{'Cache-Control':'no-store'}})}catch{return Response.json({error:'Runner failed; queue preserved'},{status:503})}
}
export const POST=GET;
