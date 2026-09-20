import test from 'node:test';
import assert from 'node:assert/strict';
import {isNetlifyRuntime,storageReadiness} from '../lib/storage-runtime';

test('Netlify Functions SITE_ID selects durable blobs without build-only flags',()=>{
 assert.equal(isNetlifyRuntime({SITE_ID:'site-id-from-functions',NODE_ENV:'production'}),true);
 assert.equal(isNetlifyRuntime({NETLIFY_SITE_ID:'legacy-explicit-site'}),true);
 assert.equal(isNetlifyRuntime({NETLIFY:'true'}),true);
});

test('Vercel without storage fails readiness and never chooses a local or stale Netlify backend',()=>{
 for(const environment of [{VERCEL:'1'},{VERCEL_ENV:'production'},{VERCEL_ENV:'preview',NETLIFY:'true',SITE_ID:'old-netlify'}]){
  const result=storageReadiness(environment);
  assert.equal(result.provider,'vercel');assert.equal(result.configured,false);assert.equal(result.durable,false);
  assert.match(result.reason||'',/BLOB_READ_WRITE_TOKEN/);
 }
 const result=storageReadiness({VERCEL:'1',BLOB_READ_WRITE_TOKEN:'test-private-credential'});
 assert.equal(result.configured,true);assert.equal(result.durable,true);
 assert.ok(!JSON.stringify(result).includes('test-private-credential'));
 assert.equal(storageReadiness({BLOB_READ_WRITE_TOKEN:'test-local-token'}).provider,'local');
});

test('local development and production previews do not select remote storage',()=>{
 for(const environment of [{},{NODE_ENV:'development',LOCAL_ADMIN_PREVIEW:'1'},{NODE_ENV:'production'},{NETLIFY:'false'},{SITE_ID:' ',NETLIFY_SITE_ID:''}]){
  assert.equal(isNetlifyRuntime(environment),false);
 }
});
