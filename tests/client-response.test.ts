import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readApiResponse} from '../lib/client-response';

test('API client returns acknowledged JSON and preserves safe setup errors', async () => {
  assert.deepEqual(await readApiResponse(Response.json({updated:['1']})), {updated:['1']});
  await assert.rejects(readApiResponse(Response.json({error:'Kalıcı depo bağlı değil.'}, {status:503})), /Kalıcı depo bağlı değil/);
});
test('API client does not expose HTML, malformed JSON or invalid response shapes', async () => {
  await assert.rejects(readApiResponse(new Response('<html>platform failure</html>', {status:502})), /Sunucuya ulaşılamadı/);
  await assert.rejects(readApiResponse(Response.json(null)), /geçerli yanıt/);
  await assert.rejects(readApiResponse(new Response('', {status:401})), /Oturumunuz sona erdi/);
});
test('batch callers can retain individual row errors before checking status', async () => {
  const failure = {updated:[], failed:[{id:'1', error:'Ürün yayında değil'}]};
  assert.deepEqual(await readApiResponse(Response.json(failure, {status:422}), true), failure);
});
