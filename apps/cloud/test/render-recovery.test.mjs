import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {sqliteD1} from './fixtures/sqlite.mjs';
import {build} from 'esbuild';
import {filmFixture,pageOptions} from '../../../packages/film-runtime/test/fixture.mjs';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {planShards} from '@promobento/contracts/render';
import {advanceRenderStage,commitRender,recordRenderFailure,reconcileOperation,dispatchRender,dispatchRenderProgress} from '../src/render-recovery.ts';

function fixture(t){
 const{db,DB}=sqliteD1();t.after(()=>db.close());
 const op={id:'recovery-operation',workspace_id:'recovery-workspace',project_id:'recovery-project',generation:0,purpose:'calibration',status:'active',max_micros:1000000};
 db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(op.id,op.workspace_id,op.project_id,0,op.purpose,'active','request',op.max_micros,Date.now(),null,null);
 const render=(id,status='sharding',result=null)=>db.prepare('INSERT INTO pipeline_renders VALUES(?,?,?,?,?,?,?,?,?)').run(id,op.id,0,id,'evals/input.json',status,Date.now(),null,result);
 const attempt=id=>db.prepare('INSERT INTO pipeline_attempts(id,render_id,operation_id,generation,mode,instance,status,started_at) VALUES(?,?,?,?,?,?,?,?)').run(id,'broken-render',op.id,0,'shard','standard-3','active',Date.now());
 const events=[],env={DB,SHARDS:{getByName(id){return{async stopAndSettle(){events.push(id);}};}},OPERATIONS:{getByName(){return{async closeStudio(){events.push('closeStudio');},async progress(){events.push('progress');}};}}};
 return{db,op,render,attempt,env,events};
}

test('failure fences before stop, retries cleanup only and preserves the first cause',async t=>{
 const{db,render,attempt,env}=fixture(t);render('broken-render');attempt('shard-one');let stops=0;
 env.SHARDS.getByName=()=>({async stopAndSettle(){
  assert.equal(db.prepare('SELECT status FROM pipeline_renders').get().status,'blocked');
  if(++stops===1)throw Error('container unavailable');
 }});
 await assert.rejects(recordRenderFailure(env,'broken-render','RENDER_SEAM_BLOCK'),/COMPUTE_STOP_UNCONFIRMED/);
 assert.equal(db.prepare('SELECT stopped_at FROM pipeline_attempts').get().stopped_at,null);
 let result=parseCanonicalJson(db.prepare('SELECT result_json FROM pipeline_renders').get().result_json);
 assert.equal(result.code,'RENDER_SEAM_BLOCK');assert.equal(result.stopPending,true);
 await recordRenderFailure(env,'broken-render','RENDER_DEADLINE');
 result=parseCanonicalJson(db.prepare('SELECT result_json FROM pipeline_renders').get().result_json);
 assert.equal(result.code,'RENDER_SEAM_BLOCK');assert.equal(result.stopPending,false);
 assert.equal(db.prepare('SELECT status FROM pipeline_attempts').get().status,'stopped');assert.equal(stops,2);
});

test('terminal reconciliation repairs orphan render state without resuming or clearing unknown costs',async t=>{
 const{db,op,render,attempt,env,events}=fixture(t);
 render('broken-render');attempt('old-shard');render('passed-render','passed',canonical({film:'immutable'}));
 render('blocked-render','blocked',canonical({code:'QA_BLOCK',stopPending:true}));
 db.prepare("UPDATE pipeline_operations SET status='cancelled',generation=1 WHERE id=?").run(op.id);
 db.prepare('INSERT INTO cost_reservations VALUES(?,?,?,?,?,?,?,?)').run('unknown-model',op.id,'hash','model','C',12345,'test-catalog',Date.now());
 const result=await reconcileOperation(env,op.id);
 assert.equal(result.stoppedAttempts,1);assert.equal(result.reconciledRenders,2);assert.equal(result.pendingCosts[0].reserved_micros,12345);
 assert.equal(db.prepare('SELECT generation FROM pipeline_operations').get().generation,1);
 const repaired=parseCanonicalJson(db.prepare("SELECT result_json FROM pipeline_renders WHERE id='broken-render'").get().result_json);
 assert.deepEqual(repaired,{code:'OPERATION_CANCELLED',reconciledFrom:'sharding',status:'cancelled',stopPending:false});
 assert.equal(parseCanonicalJson(db.prepare("SELECT result_json FROM pipeline_renders WHERE id='blocked-render'").get().result_json).code,'QA_BLOCK');
 assert.equal(db.prepare("SELECT result_json FROM pipeline_renders WHERE id='passed-render'").get().result_json,canonical({film:'immutable'}));
 assert.deepEqual(events,['old-shard','closeStudio']);assert.equal(db.prepare('SELECT COUNT(*) n FROM cost_settlements').get().n,0);
});

