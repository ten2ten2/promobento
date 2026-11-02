// Workflow preflight/commit control flow with the paid Shard execution mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {sqliteD1} from './fixtures/sqlite.mjs';
import {memoryMedia} from './fixtures/media.mjs';
import {immutableBytes} from '../src/store.ts';
import {saveNativeProject,createNativeRender,NATIVE_COMMIT} from '../src/native-project.ts';

const mockModules={
 'cloudflare:workers':'export class WorkflowEntrypoint {constructor(_context,env){this.env=env;}}',
 'workflow-state.ts':'export const workflowStarted=async()=>true;',
 'render-task.ts':'export const runNativeRenderTask=(...args)=>globalThis.__nativeRenderWorkflowFixture.task(...args);',
 'render-verification.ts':'export const verifyNativeResult=async()=>true;',
 'render-recovery.ts':`export const renderFailureCode=error=>error.message;
  export const advanceRenderStage=async()=>true;
  export const commitRender=(...args)=>globalThis.__nativeRenderWorkflowFixture.commit(...args);
  export const recordRenderFailure=(...args)=>globalThis.__nativeRenderWorkflowFixture.fail(...args);`,
 'outbox.ts':'export const flushOutbox=async()=>true;',
};
const built=await build({stdin:{contents:'export {RenderWorkflow} from "./apps/cloud/src/render-workflow.ts";',resolveDir:process.cwd()},
 bundle:true,write:false,platform:'node',format:'esm',target:'node26',plugins:[{name:'render-workflow-fixtures',setup(b){
  b.onResolve({filter:/.*/},args=>{
   const name=args.path.split('/').at(-1),key=Object.hasOwn(mockModules,args.path)?args.path:Object.hasOwn(mockModules,name)?name:null;
   return key?{path:key,namespace:'fixture'}:undefined;
  });
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mockModules[args.path],loader:'js'}));
 }}]});
const {RenderWorkflow}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

async function fixture(t){
 const {db,DB}=sqliteD1(),{MEDIA}=memoryMedia();t.after(()=>db.close());
 const op={id:'workflow-rights',workspace_id:'workspace',project_id:'project',generation:0};
 db.prepare('INSERT INTO pipeline_operations(id,workspace_id,project_id,generation,purpose,status,request_hash,max_micros,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .run(op.id,op.workspace_id,op.project_id,0,'evaluation','active','request',3000000,Date.now());
 db.prepare('INSERT INTO renderer_releases(id,image_digest,runtime_version,environment_key,status) VALUES(?,?,?,?,?)')
  .run('native-release','sha256:'+'a'.repeat(64),NATIVE_COMMIT,'evals/native/environment.json','active');
 const env={DB,MEDIA};
 const file=await immutableBytes(env,'evals/workflow/source.html',new TextEncoder().encode('<html>Film</html>'),'text/html');
 const resource={resourceId:'res_workflow',sha256:file.sha256,kind:'image'};
 const saved=await saveNativeProject(env,op,{composition:{durationSeconds:15,fps:30,width:1920,height:1080},
  files:[{...file,path:'index.html'}],resources:[resource]});
 await createNativeRender(env,op,{renderId:'workflow-render',revisionId:saved.revisionId,mode:'preview',rendererRelease:'native-release'});
 const evidence=await immutableBytes(env,'evals/workflow/evidence.json',new TextEncoder().encode('{}'),'application/json');
 const grant=()=>db.prepare('INSERT INTO pipeline_rights(operation_id,resource_id,sha256,license_ref,evidence_key,scope) VALUES(?,?,?,?,?,?)')
  .run(op.id,resource.resourceId,resource.sha256,'fixture-license',evidence.key,'internal_eval_only');
 const revoke=()=>db.prepare('UPDATE pipeline_rights SET revoked_at=? WHERE operation_id=?').run(Date.now(),op.id);
 const counts={tasks:0,commits:0,failures:[]};
 const adapter={
  async task(){counts.tasks++;return {outputs:[],report:{},attemptId:'fixture-attempt'};},
  async commit(){counts.commits++;},
  async fail(_env,_id,code){counts.failures.push(code);},
 };
 const step={async do(_name,options,action){return (action??options)();}};
 return{env,db,op,grant,revoke,counts,adapter,run:()=>new RenderWorkflow({},env).run({payload:{renderId:'workflow-render'}},step)};
}

test('native Workflow refuses compute without current input rights, and refuses publication after revocation',async t=>{
 const missing=await fixture(t);
 globalThis.__nativeRenderWorkflowFixture=missing.adapter;
 await assert.rejects(missing.run(),/ASSET_RIGHTS_PENDING/);
 assert.equal(missing.counts.tasks,0,'no paid attempt may start without evidence');
 assert.equal(missing.counts.commits,0);

 const revoked=await fixture(t);revoked.grant();
 revoked.adapter.task=async()=>{revoked.counts.tasks++;revoked.revoke();return {outputs:[],report:{},attemptId:'fixture-attempt'};};
 globalThis.__nativeRenderWorkflowFixture=revoked.adapter;
 await assert.rejects(revoked.run(),/ASSET_RIGHTS_PENDING/);
 assert.equal(revoked.counts.tasks,1,'the mock revoke occurs only after execution');
 assert.equal(revoked.counts.commits,0,'a revoked film must not be published');

 const valid=await fixture(t);valid.grant();
 globalThis.__nativeRenderWorkflowFixture=valid.adapter;
 const result=await valid.run();
 assert.equal(result.status,'passed');
 assert.equal(valid.counts.tasks,1);
 assert.equal(valid.counts.commits,1);
 t.after(()=>delete globalThis.__nativeRenderWorkflowFixture);
});
