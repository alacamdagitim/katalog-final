export default async function(){
 if(process.env.SYNC_ENABLED!=='true')return;
 const origin=new URL(process.env.APP_URL);
 if(origin.protocol!=='https:'||(process.env.CRON_SECRET||'').length<32)throw new Error('Configure APP_URL and CRON_SECRET');
 const r=await fetch(new URL('/api/internal/sync',origin),{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+process.env.CRON_SECRET},signal:AbortSignal.timeout(27000)});
 if(!r.ok)throw new Error('Catalog sync invocation failed: '+r.status);
}
