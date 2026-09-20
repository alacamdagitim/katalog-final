import test from 'node:test';
import assert from 'node:assert/strict';
import {isNetlifyRuntime} from '../lib/storage-runtime';

test('Netlify Functions SITE_ID selects durable blobs without build-only flags',()=>{
 assert.equal(isNetlifyRuntime({SITE_ID:'site-id-from-functions',NODE_ENV:'production'}),true);
 assert.equal(isNetlifyRuntime({NETLIFY_SITE_ID:'legacy-explicit-site'}),true);
 assert.equal(isNetlifyRuntime({NETLIFY:'true'}),true);
});

test('local development and production previews do not select remote storage',()=>{
 for(const environment of [{},{NODE_ENV:'development',LOCAL_ADMIN_PREVIEW:'1'},{NODE_ENV:'production'},{NETLIFY:'false'},{SITE_ID:' ',NETLIFY_SITE_ID:''}]){
  assert.equal(isNetlifyRuntime(environment),false);
 }
});
