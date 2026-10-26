import test from 'node:test';
import assert from 'node:assert/strict';
import {readOperationState} from '../../../research/evals/read-operation.mjs';

test('only socket-reset operation reads reconnect, bounded to two retries without redispatch',async()=>{
 const reset=Object.assign(new TypeError('fetch failed'),{cause:{code:'UND_ERR_SOCKET'}});
 let reads=0,retries=0,waits=0;
 const state=await readOperationState(async()=>{if(++reads<3)throw reset;return{status:'awaiting_user'};},
  {wait:async()=>{waits++;},onRetry:()=>{retries++;}});
 assert.deepEqual(state,{status:'awaiting_user'});assert.equal(reads,3);assert.equal(retries,2);assert.equal(waits,2);
 reads=0;await assert.rejects(readOperationState(async()=>{reads++;throw reset;},{wait:async()=>{}}),error=>error===reset);assert.equal(reads,3);
 for(const error of [Error('EVAL_API_500'),Object.assign(Error('OPERATION_DEADLINE'),{name:'TimeoutError'})]){
  reads=0;await assert.rejects(readOperationState(async()=>{reads++;throw error;},{wait:async()=>{throw Error('must not wait');}}),actual=>actual===error);assert.equal(reads,1);
 }
});