test('passed film and notification are atomic, idempotent and independent of progress RPC availability',async t=>{
 const{db,op,render,env}=fixture(t);render('final-render','assembling');const result=canonical({status:'passed',film:'fixed-bytes'});
 await commitRender(env,'final-render',op,result);await commitRender(env,'final-render',op,result);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM pipeline_outbox').get().n,1);
 await assert.rejects(commitRender(env,'final-render',op,canonical({status:'passed',film:'other'})),/RENDER_COMMIT_CONFLICT/);
 env.OPERATIONS.getByName=()=>({async progress(){throw Error('RPC offline');}});
 const item={operationId:op.id,payloadJson:db.prepare('SELECT payload_json FROM pipeline_outbox').get().payload_json};
 await assert.rejects(dispatchRenderProgress(env,item),/RPC offline/);
 await recordRenderFailure(env,'final-render','RENDER_INTERNAL_ERROR');
 assert.equal(db.prepare('SELECT result_json FROM pipeline_renders').get().result_json,result);
 db.prepare("UPDATE pipeline_operations SET status='cancelled',generation=1").run();
 await dispatchRenderProgress(env,item); // Stale progress must not revive the cancelled operation.
 await assert.rejects(advanceRenderStage(env,'final-render',op,'sharding'),/OPERATION_FENCED/);
});

test('commit fences foreign scopes and stale generations; atomic outbox failure rolls back the film',async t=>{
 const{db,op,render,env}=fixture(t);render('final-render','assembling');const result=canonical({status:'passed'});
 await assert.rejects(commitRender(env,'final-render',{...op,id:'foreign-operation'},result),/OPERATION_FENCED/);
 db.exec("CREATE TRIGGER unavailable_outbox BEFORE INSERT ON pipeline_outbox BEGIN SELECT RAISE(ABORT,'outbox unavailable'); END;");
 await assert.rejects(commitRender(env,'final-render',op,result),/outbox unavailable/);
 assert.equal(db.prepare('SELECT status FROM pipeline_renders').get().status,'assembling');
 db.exec('DROP TRIGGER unavailable_outbox');db.prepare("UPDATE pipeline_operations SET generation=1,status='cancelled'").run();
 await assert.rejects(commitRender(env,'final-render',op,result),/OPERATION_FENCED/);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM pipeline_outbox').get().n,0);
});

test('late cancelled delivery does not create compute, and duplicate errored Workflow is repaired without restart',async t=>{
 const{db,op,render,env}=fixture(t);render('broken-render');let creates=0;
 env.RENDER_WORKFLOW={async create(){creates++;throw Error('already exists');},async get(){return{async status(){return{status:'errored',error:{message:'RENDER_SEAM_BLOCK'}};}};}};
 const item={id:'render-broken-render',operationId:op.id};
 db.prepare("UPDATE pipeline_operations SET status='cancelled',generation=1").run();await dispatchRender(env,item);assert.equal(creates,0);
 db.prepare("UPDATE pipeline_operations SET status='active',generation=0").run();await dispatchRender(env,item);assert.equal(creates,1);
 assert.equal(parseCanonicalJson(db.prepare('SELECT result_json FROM pipeline_renders').get().result_json).code,'RENDER_SEAM_BLOCK');
 await dispatchRender(env,item);assert.equal(creates,1);
});

