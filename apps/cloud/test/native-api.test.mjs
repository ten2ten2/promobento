import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {sqliteD1} from './fixtures/sqlite.mjs';
import {memoryMedia} from './fixtures/media.mjs';
import {NATIVE_COMMIT} from '../src/native-project.ts';
import {objectUploadHeaders,requireIdleCapacity} from '../src/internal-eval-client.mjs';
import {canonical} from '@promobento/contracts/canonical';

const built=await build({stdin:{contents:'export {default as worker} from "./apps/cloud/src/index.ts";',resolveDir:process.cwd()},
  bundle:true,write:false,platform:'node',format:'esm',target:'node26',
  plugins:[{name:'cloudflare-api-fixture',setup(builder){
    builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'workers',namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:
      'export class DurableObject{} export class WorkerEntrypoint{} export class WorkflowEntrypoint{}',loader:'js'}));
  }}]});
const {worker}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

test('internal API distinguishes runtime failure from invalid input without leaking exception details',async()=>{
 const base='https://worker.example/internal/s1/';
 const env={S1_ENABLED:'internal_eval',EVAL_API_KEY:'fixture-only',
  COORDINATOR:{getByName(){return {async counts(){throw Error('private database connection details');}};}}};
 const headers={authorization:'Bearer fixture-only'};
 const failed=await worker.fetch(new Request(base+'capacity',{headers}),env,{});
 assert.equal(failed.status,500);
 assert.equal(failed.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(await failed.json(),{code:'PIPELINE_INTERNAL_ERROR'});
 const masked=await worker.fetch(new Request(base+'capacity',{headers}),
  {...env,COORDINATOR:{getByName(){return {async counts(){throw Error('SQLITE_BUSY');}};}}},{});
 assert.equal(masked.status,500);
 assert.deepEqual(await masked.json(),{code:'PIPELINE_INTERNAL_ERROR'});
 const invalid=await worker.fetch(new Request(base+'objects/evals/test/a.bin',{method:'PUT',headers:{...headers,'content-length':'0'}}),env,{});
 assert.equal(invalid.status,422);
 assert.deepEqual(await invalid.json(),{code:'OBJECT_SHA256_REQUIRED'});
});

test('HTTP JSON boundary classifies malformed bodies as 422, even with strict canonical parsing',async()=>{
 const base='https://worker.example/internal/s1/operations';
 const env={S1_ENABLED:'internal_eval',EVAL_API_KEY:'fixture-only'};
 for(const [body,code] of [['{','BODY_JSON_INVALID'],['{"a":1,"a":2}','BODY_JSON_INVALID'],
  ['"\\ud800"','BODY_JSON_INVALID'],['null','BODY_JSON_OBJECT_REQUIRED'],
  ['[]','BODY_JSON_OBJECT_REQUIRED'],['42','BODY_JSON_OBJECT_REQUIRED']]){
  const response=await worker.fetch(new Request(base,{method:'POST',
   headers:{authorization:'Bearer fixture-only','content-type':'application/json'},body}),env,{});
  assert.equal(response.status,422,body);
  assert.deepEqual(await response.json(),{code},body);
 }
 for(const path of ['native/projects','renders','creative','rights']){
  const response=await worker.fetch(new Request('https://worker.example/internal/s1/'+path,
   {method:'POST',headers:{authorization:'Bearer fixture-only'},body:'{}'}),env,{});
  assert.equal(response.status,422,path);
  assert.deepEqual(await response.json(),{code:'OPERATION_INVALID'},path);
 }
});

test('HTTP JSON boundary preserves an oversized-body error when stream cancellation fails',async()=>{
 const body=new ReadableStream({
  start(controller){controller.enqueue(new Uint8Array((4<<20)+1));},
  cancel(){throw Error('private transport cancellation failure');},
 });
 const response=await worker.fetch(new Request('https://worker.example/internal/s1/operations',{
  method:'POST',duplex:'half',headers:{authorization:'Bearer fixture-only'},body,
 }),{S1_ENABLED:'internal_eval',EVAL_API_KEY:'fixture-only'},{});
 assert.equal(response.status,422);
 assert.deepEqual(await response.json(),{code:'BODY_TOO_LARGE'});
});

test('native project HTTP rejects malformed file/resource lists at the input boundary',async t=>{
 const {db,DB}=sqliteD1();t.after(()=>db.close());
 const operationId='input-shape-operation';
 db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  .run(operationId,'workspace','project',0,'evaluation','active','request',100000,Date.now(),null,null);
 const env={DB,MEDIA:memoryMedia().MEDIA,S1_ENABLED:'internal_eval',EVAL_API_KEY:'fixture-only'};
 const file={path:'index.html',key:'evals/native/index.html',sha256:'a'.repeat(64),byteLength:1,mediaType:'text/html'};
 for(const invalid of [{files:null},{files:[null]},{files:[{path:'index.html'}]},
  {files:[],resources:{}},{files:[],resources:[null]},{files:[],baseRevision:12},
  {files:[file,{...file,path:{toString:null},key:'evals/native/second.js'}]},
  {files:[{...file,path:['index.html']}]},
  {files:[],timingEvidenceRef:{key:{toString:null}}},
  {files:[],timingEvidenceRef:['operations/input-shape-operation/timing.json']},
  {files:[file],resources:[{resourceId:{toString:null},sha256:'a'.repeat(64)}]},
  {files:[file],resources:[{resourceId:'res_invalid',sha256:{toString:null}}]}]){
  const response=await worker.fetch(new Request('https://worker.example/internal/s1/native/projects',{
   method:'POST',headers:{authorization:'Bearer fixture-only','content-type':'application/json'},
   body:canonical({operationId,...invalid})}),env,{});
  assert.equal(response.status,422,JSON.stringify(invalid));
  assert.deepEqual(await response.json(),{code:'NATIVE_PROJECT_SCHEMA_INVALID'});
 }
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_native_projects').get().n,0);
 const crossOperation=await worker.fetch(new Request('https://worker.example/internal/s1/native/projects',{
  method:'POST',headers:{authorization:'Bearer fixture-only','content-type':'application/json'},
  body:canonical({operationId,files:[],timingEvidenceRef:{key:'operations/another-operation/time.json',
   sha256:'a'.repeat(64),byteLength:2}})}),env,{});
 assert.equal(crossOperation.status,422,'a foreign reference without a parent must remain a domain input error');
 assert.deepEqual(await crossOperation.json(),{code:'NATIVE_TIMING_EVIDENCE_SCOPE_INVALID'});
});

test('malformed nested render revision and rights identities return 422 without writes',async t=>{
 const {db,DB}=sqliteD1();t.after(()=>db.close());
 const operationId='typed-identity-operation';
 db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  .run(operationId,'workspace','project',0,'evaluation','active','request',100000,Date.now(),null,null);
 const env={DB,MEDIA:memoryMedia().MEDIA,S1_ENABLED:'internal_eval',EVAL_API_KEY:'fixture-only'};
 const request=(path,input)=>worker.fetch(new Request('https://worker.example/internal/s1/'+path,{
  method:'POST',headers:{authorization:'Bearer fixture-only','content-type':'application/json'},body:canonical({operationId,...input})}),env,{});
 for(const revisionId of [['a'.repeat(64)],{toString:null}]){
  const response=await request('renders',{renderId:'invalid-revision-render',revisionId,rendererRelease:'fixture-release',mode:'preview'});
  assert.equal(response.status,422,JSON.stringify(revisionId));
  assert.deepEqual(await response.json(),{code:'NATIVE_REVISION_INVALID'});
 }
 const rights={resourceId:'res_test_resource',sha256:'a'.repeat(64),licenseRef:'owner-approved',
  scope:'internal_eval_only',evidenceKey:'evals/fixture/rights.json'};
 for(const invalid of [{resourceId:{toString:null}},{resourceId:['res_test_resource']},
  {sha256:{toString:null}},{sha256:['a'.repeat(64)]}]){
  const response=await request('rights',{...rights,...invalid});
  assert.equal(response.status,422,JSON.stringify(invalid));
  assert.deepEqual(await response.json(),{code:'RIGHTS_INVALID'});
 }
 for(const table of ['pipeline_renders','pipeline_rights'])
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,table);
});

