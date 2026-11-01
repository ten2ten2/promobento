import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {sqliteD1} from './fixtures/sqlite.mjs';
import {memoryMedia} from './fixtures/media.mjs';
import {NATIVE_COMMIT} from '../src/native-project.ts';

const built=await build({stdin:{contents:'export {default as worker} from "./apps/cloud/src/index.ts";',resolveDir:process.cwd()},
  bundle:true,write:false,platform:'node',format:'esm',target:'node26',
  plugins:[{name:'cloudflare-api-fixture',setup(builder){
    builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'workers',namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:
      'export class DurableObject{} export class WorkerEntrypoint{} export class WorkflowEntrypoint{}',loader:'js'}));
  }}]});
const {worker}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

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
