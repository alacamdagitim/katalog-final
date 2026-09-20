import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {HttpError,sameOrigin} from '../lib/http';

const denied=(error:unknown)=>error instanceof HttpError&&error.status===403;
test('actual NextRequest loopback normalization cannot reject legitimate browser writes',()=>{
 for(const host of ['localhost:3010','127.0.0.1:3010','[::1]:3010']){
  const origin=`http://${host}`;
  const req=new NextRequest(`${origin}/api/prices`,{headers:{host,origin}});
  if(host.startsWith('127.'))assert.equal(new URL(req.url).hostname,'localhost');
  assert.doesNotThrow(()=>sameOrigin(req));
 }
 assert.doesNotThrow(()=>sameOrigin(new NextRequest('https://katalog.example.com/api/prices',{headers:{host:'katalog.example.com',origin:'https://katalog.example.com'}})));
});
test('origin checks keep host, port and protocol boundaries; forwarded host is not trusted',()=>{
 for(const origin of ['http://localhost:3010','http://127.0.0.1:3000','https://127.0.0.1:3010','null','https://evil.example','http://127.0.0.1:3010/']){
  const req=new NextRequest('http://127.0.0.1:3010/api/prices',{headers:{host:'127.0.0.1:3010',origin,'x-forwarded-host':'evil.example'}});
  assert.throws(()=>sameOrigin(req),denied);
 }
});
test('missing and malformed Host headers fail closed when Origin is present',()=>{
 for(const host of ['', 'example.com/path','user@example.com','example.com?x=1','example.com,evil.example','example.com\\evil','example.com%2Fevil']){
  assert.throws(()=>sameOrigin(new Request('https://example.com/api/prices',{headers:{host,origin:'https://example.com'}})),denied);
 }
});