test('uploaded malformed or non-object evidence is rejected as client input on both evidence endpoints',async t=>{
 const {db,DB}=sqliteD1();t.after(()=>db.close());
 const operationId='uploaded-evidence-operation';
 db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  .run(operationId,'workspace','project',0,'evaluation','active','request',100000,Date.now(),null,null);
 const {MEDIA}=memoryMedia();
 const env={DB,MEDIA,S1_ENABLED:'internal_eval',EVAL_API_KEY:'fixture-only'};
 const base='https://worker.example/internal/s1/';
 const headers={authorization:'Bearer fixture-only','content-type':'application/json'};
 const rights={operationId,resourceId:'res_test_resource',sha256:'a'.repeat(64),licenseRef:'owner-approved',
  scope:'internal_eval_only'};
 for(const [index,body] of ['null','[]','42','{','{"duplicate":1,"duplicate":2}','"\\ud800"'].entries()){
  const key=`evals/fixture/invalid-${index}.json`,bytes=new TextEncoder().encode(body);
  const uploaded=await worker.fetch(new Request(base+'objects/'+key,{method:'PUT',
   headers:{...headers,...objectUploadHeaders(bytes)},body:bytes}),env,{});
  assert.equal(uploaded.status,200,body);
  const registration=await worker.fetch(new Request(base+'rights',{method:'POST',headers,
   body:canonical({...rights,evidenceKey:key})}),env,{});
  assert.equal(registration.status,422,body);
  assert.deepEqual(await registration.json(),{code:'RIGHTS_EVIDENCE_INVALID'},body);
  const confirmation=await worker.fetch(new Request(base+'model-budget/confirm',{method:'POST',headers,
   body:canonical({evidenceKey:key})}),env,{});
  assert.equal(confirmation.status,422,body);
  assert.deepEqual(await confirmation.json(),{code:'MODEL_CONFIRMATION_INVALID'},body);
 }
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_rights').get().n,0);
 const broken={...env,MEDIA:{...MEDIA,async get(){throw Error('private R2 transport failure');}}};
 for(const [endpoint,input] of [['rights',{...rights,evidenceKey:'evals/fixture/invalid-0.json'}],
  ['model-budget/confirm',{evidenceKey:'evals/fixture/invalid-0.json'}]]){
  const response=await worker.fetch(new Request(base+endpoint,{method:'POST',headers,body:canonical(input)}),broken,{});
  assert.equal(response.status,500,endpoint);
  assert.deepEqual(await response.json(),{code:'PIPELINE_INTERNAL_ERROR'},endpoint);
 }
});

