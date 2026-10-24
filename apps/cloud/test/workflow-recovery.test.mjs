import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {sqliteD1} from './fixtures/sqlite.mjs';
import {memoryMedia} from './fixtures/media.mjs';
import {registerWorkflow,workflowStarted,workflowInventory} from '../src/workflow-state.ts';
import {recoverWorkflows,dispatchCreative} from '../src/workflow-recovery.ts';
import {dispatchRender,reconcileOperation,recordRenderFailure} from '../src/render-recovery.ts';

function fixture(t){
 const {db,DB}=sqliteD1();t.after(()=>db.close());const {MEDIA,objects}=memoryMedia();
 const op={id:'workflow-operation',generation:0};
 db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(op.id,'workspace','project',0,'calibration','active','request',1000000,Date.now(),null,null);
 const states=new Map(),events=[];let creates=0,lateCancel=false,unavailable=false;
 const binding={async create({id}){creates++;states.set(id,'running');if(lateCancel)db.prepare("UPDATE pipeline_operations SET status='cancelled',generation=1").run();return{};},async get(id){
  if(unavailable||!states.has(id))throw Error('native status unavailable');
  return{async status(){return{status:states.get(id)};},async terminate(){events.push('terminate:'+id);states.set(id,'terminated');}};
 }};
 const env={DB,MEDIA,RENDER_WORKFLOW:binding,OPERATION_WORKFLOW:binding,
  SHARDS:{getByName(id){return{async stopAndSettle(){events.push('stop:'+id);}};}},
  OPERATIONS:{getByName(){return{async closeStudio(){events.push('closeStudio');},async progress(){}};}}};
 const render=(id='workflow-render',status='sharding')=>db.prepare('INSERT INTO pipeline_renders VALUES(?,?,?,?,?,?,?,?,?)').run(id,op.id,0,id,'evals/input.json',status,Date.now(),null,null);
 const attempt=(id='existing-attempt')=>db.prepare('INSERT INTO pipeline_attempts(id,render_id,operation_id,generation,mode,instance,status,started_at) VALUES(?,?,?,?,?,?,?,?)').run(id,'workflow-render',op.id,0,'shard','standard-3','active',Date.now());
 return{db,env,op,render,attempt,states,events,objects,creates:()=>creates,lateCancel:()=>{lateCancel=true;},unavailable:value=>{unavailable=value;}};
}

test('native creation finishing after cancellation is terminated; original generation and unknown costs survive cleanup',async t=>{
 const f=fixture(t);f.render();f.attempt();f.lateCancel();
 f.db.prepare('INSERT INTO cost_reservations VALUES(?,?,?,?,?,?,?,?)').run('unknown-model',f.op.id,'request','model','C',1234,'catalog',Date.now());
 await dispatchRender(f.env,{id:'render-workflow-render',operationId:f.op.id});
 assert.equal(f.states.get('workflow-render'),'terminated');assert.equal(f.creates(),1);
 const result=await reconcileOperation(f.env,f.op.id);assert.equal(result.pendingCosts[0].reserved_micros,1234);
 assert.equal(f.db.prepare('SELECT stopped_at FROM pipeline_attempts').get().stopped_at>0,true);
 assert.equal(f.db.prepare('SELECT generation FROM pipeline_workflows').get().generation,0);
 assert.equal(f.db.prepare('SELECT generation FROM pipeline_operations').get().generation,1);
 assert.equal(f.db.prepare('SELECT status FROM pipeline_renders').get().status,'cancelled');
 await dispatchRender(f.env,{id:'render-workflow-render',operationId:f.op.id});assert.equal(f.creates(),1);
});

