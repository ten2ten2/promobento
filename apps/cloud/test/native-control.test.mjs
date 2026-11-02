import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest,sha256Bytes} from '@promobento/contracts/digest';
import {saveNativeProject, loadNativeProject, createNativeRender, getNativeRender, checkedNativeBytes, NATIVE_COMMIT} from '../src/native-project.ts';
import {immutableBytes,immutableStream,reserve,settle,rights} from '../src/store.ts';
import {boundedUploadStream, putBoundedUpload} from '../src/upload-stream.ts';
import {fixedLengthOf} from './fixtures/fixed-length.mjs';
import {runNativeRenderTask} from '../src/render-task.ts';
import {claimRenderAdmission, requestRenderAdmission} from '../src/render-admission.ts';
import {recoverWorkflows} from '../src/workflow-recovery.ts';
import {registerWorkflow,workflowStarted} from '../src/workflow-state.ts';
import {commitRender, dispatchRenderProgress, recordRenderFailure, reconcileOperation, deliverDirectorEvent, recoverDirectorEvents} from '../src/render-recovery.ts';
import {flushOutbox} from '../src/outbox.ts';
import {chooseDirection} from '../src/director-choice.ts';
import {registerOperation,cancelOperation} from '../src/operation-registration.ts';
import {boundedControl,processQueueMessages} from '../src/control-batch.ts';
import {getReviewDraft, directorProgress, dispatchDirectorProgress, dispatchOperationCancellation, failDirector, commitCandidate} from '../src/director-recovery.ts';
import {sqliteD1} from './fixtures/sqlite.mjs';
import {memoryMedia} from './fixtures/media.mjs';

async function fixture(t) {
  const {db, DB} = sqliteD1(); t.after(() => db.close());
  const {MEDIA, objects} = memoryMedia(), sent = [];
  const env = {DB, MEDIA, OUTBOX: {async send(value) {sent.push(value);}}};
  const op = {id: 'native-operation', workspace_id: 'workspace-one', project_id: 'project-one', generation: 0,
    purpose: 'evaluation', status: 'active', max_micros: 3000000};
  db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(op.id, op.workspace_id, op.project_id, 0, op.purpose, 'active', 'request', op.max_micros, Date.now(), null, null);
  db.prepare('INSERT INTO renderer_releases VALUES(?,?,?,?,?)').run('native-release', 'sha256:' + 'a'.repeat(64), NATIVE_COMMIT, 'evals/native/environment.json', 'active');
  const bytes = new TextEncoder().encode('<!doctype html><html><body>Original fixture</body></html>');
  const file = await immutableBytes(env, 'evals/native/index.html', bytes, 'text/html');
  const input = {composition: {durationSeconds: 15, fps: 30, width: 1920, height: 1080},
    files: [{path: 'index.html', key: file.key, sha256: file.sha256, byteLength: file.byteLength, mediaType: 'text/html'}], resources: []};
  const saved = await saveNativeProject(env, op, input);
  return {db, env, op, saved, input, sent, objects};
}

function fakeAdmission(env) {
  const events = new Map(), leases = new Map();
  const coordinator = {
    async acquire(id, workspace, generation) {
      const token = leases.get(id) ?? crypto.randomUUID(); leases.set(id, token);
      return {token, created: true};
    },
    async extend() {},
    async assertLease(id, _workspace, _generation, token) {
      if (leases.get(id) !== token) throw Error('RENDER_LEASE_FENCED');
    },
    async release(id, token) {
      assert.equal(leases.get(id) ?? token, token);
      const pending = await env.DB.prepare('SELECT r.id FROM cost_reservations r LEFT JOIN cost_settlements s ON s.reservation_id=r.id WHERE r.id=? AND s.reservation_id IS NULL').bind(id).first();
      if (pending) throw Error('COMPUTE_SETTLEMENT_UNCONFIRMED');
      leases.delete(id);
      await env.DB.prepare("UPDATE pipeline_render_admissions SET status='released' WHERE id=? AND lease_token=?").bind(id, token).run();
    },
  };
  env.COORDINATOR = {getByName() {return coordinator;}};
  env.RENDER_WORKFLOW = {get(renderId) {return {async sendEvent(value) {events.set(renderId + ':' + value.type, value);}};}};
  return async (_name, options) => {
    const event = events.get('native-render:' + options.type);
    assert.ok(event, 'capacity notification must be durable and ready before the step resumes');
    return {payload: event.payload};
  };
}

test('native migration preserves settled films and unknown reservations; automatic recovery skips legacy workflows', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const file of ['0001_s1_pipeline.sql', '0002_workflow_recovery.sql', '0003_directing_method.sql'])
      db.exec(readFileSync('apps/cloud/migrations/' + file, 'utf8'));
    db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run('old-operation', 'workspace', 'project', 0, 'evaluation', 'active', 'request', 3000000, 1, null, null);
    db.prepare('INSERT INTO pipeline_renders VALUES(?,?,?,?,?,?,?,?,?)').run('old-render', 'old-operation', 0, 'request', 'renders/old/input.json', 'passed', 1, 2, '{"frozen":true}');
    db.prepare('INSERT INTO cost_reservations VALUES(?,?,?,?,?,?,?,?)').run('unknown-model', 'old-operation', 'request', 'model', 'scenes', 115601, 'old-catalog', 1);
    db.prepare('INSERT INTO pipeline_workflows(kind,id,operation_id,generation,registered_at) VALUES(?,?,?,?,?)').run('operation', 'old-operation', 'old-operation', 0, 1);
    const before = canonical({operations: db.prepare('SELECT * FROM pipeline_operations').all(), renders: db.prepare('SELECT * FROM pipeline_renders').all(),
      costs: db.prepare('SELECT * FROM cost_reservations').all(), settlements: db.prepare('SELECT * FROM cost_settlements').all()});
    db.exec(readFileSync('apps/cloud/migrations/0004_native_projects.sql', 'utf8'));
    const DB = {prepare(sql) {return {async all() {return {results: db.prepare(sql).all()};}};}};
    assert.deepEqual(await recoverWorkflows({DB}), []);
    assert.equal(db.prepare('SELECT engine FROM pipeline_workflows').get().engine, 'legacy');
    assert.equal(canonical({operations: db.prepare('SELECT * FROM pipeline_operations').all(), renders: db.prepare('SELECT * FROM pipeline_renders').all(),
      costs: db.prepare('SELECT * FROM cost_reservations').all(), settlements: db.prepare('SELECT * FROM cost_settlements').all()}), before);
  } finally {db.close();}
});

test('terminal native cleanup and draft reads require no retired Studio handle or response shape', async t => {
  const {db, env, op} = await fixture(t);
  db.prepare("UPDATE pipeline_operations SET status='failed',result_key=? WHERE id=?")
    .run('operations/' + op.id + '/review-draft.json', op.id);
  assert.equal(await getReviewDraft(env, op.id), null, 'the pre-native review-draft address is retired');
  const result = await reconcileOperation(env, op.id);
  assert.equal(result.stoppedAttempts, 0);
  assert.equal(result.reconciledRenders, 0);
  assert.deepEqual(result.pendingCosts, []);
});

test('an already-claimed Workflow restart cannot erase its reconciled terminal status',async t=>{
 const{db,env,op}=await fixture(t);
 assert.equal(await workflowStarted(env,'operation',op.id,op.id,op.generation),op.generation);
 db.prepare(`UPDATE pipeline_workflows SET native_status='complete',reconciled_at=?,last_error='archived'
   WHERE kind='operation' AND id=?`).run(Date.now(),op.id);
 const before=db.prepare("SELECT * FROM pipeline_workflows WHERE kind='operation' AND id=?").get(op.id);
 await assert.rejects(workflowStarted(env,'operation',op.id,op.id,op.generation),/WORKFLOW_RESTART_RECONCILIATION_REQUIRED/);
 const after=db.prepare("SELECT * FROM pipeline_workflows WHERE kind='operation' AND id=?").get(op.id);
 assert.deepEqual(after,before,'rejecting a second claim must not revive or modify a terminal Workflow row');
});

test('a delayed first Workflow start cannot claim a pre-reconciled or cancelled operation',async t=>{
 const{db,env,op}=await fixture(t);
 await registerWorkflow(env,'operation',op.id,op.id,op.generation);
 db.prepare(`UPDATE pipeline_workflows SET native_status='terminated',reconciled_at=?
   WHERE kind='operation' AND id=?`).run(Date.now(),op.id);
 const before=db.prepare("SELECT * FROM pipeline_workflows WHERE kind='operation' AND id=?").get(op.id);
 await assert.rejects(workflowStarted(env,'operation',op.id,op.id,op.generation),/WORKFLOW_RESTART_RECONCILIATION_REQUIRED/);
 assert.deepEqual(db.prepare("SELECT * FROM pipeline_workflows WHERE kind='operation' AND id=?").get(op.id),before);
 db.prepare('UPDATE pipeline_workflows SET reconciled_at=NULL WHERE id=?').run(op.id);
 db.prepare("UPDATE pipeline_operations SET status='cancelled',generation=generation+1 WHERE id=?").run(op.id);
 const cancelled=db.prepare("SELECT * FROM pipeline_workflows WHERE kind='operation' AND id=?").get(op.id);
 await assert.rejects(workflowStarted(env,'operation',op.id,op.id,op.generation),/WORKFLOW_RESTART_RECONCILIATION_REQUIRED/);
 assert.deepEqual(db.prepare("SELECT * FROM pipeline_workflows WHERE kind='operation' AND id=?").get(op.id),cancelled);
});