test('asynchronous recovery, private-artifact and event failures stay inside HTTP error boundary',async()=>{
 const headers={authorization:'Bearer fixture-only'};
 const base='https://worker.example/internal/s1/';
 const brokenDB={prepare(){return {bind(){return this;},async first(){throw Error('private D1 error');}};}};
 const baseEnv={S1_ENABLED:'internal_eval',EVAL_API_KEY:'fixture-only',DB:brokenDB};
 for(const path of ['operations/a123/recovery','artifacts/renders/a123/result.mp4']){
  const response=await worker.fetch(new Request(base+path,{headers}),baseEnv,{});
  assert.equal(response.status,500,path);
  assert.deepEqual(await response.json(),{code:'PIPELINE_INTERNAL_ERROR'},path);
 }
 const eventsEnv={...baseEnv,OPERATIONS:{getByName(){return {async watch(){throw Error('private SSE error');}};}}};
 const response=await worker.fetch(new Request(base+'operations/a123/events',{headers}),eventsEnv,{});
 assert.equal(response.status,500);
 assert.deepEqual(await response.json(),{code:'PIPELINE_INTERNAL_ERROR'});
 const malformed=await worker.fetch(new Request(base+'artifacts/%ZZ',{headers}),baseEnv,{});
 assert.equal(malformed.status,422);
 assert.deepEqual(await malformed.json(),{code:'OBJECT_KEY_INVALID'});
});

