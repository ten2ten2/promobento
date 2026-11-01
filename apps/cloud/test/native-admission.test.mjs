import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1} from './fixtures/sqlite.mjs';
import {dispatchRenderAdmissions, requestRenderAdmission, waitForRenderAdmission, claimRenderAdmission} from '../src/render-admission.ts';
import {nativeRenderPolicy} from '../src/native-task.ts';
import {recordRenderFailure} from '../src/render-recovery.ts';

function fixture(t) {
  const {db, DB} = sqliteD1(); t.after(() => db.close());
  const leases = new Map(), events = [];
  const coordinator = {
    async acquire(id, workspace, generation, deadline) {
      const previous = leases.get(id);
      if (previous) return {token: previous.token, created: false};
      if (leases.size >= nativeRenderPolicy.globalInstances) return {blocked: 'global'};
      if ([...leases.values()].some(lease => lease.workspace === workspace)) return {blocked: 'workspace'};
      const token = '11111111-1111-4111-8111-' + String(leases.size + 1).padStart(12, '0');
      leases.set(id, {workspace, generation, deadline, token}); return {token, created: true};
    },
    async extend(id, token, deadline) {
      assert.equal(leases.get(id)?.token, token);
      leases.get(id).deadline = deadline;
    },
    async release(id, token) {
      if (leases.get(id)?.token === token) {
        leases.delete(id);
        await DB.prepare("UPDATE pipeline_render_admissions SET status='released' WHERE id=? AND lease_token=?").bind(id, token).run();
      }
    },
  };
  const env = {DB, COORDINATOR: {getByName() {return coordinator;}},
    RENDER_WORKFLOW: {get(renderId) {return {async sendEvent(event) {events.push({renderId, ...event});}};}},
    SHARDS: {getByName() {return {async isStopped() {return true;}, async stopAndSettle() {}};}},
  };
  let sequence = 0;
  function add(workspace = 'workspace-one', options = {}) {
    const renderId = 'render-' + ++sequence, operationId = 'operation-' + sequence;
    const op = {id: operationId, workspace_id: workspace, project_id: 'project-one', generation: 0,
      status: 'active', purpose: 'evaluation', max_micros: 3000000};
    const createdAt = Date.now() + (options.offset ?? 0);
    db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(op.id, op.workspace_id, op.project_id, 0, 'evaluation', 'active', renderId, op.max_micros, createdAt, null, null);
    db.prepare(`INSERT INTO pipeline_renders(id,operation_id,generation,request_hash,job_key,status,created_at,
      queue_deadline_at,operation_deadline_at,mode) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(renderId, op.id, 0, renderId, 'renders/' + renderId + '/input.json', 'queued', createdAt,
        options.queueDeadlineAt ?? createdAt + nativeRenderPolicy.queueWaitMs,
        options.operationDeadlineAt ?? createdAt + nativeRenderPolicy.exportOperationMs,
        options.mode ?? 'export');
    return {op, renderId};
  }
  function addTicket({op, renderId}, index = 0, requestedAt = Date.now()) {
    const id = 'attempt-' + renderId + '-' + index;
    db.prepare(`INSERT INTO pipeline_render_admissions
      (id,render_id,operation_id,generation,workspace_id,attempt_index,status,requested_at,queue_deadline_at)
      VALUES(?,?,?,?,?,?,'queued',?,?)`)
      .run(id, renderId, op.id, op.generation, op.workspace_id, index, requestedAt,
        db.prepare('SELECT queue_deadline_at FROM pipeline_renders WHERE id=?').get(renderId).queue_deadline_at);
    return id;
  }
  return {db, env, leases, events, add, addTicket};
}

test('64 submissions admit at most four distinct workspaces; no queue ticket counts as physical compute', async t => {
  const {db, env, leases, events, add, addTicket} = fixture(t);
  for (let index = 0; index < 8; index++) addTicket(add('workspace-0'), 0, Date.now() - 5000 + index);
  for (let workspace = 1; workspace < 8; workspace++) {
    for (let index = 0; index < 8; index++) addTicket(add('workspace-' + workspace), 0, Date.now() - 1000 + index);
  }
  await dispatchRenderAdmissions(env);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pipeline_render_admissions WHERE status='admitted'").get().n, 4);
  assert.equal(leases.size, 4);
  assert.equal(new Set([...leases.values()].map(lease => lease.workspace)).size, 4);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cost_reservations').get().n, 0);
  await dispatchRenderAdmissions(env);
  assert.equal(events.length, 4, 'repeated wake must not duplicate event or lease');

  const [releasedId, lease] = leases.entries().next().value;
  await env.COORDINATOR.getByName('global-v1').release(releasedId, lease.token);
  await dispatchRenderAdmissions(env);
  assert.equal(leases.size, 4, 'a freed slot admits a previously waiting workspace');
  assert.equal(new Set([...leases.values()].map(value => value.workspace)).size, 4);
  assert.equal(events.length, 5);
});

test('admission event can arrive before wait; only then can an attempt start its execution deadline', async t => {
  const {db, env, events, add} = fixture(t);
  const {op, renderId} = add('workspace-one', {mode: 'preview', offset: -5 * 60_000});
  const ticket = await requestRenderAdmission(env, renderId, op, 'attempt-preview', 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 0);
  assert.equal(events.length, 1);
  const token = await waitForRenderAdmission({async waitForEvent(_name, options) {
    assert.equal(options.type, 'native-admission-0');
    return {payload: events.shift().payload};
  }}, 'admission-0', ticket, 0);
  await assert.rejects(claimRenderAdmission(env, op, {renderId, mode: 'preview'}, ticket.id, 'wrong-token'), /RENDER_FENCED/);
  const started = Date.now(), deadlineAt = await claimRenderAdmission(env, op, {renderId, mode: 'preview'}, ticket.id, token);
  assert.ok(deadlineAt >= started + nativeRenderPolicy.previewDeadlineMs - 1000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 1);
  assert.equal(db.prepare('SELECT status FROM pipeline_renders WHERE id=?').get(renderId).status, 'rendering');
  assert.equal(await claimRenderAdmission(env, op, {renderId, mode: 'preview'}, ticket.id, token), deadlineAt);
});

test('two competing dispatchers cannot release the other dispatcher\'s winning lease', async t => {
  const {db, env, leases, events, add, addTicket} = fixture(t);
  addTicket(add());
  await Promise.all([dispatchRenderAdmissions(env), dispatchRenderAdmissions(env)]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pipeline_render_admissions WHERE status='admitted'").get().n, 1);
  assert.equal(leases.size, 1);
  assert.ok(events.length >= 1 && events.length <= 2, 'event delivery is at least once under a race');
  assert.equal(new Set(events.map(event => event.payload.leaseToken)).size, 1);
});

test('an admission delayed past the queue deadline releases its unused lease', async t => {
  const {db, env, leases, add, addTicket} = fixture(t);
  const pending = add('short-window', {queueDeadlineAt: Date.now() + 100});
  const ticketId = addTicket(pending);
  const coordinator = env.COORDINATOR.getByName('global-v1');
  const original = coordinator.acquire.bind(coordinator);
  coordinator.acquire = async (...args) => {
    const result = await original(...args);
    await new Promise(resolve => setTimeout(resolve, 150));
    return result;
  };
  await dispatchRenderAdmissions(env);
  assert.equal(leases.size, 0);
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions WHERE id=?').get(ticketId).status, 'queued');
  await dispatchRenderAdmissions(env);
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions WHERE id=?').get(ticketId).status, 'expired');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 0);
});

test('queue expiry never allocates a physical attempt; cancelled generation cannot be admitted', async t => {
  const {db, env, events, leases, add, addTicket} = fixture(t);
  const expired = add('expired-workspace', {queueDeadlineAt: Date.now() - 1});
  const cancelled = add('cancelled-workspace');
  const expiredId = addTicket(expired), cancelledId = addTicket(cancelled);
  db.prepare("UPDATE pipeline_operations SET status='cancelled',generation=1 WHERE id=?").run(cancelled.op.id);
  await dispatchRenderAdmissions(env);
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions WHERE id=?').get(expiredId).status, 'expired');
  assert.equal(events.at(0).payload.expired, true);
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions WHERE id=?').get(cancelledId).status, 'queued');
  assert.equal(leases.size, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 0);
});

test('a failure after admission but before container start returns the reserved slot safely', async t => {
  const {db, env, leases, add} = fixture(t);
  const {op, renderId} = add();
  await requestRenderAdmission(env, renderId, op, 'admitted-no-container', 0);
  assert.equal(leases.size, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 0);
  await recordRenderFailure(env, renderId, 'RENDER_STARTUP_TIMEOUT');
  assert.equal(leases.size, 0);
  assert.equal(db.prepare('SELECT status FROM pipeline_renders WHERE id=?').get(renderId).status, 'blocked');
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions').get().status, 'released');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cost_reservations').get().n, 0);
});
