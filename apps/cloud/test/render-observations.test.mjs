import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCanonicalJson} from '@promobento/contracts/canonical';
import {filmObservationFrames} from '../../../packages/blocks/src/events.mjs';
import {checkShardObservations} from '../src/render-observations.ts';
import {validate as validObservation} from '@promobento/contracts/validators/frame-observation';
import {webglFixture} from '../../../packages/film-runtime/test/webgl-fixture.mjs';

test('24 short shards cover exact global reading holds; missing/duplicate/wrong-scope/BLOCK observations still fail',()=>{
 const saved=parseCanonicalJson(readFileSync('docs/evidence/2026-10-24-s1-staging/webgl-film-attempt/inspection.json'));
 const film=webglFixture();film.durationSeconds=30;film.totalFrames=900;film.scenes[0].end=900;
 assert.deepEqual(filmObservationFrames(film,'final'),[45,450]);assert.deepEqual(filmObservationFrames(film,'review'),[44,450]);
 const job={renderId:saved.renders[0].id,aspectId:'landscape',quality:'final'};
 const observation=frame=>({schemaVersion:'3.0.0',kind:'frame_observation',renderId:job.renderId,aspectId:job.aspectId,frame,texts:[],regions:[],findings:[]});
 const shards=saved.attempts.filter(attempt=>attempt.mode==='shard').map(attempt=>parseCanonicalJson(attempt.result_json));
 assert.equal(shards.length,24);let total=0;
 for(const result of shards){
  const shard=result.report,frames=filmObservationFrames(film,'final').filter(frame=>frame>=shard.start&&frame<shard.end);
  // The recorded controller emitted [] exactly on shards which contain no global hold.
  assert.equal(result.outputs.find(blob=>blob.key.endsWith('/observations.json')).byteLength===2,frames.length===0);
  checkShardObservations(job,shard,film,frames.map(observation));total+=frames.length;
 }
 assert.equal(total,2);
 const shard=shards.find(result=>result.report.start===30).report,good=observation(45);
 assert.throws(()=>checkShardObservations(job,shard,film,[]),/QA_OBSERVATION_MISSING/);
 for(const bad of[[good,good],[{...good,renderId:'other-render'}],[{...good,aspectId:'portrait'}],[{...good,frame:46}]])
  assert.throws(()=>checkShardObservations(job,shard,film,bad),/QA_OBSERVATION_SCOPE_INVALID/);
 assert.throws(()=>checkShardObservations(job,shard,film,[{...good,findings:[{code:'text-clipped',severity:'BLOCK'}]}]),/QA_BLOCK/);
 const wrongFace={...good,findings:[{code:'FONT_FACE_MISMATCH',severity:'BLOCK',detail:'A grapheme uses a different bound face.'}]};
 assert.equal(validObservation(wrongFace),true);assert.throws(()=>checkShardObservations(job,shard,film,[wrongFace]),/QA_BLOCK/);
 assert.throws(()=>checkShardObservations(job,shards.find(result=>result.report.start===0).report,film,[good]),/QA_OBSERVATION_SCOPE_INVALID/);
});
