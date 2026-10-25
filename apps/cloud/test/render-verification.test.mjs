import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {pngRgba} from '@promobento/contracts/seams';
import {filmObservationFrames} from '../../../packages/blocks/src/events.mjs';
import {performanceFilm} from '../scripts/probe-performance.mjs';
import {verifyRenderShards} from '../src/render-verification.ts';

function fixture(kind='2d'){
 const history=parseCanonicalJson(readFileSync('docs/evidence/2026-10-24-s1-staging/'+(kind==='webgl'?'webgl-film-attempt':'film-attempt')+'/inspection.json'));
 const receipt=parseCanonicalJson(history.attempts.find(attempt=>attempt.mode==='shard').result_json).report;
 const film=performanceFilm(kind),job={renderId:'verification-fixture',aspectId:'landscape',quality:'final'},count=kind==='webgl'?24:6;
 const cuts=Array.from({length:count+1},(_,i)=>Math.floor(i*60/count)*15),objects=new Map(),png=pngRgba(1,1,Uint8Array.from([10,20,30,255]));
 const blob=(key,bytes)=>{objects.set(key,bytes);return{name:key,key,sha256:sha256Bytes(bytes),byteLength:bytes.length};};
 const shards=cuts.slice(1).map((end,i)=>{
  const observations=filmObservationFrames(film,'final').filter(frame=>frame>=cuts[i]&&frame<end).map(frame=>({schemaVersion:'3.0.0',kind:'frame_observation',
   renderId:job.renderId,aspectId:job.aspectId,frame,texts:[],regions:[],findings:[]}));
  const observation=blob(i+'/observations.json',new TextEncoder().encode(canonical(observations)));
  return{report:{...receipt,renderId:job.renderId,start:cuts[i],end,shardIndex:i,outputs:{...receipt.outputs,observations:observation.sha256}},outputs:[observation,
   ...(i?[blob(i+'/seam-frames/'+(cuts[i]-1)+'-cold.png',png)]:[]),...(i<count-1?[blob(i+'/seam-frames/'+(end-1)+'-last.png',png)]:[])]};
 });
 return{job,film,shards,partition:{shards:cuts.slice(1).map((end,i)=>({start:cuts[i],end}))},imageDigest:receipt.imageDigest,objects,
  output:(result,suffix)=>{const blob=result.outputs.find(blob=>blob.key.endsWith(suffix));if(!blob)throw Error('RENDER_OUTPUT_MISSING');return blob;},
  read:async blob=>objects.get(blob.key)};
}

test('bounded 2D verification preserves ordered seams and exact observations; WebGL remains serial',async()=>{
 for(const kind of ['2d','webgl']){
  const f=fixture(kind);let active=0,peak=0;
  const seams=await verifyRenderShards({...f,read:async blob=>{
   if(blob.key.endsWith('/observations.json')){active++;peak=Math.max(peak,active);await setImmediate();active--;}
   return f.objects.get(blob.key);
  }});
  assert.equal(peak,kind==='2d'?2:1);assert.equal(active,0);
  assert.deepEqual(seams.map(seam=>seam.frame),f.partition.shards.slice(1).map(shard=>shard.start-1));assert.ok(seams.every(seam=>seam.identical));
 }
});

test('QA failures drain started reads, stop new shards and retain the first failure',async()=>{
 const f=fixture();let release,finished=false;const blocked=new Promise(resolve=>release=resolve),started=[];
 const result=verifyRenderShards({...f,read:async blob=>{
  started.push(blob.key);
  if(blob.key==='0/observations.json')throw Error('RENDER_OUTPUT_IDENTITY_MISMATCH');
  await blocked;return f.objects.get(blob.key);
 }});
 result.finally(()=>finished=true).catch(()=>{});await setImmediate();
 assert.equal(finished,false);assert.deepEqual(started,['0/observations.json','1/observations.json']);
 release();await assert.rejects(result,/RENDER_OUTPUT_IDENTITY_MISMATCH/);assert.equal(finished,true);
 assert.ok(started.every(key=>key.startsWith('0/')||key.startsWith('1/')));
 for(const change of [f=>f.shards[0].report.end++,f=>f.shards[0].report.imageDigest='sha256:'+'0'.repeat(64),
  f=>f.shards[0].outputs[0].sha256='0'.repeat(64)]){
  const bad=fixture();change(bad);await assert.rejects(verifyRenderShards(bad),/SHARD_RECEIPT_INVALID/);
 }
 const missing=fixture();missing.objects.set('0/observations.json',new TextEncoder().encode('[]'));
 await assert.rejects(verifyRenderShards(missing),/QA_OBSERVATION_MISSING/);
 const seam=fixture();seam.objects.set('1/seam-frames/149-cold.png',pngRgba(1,1,Uint8Array.from([50,20,30,255])));
 await assert.rejects(verifyRenderShards(seam),/RENDER_SEAM_BLOCK/);
 const gl=fixture('webgl');delete gl.shards[0].report.webgl;await assert.rejects(verifyRenderShards(gl),/SHARD_WEBGL_REPORT_MISSING/);
});
