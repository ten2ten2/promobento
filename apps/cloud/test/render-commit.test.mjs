import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {filmFixture} from '../../../packages/film-runtime/test/fixture.mjs';

test('replayed successful compute commits through canonical-text Workflow boundaries without retry masking',async()=>{
 const {outputFiles}=await build({entryPoints:['apps/cloud/src/render-workflow.ts'],bundle:true,write:false,platform:'node',format:'esm',target:'node26',plugins:[{
  name:'workflow-fixture',setup(build){
   build.onResolve({filter:/^cloudflare:workers$/},()=>({path:'workflow',namespace:'fixture'}));
   build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export class WorkflowEntrypoint { constructor(ctx,env){this.ctx=ctx;this.env=env;} }',loader:'js'}));
  }
 }]});
 const {RenderWorkflow}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
 const saved=parseCanonicalJson(readFileSync('docs/evidence/2026-10-24-s1-staging/film-attempt/inspection.json'));
 const db=new DatabaseSync(':memory:');db.exec(readFileSync('apps/cloud/migrations/0001_s1_pipeline.sql','utf8'));
 const op=saved.operations[0],row=saved.renders[0],now=Date.now(),imageDigest=parseCanonicalJson(saved.attempts.find(a=>a.mode==='shard').result_json).report.imageDigest;
 const spec=filmFixture(),raw=canonical(spec),filmBytes=new TextEncoder().encode(raw),filmKey='evals/replay/film.json';
 const input={job:{schemaVersion:'3.0.0',kind:'render_job',renderId:row.id,operationId:op.id,candidateId:'replay-candidate',sourceHash:filmSourceHash(raw),
  runtimeVersion:'film-runtime-v1',rendererRelease:'replay-release',aspectId:'landscape',durationSeconds:15,totalFrames:450,quality:'final',
  renderProfile:{sampleCount:1,shutterAngle:0,sampling:'centered-box-v1',edgePolicy:'clamp-v1'},resources:[]},
  options:{seed:'film-fixture-1'},inputs:[{name:'film',key:filmKey,byteLength:filmBytes.length,sha256:sha256Bytes(filmBytes)}],coverFrame:165};
 const objects=new Map([[filmKey,filmBytes],['evals/replay/input.json',new TextEncoder().encode(canonical(input))]]);
 db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(op.id,'replay-workspace','replay-project',0,'calibration','active','replay',1000000,now-100000,null,null);
 db.prepare('INSERT INTO pipeline_renders VALUES(?,?,?,?,?,?,?,?,?)').run(row.id,op.id,0,'replay','evals/replay/input.json','queued',now-100000,null,null);
 db.prepare('INSERT INTO renderer_releases VALUES(?,?,?,?,?)').run('replay-release',imageDigest,'film-runtime-v1','replay-environment','active');
 const DB={prepare(sql){let args=[];return{bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)??null;},async all(){return{results:db.prepare(sql).all(...args)};},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};}};
 const progress=[],env={DB,MEDIA:{async get(key){const bytes=objects.get(key);return bytes?{size:bytes.length,customMetadata:{},async arrayBuffer(){return bytes;}}:null;}},
  OPERATIONS:{getByName(){return{async progress(text){progress.push(parseCanonicalJson(text).status);}};}}};
 const cache=new Map(saved.attempts.flatMap(a=>{const name=a.mode==='shard'?'shard-'+a.shard_index:a.mode;return[[name+'-id',a.id],[name,canonical(parseCanonicalJson(a.result_json))]];}));
 cache.set('verify-shards',canonical(parseCanonicalJson(saved.workflow.steps.find(s=>s.name==='verify-shards-1').output)));
 let commitCalls=0;
 const step={async do(name,configOrFn,callback){
  if(cache.has(name))return cache.get(name);
  if(name==='commit-render'){commitCalls++;assert.equal(configOrFn.retries.limit,0);}
  const value=await(callback??configOrFn)();
  assert.ok(value===null||typeof value!=='object','step output must be canonical text or a primitive');return value;
 }};
 try{
  const result=await new RenderWorkflow({},env).run({payload:{renderId:row.id}},step);
  assert.equal(commitCalls,1);assert.equal(result.status,'passed');assert.equal(result.media.totalFrames,450);
  assert.equal(result.peakMemory.status,'unverified');assert.equal(result.peakMemory.measurements.length,3);
  assert.ok(result.peakMemory.measurements.every(m=>m.peakMemoryMiB===null&&m.peakMemoryUnavailableReason==='cgroup_peak_not_exposed'));
  assert.equal(result.seamReport.seams.length,2);assert.equal(result.observationFrames.length,6);
  assert.equal(db.prepare('SELECT status FROM pipeline_renders').get().status,'passed');assert.deepEqual(progress,['sharding','assembling','passed']);
 }finally{db.close();}
});