test('direction-preview artifact reads honor separately supplied audio rights and later revocation',async t=>{
 const {db,DB}=sqliteD1();t.after(()=>db.close());
 const {MEDIA}=memoryMedia(),id='audio-preview-operation',key='operations/'+id+'/direction-preview.png';
 db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  .run(id,'workspace','project',0,'evaluation','awaiting_user','request',100000,Date.now(),null,null);
 const audio={resourceId:'res_audio_source',sha256:'a'.repeat(64),kind:'audio'};
 await MEDIA.put('evals/native/context.json',canonical({resources:[],audioSources:[audio]}));
 await MEDIA.put('operations/'+id+'/previews.json',canonical([{key}]));
 await MEDIA.put(key,Uint8Array.from([137,80,78,71]));
 await MEDIA.put('evals/native/license.json',canonical({approvedBy:'owner'}));
 db.prepare("INSERT INTO pipeline_contexts(operation_id,request_key,previews_key,engine) VALUES(?,?,?,'huashu')")
  .run(id,'evals/native/context.json','operations/'+id+'/previews.json');
 db.prepare('INSERT INTO pipeline_rights(operation_id,resource_id,sha256,license_ref,evidence_key,scope) VALUES(?,?,?,?,?,?)')
  .run(id,audio.resourceId,audio.sha256,'fixture-license','evals/native/license.json','internal_eval_only');
 const request=()=>worker.fetch(new Request('https://worker.example/internal/s1/artifacts/'+key,
  {headers:{authorization:'Bearer fixture-only'}}),{DB,MEDIA,S1_ENABLED:'internal_eval',EVAL_API_KEY:'fixture-only'},{});
 assert.equal((await request()).status,200);
 db.prepare('UPDATE pipeline_rights SET revoked_at=? WHERE operation_id=?').run(Date.now(),id);
 const blocked=await request();
 assert.equal(blocked.status,422);
 assert.deepEqual(await blocked.json(),{code:'ASSET_RIGHTS_PENDING'});
});