async function computeFixture(t,{busy=false,cancelWhileWaiting=false,armFails=false,stopBeforeStart=true}={}){
 const{outputFiles}=await build({entryPoints:['apps/cloud/src/compute.ts'],bundle:true,write:false,platform:'node',format:'esm',target:'node26',plugins:[{
  name:'durable-object-fixture',setup(build){
   build.onResolve({filter:/^cloudflare:workers$/},()=>({path:'entrypoint',namespace:'fixture'}));
   build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'class Entrypoint { constructor(ctx,env){this.ctx=ctx;this.env=env;} } export class DurableObject extends Entrypoint {} export class WorkerEntrypoint extends Entrypoint {}',loader:'js'}));
  }
 }]});
 const{ShardDO}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
 const{db,op,render,env}=fixture(t);render('stopped-render','sharding');
 const imageDigest='sha256:'+'a'.repeat(64);db.prepare('INSERT INTO renderer_releases VALUES(?,?,?,?,?)').run('test-release',imageDigest,'film-runtime-v1','environment','active');
 const spec=filmFixture(),job={schemaVersion:'3.0.0',kind:'render_job',renderId:'stopped-render',operationId:op.id,candidateId:'test-candidate',sourceHash:filmSourceHash(canonical(spec)),runtimeVersion:'film-runtime-v1',rendererRelease:'test-release',aspectId:'landscape',durationSeconds:15,totalFrames:450,quality:'final',renderProfile:{sampleCount:1,shutterAngle:0,sampling:'centered-box-v1',edgePolicy:'clamp-v1'},resources:[]};
 const options=pageOptions('landscape',{width:1920,height:1080,safeInsets:{top:.05,right:.05,bottom:.05,left:.05}});
 const task={schemaVersion:'3.0.0',kind:'render_task',taskId:'stopped-task',mode:'shard',instance:'standard-3',job,inputs:[],options,shard:planShards(job,spec,{seed:options.seed}).shards[0],generation:0,imageDigest,deadlineAt:Date.now()+2000};
 const values=new Map();let shard,starts=0,leases=0,acquires=0;
 const storage={get:async key=>values.get(key),async put(key,value){
  if(typeof key==='object')for(const[k,v]of Object.entries(key))values.set(k,v);else values.set(key,value);
  if(key==='startedAt'&&stopBeforeStart)await shard.stopAndSettle(); // Force the stop exactly at the last await before container.start.
 },delete:async key=>values.delete(key),setAlarm:async()=>{},deleteAlarm:async()=>{},transactionSync:fn=>fn(),kv:{get:key=>values.get(key),put:(key,value)=>values.set(key,value)}};
 const container={images:{render:'registry/render@'+imageDigest},running:false,async interceptOutboundHttp(){},start(){starts++;this.running=true;},async destroy(){this.running=false;}};
 const ctx={storage,container,exports:{Broker(){return{};}}};
 env.COORDINATOR={getByName(){return{async acquire(){acquires++;if(busy&&acquires===1){assert.equal(db.prepare('SELECT COUNT(*) n FROM cost_reservations').get().n,0);if(cancelWhileWaiting)values.set('stopRequested',true);return false;}leases++;return true;},async arm(){if(armFails)throw Error('alarm unavailable');},async release(){assert.equal(container.running,false);leases=0;}};}};
 shard=new ShardDO(ctx,env);
 return{db,env,ctx,ShardDO,shard,task,values,counts:()=>({starts,leases,acquires})};
}

test('confirmed stop persists across eviction and fences an execute already waiting to start',async t=>{
 const{db,env,ctx,ShardDO,shard,task,values,counts}=await computeFixture(t);
 await assert.rejects(shard.execute(canonical(task)),/COMPUTE_ATTEMPT_STOPPED/);
 assert.equal(counts().starts,0);assert.equal(counts().leases,0);assert.equal(values.get('stopRequested'),true);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM cost_settlements').get().n,1);
 // A fresh DO instance retains the stop latch even if execute never bound a request.
 values.delete('requestHash');values.delete('taskId');
 await assert.rejects(new ShardDO(ctx,env).execute(canonical(task)),/COMPUTE_ATTEMPT_STOPPED/);assert.equal(counts().starts,0);
});

test('capacity waits spend no compute before a lease and stop or alarm failure cannot leak slots',async t=>{
 for(const options of[{busy:true},{busy:true,cancelWhileWaiting:true},{armFails:true}]){
  const{db,shard,task,counts}=await computeFixture(t,options);
  await assert.rejects(shard.execute(canonical(task)),options.armFails?/alarm unavailable/:/COMPUTE_ATTEMPT_STOPPED/);
  assert.equal(counts().starts,0);assert.equal(counts().leases,0);
  assert.equal(counts().acquires,options.busy&&!options.cancelWhileWaiting?2:1);
  const expected=options.cancelWhileWaiting||options.armFails?0:1;
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cost_reservations').get().n,expected);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cost_settlements').get().n,expected);
 }
});