test('platform termination is found without queue redelivery; cleanup retries keep the first render cause',async t=>{
 const f=fixture(t);f.render();f.attempt();await registerWorkflow(f.env,'render','workflow-render',f.op.id,0);f.states.set('workflow-render','terminated');
 assert.equal((await recoverWorkflows(f.env))[0].status,'inspected');
 const row=f.db.prepare('SELECT status,result_json FROM pipeline_renders').get();assert.equal(row.status,'blocked');assert.equal(parseCanonicalJson(row.result_json).code,'RENDER_WORKFLOW_TERMINATED');
 await recordRenderFailure(f.env,'workflow-render','RENDER_DEADLINE');
 assert.equal(parseCanonicalJson(f.db.prepare('SELECT result_json FROM pipeline_renders').get().result_json).code,'RENDER_WORKFLOW_TERMINATED');
 assert.ok((await workflowInventory(f.env,f.op.id))[0].reconciled_at);assert.equal(f.creates(),0);
});

test('unknown native status cannot claim stopped, but does not prevent physical cleanup or release unknown model spend',async t=>{
 const f=fixture(t);f.render();f.attempt();await registerWorkflow(f.env,'render','workflow-render',f.op.id,0);
 f.db.prepare("UPDATE pipeline_operations SET status='cancelled',generation=1").run();f.unavailable(true);
 await assert.rejects(reconcileOperation(f.env,f.op.id),/WORKFLOW_STOP_UNCONFIRMED/);
 assert.ok(f.events.includes('stop:existing-attempt'));assert.ok(f.events.includes('closeStudio'));
 assert.equal((await workflowInventory(f.env,f.op.id))[0].reconciled_at,null);
 f.unavailable(false);f.states.set('workflow-render','complete');await reconcileOperation(f.env,f.op.id);
 assert.ok((await workflowInventory(f.env,f.op.id))[0].reconciled_at);assert.equal(f.creates(),0);
});

test('errored director duplicate is repaired rather than acknowledged as active or recreated',async t=>{
 const f=fixture(t);const row=await registerWorkflow(f.env,'operation',f.op.id,f.op.id,0);f.states.set(f.op.id,'errored');
 f.db.prepare('UPDATE pipeline_workflows SET native_created_at=?').run(Date.now());
 await dispatchCreative(f.env,{operationId:f.op.id});
 assert.equal(f.db.prepare('SELECT status FROM pipeline_operations').get().status,'failed');assert.equal(f.creates(),0);
 const notice=parseCanonicalJson(f.db.prepare("SELECT payload_json FROM pipeline_outbox WHERE kind='operation_failure'").get().payload_json);
 assert.equal(notice.code,'OPERATION_WORKFLOW_ERRORED');assert.ok(f.objects.has('operations/'+f.op.id+'/failure.json'));
 assert.ok((await workflowInventory(f.env,row.id))[0].reconciled_at);
});

test('full native restart cannot repeat an execution claim or start new compute, even with an active operation',async t=>{
 const f=fixture(t);f.render();f.attempt();await workflowStarted(f.env,'render','workflow-render',f.op.id,0);
 const {outputFiles}=await build({entryPoints:['apps/cloud/src/render-workflow.ts'],bundle:true,write:false,platform:'node',format:'esm',target:'node26',plugins:[{
  name:'workflow-fixture',setup(build){build.onResolve({filter:/^cloudflare:workers$/},()=>({path:'entrypoint',namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export class WorkflowEntrypoint {constructor(ctx,env){this.ctx=ctx;this.env=env;}}',loader:'js'}));}
 }]});
 const {RenderWorkflow}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
 let reads=0;f.env.MEDIA.get=async()=>{reads++;throw Error('must not load a new render');};
 const steps={async do(_name,configOrFn,callback){return(callback??configOrFn)();}};
 await assert.rejects(new RenderWorkflow({},f.env).run({payload:{renderId:'workflow-render'}},steps),/WORKFLOW_RESTART_RECONCILIATION_REQUIRED/);
 assert.equal(reads,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n,1);assert.equal(f.creates(),0);
 assert.equal(parseCanonicalJson(f.db.prepare('SELECT result_json FROM pipeline_renders').get().result_json).code,'WORKFLOW_RESTART_RECONCILIATION_REQUIRED');
 assert.ok(f.events.includes('stop:existing-attempt'));
});
