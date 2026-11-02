import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {runBoundedStage,analyzeMaterialStage,previewDirectionStage} from '../src/director-stages.ts';

test('independent stage work is bounded and returns input order after out-of-order completion',async()=>{
 let active=0,peak=0;
 const results=await runBoundedStage([0,1,2,3,4,5],2,async value=>{
  active++;peak=Math.max(peak,active);
  await (value%2===0?setImmediate():new Promise(resolve=>setTimeout(resolve,3)));
  active--;return value*2;
 });
 assert.deepEqual(results,[0,2,4,6,8,10]);assert.equal(peak,2);assert.equal(active,0);
 await assert.rejects(runBoundedStage([],0,async()=>0),/DIRECTOR_STAGE_CONCURRENCY_INVALID/);
 await assert.rejects(runBoundedStage([],5,async()=>0),/DIRECTOR_STAGE_CONCURRENCY_INVALID/);
});

test('a failed stage drains dispatched work and never starts later paid tasks',async()=>{
 let unblock,active=0;
 const gate=new Promise(resolve=>{unblock=resolve;});
 const started=[];
 const result=runBoundedStage([0,1,2,3],2,async index=>{
  started.push(index);active++;
  try{if(index===0)throw Error('MODEL_DENIED');await gate;return index;}
  finally{active--;}
 });
 await setImmediate();assert.deepEqual(started,[0,1]);assert.equal(active,1);
 unblock();await assert.rejects(result,/MODEL_DENIED/);
 assert.equal(active,0);assert.deepEqual(started,[0,1]);
});

test('stage boundaries preserve asset indices and the authored direction-card order',async()=>{
 const assets=[{preview:{},resourceId:'a'},{resourceId:'skip'},{preview:{},resourceId:'c'}];
 const insights=await analyzeMaterialStage(assets,2,async(asset,index)=>({id:asset.resourceId,callId:'asset-'+index}));
 assert.deepEqual(insights,[{id:'a',callId:'asset-0'},{id:'c',callId:'asset-2'}]);
 const cards=[{key:'fit'},{key:'amplify'},{key:'unexpected'}];
 assert.deepEqual(await previewDirectionStage(cards,2,async card=>({key:card.key})),cards);
});