test('controller startup must pass health before task dispatch; physical headroom preserves page and render limits',async t=>{
 for(const scenario of ['timeout','exit','ready','late-ready','deadline-cap','late-response']){
  const{db,shard,task,ctx,counts}=await computeFixture(t,{stopBeforeStart:false});
  db.prepare('INSERT INTO pipeline_attempts(id,render_id,operation_id,generation,mode,instance,status,started_at) VALUES(?,?,?,?,?,?,?,?)')
   .run(task.taskId,task.job.renderId,task.job.operationId,0,task.mode,task.instance,'active',Date.now());
  let dispatched=0,healthCalls=0;
  t.mock.timers.enable({apis:['Date']});
  task.deadlineAt=Date.now()+(scenario==='deadline-cap'?20000:60000);
  ctx.container.interceptOutboundHttp=async()=>{};
  ctx.container.monitor=()=>scenario==='exit'?Promise.resolve():new Promise(()=>{});
  ctx.container.getTcpPort=()=>({async fetch(url,init){
   if(url.endsWith('/healthz')){
    healthCalls++;assert.ok(init.signal instanceof AbortSignal);
    if(scenario==='timeout'){t.mock.timers.tick(45001);return new Response(null,{status:503});}
    if(scenario==='late-ready')t.mock.timers.tick(32000);
    if(scenario==='deadline-cap')t.mock.timers.tick(20001);
    if(scenario==='late-response')t.mock.timers.tick(45001);
    return Response.json({status:'ready'});
   }
   if(url.endsWith('/task')){dispatched++;return new Response(null,{status:202});}
   if(url.endsWith('/result'))return Response.json({status:'succeeded',taskId:task.taskId});
   throw Error('unexpected request');
  }});
  try{
   const success=['ready','late-ready'].includes(scenario);
   if(success){
    const value=parseCanonicalJson(await shard.execute(canonical(task)));
    assert.equal(value.status,'succeeded');assert.equal(value.lifecycleTimings.containerReadyMs,scenario==='late-ready'?32000:0);
   }
   else{
    const code=scenario==='exit'?'RENDER_STARTUP_EXITED':'RENDER_STARTUP_TIMEOUT';
    await assert.rejects(shard.execute(canonical(task)),new RegExp(code));
    const diagnostic=parseCanonicalJson(db.prepare('SELECT result_json FROM pipeline_attempts WHERE id=?').get(task.taskId).result_json);
    assert.equal(diagnostic.code,code);assert.equal(diagnostic.startup.monitorState,scenario==='exit'?'exited':'pending');
    assert.equal(diagnostic.startup.budgetMs,scenario==='deadline-cap'?20000:45000);
    if(scenario==='timeout'){assert.equal(diagnostic.startup.elapsedMs,45001);assert.equal(diagnostic.startup.lastProbe.httpStatus,503);}
   }
   assert.equal(dispatched,success?1:0);assert.ok(healthCalls<=1);
   assert.equal(ctx.container.running,false);assert.equal(counts().leases,0);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM cost_settlements').get().n,1);
  }finally{t.mock.timers.reset();}
 }
});

test('broker registration precedes allocation, is bounded and cannot start after cancellation',async t=>{
 for(const scenario of ['slow','cancelled','hung']){
  const{db,shard,task,ctx,counts,values}=await computeFixture(t,{stopBeforeStart:false});
  task.deadlineAt=Date.now()+120000;t.mock.timers.enable({apis:['Date','setTimeout']});
  let entered;const ready=new Promise(resolve=>entered=resolve);
  ctx.container.interceptOutboundHttp=async()=>{
   assert.equal(counts().starts,0);entered();
   if(scenario==='hung')return new Promise(()=>{});
   t.mock.timers.tick(20000);
   if(scenario==='cancelled')await shard.stopAndSettle();
  };
  ctx.container.monitor=()=>new Promise(()=>{});
  ctx.container.getTcpPort=()=>({async fetch(url){
   if(url.endsWith('/healthz'))return Response.json({status:'ready'});
   if(url.endsWith('/task'))return new Response(null,{status:202});
   if(url.endsWith('/result'))return Response.json({status:'succeeded',taskId:task.taskId});
   throw Error('unexpected request');
  }});
  try{
   const result=shard.execute(canonical(task));
   if(scenario==='hung'){await ready;t.mock.timers.tick(30001);await assert.rejects(result,/RENDER_BROKER_REGISTRATION_TIMEOUT/);}
   else if(scenario==='cancelled')await assert.rejects(result,/COMPUTE_ATTEMPT_STOPPED/);
   else{const value=parseCanonicalJson(await result);assert.equal(value.lifecycleTimings.brokerRegistrationMs,20000);assert.equal(value.lifecycleTimings.containerReadyMs,0);}
   assert.equal(counts().starts,scenario==='slow'?1:0);assert.equal(counts().leases,0);
   const settlement=db.prepare('SELECT actual_micros FROM cost_settlements').get();assert.ok(settlement);
   if(scenario!=='slow')assert.equal(settlement.actual_micros,0,'no container was allocated');
   if(scenario==='cancelled')assert.equal(values.get('stopRequested'),true);
  }finally{t.mock.timers.reset();}
 }
});