test('terminal cleanup limits parallel Workflow, Shard and capacity-release RPCs across many renders',async t=>{
  const {db,env,op}=await fixture(t);
  const count=12,token='11111111-1111-4111-8111-111111111111';
  for(let index=0;index<count;index++){
    const renderId='cleanup-render-'+index,attemptId='cleanup-attempt-'+index;
    db.prepare(`INSERT INTO pipeline_renders
      (id,operation_id,generation,request_hash,job_key,status,created_at)
      VALUES(?,?,?,?,?,'rendering',?)`).run(renderId,op.id,0,'hash-'+index,'renders/'+renderId+'/job.json',Date.now());
    db.prepare(`INSERT INTO pipeline_attempts
      (id,render_id,operation_id,generation,mode,instance,status,started_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(attemptId,renderId,op.id,0,'native_export','standard-3','active',Date.now());
    db.prepare(`INSERT INTO pipeline_render_admissions
      (id,render_id,operation_id,generation,workspace_id,attempt_index,status,requested_at,queue_deadline_at,
       lease_token,admitted_at,attempt_deadline_at)
      VALUES(?,?,?,?,?,0,'running',?,?,?,?,?)`)
      .run(attemptId,renderId,op.id,0,op.workspace_id,Date.now(),Date.now()+60_000,token,Date.now(),Date.now()+60_000);
    db.prepare(`INSERT INTO pipeline_workflows(kind,id,operation_id,generation,registered_at,engine)
      VALUES('render',?,?,0,?,'huashu')`).run(renderId,op.id,Date.now());
  }
  const rates={shard:{active:0,peak:0},workflow:{active:0,peak:0},release:{active:0,peak:0}};
  const pause=async kind=>{
    const state=rates[kind];state.active++;state.peak=Math.max(state.peak,state.active);
    await new Promise(resolve=>setTimeout(resolve,8));state.active--;
  };
  env.SHARDS={getByName(){return{async stopAndSettle(){await pause('shard');}};}};
  const terminated=new Set();
  env.RENDER_WORKFLOW={get(id){return{
    async status(){await pause('workflow');return{status:terminated.has(id)?'terminated':'running'};},
    async terminate(){await pause('workflow');terminated.add(id);},
  };}};
  env.COORDINATOR={getByName(){return{
    async release(){await pause('release');},
  };}};
  db.prepare("UPDATE pipeline_operations SET status='failed' WHERE id=?").run(op.id);
  const result=await reconcileOperation(env,op.id);
  assert.equal(result.stoppedAttempts,count);
  assert.equal(result.reconciledRenders,count);
  assert.equal(result.workflows.length,count);
  for(const [kind,state] of Object.entries(rates))
    assert.ok(state.peak<=4,kind+' control RPCs must stay within finite parallelism (observed '+state.peak+')');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts WHERE stopped_at IS NOT NULL').get().n,count);
});

test('unavailable Workflow status does not strand an admitted no-start lease during reconciliation', async t => {
  const {db, env, op, saved} = await fixture(t);
  fakeAdmission(env);
  await createNativeRender(env, op, {renderId:'native-render',revisionId:saved.revisionId,
    mode:'export',rendererRelease:'native-release'});
  const ticket = await requestRenderAdmission(env, 'native-render', op, 'no-start-ticket', 0);
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions WHERE id=?').get(ticket.id).status, 'admitted');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 0);
  db.prepare("INSERT INTO pipeline_workflows(kind,id,operation_id,generation,registered_at,engine) VALUES('render',?,?,?,?,?)")
    .run('native-render',op.id,op.generation,Date.now(),'huashu');
  db.prepare("UPDATE pipeline_operations SET status='failed' WHERE id=?").run(op.id);
  let stops = 0;
  env.RENDER_WORKFLOW = {get() {return {async status() {throw Error('WORKFLOW_STATUS_API_DOWN');}};}};
  env.SHARDS = {getByName(id) {assert.equal(id, ticket.id); return {
    async stopAndSettle() {stops++;}, async isStopped() {return true;},
  };}};
  await assert.rejects(reconcileOperation(env, op.id), /WORKFLOW_STOP_UNCONFIRMED/);
  assert.equal(stops, 1, 'the admitted Shard was stopped despite the Workflow API error');
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions WHERE id=?').get(ticket.id).status, 'released');
});

test('immutable revisions validate bytes and scope parents to the same workspace/project', async t => {
  const {db, env, op, saved, input, objects} = await fixture(t);
  assert.equal((await loadNativeProject(env, op, saved.revisionId)).manifestKey, saved.manifestKey);
  assert.equal((await saveNativeProject(env, op, input)).revisionId, saved.revisionId);
  await assert.rejects(loadNativeProject(env, {...op, workspace_id: 'other-workspace'}, saved.revisionId), /NATIVE_PROJECT_NOT_FOUND/);
  await assert.rejects(saveNativeProject(env, op, {...input, baseRevision: 'f'.repeat(64)}), /NATIVE_PROJECT_NOT_FOUND/);
  await assert.rejects(saveNativeProject(env, op, {...input, files: [{...input.files[0], key: 'operations/other-operation/native/index.html'}]}), /NATIVE_FILE_SCOPE_INVALID/);
  const next = {...op, id: 'patch-operation'};
  db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(next.id, next.workspace_id, next.project_id, 0, 'evaluation', 'active', 'patch-request', 3000000, Date.now(), null, null);
  const changed = await immutableBytes(env, 'evals/native/patched.html', new TextEncoder().encode('<html><body>Patched fixture</body></html>'), 'text/html');
  const patched = await saveNativeProject(env, next, {...input, files: [{...changed, path: 'index.html'}], baseRevision: saved.revisionId});
  assert.notEqual(patched.revisionId, saved.revisionId);
  assert.equal((await loadNativeProject(env, next, saved.revisionId)).manifestKey, saved.manifestKey);
  assert.equal(db.prepare('SELECT parent_revision FROM pipeline_native_projects WHERE operation_id=?').get(next.id).parent_revision, saved.revisionId);
  const empty = await immutableBytes(env, 'evals/native/index.css', new Uint8Array(), 'text/css');
  const withEmpty = await saveNativeProject(env, op, {...input, files: [...input.files, {...empty, path: 'index.css'}]});
  assert.equal(withEmpty.project.files.find(file => file.path === 'index.css').byteLength, 0);
  assert.equal((await checkedNativeBytes(env, empty, 240000, {allowEmpty: true})).byteLength, 0);
  await assert.rejects(checkedNativeBytes(env, empty, 240000), /RENDER_OUTPUT_INVALID/);
  objects.get(empty.key).customMetadata.sha256 = '0'.repeat(64);
  await assert.rejects(checkedNativeBytes(env, empty, 240000, {allowEmpty: true}), /SOURCE_IDENTITY_MISMATCH/);
  objects.get(input.files[0].key).customMetadata.sha256 = '0'.repeat(64);
  await assert.rejects(saveNativeProject(env, op, input), /SOURCE_IDENTITY_MISMATCH/);
});

test('a direct native child cannot silently drop its parent revision rights',async t=>{
  const {db,env,op,input}=await fixture(t);
  const resource={resourceId:'res_parent_asset',sha256:input.files[0].sha256,kind:'image'};
  const parent=await saveNativeProject(env,op,{...input,resources:[resource]});
  const childOp={...op,id:'native-child-operation'};
  db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(childOp.id,childOp.workspace_id,childOp.project_id,0,childOp.purpose,'active','child-request',childOp.max_micros,Date.now(),null,null);
  const child=await saveNativeProject(env,childOp,{...input,resources:[],baseRevision:parent.revisionId});
  assert.deepEqual(child.project.resources,[resource],
    'direct project callers must inherit rights metadata, not only the Director helper');
  await assert.rejects(rights(env,childOp,child.project.resources),/ASSET_RIGHTS_PENDING/,
    'rendering this child without an owner grant must remain fenced');
  await assert.rejects(saveNativeProject(env,childOp,{...input,baseRevision:parent.revisionId,
    resources:[{...resource,kind:'video'}]}),/NATIVE_RESOURCE_CONFLICT/,
  'a child cannot silently reinterpret the inherited license identity');
});

test('a transient preflight D1 read failure resumes a confirmed unstarted render', async t => {
  const {db, env, op, saved, objects} = await fixture(t);
  const waitForEvent = fakeAdmission(env);
  await createNativeRender(env, op, {renderId:'native-render',revisionId:saved.revisionId,
    mode:'preview',rendererRelease:'native-release'});
  const input = parseCanonicalJson(objects.get('renders/native-render/input.json').bytes);
  const originalDB = env.DB;
  let failed = false, executions = 0, queued = 0;
  env.DB = {...originalDB, prepare(sql) {
    const prepared = originalDB.prepare(sql);
    if (!sql.includes('SELECT p.result_json FROM pipeline_attempts p')) return prepared;
    return {bind(...args) {prepared.bind(...args); return this;}, async first() {
      if (!failed) {failed = true; throw Error('Network connection lost.');}
      return prepared.first();
    }};
  }};
  env.SHARDS = {getByName() {return {
    async recoverCompletedResult() {return null;},
    async execute() {executions++; return canonical({status:'succeeded',outputs:[],report:{}});},
    async isStopped() {return true;},
  };}};
  const step = {async do(name, ...args) {if (name === 'native-project-queue') queued++; return args.at(-1)();},
    waitForEvent, async sleepUntil() {assert.fail('an absent physical attempt does not require outcome polling');}};
  const result = await runNativeRenderTask(env, step, {renderId:'native-render',op,input,
    imageDigest:'sha256:'+'a'.repeat(64)});
  assert.equal(result.status, 'succeeded');
  assert.equal(failed, true);
  assert.equal(queued, 1);
  assert.equal(executions, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 1);
});

test('native render admission stores one job/outbox, preserves idempotency, and rejects cancelled generations', async t => {
  const {db, env, op, saved, sent} = await fixture(t);
  const request = {renderId: 'native-render', revisionId: saved.revisionId, mode: 'export', rendererRelease: 'native-release'};
  await createNativeRender(env, op, request);
  await createNativeRender(env, op, request);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_renders').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cost_reservations').get().n, 0);
  assert.equal(sent.length, 1);
  assert.equal(parseCanonicalJson(sent[0].payloadJson).engine, 'huashu');
  const stored = await getNativeRender(env, op, request.renderId);
  assert.equal(stored.status, 'queued');
  await assert.rejects(createNativeRender(env, op, {...request, mode: 'preview'}), /IDEMPOTENCY_CONFLICT/);
  db.prepare('UPDATE pipeline_operations SET status=\'cancelled\',generation=1 WHERE id=?').run(op.id);
  await assert.rejects(createNativeRender(env, op, {...request, renderId: 'cancelled-render'}), /OPERATION_FENCED/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_renders').get().n, 1);
});

test('unknown compute usage prevents a physical retry even after stop is confirmed', async t => {
  const {db, env, op, saved, objects} = await fixture(t);
  const waitForEvent = fakeAdmission(env);
  await createNativeRender(env, op, {renderId: 'native-render', revisionId: saved.revisionId, mode: 'export', rendererRelease: 'native-release'});
  const input = parseCanonicalJson(objects.get('renders/native-render/input.json').bytes);
  const originalDB = env.DB;
  let diagnosticWrites = 0;
  env.DB = {...originalDB, prepare(sql) {
    const prepared = originalDB.prepare(sql);
    if (!sql.includes('UPDATE pipeline_attempts SET recovery_code=')) return prepared;
    return {bind(...args) {prepared.bind(...args); return this;}, async run() {
      diagnosticWrites++;
      throw Error('Network connection lost.');
    }};
  }};
  let executions = 0, stops = 0;
  env.SHARDS = {getByName(id) {return {
    async recoverCompletedResult() {return null;},
    async execute(text) {
      executions++;
      await reserve(env, op, id, 'compute', 'render', 500, parseCanonicalJson(text), 'fixture', 10000000);
      throw Error('Network connection lost.');
    }, async stopAndSettle() {stops++;}, async isStopped() {return true;},
  };}};
  const realNow = Date.now, deadlineAt = realNow() + 100;
  let simulatedNow = realNow();
  const step = {async do(_name, ...args) {return args.at(-1)();}, waitForEvent,
    async sleepUntil(_name, wakeAt) {simulatedNow = wakeAt;},
    async sleep() {assert.fail('an unresolved reservation cannot authorize a retry');}};
  try {
    Date.now = () => Math.max(realNow(), simulatedNow);
    await assert.rejects(runNativeRenderTask(env, step, {renderId: 'native-render', op, input,
      imageDigest: 'sha256:' + 'a'.repeat(64), operationDeadlineAt: deadlineAt}), /RENDER_ATTEMPT_OUTCOME_UNKNOWN/);
  } finally {Date.now = realNow;}
  assert.equal(executions, 1); assert.ok(stops >= 1, 'reconciliation may repeat stop, but never relaunch compute');
  assert.equal(diagnosticWrites, 2);
  assert.equal(db.prepare('SELECT recovery_code FROM pipeline_attempts').get().recovery_code, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n, 0);
  assert.equal(db.prepare('SELECT reserved_micros FROM cost_reservations').get().reserved_micros, 500);
});

for (const scenario of ['released-before-claim', 'lease-expired-during-extend', 'lost-read-after-release', 'lost-no-start-recheck']) {
  test('a grant ' + scenario + ' is recovered without spending a physical retry', async t => {
    const {db, env, op, saved, objects} = await fixture(t);
    const waitForEvent = fakeAdmission(env);
    await createNativeRender(env, op, {renderId: 'native-render', revisionId: saved.revisionId,
      mode: 'preview', rendererRelease: 'native-release'});
    const input = parseCanonicalJson(objects.get('renders/native-render/input.json').bytes);
    const coordinator = env.COORDINATOR.getByName('global-v1');
    const checkpointed = new Map();
    let expired = false, oldToken, resets = 0, executions = 0, readLost = false;
    if (scenario === 'lost-read-after-release') {
      const originalDB = env.DB;
      env.DB = {...originalDB, prepare(sql) {
        const prepared = originalDB.prepare(sql);
        if (!sql.includes('SELECT p.result_json FROM pipeline_attempts p') || !sql.includes("p.status='succeeded'")) return prepared;
        return {bind(...args) {prepared.bind(...args); return this;}, async first() {
          if (expired && !readLost) {readLost = true; throw Error('Network connection lost.');}
          return prepared.first();
        }};
      }};
    }
    if (scenario === 'lost-no-start-recheck') {
      const originalDB = env.DB;
      env.DB = {...originalDB, prepare(sql) {
        const prepared = originalDB.prepare(sql);
        if (!sql.includes('SELECT a.id FROM pipeline_render_admissions a')) return prepared;
        return {bind(...args) {prepared.bind(...args); return this;}, async first() {
          if (expired && !readLost) {readLost = true; throw Error('Network connection lost.');}
          return prepared.first();
        }};
      }};
    }
    if (scenario === 'lease-expired-during-extend') {
      const originalExtend = coordinator.extend.bind(coordinator);
      coordinator.extend = async (...args) => {
        if (!expired) {
          expired = true;
          oldToken = args[1];
          await coordinator.release(args[0], args[1]);
          throw Error('RENDER_LEASE_FENCED');
        }
        return originalExtend(...args);
      };
    }
    env.SHARDS = {getByName(id) {return {
      async isStopped() {return true;}, async stopAndSettle() {},
      async resetUnstartedAdmission(ticketId, token) {
        assert.equal(ticketId, id);
        assert.equal(token, oldToken);
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 0);
        resets++;
      },
      async execute() {executions++; return canonical({status:'succeeded', outputs: [], report: {}});},
    };}};
    const step = {
      async do(name, ...args) {
        if (!checkpointed.has(name)) {
          if (['released-before-claim','lost-read-after-release','lost-no-start-recheck'].includes(scenario) && name === 'native-project' && !expired) {
            const row = db.prepare('SELECT id,lease_token FROM pipeline_render_admissions').get();
            expired = true; oldToken = row.lease_token;
            await coordinator.release(row.id, row.lease_token);
          }
          checkpointed.set(name, await args.at(-1)());
        }
        return checkpointed.get(name);
      },
      waitForEvent,
      async sleep() {assert.fail('an unstarted admission cannot consume a physical retry');},
    };
    const context = {renderId:'native-render', op, input, imageDigest:'sha256:' + 'a'.repeat(64)};
    const result = await runNativeRenderTask(env, step, context);
    assert.equal(result.status, 'succeeded');
    assert.equal(expired, true);
    assert.equal(readLost, ['lost-read-after-release','lost-no-start-recheck'].includes(scenario));
    if (readLost) assert.equal(parseCanonicalJson(checkpointed.get('native-project')).kind, 'render_outcome_pending');
    assert.equal(resets, 1);
    assert.equal(executions, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 1);
    assert.notEqual(db.prepare('SELECT lease_token FROM pipeline_render_admissions').get().lease_token, oldToken);
    assert.ok(checkpointed.has('native-project-grant-retry-1'));
    assert.equal((await runNativeRenderTask(env, step, context)).attemptId, result.attemptId,
      'durable replay must not execute the same paid attempt again');
    assert.equal(executions, 1);
  });
}

test('replay keeps an older no-start recovery decision after a newer grant committed its claim', async t => {
  const {db, env, op, saved, objects} = await fixture(t);
  const waitForEvent = fakeAdmission(env);
  await createNativeRender(env, op, {renderId: 'native-render', revisionId: saved.revisionId,
    mode: 'preview', rendererRelease: 'native-release'});
  const input = parseCanonicalJson(objects.get('renders/native-render/input.json').bytes);
  const originalDB = env.DB, cached = new Map();
  let released = false, readLost = false, interrupted = false, oldToken;
  let resets = 0, executions = 0;
  env.DB = {...originalDB, prepare(sql) {
    const prepared = originalDB.prepare(sql);
    if (!sql.includes('SELECT p.result_json FROM pipeline_attempts p') || !sql.includes("p.status='succeeded'")) return prepared;
    return {bind(...args) {prepared.bind(...args); return this;}, async first() {
      if (released && !readLost) {readLost = true; throw Error('Network connection lost.');}
      return prepared.first();
    }};
  }, async batch(statements) {
    const result = await originalDB.batch(statements);
    if (!interrupted) {
      interrupted = true;
      throw Error('SIMULATED_CLAIM_CHECKPOINT_INTERRUPTION');
    }
    return result;
  }};
  env.SHARDS = {getByName(id) {return {
    async recoverCompletedResult() {return null;},
    async resetUnstartedAdmission(ticketId, token) {
      assert.equal(ticketId, id); assert.equal(token, oldToken); resets++;
    },
    async execute() {
      executions++;
      if (executions === 1) throw Error('RENDER_STARTUP_TIMEOUT');
      return canonical({status: 'succeeded', outputs: [], report: {fixture: 'replayed grant'}});
    },
    async stopAndSettle() {}, async isStopped() {return true;},
  };}};
  const step = {
    async do(name, ...args) {
      if (!cached.has(name)) {
        if (name === 'native-project' && !released) {
          const row = db.prepare('SELECT id,lease_token FROM pipeline_render_admissions').get();
          oldToken = row.lease_token; released = true;
          await env.COORDINATOR.getByName('global-v1').release(row.id, oldToken);
        }
        cached.set(name, await args.at(-1)());
      }
      return cached.get(name);
    },
    waitForEvent,
    async sleep() {},
    async sleepUntil() {assert.fail('a confirmed no-start admission must not poll');},
  };
  const context = {renderId: 'native-render', op, input, imageDigest: 'sha256:' + 'a'.repeat(64)};
  await assert.rejects(runNativeRenderTask(env, step, context), /SIMULATED_CLAIM_CHECKPOINT_INTERRUPTION/);
  assert.equal(readLost, true);
  assert.equal(interrupted, true);
  assert.equal(resets, 1);
  assert.equal(executions, 0, 'the second grant committed its D1 claim but did not invoke Shard');
  assert.equal(parseCanonicalJson(cached.get('native-project')).kind, 'render_outcome_pending');
  assert.equal(cached.get('native-project-outcome-check-0')?.kind, 'render_admission_unstarted');
  assert.equal(db.prepare('SELECT status FROM pipeline_attempts').get().status, 'active');

  const result = await runNativeRenderTask(env, step, context);
  assert.equal(result.status, 'succeeded');
  assert.equal(executions, 2, 'the genuine startup failure may spend the second physical attempt');
  const attempts = db.prepare('SELECT status,result_json FROM pipeline_attempts ORDER BY rowid').all();
  assert.deepEqual(attempts.map(a => a.status), ['failed', 'succeeded']);
  assert.equal(parseCanonicalJson(attempts[0].result_json).code, 'RENDER_STARTUP_TIMEOUT');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 2);
  assert.equal((await runNativeRenderTask(env, step, context)).attemptId, result.attemptId);
  assert.equal(executions, 2, 'further replays must not rerun paid work');
});

test('preflight no-start checkpoint cannot mask a later physical failure recovery', async t => {
  const {db, env, op, saved, objects} = await fixture(t);
  const waitForEvent = fakeAdmission(env);
  await createNativeRender(env, op, {renderId: 'native-render', revisionId: saved.revisionId,
    mode: 'preview', rendererRelease: 'native-release'});
  const input = parseCanonicalJson(objects.get('renders/native-render/input.json').bytes);
  const originalDB = env.DB, cached = new Map();
  let preflightLost = false, settlementLost = false, executions = 0;
  env.DB = {...originalDB, prepare(sql) {
    const prepared = originalDB.prepare(sql);
    const failPreflight = sql.includes('SELECT p.result_json FROM pipeline_attempts p') && sql.includes("p.status='failed'");
    const failSettlement = sql.includes('SELECT a.lease_token,p.result_json,p.recovery_code FROM pipeline_attempts p');
    if (!failPreflight && !failSettlement) return prepared;
    return {bind(...args) {prepared.bind(...args); return this;}, async first() {
      if (failPreflight && !preflightLost) {preflightLost = true; throw Error('Network connection lost.');}
      if (failSettlement && !settlementLost) {settlementLost = true; throw Error('Network connection lost.');}
      return prepared.first();
    }};
  }};
  env.SHARDS = {getByName() {return {
    async recoverCompletedResult() {return null;},
    async execute() {
      executions++;
      if (executions === 1) throw Error('RENDER_STARTUP_TIMEOUT');
      return canonical({status: 'succeeded', outputs: [], report: {}});
    },
    async stopAndSettle() {}, async isStopped() {return true;},
  };}};
  const step = {async do(name, ...args) {
    if (!cached.has(name)) cached.set(name, await args.at(-1)());
    return cached.get(name);
  }, waitForEvent, async sleep() {},
  async sleepUntil() {assert.fail('both recovery decisions should be immediate');}};
  const context = {renderId: 'native-render', op, input, imageDigest: 'sha256:' + 'a'.repeat(64)};
  const result = await runNativeRenderTask(env, step, context);
  assert.equal(result.status, 'succeeded');
  assert.equal(preflightLost, true); assert.equal(settlementLost, true);
  assert.equal(cached.get('native-project-preflight-failure-outcome-check-0')?.kind, 'render_admission_unstarted');
  assert.equal(cached.get('native-project-outcome-check-0')?.kind, 'render_platform_retry');
  assert.equal(executions, 2);
  assert.equal(parseCanonicalJson(db.prepare('SELECT result_json FROM pipeline_attempts ORDER BY rowid LIMIT 1').get().result_json).code,
    'RENDER_STARTUP_TIMEOUT');
});

test('a settled successful render survives interruption before its execution-step checkpoint', async t => {
  const {db, env, op, saved, objects} = await fixture(t);
  const waitForEvent = fakeAdmission(env);
  await createNativeRender(env, op, {renderId: 'native-render', revisionId: saved.revisionId,
    mode: 'preview', rendererRelease: 'native-release'});
  const input = parseCanonicalJson(objects.get('renders/native-render/input.json').bytes);
  const cached = new Map();
  let executions = 0, interrupted = false;
  env.SHARDS = {getByName(id) {return {
    async execute(text) {
      executions++;
      await reserve(env, op, id, 'compute', 'render', 500, parseCanonicalJson(text), 'fixture', 10000000);
      await settle(env, id, 10, {fixture: 'known usage'});
      return canonical({status: 'succeeded', outputs: [], report: {fixture: 'persisted'}});
    }, async isStopped() {return true;},
    async stopAndSettle() {assert.fail('a settled success must not need another stop');},
    async resetUnstartedAdmission() {assert.fail('a paid attempt cannot be reset');},
  };}};
  const step = {
    async do(name, ...args) {
      if (cached.has(name)) return cached.get(name);
      const result = await args.at(-1)();
      if (name === 'native-project' && !interrupted) {
        interrupted = true;
        throw Error('SIMULATED_CHECKPOINT_INTERRUPTION');
      }
      cached.set(name, result);
      return result;
    }, waitForEvent,
    async sleep() {assert.fail('the successful physical attempt must not retry');},
  };
  const context = {renderId: 'native-render', op, input, imageDigest: 'sha256:' + 'a'.repeat(64)};
  await assert.rejects(runNativeRenderTask(env, step, context), /SIMULATED_CHECKPOINT_INTERRUPTION/);
  const physical = db.prepare('SELECT id,status,stopped_at,result_json FROM pipeline_attempts').get();
  assert.equal(physical.status, 'succeeded');
  assert.ok(physical.stopped_at);
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions').get().status, 'released');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n, 1);
  assert.equal(cached.has('native-project'), false);

  const recovered = await runNativeRenderTask(env, step, context);
  assert.equal(recovered.attemptId, physical.id);
  assert.deepEqual(recovered.report, {fixture: 'persisted'});
  assert.equal(executions, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 1);

  // A result cannot be recovered if cost settlement or the stop proof disappears.
  db.prepare('DELETE FROM cost_settlements WHERE reservation_id=?').run(physical.id);
  await assert.rejects(runNativeRenderTask(env, step, context), /RENDER_FENCED/);
  await settle(env, physical.id, 10, {fixture: 'known usage'});
  db.prepare('UPDATE pipeline_attempts SET stopped_at=NULL WHERE id=?').run(physical.id);
  await assert.rejects(runNativeRenderTask(env, step, context), /RENDER_FENCED/);
  assert.equal(executions, 1);
});

test('a concurrent completion after the replay precheck returns its stored result without re-executing', async t => {
  const {db, env, op, saved, objects} = await fixture(t);
  const waitForEvent = fakeAdmission(env);
  await createNativeRender(env, op, {renderId:'native-render',revisionId:saved.revisionId,
    mode:'export',rendererRelease:'native-release'});
  const input = parseCanonicalJson(objects.get('renders/native-render/input.json').bytes);
  const coordinator = env.COORDINATOR.getByName('global-v1');
  let completed = false;
  env.SHARDS = {getByName() {return {
    async execute() {assert.fail('the already-completed compute must never run again');},
    async stopAndSettle() {assert.fail('a settled result requires no new stop');},
  };}};
  const step = {
    async do(name, ...args) {
      if (name === 'native-project' && !completed) {
        const row = db.prepare('SELECT id,lease_token FROM pipeline_render_admissions').get();
        await claimRenderAdmission(env, op, input, row.id, row.lease_token);
        await reserve(env, op, row.id, 'compute', 'render', 500, {taskId: row.id}, 'fixture', 10000000);
        await settle(env, row.id, 10, {fixture: 'known usage'});
        await coordinator.release(row.id, row.lease_token);
        await env.DB.prepare('UPDATE pipeline_attempts SET status=?,stopped_at=?,result_json=? WHERE id=?')
          .bind('succeeded',Date.now(),canonical({status:'succeeded',outputs:[],report:{fixture:'concurrent'}}),row.id).run();
        completed = true;
      }
      return args.at(-1)();
    }, waitForEvent,
  };
  const recovered = await runNativeRenderTask(env, step, {renderId:'native-render',op,input,imageDigest:'sha256:'+'a'.repeat(64)});
  assert.equal(completed, true);
  assert.deepEqual(recovered.report, {fixture:'concurrent'});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 1);
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions').get().status, 'released');
});

test('a lost claim-batch response resumes the same physical attempt', async t => {
  const {db, env, op, saved, objects} = await fixture(t);
  const waitForEvent = fakeAdmission(env);
  await createNativeRender(env, op, {renderId:'native-render',revisionId:saved.revisionId,
    mode:'preview',rendererRelease:'native-release'});
  const input = parseCanonicalJson(objects.get('renders/native-render/input.json').bytes);
  const originalDB = env.DB;
  let lost = false, executions = 0;
  env.DB = {...originalDB, async batch(statements) {
    const value = await originalDB.batch(statements);
    if (!lost) {lost = true; throw Error('Network connection lost.');}
    return value;
  }};
  env.SHARDS = {getByName() {return {
    async execute() {executions++; return canonical({status:'succeeded',outputs:[],report:{}});},
    async isStopped() {return true;},
  };}};
  const step = {async do(_name, ...args) {return args.at(-1)();}, waitForEvent};
  const result = await runNativeRenderTask(env, step, {renderId:'native-render',op,input,imageDigest:'sha256:'+'a'.repeat(64)});
  assert.equal(lost, true);
  assert.equal(result.status, 'succeeded');
  assert.equal(executions, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 1);
});

test('a Shard success with lost RPC is persisted before deciding on a physical retry', async t => {
  const {db, env, op, saved, objects} = await fixture(t);
  const waitForEvent = fakeAdmission(env);
  await createNativeRender(env, op, {renderId:'native-render',revisionId:saved.revisionId,
    mode:'export',rendererRelease:'native-release'});
  const input = parseCanonicalJson(objects.get('renders/native-render/input.json').bytes);
  const coordinator = env.COORDINATOR.getByName('global-v1');
  const savedResult = {status:'succeeded',outputs:[],report:{fixture:'Shard persisted this result'}};
  let executions = 0, recovered = 0;
  env.SHARDS = {getByName(id) {return {
    async execute(text) {
      executions++;
      await reserve(env, op, id, 'compute', 'render', 500, parseCanonicalJson(text), 'fixture', 10000000);
      await settle(env, id, 10, {fixture:'known usage'});
      await coordinator.release(id, parseCanonicalJson(text).leaseToken);
      throw Error('Network connection lost.');
    },
    async recoverCompletedResult(scope) {
      recovered++;
      assert.equal(scope.attemptId, id);
      assert.equal(scope.operationId, op.id);
      assert.equal(scope.generation, op.generation);
      if (recovered <= 2) throw Error('RENDER_ATTEMPT_OUTCOME_UNKNOWN');
      await env.DB.prepare("UPDATE pipeline_attempts SET status='stopped',stopped_at=? WHERE id=?")
        .bind(Date.now(), id).run();
      return canonical(savedResult);
    },
    async isStopped() {return true;},
    async stopAndSettle() {assert.fail('the settled Shard success must not be marked as failed');},
  };}};
  const step = {async do(_name, ...args) {return args.at(-1)();}, waitForEvent, async sleepUntil() {}};
  const result = await runNativeRenderTask(env, step, {renderId:'native-render',op,input,imageDigest:'sha256:'+'a'.repeat(64)});
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.report, savedResult.report);
  assert.equal(recovered, 3, 'a still-pending outcome must remain recoverable across repeated unknown reads');
  assert.equal(executions, 1);
  assert.equal(db.prepare('SELECT status FROM pipeline_attempts').get().status, 'succeeded');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 1);
});

for (const recoveryWriteOutage of [false, true]) {
test('replayed preflight safely recovers a checkpointed transport failure' +
  (recoveryWriteOutage ? ' even when both diagnostic writes fail' : ''), async t => {
  const {db, env, op, saved, objects} = await fixture(t);
  const waitForEvent = fakeAdmission(env);
  await createNativeRender(env, op, {renderId:'native-render',revisionId:saved.revisionId,
    mode:'preview',rendererRelease:'native-release'});
  const input = parseCanonicalJson(objects.get('renders/native-render/input.json').bytes);
  const originalDB = env.DB;
  let diagnosticWrites = 0;
  if (recoveryWriteOutage) env.DB = {...originalDB, prepare(sql) {
    const prepared = originalDB.prepare(sql);
    if (!sql.includes('UPDATE pipeline_attempts SET recovery_code=')) return prepared;
    return {bind(...args) {prepared.bind(...args); return this;}, async run() {
      diagnosticWrites++;
      if (diagnosticWrites <= 2) throw Error('Network connection lost.');
      return prepared.run();
    }};
  }};
  const cached = new Map();
  let executions = 0, recoveries = 0, stops = 0, interrupted = false, waits = 0;
  env.SHARDS = {getByName() {return {
    async execute() {
      if (++executions === 1) throw Error('Network connection lost.');
      return canonical({status:'succeeded',outputs:[],report:{fixture:'second attempt'}});
    },
    async recoverCompletedResult() {
      if (++recoveries <= 4) throw Error('RENDER_RECOVERY_UNAVAILABLE');
      return null;
    },
    async stopAndSettle() {stops++;},
    async isStopped() {return true;},
  };}};
  const step = {
    async do(name, ...args) {
      if (!cached.has(name)) cached.set(name, await args.at(-1)());
      return cached.get(name);
    },
    waitForEvent,
    async sleepUntil() {
      waits++;
      if (!interrupted) {interrupted = true; throw Error('SIMULATED_WORKFLOW_REPLAY');}
    },
    async sleep() {},
  };
  const context = {renderId:'native-render',op,input,imageDigest:'sha256:'+'a'.repeat(64)};
  await assert.rejects(runNativeRenderTask(env, step, context), /SIMULATED_WORKFLOW_REPLAY/);
  const first = db.prepare('SELECT id,status,recovery_code,result_json FROM pipeline_attempts').get();
  assert.equal(first.status, 'active');
  assert.equal(diagnosticWrites, recoveryWriteOutage ? 2 : 0);
  assert.equal(first.recovery_code, recoveryWriteOutage ? null : 'RENDER_RPC_CONNECTION_LOST');
  assert.equal(first.result_json, null, 'Workflow diagnostics never masquerade as authoritative Shard results');
  assert.equal(cached.get('native-project') && parseCanonicalJson(cached.get('native-project')).kind, 'render_outcome_pending');

  const result = await runNativeRenderTask(env, step, context);
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.report, {fixture:'second attempt'});
  assert.equal(executions, 2);
  assert.ok(stops >= 1);
  assert.ok(waits <= 3, 'the recovered failure does not wait until the total operation deadline');
  const attempts = db.prepare('SELECT id,status,result_json FROM pipeline_attempts ORDER BY started_at,id').all();
  assert.equal(attempts.length, 2);
  assert.equal(db.prepare('SELECT status FROM pipeline_attempts WHERE id=?').get(first.id).status, 'failed');
  assert.equal(parseCanonicalJson(db.prepare('SELECT result_json FROM pipeline_attempts WHERE id=?').get(first.id).result_json).code,
    recoveryWriteOutage ? 'RENDER_ATTEMPT_DIAGNOSTIC_MISSING' : 'RENDER_RPC_CONNECTION_LOST');
  assert.equal(db.prepare("SELECT status FROM pipeline_render_admissions WHERE id=?").get(first.id).status, 'released');
  assert.equal((await runNativeRenderTask(env, step, context)).attemptId, result.attemptId);
  assert.equal(executions, 2, 'durable replay cannot execute a settled attempt twice');
});
}

test('a success materialized after the physical deadline and repeated unknown reads remains recoverable', async t => {
  const {db, env, op, saved, objects} = await fixture(t);
  const waitForEvent = fakeAdmission(env);
  await createNativeRender(env, op, {renderId:'native-render',revisionId:saved.revisionId,
    mode:'preview',rendererRelease:'native-release'});
  const input = parseCanonicalJson(objects.get('renders/native-render/input.json').bytes);
  const coordinator = env.COORDINATOR.getByName('global-v1');
  const result = {status:'succeeded',outputs:[],report:{fixture:'late durable success'}};
  let executions = 0, recoveries = 0, stops = 0, waits = 0;
  env.SHARDS = {getByName(id) {return {
    async execute(text) {
      executions++;
      await reserve(env, op, id, 'compute', 'render', 500, parseCanonicalJson(text), 'fixture', 10000000);
      await settle(env, id, 10, {fixture:'confirmed'});
      await coordinator.release(id, parseCanonicalJson(text).leaseToken);
      db.prepare('UPDATE pipeline_render_admissions SET attempt_deadline_at=? WHERE id=?').run(Date.now()-1, id);
      throw Error('Network connection lost.');
    },
    async recoverCompletedResult(scope) {
      assert.equal(scope.attemptId, id);
      if (++recoveries <= 5) throw Error('RENDER_ATTEMPT_OUTCOME_UNKNOWN');
      db.prepare("UPDATE pipeline_attempts SET status='stopped',stopped_at=? WHERE id=?").run(Date.now(), id);
      return canonical(result);
    },
    async stopAndSettle() {stops++;}, async isStopped() {return true;},
  };}};
  const step = {async do(_name, ...args) {return args.at(-1)();}, waitForEvent,
    async sleepUntil() {waits++;}, async sleep() {assert.fail('late success cannot spend a second physical attempt');}};
  const recovered = await runNativeRenderTask(env, step, {renderId:'native-render',op,input,
    imageDigest:'sha256:'+'a'.repeat(64)});
  assert.deepEqual(recovered.report, result.report);
  assert.equal(executions, 1); assert.ok(stops >= 2); assert.ok(waits >= 1);
  assert.equal(db.prepare('SELECT status FROM pipeline_attempts').get().status, 'succeeded');
  assert.equal(db.prepare('SELECT status FROM pipeline_renders').get().status, 'rendering');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 1);
});

test('a hung Shard recovery RPC cannot prevent the operation deadline from being observed', async t => {
  const {db, env, op, saved, objects} = await fixture(t);
  const waitForEvent = fakeAdmission(env);
  await createNativeRender(env, op, {renderId:'native-render',revisionId:saved.revisionId,
    mode:'preview',rendererRelease:'native-release'});
  const input = parseCanonicalJson(objects.get('renders/native-render/input.json').bytes);
  const originalSetTimeout = globalThis.setTimeout, realNow = Date.now;
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) =>
    originalSetTimeout(callback, Math.min(ms, 15), ...args));
  const operationDeadlineAt = realNow() + 100;
  let simulatedNow = realNow(), executions = 0, recoveries = 0, stops = 0;
  env.SHARDS = {getByName(id) {return {
    async execute() {
      executions++;
      db.prepare('UPDATE pipeline_render_admissions SET attempt_deadline_at=? WHERE id=?').run(Date.now()-1, id);
      throw Error('Network connection lost.');
    },
    async recoverCompletedResult() {recoveries++; return new Promise(() => {});},
    async stopAndSettle() {stops++; return new Promise(() => {});},
    async isStopped() {return false;},
  };}};
  const step = {async do(_name, ...args) {return args.at(-1)();}, waitForEvent,
    async sleepUntil(_name, wakeAt) {simulatedNow = wakeAt;},
    async sleep() {assert.fail('an unknown attempt cannot be requeued');}};
  try {
    Date.now = () => Math.max(realNow(), simulatedNow);
    await assert.rejects(runNativeRenderTask(env, step, {renderId:'native-render',op,input,
      imageDigest:'sha256:'+'a'.repeat(64), operationDeadlineAt}), /RENDER_ATTEMPT_OUTCOME_UNKNOWN/);
  } finally {Date.now = realNow;}
  assert.equal(executions, 1);
  assert.ok(recoveries >= 2 && stops >= 1, 'each hanging request is bounded and retried without a duplicate launch');
  assert.equal(db.prepare('SELECT status FROM pipeline_renders').get().status, 'rendering');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 1);
});

test('an acknowledged success write with a lost response is never downgraded to failure', async t => {
  const {db, env, op, saved, objects} = await fixture(t);
  const waitForEvent = fakeAdmission(env);
  await createNativeRender(env, op, {renderId:'native-render',revisionId:saved.revisionId,
    mode:'preview',rendererRelease:'native-release'});
  const input = parseCanonicalJson(objects.get('renders/native-render/input.json').bytes);
  const originalDB = env.DB;
  let lost = false, readLost = false, executions = 0;
  env.DB = {...originalDB, prepare(sql) {
    const prepared = originalDB.prepare(sql);
    if (sql.includes('SELECT p.result_json FROM pipeline_attempts p') && sql.includes("p.status='succeeded'")) {
      return {bind(...args) {prepared.bind(...args); return this;}, async first() {
        if (lost && !readLost) {readLost = true; throw Error('Network connection lost.');}
        return prepared.first();
      }};
    }
    if (!sql.includes("UPDATE pipeline_attempts SET status='succeeded'")) return prepared;
    return {bind(...args) {
      const bound = prepared.bind(...args);
      return {async run() {
        const response = await bound.run();
        if (!lost) {lost = true; throw Error('Network connection lost.');}
        return response;
      }};
    }};
  }};
  env.SHARDS = {getByName() {return {
    async execute() {executions++; return canonical({status:'succeeded',outputs:[],report:{fixture:'first result'}});},
    async isStopped() {return true;},
  };}};
  const step = {async do(_name, ...args) {return args.at(-1)();}, waitForEvent};
  const result = await runNativeRenderTask(env, step, {renderId:'native-render',op,input,imageDigest:'sha256:'+'a'.repeat(64)});
  const row = db.prepare('SELECT status,result_json FROM pipeline_attempts').get();
  assert.equal(lost, true);
  assert.equal(readLost, true, 'a transient confirmation read failure is also recoverable');
  assert.equal(row.status, 'succeeded');
  assert.equal(parseCanonicalJson(row.result_json).status, 'succeeded');
  assert.deepEqual(result.report, {fixture:'first result'});
  assert.equal(executions, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 1);
});

test('claim-time recovery never re-admits a ticket with an existing physical attempt', async t => {
  const {db, env, op, saved, objects} = await fixture(t);
  fakeAdmission(env);
  await createNativeRender(env, op, {renderId:'native-render',revisionId:saved.revisionId,
    mode:'export',rendererRelease:'native-release'});
  const input = parseCanonicalJson(objects.get('renders/native-render/input.json').bytes);
  const coordinator = env.COORDINATOR.getByName('global-v1');
  let claimed = false;
  env.SHARDS = {getByName() {return {
    async recoverCompletedResult() {return null;},
    async isStopped() {return true;},
    async execute() {assert.fail('physical execution must not be launched again');},
    async resetUnstartedAdmission() {assert.fail('a physical attempt cannot be reset');},
  };}};
  const step = {
    async do(name, ...args) {
      if (name === 'native-project' && !claimed) {
        const row = db.prepare('SELECT id,lease_token FROM pipeline_render_admissions').get();
        await claimRenderAdmission(env, op, input, row.id, row.lease_token);
        await coordinator.release(row.id, row.lease_token);
        claimed = true;
      }
      return args.at(-1)();
    },
    async waitForEvent() {assert.fail('a physically claimed ticket must not wait for another grant');},
  };
  await assert.rejects(runNativeRenderTask(env, step, {renderId:'native-render',op,input,imageDigest:'sha256:'+'a'.repeat(64)}),
    /RENDER_FENCED/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 1);
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions').get().status, 'released');
});

test('a settled platform failure retries with a new attempt; durable replay cannot repeat it', async t => {
  const {db, env, op, saved, objects} = await fixture(t);
  const waitForEvent = fakeAdmission(env);
  await createNativeRender(env, op, {renderId: 'native-render', revisionId: saved.revisionId, mode: 'export', rendererRelease: 'native-release'});
  const input = parseCanonicalJson(objects.get('renders/native-render/input.json').bytes);
  const reservations = new Map(), cached = new Map(); let executions = 0;
  env.SHARDS = {getByName(id) {return {
    async recoverCompletedResult() {return null;},
    async execute(text) {
      executions++; await reserve(env, op, id, 'compute', 'render', 500, parseCanonicalJson(text), 'fixture', 10000000, op.max_micros);
      reservations.set(id, executions);
      if (executions === 1) throw Error('RENDER_STARTUP_TIMEOUT');
      await settle(env, id, 10, {fixture: 'known usage'});
      return canonical({status: 'succeeded', outputs: [], report: {}});
    }, async stopAndSettle() {if (reservations.has(id)) await settle(env, id, 10, {fixture: 'known usage'});},
    async isStopped() {return true;},
  };}};
  const step = {async do(name, ...args) {if (!cached.has(name)) cached.set(name, await args.at(-1)()); return cached.get(name);}, waitForEvent, async sleep() {}};
  const context = {renderId: 'native-render', op, input, imageDigest: 'sha256:' + 'a'.repeat(64)};
  const result = await runNativeRenderTask(env, step, context);
  assert.equal(result.status, 'succeeded'); assert.equal(executions, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 2);
  assert.deepEqual((await runNativeRenderTask(env, step, context)).attemptId, result.attemptId);
  assert.equal(executions, 2);
  db.prepare("UPDATE pipeline_renders SET status='verifying' WHERE id='native-render'").run();
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 16 * 60_000;
    assert.equal((await runNativeRenderTask(env, step, context)).attemptId, result.attemptId,
      'late replay in verification must recover the second attempt past the first queue deadline');
  } finally {Date.now = realNow;}
  assert.equal(executions, 2);
});

for (const changedResponse of ['committed', 'zero-change']) {
  test('failure confirmation read outage after a ' + changedResponse + ' update resumes the physical retry', async t => {
    const {db, env, op, saved, objects} = await fixture(t);
    const waitForEvent = fakeAdmission(env);
    await createNativeRender(env, op, {renderId:'native-render',revisionId:saved.revisionId,
      mode:'preview',rendererRelease:'native-release'});
    const input = parseCanonicalJson(objects.get('renders/native-render/input.json').bytes);
    const originalDB = env.DB;
    let readLost = false, zeroed = false, executions = 0, stops = 0;
    env.DB = {...originalDB, prepare(sql) {
      const prepared = originalDB.prepare(sql);
      if (sql.includes('SELECT p.result_json FROM pipeline_attempts p') && sql.includes("p.status='failed'")) {
        return {bind(...args) {prepared.bind(...args); return this;}, async first() {
          if (!readLost && db.prepare("SELECT COUNT(*) AS n FROM pipeline_attempts WHERE status='failed'").get().n) {
            readLost = true;
            throw Error('Network connection lost.');
          }
          return prepared.first();
        }};
      }
      if (changedResponse === 'zero-change' && sql.includes("UPDATE pipeline_attempts SET\n      status='failed'")) {
        return {bind(...args) {prepared.bind(...args); return this;}, async run() {
          const response = await prepared.run();
          if (!zeroed) {zeroed = true; return {meta:{changes:0}};}
          return response;
        }};
      }
      return prepared;
    }};
    env.SHARDS = {getByName() {return {
      async recoverCompletedResult() {return null;},
      async execute() {
        if (++executions === 1) throw Error('RENDER_STARTUP_TIMEOUT');
        return canonical({status:'succeeded',outputs:[],report:{fixture:'recovered retry'}});
      },
      async stopAndSettle() {stops++;},
      async isStopped() {return true;},
    };}};
    const step = {async do(_name, ...args) {return args.at(-1)();}, waitForEvent, async sleep() {}};
    const result = await runNativeRenderTask(env, step, {renderId:'native-render',op,input,
      imageDigest:'sha256:'+'a'.repeat(64)});
    assert.equal(result.status, 'succeeded');
    assert.equal(readLost, true);
    assert.equal(zeroed, changedResponse === 'zero-change');
    assert.equal(executions, 2);
    assert.ok(stops >= 1);
    const rows = db.prepare('SELECT status,result_json FROM pipeline_attempts ORDER BY started_at,id').all();
    assert.equal(rows.length, 2);
    assert.ok(rows.some(row => row.status === 'failed' && parseCanonicalJson(row.result_json).code === 'RENDER_STARTUP_TIMEOUT'));
    assert.ok(rows.some(row => row.status === 'succeeded'));
  });
}

test('a lost platform-retry checkpoint requeues the confirmed failed attempt on Workflow replay', async t => {
  const {db, env, op, saved, objects} = await fixture(t);
  const waitForEvent = fakeAdmission(env);
  await createNativeRender(env, op, {renderId:'native-render',revisionId:saved.revisionId,
    mode:'preview',rendererRelease:'native-release'});
  const input = parseCanonicalJson(objects.get('renders/native-render/input.json').bytes);
  const cached = new Map(), reservations = new Set();
  let executions = 0, interrupted = false;
  env.SHARDS = {getByName(id) {return {
    async recoverCompletedResult() {return null;},
    async execute(text) {
      executions++;
      await reserve(env, op, id, 'compute', 'render', 500, parseCanonicalJson(text), 'fixture', 10000000, op.max_micros);
      reservations.add(id);
      if (executions === 1) throw Error('RENDER_STARTUP_TIMEOUT');
      await settle(env, id, 10, {fixture:'confirmed'});
      return canonical({status:'succeeded',outputs:[],report:{fixture:'retry'}});
    },
    async stopAndSettle() {if (reservations.has(id)) await settle(env, id, 10, {fixture:'confirmed'});},
    async isStopped() {return true;},
  };}};
  const step = {
    async do(name, ...args) {
      if (cached.has(name)) return cached.get(name);
      const result = await args.at(-1)();
      if (name === 'native-project' && !interrupted) {
        interrupted = true;
        throw Error('SIMULATED_RETRY_CHECKPOINT_LOSS');
      }
      cached.set(name, result);
      return result;
    },
    waitForEvent, async sleep() {},
  };
  const context = {renderId:'native-render',op,input,imageDigest:'sha256:'+'a'.repeat(64)};
  await assert.rejects(runNativeRenderTask(env, step, context), /SIMULATED_RETRY_CHECKPOINT_LOSS/);
  const failed = db.prepare('SELECT id,status,stopped_at,result_json FROM pipeline_attempts').get();
  assert.equal(failed.status, 'failed');
  assert.ok(failed.stopped_at);
  assert.equal(parseCanonicalJson(failed.result_json).code, 'RENDER_STARTUP_TIMEOUT');
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions').get().status, 'released');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n, 1);
  assert.equal(cached.has('native-project'), false);
  const result = await runNativeRenderTask(env, step, context);
  assert.equal(result.status, 'succeeded');
  assert.equal(executions, 2, 'the first physical attempt is never executed again');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 2);
  assert.equal(db.prepare('SELECT status FROM pipeline_renders').get().status, 'rendering');
});

test('terminal media commit and notification are atomic and replayable; cancellation fences publication', async t => {
  const {db, env, op, saved} = await fixture(t);
  await createNativeRender(env, op, {renderId: 'native-render', revisionId: saved.revisionId, mode: 'export', rendererRelease: 'native-release'});
  const result = canonical({kind: 'native_render_result', status: 'passed', outputs: [], attemptId: 'successful-attempt'});
  db.prepare("UPDATE pipeline_renders SET status='verifying' WHERE id='native-render'").run();
  await assert.rejects(commitRender(env, 'native-render', op, result), /OPERATION_FENCED/, 'unverified physical attempts cannot publish results');
  db.prepare('INSERT INTO pipeline_attempts(id,render_id,operation_id,generation,mode,instance,status,started_at,stopped_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('successful-attempt','native-render',op.id,0,'native_export','standard-3','succeeded',Date.now()-1000,Date.now());
  db.prepare('INSERT INTO pipeline_render_admissions(id,render_id,operation_id,generation,workspace_id,attempt_index,status,requested_at,queue_deadline_at,lease_token,admitted_at,attempt_deadline_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('successful-attempt','native-render',op.id,0,op.workspace_id,0,'released',Date.now()-2000,Date.now()+60000,'11111111-1111-4111-8111-111111111111',Date.now()-1000,Date.now()+60000);
  await commitRender(env, 'native-render', op, result);
  await commitRender(env, 'native-render', op, result);
  assert.equal(db.prepare('SELECT status,result_json FROM pipeline_renders').get().result_json, result);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_outbox WHERE kind=\'render_progress\'').get().n, 1);
  await assert.rejects(commitRender(env, 'native-render', op, canonical({attemptId: 'successful-attempt',different: true})), /RENDER_COMMIT_CONFLICT/);
  await createNativeRender(env, op, {renderId: 'second-render', revisionId: saved.revisionId, mode: 'export', rendererRelease: 'native-release'});
  db.prepare('UPDATE pipeline_operations SET status=\'cancelled\',generation=1 WHERE id=?').run(op.id);
  await assert.rejects(commitRender(env, 'second-render', op, result), /OPERATION_FENCED/);
  let delivered = false;
  env.OPERATIONS = {getByName() {return {async progress() {delivered = true;}};}};
  await dispatchRenderProgress(env, {operationId: op.id, payloadJson: canonical({operationId: op.id, generation: 0, renderId: 'native-render'})});
  assert.equal(delivered, false);
});

test('native publication atomically fences missing and revoked source rights, preserving completed commits',async t=>{
  const {db,env,op,input}=await fixture(t);
  const resource={resourceId:'res_rights',sha256:input.files[0].sha256,kind:'image'};
  const saved=await saveNativeProject(env,op,{...input,resources:[resource]});
  await createNativeRender(env,op,{renderId:'rights-render',revisionId:saved.revisionId,mode:'preview',rendererRelease:'native-release'});
  db.prepare("UPDATE pipeline_renders SET status='verifying' WHERE id='rights-render'").run();
  const result=canonical({kind:'native_render_result',status:'passed',outputs:[],attemptId:'rights-attempt'});
  db.prepare('INSERT INTO pipeline_attempts(id,render_id,operation_id,generation,mode,instance,status,started_at,stopped_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('rights-attempt','rights-render',op.id,op.generation,'native_preview','standard-3','succeeded',Date.now()-1000,Date.now());
  db.prepare('INSERT INTO pipeline_render_admissions(id,render_id,operation_id,generation,workspace_id,attempt_index,status,requested_at,queue_deadline_at,lease_token,admitted_at,attempt_deadline_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('rights-attempt','rights-render',op.id,op.generation,op.workspace_id,0,'released',Date.now()-2000,Date.now()+60000,'22222222-2222-4222-8222-222222222222',Date.now()-1000,Date.now()+60000);
  await assert.rejects(commitRender(env,'rights-render',op,result,[resource]),/ASSET_RIGHTS_PENDING/,'missing evidence must block a verified film');
  const evidence=await immutableBytes(env,'evals/native/rights.json',new TextEncoder().encode('{}'),'application/json');
  db.prepare('INSERT INTO pipeline_rights(operation_id,resource_id,sha256,license_ref,evidence_key,scope) VALUES(?,?,?,?,?,?)')
    .run(op.id,resource.resourceId,resource.sha256,'fixture-license',evidence.key,'internal_eval_only');
  db.prepare('UPDATE pipeline_rights SET revoked_at=? WHERE operation_id=?').run(Date.now(),op.id);
  await assert.rejects(commitRender(env,'rights-render',op,result,[resource]),/ASSET_RIGHTS_PENDING/,'revoke/commit races must be fenced inside D1');
  assert.equal(db.prepare("SELECT status FROM pipeline_renders WHERE id='rights-render'").get().status,'verifying');
  db.prepare('UPDATE pipeline_rights SET revoked_at=NULL WHERE operation_id=?').run(op.id);
  await commitRender(env,'rights-render',op,result,[resource]);
  assert.equal(db.prepare("SELECT status FROM pipeline_renders WHERE id='rights-render'").get().status,'passed');
  db.prepare('UPDATE pipeline_rights SET revoked_at=? WHERE operation_id=?').run(Date.now(),op.id);
  await commitRender(env,'rights-render',op,result,[resource]);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM pipeline_outbox WHERE kind='render_progress'").get().count,1);
});

test('Director candidate commit atomically fences source revocation and keeps earlier success immutable',async t=>{
  const {db,env,op,input}=await fixture(t);
  const resource={resourceId:'res_candidate',sha256:input.files[0].sha256,kind:'image'};
  const key=`operations/${op.id}/candidate.json`;
  await assert.rejects(commitCandidate(env,op,key,[resource]),/ASSET_RIGHTS_PENDING/);
  const evidence=await immutableBytes(env,'evals/native/candidate-rights.json',new TextEncoder().encode('{}'),'application/json');
  db.prepare('INSERT INTO pipeline_rights(operation_id,resource_id,sha256,license_ref,evidence_key,scope) VALUES(?,?,?,?,?,?)')
    .run(op.id,resource.resourceId,resource.sha256,'fixture-license',evidence.key,'internal_eval_only');
  // The initial rights() read passed, then the owner revoked before the D1 transaction.
  const batch=env.DB.batch.bind(env.DB);
  env.DB.batch=async statements=>{
    db.prepare('UPDATE pipeline_rights SET revoked_at=? WHERE operation_id=?').run(Date.now(),op.id);
    return batch(statements);
  };
  await assert.rejects(commitCandidate(env,op,key,[resource]),/ASSET_RIGHTS_PENDING/);
  assert.equal(db.prepare('SELECT status FROM pipeline_operations WHERE id=?').get(op.id).status,'active');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pipeline_outbox WHERE kind='operation_progress'").get().n,0);
  env.DB.batch=batch;
  db.prepare('UPDATE pipeline_rights SET revoked_at=NULL WHERE operation_id=?').run(op.id);
  await commitCandidate(env,op,key,[resource]);
  const committed=db.prepare('SELECT status,result_key FROM pipeline_operations WHERE id=?').get(op.id);
  assert.equal(committed.status,'succeeded');assert.equal(committed.result_key,key);
  db.prepare('UPDATE pipeline_rights SET revoked_at=? WHERE operation_id=?').run(Date.now(),op.id);
  await commitCandidate(env,op,key,[resource]); // A later revoke cannot rewrite or un-commit a completed candidate.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pipeline_outbox WHERE kind='operation_progress'").get().n,1);
});

test('Director completion events recover after Queue acknowledgement and exhausted delivery retries', async t => {
  const {db, env, op, saved} = await fixture(t);
  await createNativeRender(env, op, {renderId: 'native-render', revisionId: saved.revisionId, mode: 'export', rendererRelease: 'native-release'});
  await createNativeRender(env, op, {renderId: 'blocked-render', revisionId: saved.revisionId, mode: 'preview', rendererRelease: 'native-release'});
  db.prepare("UPDATE pipeline_renders SET status='passed' WHERE id='native-render'").run();
  db.prepare("UPDATE pipeline_renders SET status='blocked' WHERE id='blocked-render'").run();
  db.prepare("INSERT INTO pipeline_workflows(kind,id,operation_id,generation,registered_at,engine) VALUES('operation',?,?,?,?,?)")
    .run(op.id, op.id, 0, Date.now(), 'huashu');
  const entries = [
    {id: 'progress-native-render', kind: 'render_progress', status: 'passed', renderId: 'native-render'},
    {id: 'render-terminal-blocked-render', kind: 'render_terminal', status: 'blocked', renderId: 'blocked-render'},
  ];
  for (const entry of entries) {
    db.prepare('INSERT INTO pipeline_outbox(id,operation_id,kind,payload_json) VALUES(?,?,?,?)')
      .run(entry.id, op.id, entry.kind, canonical({operationId: op.id, generation: 0, renderId: entry.renderId, status: entry.status}));
    await flushOutbox(env, entry.id);
    assert.ok(db.prepare('SELECT delivered_at FROM pipeline_outbox WHERE id=?').get(entry.id).delivered_at,
      'Queue enqueue is tracked separately from Director event delivery');
  }
  const received = [], failures = new Set(entries.map(entry => entry.renderId));
  env.OPERATION_WORKFLOW = {get() {return {
    async sendEvent(event) {
      if (failures.delete(event.payload.renderId)) throw Error('EVENT_API_TEMPORARILY_UNAVAILABLE');
      received.push(event);
    }, async status() {return {status: 'running'};},
  };}};
  env.OPERATIONS = {getByName() {return {async progress() {}};}};
  for (const entry of entries) {
    const item = {id: entry.id, kind: entry.kind, operationId: op.id,
      payloadJson: db.prepare('SELECT payload_json FROM pipeline_outbox WHERE id=?').get(entry.id).payload_json};
    await assert.rejects(deliverDirectorEvent(env, item), /EVENT_API_TEMPORARILY_UNAVAILABLE/);
    assert.equal(db.prepare('SELECT director_event_done_at FROM pipeline_outbox WHERE id=?').get(entry.id).director_event_done_at, null);
  }
  assert.equal(received.length, 0);
  // Simulate a later scheduled sweep; Queue itself never redelivers these messages.
  db.prepare("UPDATE pipeline_outbox SET director_event_retry_at=0 WHERE kind IN ('render_progress','render_terminal')").run();
  await recoverDirectorEvents(env);
  assert.equal(received.length, 2);
  assert.deepEqual(received.map(event => event.payload.status).sort(), ['blocked', 'passed']);
  for (const entry of entries) assert.ok(db.prepare('SELECT director_event_done_at FROM pipeline_outbox WHERE id=?').get(entry.id).director_event_done_at);
  await recoverDirectorEvents(env);
  assert.equal(received.length, 2, 'acknowledged events are not replayed by later sweeps');
});

test('a hung SSE progress RPC cannot stall Director hints or durable render events', async t => {
  const {db,env,op,saved} = await fixture(t);
  await createNativeRender(env,op,{renderId:'native-render',revisionId:saved.revisionId,
    mode:'preview',rendererRelease:'native-release'});
  db.prepare("UPDATE pipeline_renders SET status='passed' WHERE id='native-render'").run();
  db.prepare("INSERT INTO pipeline_workflows(kind,id,operation_id,generation,registered_at,engine) VALUES('operation',?,?,?,?,?)")
    .run(op.id,op.id,op.generation,Date.now(),'huashu');
  const payload=canonical({operationId:op.id,generation:op.generation,renderId:'native-render',status:'passed'});
  db.prepare("INSERT INTO pipeline_outbox(id,operation_id,kind,payload_json) VALUES(?,?,?,?)")
    .run('progress-native-render',op.id,'render_progress',payload);
  let progressCalls=0;
  env.OPERATIONS={getByName(){return {async progress(){progressCalls++;return new Promise(()=>{});}};}};
  const notices=[];
  env.OPERATION_WORKFLOW={get(){return {async sendEvent(event){notices.push(event);}};}};
  const originalSetTimeout=globalThis.setTimeout;
  t.mock.method(globalThis,'setTimeout',(callback,ms,...args)=>
    originalSetTimeout(callback,Math.min(ms,12),...args));
  await directorProgress(env,op,'previewing');
  const outboxItem={id:'progress-native-render',kind:'render_progress',operationId:op.id,payloadJson:payload};
  await deliverDirectorEvent(env,outboxItem);
  await deliverDirectorEvent(env,outboxItem);
  assert.equal(progressCalls,2);
  assert.equal(notices.length,1,'best-effort SSE cannot cause another delivery of an acknowledged Director event');
  assert.ok(db.prepare('SELECT director_event_done_at FROM pipeline_outbox WHERE id=?').get(outboxItem.id).director_event_done_at);

  db.prepare("UPDATE pipeline_operations SET status='succeeded' WHERE id=?").run(op.id);
  await assert.rejects(dispatchDirectorProgress(env,{operationId:op.id,payloadJson:canonical({operationId:op.id,generation:op.generation,status:'succeeded'})}),
    /CONTROL_RPC_TIMEOUT/);
});

test('concurrent user choices commit one winner and recover its durable Director event after an API outage', async t => {
  const {db,env,op} = await fixture(t);
  const directionsHash = 'd'.repeat(64);
  db.prepare("UPDATE pipeline_operations SET status='awaiting_user' WHERE id=?").run(op.id);
  db.prepare("INSERT INTO pipeline_contexts(operation_id,request_key,engine,directions_hash) VALUES(?,?,'huashu',?)")
    .run(op.id,'evals/fixture/context.json',directionsHash);
  db.prepare("INSERT INTO pipeline_workflows(kind,id,operation_id,generation,registered_at,engine) VALUES('operation',?,?,?,?,?)")
    .run(op.id,op.id,op.generation,Date.now(),'huashu');
  const choices = [{key:'fit',directionsHash},{key:'unexpected',directionsHash}];
  const results = await Promise.allSettled(choices.map(choice => chooseDirection(env,op,choice)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length,1);
  assert.match(results.find(result => result.status === 'rejected').reason.message,/IDEMPOTENCY_CONFLICT/);
  const winning = choices[results.findIndex(result => result.status === 'fulfilled')];
  const saved = db.prepare('SELECT choice,choice_hash FROM pipeline_contexts WHERE operation_id=?').get(op.id);
  assert.equal(saved.choice,winning.key);
  assert.equal(saved.choice_hash,digest(winning));
  const outbox = db.prepare("SELECT * FROM pipeline_outbox WHERE kind='direction_choice'").all();
  assert.equal(outbox.length,1,'a losing CAS cannot enqueue a conflicting event');
  assert.equal(parseCanonicalJson(outbox[0].payload_json).key,winning.key);
  await chooseDirection(env,op,winning);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pipeline_outbox WHERE kind='direction_choice'").get().n,1);
  const delivered=[];
  let fail = true;
  env.OPERATION_WORKFLOW={get(id){assert.equal(id,op.id);return {
    async sendEvent(event){if(fail){fail=false;throw Error('CHOICE_EVENT_UNAVAILABLE');}delivered.push(event);},
    async status(){return {status:'running'};},
  };}};
  await flushOutbox(env,outbox[0].id);
  await assert.rejects(deliverDirectorEvent(env,{id:outbox[0].id,kind:outbox[0].kind,operationId:op.id,payloadJson:outbox[0].payload_json}),/CHOICE_EVENT_UNAVAILABLE/);
  assert.equal(db.prepare('SELECT director_event_done_at FROM pipeline_outbox WHERE id=?').get(outbox[0].id).director_event_done_at,null);
  db.prepare('UPDATE pipeline_outbox SET director_event_retry_at=0 WHERE id=?').run(outbox[0].id);
  await recoverDirectorEvents(env);
  assert.deepEqual(delivered,[{type:'direction-choice',payload:winning}]);
  assert.ok(db.prepare('SELECT director_event_done_at FROM pipeline_outbox WHERE id=?').get(outbox[0].id).director_event_done_at);
  db.prepare('UPDATE pipeline_operations SET status=\'cancelled\',generation=1 WHERE id=?').run(op.id);
  db.prepare('UPDATE pipeline_outbox SET director_event_done_at=NULL,director_event_retry_at=0 WHERE id=?').run(outbox[0].id);
  await recoverDirectorEvents(env);
  assert.equal(delivered.length,1,'a cancelled generation cannot be reawakened by a delayed event');
});

test('Director event recovery continues past one stalled event without losing either result', async t => {
  const {db,env,op,saved}=await fixture(t);
  for(const renderId of ['stalled-render','ready-render']){
    await createNativeRender(env,op,{renderId,revisionId:saved.revisionId,mode:'preview',rendererRelease:'native-release'});
    db.prepare("UPDATE pipeline_renders SET status='passed' WHERE id=?").run(renderId);
    db.prepare('INSERT INTO pipeline_outbox(id,operation_id,kind,payload_json) VALUES(?,?,?,?)')
      .run('progress-'+renderId,op.id,'render_progress',canonical({operationId:op.id,generation:0,renderId,status:'passed'}));
  }
  db.prepare("INSERT INTO pipeline_workflows(kind,id,operation_id,generation,registered_at,engine) VALUES('operation',?,?,?,?,?)")
    .run(op.id,op.id,0,Date.now(),'huashu');
  env.OPERATIONS={getByName(){return {async progress(){}};}};
  const received=[];
  let resume;
  const blocked=new Promise(resolve=>{resume=resolve;});
  env.OPERATION_WORKFLOW={get(){return {async sendEvent(event){
    if(event.payload.renderId==='stalled-render')await blocked;
    received.push(event.payload.renderId);
  }};}};
  const sweep=recoverDirectorEvents(env);
  try{
    for(let i=0;i<30&&!received.includes('ready-render');i++)await new Promise(resolve=>setImmediate(resolve));
    assert.ok(received.includes('ready-render'),'the second event is delivered while the first RPC is blocked');
  }finally{resume();}
  await sweep;
  assert.deepEqual(received.sort(),['ready-render','stalled-render']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pipeline_outbox WHERE kind='render_progress' AND director_event_done_at IS NOT NULL").get().n,2);
});

test('timed-out Director get calls persist backoff instead of starving later outbox events', async t => {
  const {db,env,op}=await fixture(t);
  for(let index=0;index<65;index++){
    const renderId='stalled-'+index;
    db.prepare("INSERT INTO pipeline_renders(id,operation_id,generation,request_hash,job_key,status,created_at) VALUES(?,?,?,?,?,'passed',?)")
      .run(renderId,op.id,op.generation,renderId,'renders/'+renderId+'/input.json',Date.now());
    db.prepare('INSERT INTO pipeline_outbox(id,operation_id,kind,payload_json) VALUES(?,?,?,?)')
      .run('progress-'+renderId,op.id,'render_progress',canonical({operationId:op.id,generation:op.generation,renderId,status:'passed'}));
  }
  db.prepare("INSERT INTO pipeline_workflows(kind,id,operation_id,generation,registered_at,engine) VALUES('operation',?,?,?,?,?)")
    .run(op.id,op.id,op.generation,Date.now(),'huashu');
  const received=[];
  env.OPERATIONS={getByName(){return {async progress(){}};}};
  env.OPERATION_WORKFLOW={get(id){assert.equal(id,op.id);
    // First sweep encounters 64 hung gets; the next has one healthy row.
    const backedOff=db.prepare('SELECT COUNT(*) AS n FROM pipeline_outbox WHERE director_event_retry_at>0').get().n;
    if(backedOff<64)return new Promise(()=>{});
    return {async sendEvent(event){received.push(event.payload.renderId);}};
  }};
  const originalSetTimeout=globalThis.setTimeout;
  t.mock.method(globalThis,'setTimeout',(callback,ms,...args)=>originalSetTimeout(callback,Math.min(ms,10),...args));
  await recoverDirectorEvents(env);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_outbox WHERE director_event_retry_at>?').get(Date.now()).n,64);
  await recoverDirectorEvents(env);
  assert.deepEqual(received,['stalled-64']);
  assert.ok(db.prepare("SELECT director_event_done_at FROM pipeline_outbox WHERE id='progress-stalled-64'").get().director_event_done_at);
});

test('Workflow recovery inspects healthy rows despite a stalled status API', async t => {
  const {db,env,op}=await fixture(t);
  for(const id of ['stalled-workflow','ready-workflow'])db.prepare("INSERT INTO pipeline_workflows(kind,id,operation_id,generation,registered_at,engine) VALUES('render',?,?,?,?,?)")
    .run(id,op.id,op.generation,Date.now(),'huashu');
  let resume;
  const blocked=new Promise(resolve=>{resume=resolve;});
  const inspected=[];
  env.RENDER_WORKFLOW={get(id){return {async status(){
    if(id==='stalled-workflow')await blocked;
    inspected.push(id);
    return {status:'running'};
  }};}};
  const sweep=recoverWorkflows(env);
  try{
    for(let i=0;i<30&&!inspected.includes('ready-workflow');i++)await new Promise(resolve=>setImmediate(resolve));
    assert.ok(inspected.includes('ready-workflow'),'a later workflow does not wait for an earlier stalled Workflow API');
  }finally{resume();}
  assert.deepEqual((await sweep).map(row=>row.status),['inspected','inspected']);
});

test('outbox sends in bounded parallelism and retries a failed row without skipping healthy rows', async t => {
  const {db,env,op}=await fixture(t);
  for(const id of ['stalled','healthy','failed'])db.prepare('INSERT INTO pipeline_outbox(id,operation_id,kind,payload_json) VALUES(?,?,?,?)')
    .run(id,op.id,'creative',canonical({id}));
  let resume;
  const blocked=new Promise(resolve=>{resume=resolve;});
  const sent=[];
  env.OUTBOX={async send(item){
    if(item.id==='stalled')await blocked;
    if(item.id==='failed')throw Error('QUEUE_API_DOWN');
    sent.push(item.id);
  }};
  const flush=flushOutbox(env);
  try{
    for(let i=0;i<30&&!sent.includes('healthy');i++)await new Promise(resolve=>setImmediate(resolve));
    assert.ok(sent.includes('healthy'),'a blocked send cannot prevent delivery of an independent event');
  }finally{resume();}
  await assert.rejects(flush,/OUTBOX_DELIVERY_UNCONFIRMED/);
  assert.deepEqual(sent.sort(),['healthy','stalled']);
  assert.equal(db.prepare("SELECT delivered_at FROM pipeline_outbox WHERE id='failed'").get().delivered_at,null);
  assert.ok(db.prepare("SELECT delivered_at FROM pipeline_outbox WHERE id='healthy'").get().delivered_at);
});

test('Queue batches ACK healthy messages while other handlers hang or fail, and time out an isolated RPC', async () => {
  const results=[];
  const messages=['stalled','healthy','failed'].map(kind=>({body:{kind},ack(){results.push(kind+':ack');},retry(){results.push(kind+':retry');}}));
  let resume;
  const blocked=new Promise(resolve=>{resume=resolve;});
  const processing=processQueueMessages(messages,async message=>{
    if(message.body.kind==='stalled')await blocked;
    if(message.body.kind==='failed')throw Error('QUEUE_HANDLER_DOWN');
  });
  try{
    for(let i=0;i<30&&!results.includes('healthy:ack');i++)await new Promise(resolve=>setImmediate(resolve));
    assert.ok(results.includes('healthy:ack'));
    assert.ok(results.includes('failed:retry'));
  }finally{resume();}
  await processing;
  assert.ok(results.includes('stalled:ack'));
  await assert.rejects(boundedControl(new Promise(()=>{}),5),/CONTROL_RPC_TIMEOUT/);
  const expired={ack(){assert.fail('an unconfirmed message must not be ACKed');},retry(){results.push('expired:retry');}};
  await processQueueMessages([expired],async()=>new Promise(()=>{}),5);
  assert.ok(results.includes('expired:retry'));
});

test('simultaneous cost reservations are idempotent only for the same full cost identity', async t => {
  const {db,env,op}=await fixture(t);
  const task={operationId:op.id,model:'fixture',stage:'facts'};
  const reserveSame=()=>reserve(env,op,'reservation-race','model','facts',300,task,'fixture-catalog',100_000);
  await Promise.all([reserveSame(),reserveSame(),reserveSame()]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cost_reservations WHERE id=?').get('reservation-race').n,1);
  await reserveSame();
  await assert.rejects(reserve(env,op,'reservation-race','model','facts',301,task,'fixture-catalog',100_000),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(reserve(env,op,'reservation-race','model','review',300,task,'fixture-catalog',100_000),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(reserve(env,{...op,id:'another-operation'},'reservation-race','model','facts',300,task,'fixture-catalog',100_000),/IDEMPOTENCY_CONFLICT/);
  assert.equal(db.prepare('SELECT reserved_micros FROM cost_reservations WHERE id=?').get('reservation-race').reserved_micros,300);
});

test('bounded R2 upload streams reject short, oversized and falsely declared object bodies', async () => {
  const request=chunks=>new Request('https://broker.internal/w/output',{method:'PUT',duplex:'half',
    body:new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(new Uint8Array(chunk));controller.close();}})});
  const read=(chunks,length)=>{
    const upload=boundedUploadStream(request(chunks).body,length);
    assert.equal(fixedLengthOf(upload.readable),length);
    return new Response(upload.readable).arrayBuffer();
  };
  assert.deepEqual(new Uint8Array(await read([[1,2],[3]],3)),new Uint8Array([1,2,3]));
  await assert.rejects(read([[1,2,3,4,5,6]],3),/OBJECT_LENGTH_MISMATCH/);
  await assert.rejects(read([[1,2]],3),/OBJECT_LENGTH_MISMATCH/);
  assert.throws(()=>boundedUploadStream(request([[1]]).body,50*(1<<20)+1),/OBJECT_TOO_LARGE/);
  assert.deepEqual(new Uint8Array(await new Response(boundedUploadStream(null,0).readable).arrayBuffer()),new Uint8Array());
});

test('an early R2 rejection or conditional miss aborts its unconsumed input stream', async () => {
  for (const outcome of ['rejected', 'conditional-miss']) {
    let cancelled = false;
    const body = new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(1));},
      cancel() {cancelled = true;}});
    const bucket = {async put(_key, readable) {
      assert.equal(fixedLengthOf(readable), 1000);
      if (outcome === 'rejected') throw Error('R2_REFUSED');
      return null;
    }};
    const pending = putBoundedUpload(bucket, 'evals/test/file.png', body, 1000, {});
    if (outcome === 'rejected') await assert.rejects(pending, /R2_REFUSED/);
    else assert.equal(await pending, null);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cancelled, true, outcome);
  }
});

test('internal eval file ingress verifies SHA-256 in R2 and never trusts an incomplete object', async () => {
  const {MEDIA,objects}=memoryMedia(),key='evals/native/streamed.mp4';
  const bytes=new Uint8Array(3<<20).fill(7),sha256=sha256Bytes(bytes);
  const upload=(data,length,hash)=>immutableStream({MEDIA},key,new ReadableStream({start(controller) {
    for(let offset=0;offset<data.length;offset+=8192)controller.enqueue(data.subarray(offset,offset+8192));
    controller.close();
  }}),length,hash,'video/mp4');
  await assert.rejects(upload(bytes,bytes.length-1,sha256),/OBJECT_LENGTH_MISMATCH/);
  assert.equal(objects.size,0);
  await assert.rejects(upload(bytes,bytes.length,'0'.repeat(64)),/R2_CHECKSUM_MISMATCH/);
  assert.equal(objects.size,0);
  const blob=await upload(bytes,bytes.length,sha256);
  assert.equal(blob.sha256,sha256);
  assert.equal(objects.get(key).bytes.length,bytes.length);
  await upload(bytes,bytes.length,sha256);
  await assert.rejects(upload(new Uint8Array(bytes.length),bytes.length,sha256),/OBJECT_IDENTITY_MISMATCH/);
  await assert.rejects(upload(bytes,bytes.length,'1'.repeat(64)),/IMMUTABLE_OBJECT_CONFLICT/);
});

test('conditional immutable uploads cannot falsely ACK the losing bytes of a concurrent write', async () => {
  const {MEDIA,objects}=memoryMedia(),key='evals/native/immutable-race.png';
  const head=MEDIA.head.bind(MEDIA);
  let preflight=0;
  MEDIA.head=async path=>path===key&&preflight++<2?null:head(path);
  const rows=await Promise.allSettled([
    immutableBytes({MEDIA},key,new Uint8Array([1,2,3]),'image/png'),
    immutableBytes({MEDIA},key,new Uint8Array([4,5,6]),'image/png'),
  ]);
  assert.equal(rows.filter(row=>row.status==='fulfilled').length,1);
  assert.match(rows.find(row=>row.status==='rejected').reason.message,/IMMUTABLE_OBJECT_CONFLICT/);
  const winning=rows.find(row=>row.status==='fulfilled').value;
  assert.equal(sha256Bytes(objects.get(key).bytes),winning.sha256);
});

test('concurrent operation creation preserves idempotency and rejects a conflicting body', async t => {
  const {db,env}=await fixture(t);
  const input={id:'parallel-operation',workspaceId:'workspace-one',projectId:'project-one',purpose:'evaluation',maxMicros:3000000};
  const created=await Promise.all([registerOperation(env,input),registerOperation(env,input),registerOperation(env,input)]);
  assert.ok(created.every(value=>value.operationId===input.id));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_operations WHERE id=?').get(input.id).n,1);
  await assert.rejects(registerOperation(env,{...input,maxMicros:2000000}),/IDEMPOTENCY_CONFLICT/);
});

test('cancellation is idempotent only for a real cancelled operation, not a missing or completed one', async t => {
  const {db,env,op}=await fixture(t);
  await assert.rejects(cancelOperation(env,'missing-operation'),/OPERATION_NOT_FOUND/);
  const finished={...op,id:'finished-operation',status:'succeeded'};
  db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(finished.id,finished.workspace_id,finished.project_id,0,finished.purpose,finished.status,'request',finished.max_micros,Date.now(),Date.now(),null);
  await assert.rejects(cancelOperation(env,finished.id),/OPERATION_NOT_CANCELLABLE/);
  assert.deepEqual(await cancelOperation(env,op.id),{operationId:op.id,status:'cancelling'});
  await cancelOperation(env,op.id);
  assert.equal(db.prepare('SELECT status,generation FROM pipeline_operations WHERE id=?').get(op.id).generation,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pipeline_outbox WHERE kind='cancel'").get().n,1);
});

test('durable cancellation and failure notify live readers before asynchronous cleanup',async t=>{
 const{db,env,op}=await fixture(t),progress=[];
 env.OPERATIONS={getByName(){return{async progress(serialized){progress.push(parseCanonicalJson(serialized));}};}};
 await cancelOperation(env,op.id);
 await dispatchOperationCancellation(env,{operationId:op.id});
 assert.deepEqual(progress,[{operationId:op.id,generation:1,status:'cancelled'}]);
 const failed={...op,id:'failed-native-operation'};
 db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  .run(failed.id,failed.workspace_id,failed.project_id,0,failed.purpose,'active','failure-request',failed.max_micros,Date.now(),null,null);
 await failDirector(env,failed,'DIRECTOR_TEST_FAILURE');
 assert.deepEqual(progress[1],{operationId:failed.id,generation:0,status:'failed',code:'DIRECTOR_TEST_FAILURE'});
 assert.equal(db.prepare('SELECT status FROM pipeline_operations WHERE id=?').get(failed.id).status,'failed');
});

test('a failed native render stays blocked until physical cleanup is confirmed', async t => {
  const {db, env, op, saved} = await fixture(t);
  await createNativeRender(env, op, {renderId: 'native-render', revisionId: saved.revisionId, mode: 'export', rendererRelease: 'native-release'});
  db.prepare('INSERT INTO pipeline_attempts(id,render_id,operation_id,generation,mode,instance,status,started_at) VALUES(?,?,?,?,?,?,?,?)')
    .run('attempt-one', 'native-render', op.id, 0, 'native_export', 'standard-3', 'active', Date.now());
  env.SHARDS = {getByName() {return {async stopAndSettle() {throw Error('PLATFORM_UNAVAILABLE');}};}};
  await assert.rejects(recordRenderFailure(env, 'native-render', 'NATIVE_RENDER_FAILED'), /COMPUTE_STOP_UNCONFIRMED/);
  let row = db.prepare('SELECT status,result_json FROM pipeline_renders').get();
  assert.equal(row.status, 'blocked'); assert.equal(parseCanonicalJson(row.result_json).stopPending, true);
  env.SHARDS = {getByName() {return {async stopAndSettle() {}};}};
  await recordRenderFailure(env, 'native-render', 'DIFFERENT_FAILURE');
  row = db.prepare('SELECT status,result_json FROM pipeline_renders').get();
  assert.equal(parseCanonicalJson(row.result_json).code, 'NATIVE_RENDER_FAILED');
  assert.equal(parseCanonicalJson(row.result_json).stopPending, false);
});

test('a hung physical stop preserves terminal notification and leaves cleanup retryable', async t => {
  const {db, env, op, saved, sent} = await fixture(t);
  await createNativeRender(env, op, {renderId:'native-render',revisionId:saved.revisionId,
    mode:'export',rendererRelease:'native-release'});
  const token = '11111111-1111-4111-8111-111111111111';
  db.prepare(`INSERT INTO pipeline_render_admissions
    (id,render_id,operation_id,generation,workspace_id,attempt_index,status,requested_at,queue_deadline_at,
      lease_token,admitted_at,attempt_deadline_at) VALUES(?,?,?,?,?,0,'running',?,?,?,?,?)`)
    .run('stalled-attempt','native-render',op.id,op.generation,op.workspace_id,Date.now()-1,
      Date.now()+60_000,token,Date.now(),Date.now()+600_000);
  db.prepare(`INSERT INTO pipeline_attempts(id,render_id,operation_id,generation,mode,instance,status,started_at)
    VALUES(?,?,?,?,?,?,?,?)`).run('stalled-attempt','native-render',op.id,op.generation,
    'native_export','standard-3','active',Date.now());
  for (const [kind,id] of [['render','native-render'],['operation',op.id]])
    db.prepare("INSERT INTO pipeline_workflows(kind,id,operation_id,generation,registered_at,engine) VALUES(?,?,?,?,?,'huashu')")
      .run(kind,id,op.id,op.generation,Date.now());
  let stops = 0;
  env.SHARDS = {getByName() {return {async stopAndSettle() {stops++; return new Promise(() => {});}};}};
  env.RENDER_WORKFLOW = {get() {return {async status() {return {status:'errored',error:{message:'NATIVE_RENDER_FAILED'}};}};}};
  const notifications = [];
  env.OPERATION_WORKFLOW = {get() {return {
    async status() {return {status:'running'};},
    async sendEvent(event) {notifications.push(event);},
  };}};
  const originalSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis,'setTimeout',(callback,ms,...args)=>
    originalSetTimeout(callback,Math.min(ms,12),...args));

  await assert.rejects(recordRenderFailure(env,'native-render','NATIVE_RENDER_FAILED'),/COMPUTE_STOP_UNCONFIRMED/);
  const render = db.prepare('SELECT status,result_json FROM pipeline_renders WHERE id=?').get('native-render');
  assert.equal(render.status,'blocked');
  assert.equal(parseCanonicalJson(render.result_json).stopPending,true);
  const terminalId = 'render-terminal-native-render';
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_outbox WHERE id=?').get(terminalId).n,1,
    'the failure event is durable before physical cleanup');
  assert.equal(db.prepare('SELECT stopped_at FROM pipeline_attempts WHERE id=?').get('stalled-attempt').stopped_at,null);
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions WHERE id=?').get('stalled-attempt').status,'running');

  for (let cycle=0;cycle<2;cycle++) {
    const rows = await recoverWorkflows(env);
    assert.ok(rows.some(row=>row.kind==='render'&&row.status==='unconfirmed'));
    await recoverDirectorEvents(env);
    await flushOutbox(env,terminalId);
  }
  assert.ok(stops>=3,'later recovery attempts cleanup without claiming it succeeded');
  assert.equal(notifications.length,1,'the Director gets the durable failure only once');
  assert.equal(notifications[0].payload.status,'blocked');
  assert.equal(sent.filter(item=>item.id===terminalId).length,1);
  assert.ok(db.prepare('SELECT director_event_done_at FROM pipeline_outbox WHERE id=?').get(terminalId).director_event_done_at);
  assert.equal(db.prepare('SELECT stopped_at FROM pipeline_attempts WHERE id=?').get('stalled-attempt').stopped_at,null);
});
