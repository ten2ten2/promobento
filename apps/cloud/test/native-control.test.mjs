import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {saveNativeProject, loadNativeProject, createNativeRender, getNativeRender, checkedNativeBytes, NATIVE_COMMIT} from '../src/native-project.ts';
import {immutableBytes, reserve, settle} from '../src/store.ts';
import {runNativeRenderTask} from '../src/render-task.ts';
import {recoverWorkflows} from '../src/workflow-recovery.ts';
import {commitRender, dispatchRenderProgress, recordRenderFailure} from '../src/render-recovery.ts';
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
  const step = {async do(_name, ...args) {return args.at(-1)();}, async sleep() {assert.fail('an unresolved reservation cannot authorize a retry');}};
  await assert.rejects(runNativeRenderTask(env, step, {renderId: 'native-render', op, input, imageDigest: 'sha256:' + 'a'.repeat(64), deadlineAt: Date.now() + 60000}), /RENDER_RPC_CONNECTION_LOST/);
  assert.equal(executions, 1); assert.equal(stops, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n, 0);
  assert.equal(db.prepare('SELECT reserved_micros FROM cost_reservations').get().reserved_micros, 500);
});

test('a settled platform failure retries with a new attempt; durable replay cannot repeat it', async t => {
  const {db, env, op, saved, objects} = await fixture(t);
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
  const step = {async do(name, ...args) {if (!cached.has(name)) cached.set(name, await args.at(-1)()); return cached.get(name);}, async sleep() {}};
  const context = {renderId: 'native-render', op, input, imageDigest: 'sha256:' + 'a'.repeat(64), deadlineAt: Date.now() + 60000};
  const result = await runNativeRenderTask(env, step, context);
  assert.equal(result.status, 'succeeded'); assert.equal(executions, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 2);
  assert.deepEqual((await runNativeRenderTask(env, step, context)).attemptId, result.attemptId);
  assert.equal(executions, 2);
});

test('terminal media commit and notification are atomic and replayable; cancellation fences publication', async t => {
  const {db, env, op, saved} = await fixture(t);
  await createNativeRender(env, op, {renderId: 'native-render', revisionId: saved.revisionId, mode: 'export', rendererRelease: 'native-release'});
  const result = canonical({kind: 'native_render_result', status: 'passed', outputs: []});
  await commitRender(env, 'native-render', op, result);
  await commitRender(env, 'native-render', op, result);
  assert.equal(db.prepare('SELECT status,result_json FROM pipeline_renders').get().result_json, result);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_outbox WHERE kind=\'render_progress\'').get().n, 1);
  await assert.rejects(commitRender(env, 'native-render', op, canonical({different: true})), /RENDER_COMMIT_CONFLICT/);
  await createNativeRender(env, op, {renderId: 'second-render', revisionId: saved.revisionId, mode: 'export', rendererRelease: 'native-release'});
  db.prepare('UPDATE pipeline_operations SET status=\'cancelled\',generation=1 WHERE id=?').run(op.id);
  await assert.rejects(commitRender(env, 'second-render', op, result), /OPERATION_FENCED/);
  let delivered = false;
  env.OPERATIONS = {getByName() {return {async progress() {delivered = true;}};}};
  await dispatchRenderProgress(env, {operationId: op.id, payloadJson: canonical({operationId: op.id, generation: 0, renderId: 'native-render'})});
  assert.equal(delivered, false);
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