test('only an owning blocked render may read its exact private QA film and report',async t=>{
  const {db,DB}=sqliteD1();t.after(()=>db.close());
  const {MEDIA}=memoryMedia(),id='blocked-qa-op',renderId='blocked-qa-render';
  db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(id,'workspace','project',0,'evaluation','failed','request',100000,Date.now(),Date.now(),null);
  const prefix=`renders/${renderId}/attempts/qa-attempt/failed/`;
  const film=prefix+'film.mp4',report=prefix+'qa.json',other=prefix+'private.json';
  await MEDIA.put('renders/'+renderId+'/input.json',canonical({kind:'native_render_request',project:{resources:[]}}));
  for(const key of [film,report,other])await MEDIA.put(key,Buffer.from('fixture'));
  db.prepare(`INSERT INTO pipeline_renders (id,operation_id,generation,request_hash,job_key,status,created_at,finished_at,result_json)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(renderId,id,0,'request','renders/'+renderId+'/input.json','blocked',Date.now(),Date.now(),
    canonical({status:'blocked',code:'NATIVE_DYNAMIC_QA_BLOCKED',qaEvidence:{film:{key:film},report:{key:report}}}));
  const env={DB,MEDIA,S1_ENABLED:'internal_eval',EVAL_API_KEY:'fixture-only'};
  const get=key=>worker.fetch(new Request('https://worker.example/internal/s1/artifacts/'+key,
    {headers:{authorization:'Bearer fixture-only'}}),env,{});
  assert.equal((await get(film)).status,200);
  assert.equal((await get(report)).status,200);
  assert.equal((await get(other)).status,404);
  db.prepare('UPDATE pipeline_renders SET status=? WHERE id=?').run('passed',renderId);
  assert.equal((await get(film)).status,404,'blocked diagnostics never become normal deliverables');
});

test('active material ingestion sends a SHA-256 over exact binary and JSON bytes to the real R2 endpoint',async t=>{
  const {db,DB}=sqliteD1();t.after(()=>db.close());
  const {MEDIA}=memoryMedia(),env={DB,MEDIA,S1_ENABLED:'internal_eval',EVAL_API_KEY:'fixture-only'};
  const payloads=[
    {name:'picture.bin',type:'application/octet-stream',bytes:Uint8Array.from([0,255,1,128,7])},
    {name:'rights.json',type:'application/json',bytes:new TextEncoder().encode(canonical({kind:'eval_material_rights',approvedBy:'owner'}))},
  ];
  for(const {name,type,bytes}of payloads){
    const url='https://worker.example/internal/s1/objects/evals/ingest-fixture/'+name;
    // fetch sets this for a fixed Uint8Array body; Request-only local dispatch does not.
    const common={authorization:'Bearer fixture-only','content-type':type,'content-length':String(bytes.length)};
    const request=headers=>worker.fetch(new Request(url,{method:'PUT',headers,body:bytes}),env,{});
    const old=await request(common);
    assert.equal(old.status,422,'the old ingestion client lacks required hash evidence');
    assert.equal((await old.json()).code,'OBJECT_SHA256_REQUIRED');
    const result=await request({...common,...objectUploadHeaders(bytes)});
    assert.equal(result.status,200);
    const saved=await result.json();
    assert.equal(saved.byteLength,bytes.length);
    assert.equal(saved.sha256,objectUploadHeaders(bytes)['x-content-sha256']);
    const stored=await MEDIA.get(saved.key);
    assert.deepEqual(new Uint8Array(await stored.arrayBuffer()),bytes);
  }
});

test('all staging clients reject active, queued and malformed capacity snapshots',()=>{
  assert.doesNotThrow(()=>requireIdleCapacity({leases:[],queued:0,oldestWaitMs:null},'STAGING_BUSY'));
  for(const value of [{leases:[{workspace:'one',count:1}],queued:0},
    {leases:[],queued:1,oldestWaitMs:5000}])
    assert.throws(()=>requireIdleCapacity(value,'STAGING_BUSY'),/STAGING_BUSY/);
  for(const value of [[],{leases:[]},{leases:null,queued:0},{leases:[],queued:-1}])
    assert.throws(()=>requireIdleCapacity(value,'STAGING_BUSY'),/CAPACITY_RESPONSE_INVALID/);
});

test('operation recovery bounds physical-stop probes and reports unknown when a Shard stalls',async t=>{
  const {db,DB}=sqliteD1();t.after(()=>db.close());
  const operationId='recovery-operation',renderId='recovery-render';
  db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(operationId,'workspace','project',0,'evaluation','active','request',3000000,Date.now(),null,null);
  db.prepare('INSERT INTO pipeline_renders (id,operation_id,generation,request_hash,job_key,status,created_at,finished_at,result_json) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(renderId,operationId,0,'request','renders/recovery/job.json','queued',Date.now(),null,null);
  for(let i=0;i<12;i++)db.prepare(`INSERT INTO pipeline_attempts
    (id,render_id,operation_id,generation,mode,instance,status,started_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run('recovery-attempt-'+i,renderId,operationId,0,'native_export','standard-3','active',Date.now()+i);
  for(const id of ['recovery-attempt-1','untracked-compute'])
    db.prepare('INSERT INTO cost_reservations VALUES(?,?,?,?,?,?,?,?)')
      .run(id,operationId,'request','compute','render',1000,'catalog',Date.now());

  const seen=new Map(),live={count:0,peak:0};
  const SHARDS={getByName(id){return{async isStopped(){
    seen.set(id,(seen.get(id)??0)+1);
    live.count++;live.peak=Math.max(live.peak,live.count);
    if(id==='recovery-attempt-0')return new Promise(()=>{});
    await new Promise(resolve=>setTimeout(resolve,6));live.count--;
    return id!=='untracked-compute';
  }};}};
  let watchdog;
  const response=await Promise.race([
    worker.fetch(new Request('https://worker.example/internal/s1/operations/'+operationId+'/recovery',
      {headers:{authorization:'Bearer fixture-only'}}),
      {DB,SHARDS,S1_ENABLED:'internal_eval',EVAL_API_KEY:'fixture-only'},{}),
    new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(Error('RECOVERY_ROUTE_HUNG')),3_600);}),
  ]).finally(()=>clearTimeout(watchdog));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  const state=await response.json();
  assert.equal(state.attempts.length,12);
  assert.equal(state.attempts[0].physicallyStopped,null,'a timed-out probe remains unknown');
  assert.equal(state.attempts[1].physicallyStopped,true);
  assert.equal(state.costs.find(row=>row.id==='untracked-compute').physicallyStopped,false);
  assert.equal(seen.get('recovery-attempt-1'),1,'an attempt and its reservation share one probe');
  assert.ok(live.peak<=4,'a recovery read must not fan out unbounded Shard RPCs');
});

