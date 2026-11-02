import test from 'node:test';
import assert from 'node:assert/strict';
import {readBoundedResponse} from './read-bounded-response.mjs';

test('bounded selection downloads return exact bytes when within budget',async()=>{
 const response=new Response(Buffer.from('approved'),{headers:{'content-length':'8'}});
 assert.equal((await readBoundedResponse(response,8,'MATERIAL_TOO_LARGE')).toString(),'approved');
});

test('bounded selection downloads reject declared or streamed oversized responses',async()=>{
 let readStarted=false;
 const declared={headers:new Headers({'content-length':'32'}),body:{
  cancel:async()=>{},getReader(){readStarted=true;throw Error('SHOULD_NOT_READ');}
 }};
 await assert.rejects(readBoundedResponse(declared,8,'MATERIAL_TOO_LARGE'),/MATERIAL_TOO_LARGE/);
 assert.equal(readStarted,false);
 const stream=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(5));controller.enqueue(new Uint8Array(5));}}));
 await assert.rejects(readBoundedResponse(stream,8,'MATERIAL_TOO_LARGE'),/MATERIAL_TOO_LARGE/);
});

test('download cancellation failures cannot mask the original validation error',async()=>{
 const response={headers:new Headers(),body:{getReader(){return{
  read:async()=>({done:false,value:new Uint8Array(9)}),
  cancel:async()=>{throw Error('CANCEL_FAILED');},releaseLock(){}
 };}}};
 await assert.rejects(readBoundedResponse(response,8,'MATERIAL_TOO_LARGE'),/MATERIAL_TOO_LARGE/);
});
