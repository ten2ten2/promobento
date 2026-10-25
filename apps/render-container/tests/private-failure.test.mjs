import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCanonicalJson} from '@promobento/contracts/canonical';
import {savePrivateFailure} from '../src/private-failure.mjs';

test('private failure evidence is bounded, token-redacted and confined to the current attempt',async()=>{
  const task={brokerToken:'fixture-internal-token',taskId:'attempt-1',mode:'shard',shard:{index:2},job:{renderId:'render-1'}};
  const error=Object.assign(Error('page.evaluate: fixture-internal-token Bearer another-fixture-token '+'x'.repeat(4000)),{cause:{code:'ECONNRESET'}});
  let saved;
  const ref=await savePrivateFailure(error,task,async(key,bytes,mediaType)=>{
    saved={key,value:parseCanonicalJson(bytes),mediaType};return{key,byteLength:bytes.length};
  });
  assert.equal(ref.key,'renders/render-1/attempts/attempt-1/shards/2/private-failure.json');
  assert.equal(saved.mediaType,'application/json');assert.equal(saved.value.message.length,2048);
  assert.equal(JSON.stringify(saved.value).includes(task.brokerToken),false);
  assert.equal(JSON.stringify(saved.value).includes('another-fixture-token'),false);
  assert.equal(saved.value.cause.code,'ECONNRESET');
  assert.equal(await savePrivateFailure(error,task,async()=>{throw Error('broker unavailable');}),null);
});