test('real internal HTTP and Queue routes persist one direction event and ACK only after actual delivery',async t=>{
  const {db,DB}=sqliteD1();t.after(()=>db.close());
  const {MEDIA}=memoryMedia(),sent=[],events=[],background=[];
  const env={DB,MEDIA,S1_ENABLED:'internal_eval',EVAL_API_KEY:'fixture-only',
    OUTBOX:{async send(item){sent.push(item);}},
    SHARDS:{getByName(name){assert.equal(name,'release-metadata');return {async imageDigest(){return 'sha256:'+'a'.repeat(64);}};}},
    OPERATION_WORKFLOW:{get(){return {async sendEvent(event){events.push(event);},async status(){return {status:'running'};}};}}};
  const ctx={waitUntil(promise){background.push(Promise.resolve(promise));}};
  const request=(path,input)=>worker.fetch(new Request('https://worker.example/internal/s1/'+path,
    {method:'POST',headers:{authorization:'Bearer fixture-only','content-type':'application/json'},body:JSON.stringify(input)}),env,ctx);
  const creation={id:'api-operation',workspaceId:'workspace-one',projectId:'project-one',purpose:'evaluation',maxMicros:5000};
  const created=await request('operations',creation);
  assert.equal(created.status,200);
  assert.equal(created.headers.get('cache-control'),'private, no-store');
  assert.equal((await request('operations',creation)).status,200);
  const status=await worker.fetch(new Request('https://worker.example/internal/s1/operations/'+creation.id,
    {headers:{authorization:'Bearer fixture-only'}}),env,ctx);
  assert.equal(status.status,200);
  assert.equal(status.headers.get('cache-control'),'private, no-store');
  const conflict=await request('operations',{...creation,maxMicros:6000});
  assert.equal(conflict.status,409);
  assert.equal((await conflict.json()).code,'IDEMPOTENCY_CONFLICT');

  const release={id:'api-release',runtimeVersion:NATIVE_COMMIT,environmentKey:'evals/fixture/environment.json'};
  assert.equal((await request('releases',release)).status,201);
  assert.equal((await request('releases',release)).status,201);
  assert.equal((await request('releases',{...release,environmentKey:'evals/other/environment.json'})).status,409);
  const sha256='a'.repeat(64),resourceId='res_fixture',licenseRef='fixture-license';
  const evidence={resourceId,sha256,licenseRef,scope:'internal_eval_only',approvedBy:'owner',source:'fixture',basis:'approved'};
  const rights={operationId:creation.id,resourceId,sha256,licenseRef,scope:'internal_eval_only',evidenceKey:'evals/fixture/rights.json'};
  await MEDIA.put(rights.evidenceKey,JSON.stringify(evidence));
  await MEDIA.put('evals/fixture/rights-other.json',JSON.stringify(evidence));
  const wrongEvidence=await request('rights',{...rights,evidenceKey:undefined});
  assert.equal(wrongEvidence.status,422);
  assert.equal((await wrongEvidence.json()).code,'RIGHTS_INVALID');
  const missingLicense=await request('rights',{...rights,licenseRef:''});
  assert.equal(missingLicense.status,422);
  assert.equal((await missingLicense.json()).code,'RIGHTS_INVALID');
  assert.equal((await request('rights',rights)).status,201);
  assert.equal((await request('rights',rights)).status,201);
  assert.equal((await request('rights',{...rights,evidenceKey:'evals/fixture/rights-other.json'})).status,409);

  db.prepare("UPDATE pipeline_operations SET status='awaiting_user' WHERE id=?").run(creation.id);
  const directionsHash='f'.repeat(64);
  db.prepare("INSERT INTO pipeline_contexts(operation_id,request_key,engine,directions_hash) VALUES(?,?,'huashu',?)")
    .run(creation.id,'evals/fixture/context.json',directionsHash);
  db.prepare("INSERT INTO pipeline_workflows(kind,id,operation_id,generation,registered_at,engine) VALUES('operation',?,?,?,?,?)")
    .run(creation.id,creation.id,0,Date.now(),'huashu');
  const choice={key:'fit',directionsHash};
  assert.equal((await request('operations/'+creation.id+'/direction',choice)).status,200);
  await Promise.all(background);
  assert.equal(sent.length,1);
  assert.equal(sent[0].kind,'direction_choice');
  const ack=[],message={body:sent[0],ack(){ack.push('ack');},retry(){ack.push('retry');}};
  await worker.queue({messages:[message]},env);
  assert.deepEqual(ack,['ack']);
  assert.deepEqual(events,[{type:'direction-choice',payload:choice}]);
  assert.ok(db.prepare('SELECT director_event_done_at FROM pipeline_outbox WHERE id=?').get('direction-'+creation.id).director_event_done_at);
  const terminal=await request('operations/'+creation.id+'/cancel',{});
  assert.equal(terminal.status,200);
  assert.equal(db.prepare('SELECT generation FROM pipeline_operations WHERE id=?').get(creation.id).generation,1);
  assert.equal((await request('operations/'+creation.id+'/cancel',{})).status,200);
  await Promise.all(background);
});