test('unallocated native capacity failure is already stopped and does not call destroy again',async t=>{
 const{db,shard,task,ctx,counts}=await computeFixture(t,{stopBeforeStart:false});
 db.prepare('INSERT INTO pipeline_attempts(id,render_id,operation_id,generation,mode,instance,status,started_at) VALUES(?,?,?,?,?,?,?,?)')
  .run(task.taskId,task.job.renderId,task.job.operationId,0,task.mode,task.instance,'active',Date.now());
 ctx.container.interceptOutboundHttp=async()=>{throw Error('There is no container instance that can be provided to this Durable Object, try again later');};
 let destroys=0;ctx.container.destroy=async()=>{destroys++;throw Error('Network connection lost.');};
 await assert.rejects(shard.execute(canonical(task)),/RENDER_CAPACITY_UNAVAILABLE/);
 const row=parseCanonicalJson(db.prepare('SELECT result_json FROM pipeline_attempts WHERE id=?').get(task.taskId).result_json);
 assert.equal(row.code,'RENDER_CAPACITY_UNAVAILABLE');assert.equal(row.diagnostic.phase,'broker');
 assert.equal(counts().starts,0);assert.equal(counts().leases,0);assert.equal(destroys,0);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM cost_settlements').get().n,1);
 await shard.stopAndSettle();
 assert.equal(counts().starts,0);assert.equal(counts().leases,0);assert.equal(ctx.container.running,false);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM cost_settlements').get().n,1);
 assert.equal(parseCanonicalJson(db.prepare('SELECT result_json FROM pipeline_attempts WHERE id=?').get(task.taskId).result_json).code,'RENDER_CAPACITY_UNAVAILABLE');
});

test('stop is idempotent but a running instance still requires confirmed destruction',async t=>{
 const{shard,ctx,values}=await computeFixture(t);let destroys=0;
 ctx.container.destroy=async()=>{destroys++;throw Error('Network connection lost.');};
 await shard.stop();assert.equal(destroys,0);assert.equal(values.get('stopRequested'),true);
 ctx.container.running=true;
 await assert.rejects(shard.stop(),/Network connection lost/);assert.equal(ctx.container.running,true);
 ctx.container.destroy=async()=>{destroys++;ctx.container.running=false;};
 await shard.stop();await shard.stop();assert.equal(destroys,2);assert.equal(await shard.isStopped(),true);
});

test('failed controller evidence retains only an attempt-scoped private diagnostic reference',async t=>{
 const{db,shard,task,ctx}=await computeFixture(t,{stopBeforeStart:false});
 task.deadlineAt=Date.now()+120000;
 db.prepare('INSERT INTO pipeline_attempts(id,render_id,operation_id,generation,mode,instance,status,started_at) VALUES(?,?,?,?,?,?,?,?)')
  .run(task.taskId,task.job.renderId,task.job.operationId,0,task.mode,task.instance,'active',Date.now());
 const ref={key:`renders/${task.job.renderId}/attempts/${task.taskId}/shards/${task.shard.index}/private-failure.json`,sha256:'b'.repeat(64),byteLength:100};
 ctx.container.monitor=()=>new Promise(()=>{});
 ctx.container.getTcpPort=()=>({async fetch(url){
  if(url.endsWith('/healthz'))return Response.json({status:'ready'});
  if(url.endsWith('/task'))return new Response(null,{status:202});
  return Response.json({status:'failed',code:'RENDER_INTERNAL_ERROR',diagnostic:{phase:'runtime_ready',type:'Error'},privateFailure:{...ref,message:'must not be forwarded'}});
 }});
 await assert.rejects(shard.execute(canonical(task)),/RENDER_INTERNAL_ERROR/);
 const result=parseCanonicalJson(db.prepare('SELECT result_json FROM pipeline_attempts WHERE id=?').get(task.taskId).result_json);
 assert.deepEqual(result.privateFailure,{...ref,mediaType:'application/json'});
 assert.equal(JSON.stringify(result).includes('must not be forwarded'),false);
});
