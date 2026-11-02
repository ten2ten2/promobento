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
 assert.deepEqual(await failed.json(),{code:'PIPELINE_INTERNAL_ERROR'});
 const invalid=await worker.fetch(new Request(base+'objects/evals/test/a.bin',{method:'PUT',headers:{...headers,'content-length':'0'}}),env,{});
 assert.equal(invalid.status,422);
 assert.deepEqual(await invalid.json(),{code:'OBJECT_SHA256_REQUIRED'});
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
  assert.equal((await request('operations',creation)).status,200);
  assert.equal((await request('operations',creation)).status,200);
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
