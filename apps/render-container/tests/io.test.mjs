import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {mapIO} from '../src/process.mjs';

test('authorized I/O stays bounded, preserves file order and drains already-started work before cleanup',async()=>{
 let active=0,max=0;
 const result=await mapIO([0,1,2,3,4,5],async value=>{active++;max=Math.max(max,active);await setImmediate();active--;return value*2;});
 assert.deepEqual(result,[0,2,4,6,8,10]);assert.equal(max,4);assert.equal(active,0);
 let release,finished=false;const waiting=new Promise(resolve=>release=resolve),started=[];
 const failed=mapIO([0,1,2,3,4,5],async value=>{
  started.push(value);active++;
  try{if(value===0)throw Error('BROKER_WRITE_DENIED');await waiting;return value;}
  finally{active--;}
 });
 failed.finally(()=>{finished=true;}).catch(()=>{});await setImmediate();
 assert.deepEqual(started,[0,1,2,3]);assert.equal(active,3);assert.equal(finished,false);
 release();await assert.rejects(failed,/BROKER_WRITE_DENIED/);assert.equal(active,0);assert.deepEqual(started,[0,1,2,3]);
});
