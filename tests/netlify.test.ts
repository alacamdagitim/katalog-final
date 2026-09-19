import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/catalog-sync.mjs';

test('Netlify scheduled invocation is gated, authenticated and rejects failures',async()=>{
 const originalFetch=globalThis.fetch;
 const old={enabled:process.env.SYNC_ENABLED,url:process.env.APP_URL,key:process.env.CRON_SECRET};
 let calls=0;
 try {
  globalThis.fetch=async(input,init)=>{
   calls++;
   assert.equal(String(input),'https://catalog.example.test/api/internal/sync');
   assert.equal(init?.method,'POST');
   assert.equal(init?.redirect,'error');
   assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer '+process.env.CRON_SECRET);
   return Response.json({state:'ok'});
  };
  process.env.SYNC_ENABLED='false';await handler();assert.equal(calls,0);
  process.env.SYNC_ENABLED='true';process.env.APP_URL='http://catalog.example.test';process.env.CRON_SECRET='x'.repeat(32);
  await assert.rejects(handler());assert.equal(calls,0);
  process.env.APP_URL='https://catalog.example.test';process.env.CRON_SECRET='short';await assert.rejects(handler());
  process.env.CRON_SECRET='x'.repeat(32);await handler();assert.equal(calls,1);
  globalThis.fetch=async()=>new Response(null,{status:503});await assert.rejects(handler());
 }finally{
  globalThis.fetch=originalFetch;
  for(const [key,value]of Object.entries({SYNC_ENABLED:old.enabled,APP_URL:old.url,CRON_SECRET:old.key})){
   if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
 }
});
