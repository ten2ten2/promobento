import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {filmFixture,pageOptions} from '../../film-runtime/test/fixture.mjs';
import {filmSourceHash} from '../src/film-source.mjs';
import {planShards,assertRenderTask} from '../src/render.mjs';
import {deriveAudioPlan} from '../../audio/src/plan.mjs';
import {filmBlockEvents} from '../../blocks/src/events.mjs';
import {reserve,settle} from '../../../apps/cloud/src/store.ts';
const spec=filmFixture(),sha='a'.repeat(64),job={schemaVersion:'3.0.0',kind:'render_job',renderId:'test-render',operationId:'test-operation',candidateId:'test-candidate',
  sourceHash:filmSourceHash(JSON.stringify(spec)),runtimeVersion:'film-runtime-v1',rendererRelease:'test-release',aspectId:'landscape',durationSeconds:15,totalFrames:450,quality:'final',
  renderProfile:{sampleCount:1,shutterAngle:0,sampling:'centered-box-v1',edgePolicy:'clamp-v1'},resources:[]};
test('film-v1 identity is canonical and does not accept duplicate JSON keys',()=>{
  assert.equal(filmSourceHash(JSON.stringify(spec)),filmSourceHash(JSON.stringify(Object.fromEntries(Object.entries(spec).reverse()))));
  assert.throws(()=>filmSourceHash('{"schemaVersion":"3.0.0","schemaVersion":"3.0.0"}'),/DUPLICATE_JSON_KEY/);
});
test('shards cover the source grid, bind seed, and review never splits a 15 fps GOP',()=>{
  const a=planShards(job,spec,{seed:'one'}),b=planShards(job,spec,{seed:'two'});
  assert.deepEqual(a.shards.map(shard=>[shard.start,shard.end]),[[0,150],[150,300],[300,450]]);
  assert.notEqual(a.shards[0].shardKey,b.shards[0].shardKey);
  const review=planShards({...job,quality:'review'},spec,{seed:'one'});
  assert.equal(review.shards.reduce((n,shard)=>n+(shard.end-shard.start)/2,0),225);
  assert.ok(review.shards.every(shard=>shard.start%30===0&&shard.end%30===0));
});
test('private tasks reject unknown fields, duplicate input names and missing rights',()=>{
  const options=pageOptions('landscape',{width:1920,height:1080,safeInsets:{top:.05,right:.05,bottom:.05,left:.05}});
  const task={schemaVersion:'3.0.0',kind:'render_task',taskId:'test-task',mode:'shard',instance:'standard-3',brokerToken:'test-token-not-a-real-secret',job,inputs:[],options,shard:planShards(job,spec,{seed:options.seed}).shards[0]};
  assert.doesNotThrow(()=>assertRenderTask(task));
  assert.throws(()=>assertRenderTask({...task,evil:true}),/TASK_INVALID/);
  assert.throws(()=>assertRenderTask({...task,options:{...options,resources:[{...options.resources[0],rightsCleared:false}]}}),/TASK_INVALID/);
  const blob={name:'film',key:'evals/test/film.json',sha256:sha,byteLength:10};
  assert.throws(()=>assertRenderTask({...task,inputs:[blob,blob]}),/TASK_INPUT_DUPLICATE/);
});
test('auto sound events derive from the same block landmarks and survive event order changes',()=>{
  const film=filmFixture();film.audio={music:{kind:'none'},sfx:'auto',captions:'off'};
  const events=filmBlockEvents(film),plan=deriveAudioPlan(film,events);
  assert.deepEqual(plan.events.map(event=>event.frameStart),[18,141,345]);
  assert.deepEqual(plan.events.map(event=>event.eventId).sort(),deriveAudioPlan(film,[...events].reverse()).events.map(event=>event.eventId).sort());
});
test('D1 reservation SQL holds unknown spend, fences cancellation and settles idempotently',async()=>{
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../../../apps/cloud/migrations/0001_s1_pipeline.sql',import.meta.url),'utf8'));
  db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('test-operation','test-workspace','test-project',0,'evaluation','active','request',100,0,null,null);
  const DB={prepare(sql){
    let args=[];
    return {
      bind(...values){args=values;return this;},
      async first(){return db.prepare(sql).get(...args)??null;},
      async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}
    };
  }};
  const env={DB},op={id:'test-operation',generation:0,max_micros:100};
  await reserve(env,op,'call-one','model','spec',60,{request:1},'catalog',1000,100,3);
  await assert.rejects(reserve(env,op,'call-two','model','spec',50,{request:2},'catalog',1000,100,3),/COST_BUDGET_EXHAUSTED/);
  await settle(env,'call-one',40,{tokens:1});await settle(env,'call-one',40,{tokens:1});
  await reserve(env,op,'call-two','model','spec',50,{request:2},'catalog',1000,100,3);
  db.exec("UPDATE pipeline_operations SET generation=1,status='cancelled'");
  await assert.rejects(reserve(env,op,'call-three','compute','render',1,{request:3},'catalog',1000,100,3),/COST_BUDGET_EXHAUSTED/);
  db.close();
});
