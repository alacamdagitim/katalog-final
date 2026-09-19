// Optional self-hosted/local runner. Production serverless deployments use their scheduler.
if(!process.env.APP_URL||!process.env.CRON_SECRET)throw new Error('APP_URL and CRON_SECRET required');
let stopped=false;process.on('SIGINT',()=>{stopped=true});process.on('SIGTERM',()=>{stopped=true});
do{try{const r=await fetch(new URL('/api/internal/sync',process.env.APP_URL),{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+process.env.CRON_SECRET},signal:AbortSignal.timeout(55000)});console.log(r.ok?'Eşitleme döngüsü tamamlandı.':'Eşitleme yeniden denenecek.')}catch{console.error('Sunucuya ulaşılamadı; kuyruk korunuyor.')}if(!stopped)await new Promise(r=>setTimeout(r,5000));}while(!stopped);
