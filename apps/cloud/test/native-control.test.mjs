import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {saveNativeProject, loadNativeProject, createNativeRender, getNativeRender, checkedNativeBytes, NATIVE_COMMIT} from '../src/native-project.ts';
import {immutableBytes, reserve, settle} from '../src/store.ts';
import {runNativeRenderTask} from '../src/render-task.ts';
import {claimRenderAdmission} from '../src/render-admission.ts';
import {recoverWorkflows} from '../src/workflow-recovery.ts';
import {commitRender, dispatchRenderProgress, recordRenderFailure, reconcileOperation, deliverRenderDirectorEvent, recoverRenderDirectorEvents} from '../src/render-recovery.ts';
import {flushOutbox} from '../src/outbox.ts';
import {getReviewDraft} from '../src/director-recovery.ts';
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
  let executions = 0, stops = 0;
  env.SHARDS = {getByName(id) {return {
    async execute(text) {
      executions++;
      await reserve(env, op, id, 'compute', 'render', 500, parseCanonicalJson(text), 'fixture', 10000000);
      throw Error('Network connection lost.');
    }, async stopAndSettle() {stops++;}, async isStopped() {return true;},
  };}};
  const step = {async do(_name, ...args) {return args.at(-1)();}, waitForEvent, async sleep() {assert.fail('an unresolved reservation cannot authorize a retry');}};
  await assert.rejects(runNativeRenderTask(env, step, {renderId: 'native-render', op, input, imageDigest: 'sha256:' + 'a'.repeat(64)}), /RENDER_RPC_CONNECTION_LOST/);
  assert.equal(executions, 1); assert.equal(stops, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n, 0);
  assert.equal(db.prepare('SELECT reserved_micros FROM cost_reservations').get().reserved_micros, 500);
});

for (const scenario of ['released-before-claim', 'lease-expired-during-extend']) {
  test('a grant ' + scenario + ' is recovered without spending a physical retry', async t => {
    const {db, env, op, saved, objects} = await fixture(t);
    const waitForEvent = fakeAdmission(env);
    await createNativeRender(env, op, {renderId: 'native-render', revisionId: saved.revisionId,
      mode: 'preview', rendererRelease: 'native-release'});
    const input = parseCanonicalJson(objects.get('renders/native-render/input.json').bytes);
    const coordinator = env.COORDINATOR.getByName('global-v1');
    const checkpointed = new Map();
    let expired = false, oldToken, resets = 0, executions = 0;
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
          if (scenario === 'released-before-claim' && name === 'native-project' && !expired) {
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

test('claim-time recovery never re-admits a ticket with an existing physical attempt', async t => {
  const {db, env, op, saved, objects} = await fixture(t);
  fakeAdmission(env);
  await createNativeRender(env, op, {renderId:'native-render',revisionId:saved.revisionId,
    mode:'export',rendererRelease:'native-release'});
  const input = parseCanonicalJson(objects.get('renders/native-render/input.json').bytes);
  const coordinator = env.COORDINATOR.getByName('global-v1');
  let claimed = false;
  env.SHARDS = {getByName() {return {
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
    await assert.rejects(deliverRenderDirectorEvent(env, item), /EVENT_API_TEMPORARILY_UNAVAILABLE/);
    assert.equal(db.prepare('SELECT director_event_done_at FROM pipeline_outbox WHERE id=?').get(entry.id).director_event_done_at, null);
  }
  assert.equal(received.length, 0);
  // Simulate a later scheduled sweep; Queue itself never redelivers these messages.
  db.prepare("UPDATE pipeline_outbox SET director_event_retry_at=0 WHERE kind IN ('render_progress','render_terminal')").run();
  await recoverRenderDirectorEvents(env);
  assert.equal(received.length, 2);
  assert.deepEqual(received.map(event => event.payload.status).sort(), ['blocked', 'passed']);
  for (const entry of entries) assert.ok(db.prepare('SELECT director_event_done_at FROM pipeline_outbox WHERE id=?').get(entry.id).director_event_done_at);
  await recoverRenderDirectorEvents(env);
  assert.equal(received.length, 2, 'acknowledged events are not replayed by later sweeps');
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
