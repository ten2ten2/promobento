import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1} from './fixtures/sqlite.mjs';
import {dispatchRenderAdmissions, requestRenderAdmission, waitForRenderAdmission, claimRenderAdmission, canRetryUnstartedAdmission, requeueRenderAfterAttempt} from '../src/render-admission.ts';
import {nativeRenderPolicy} from '../src/native-task.ts';
import {recordRenderFailure} from '../src/render-recovery.ts';

function fixture(t) {
  const {db, DB} = sqliteD1(); t.after(() => db.close());
  const leases = new Map(), events = [], stoppedShards = new Set();
  let nextLease = 0;
  const coordinator = {
    async acquire(id, workspace, generation, deadline) {
      const previous = leases.get(id);
      if (previous) return {token: previous.token, created: false};
      if (leases.size >= nativeRenderPolicy.globalInstances) return {blocked: 'global'};
      if ([...leases.values()].some(lease => lease.workspace === workspace)) return {blocked: 'workspace'};
      const token = '11111111-1111-4111-8111-' + String(++nextLease).padStart(12, '0');
      leases.set(id, {workspace, generation, deadline, token}); return {token, created: true};
    },
    async extend(id, token, deadline) {
      assert.equal(leases.get(id)?.token, token);
      leases.get(id).deadline = deadline;
    },
    async assertLease(id, workspace, generation, token) {
      const lease = leases.get(id);
      if (!lease || lease.workspace !== workspace || lease.generation !== generation || lease.token !== token
        || lease.deadline <= Date.now()) throw Error('RENDER_LEASE_FENCED');
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
    SHARDS: {getByName(id) {return {
      async isStopped() {return true;},
      async stopAndSettle() {stoppedShards.add(id);},
      async resetUnstartedAdmission(ticketId, token) {
        assert.equal(ticketId, id);
        const row = db.prepare('SELECT status,lease_token FROM pipeline_render_admissions WHERE id=?').get(id);
        assert.equal(row.status, 'released');
        assert.equal(row.lease_token, token);
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts WHERE id=?').get(id).n, 0);
        stoppedShards.delete(id);
      },
    };}},
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
  return {db, env, leases, events, stoppedShards, add, addTicket};
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

test('hung Workflow notification never blocks another workspace grant or its event', async t => {
  const {db, env, add, addTicket} = fixture(t);
  const stuck = add('stuck-notification'), healthy = add('healthy-notification');
  const stuckId = addTicket(stuck), healthyId = addTicket(healthy);
  const originalSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) =>
    originalSetTimeout(callback, Math.min(ms, 15), ...args));
  const delivered = [];
  env.RENDER_WORKFLOW = {get(id) {return {
    async sendEvent(event) {
      if (id === stuck.renderId) return new Promise(() => {});
      delivered.push({id, event});
    },
    async status() {return {status:'running'};},
  };}};
  await dispatchRenderAdmissions(env);
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions WHERE id=?').get(stuckId).status, 'admitted');
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions WHERE id=?').get(healthyId).status, 'admitted');
  assert.deepEqual(delivered.map(row => row.id), [healthy.renderId]);
  assert.ok(db.prepare('SELECT notification_retry_at FROM pipeline_render_admissions WHERE id=?').get(stuckId).notification_retry_at > Date.now());
  assert.ok(db.prepare('SELECT notification_sent_at FROM pipeline_render_admissions WHERE id=?').get(healthyId).notification_sent_at);
});

test('one hung Coordinator acquire does not suppress another workspace admission', async t => {
  const {db, env, add, addTicket} = fixture(t);
  const stuck = add('stuck-acquire'), healthy = add('healthy-acquire');
  const stuckId = addTicket(stuck), healthyId = addTicket(healthy);
  const coordinator = env.COORDINATOR.getByName('global-v1'), originalAcquire = coordinator.acquire.bind(coordinator);
  coordinator.acquire = (...args) => args[0] === stuckId ? new Promise(() => {}) : originalAcquire(...args);
  const originalSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) =>
    originalSetTimeout(callback, Math.min(ms, 15), ...args));
  await dispatchRenderAdmissions(env);
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions WHERE id=?').get(stuckId).status, 'queued');
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions WHERE id=?').get(healthyId).status, 'admitted');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 0);
});

test('hung lease validation cannot indefinitely hold an admission Workflow precheck', async t => {
  const {db, env, add} = fixture(t);
  const pending = add('hung-lease-check'), ticket = await requestRenderAdmission(env, pending.renderId,
    pending.op, 'attempt-hung-lease', 0);
  const originalSetTimeout = globalThis.setTimeout, realNow = Date.now;
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) =>
    originalSetTimeout(callback, Math.min(ms, 15), ...args));
  env.COORDINATOR.getByName('global-v1').assertLease = async () => new Promise(() => {});
  const operationDeadlineAt = realNow() + 100;
  let simulatedNow = realNow(), checks = 0;
  const step = {async do(_name, ...args) {checks++; return args.at(-1)();},
    async waitForEvent() {throw Error('EVENT_UNAVAILABLE');},
    async sleepUntil(_name, wakeAt) {simulatedNow = wakeAt;}};
  try {
    Date.now = () => Math.max(realNow(), simulatedNow);
    await assert.rejects(waitForRenderAdmission(env, step, 'hung-lease-assert',
      {...ticket, operationDeadlineAt}, 0), /RENDER_QUEUE_EXPIRED/);
  } finally {Date.now = realNow;}
  assert.ok(checks >= 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 0);
});

test('admission event can arrive before wait; only then can an attempt start its execution deadline', async t => {
  const {db, env, events, add} = fixture(t);
  const {op, renderId} = add('workspace-one', {mode: 'preview', offset: -5 * 60_000});
  const ticket = await requestRenderAdmission(env, renderId, op, 'attempt-preview', 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 0);
  assert.equal(events.length, 1);
  const token = await waitForRenderAdmission(env, {
    async do(_name, _options, action) {return action();},
    async waitForEvent() {assert.fail('a persisted grant does not need an event to be redelivered');},
  }, 'admission-0', ticket, 0);
  await assert.rejects(claimRenderAdmission(env, op, {renderId, mode: 'preview'}, ticket.id, 'wrong-token'), /RENDER_FENCED/);
  const started = Date.now(), deadlineAt = await claimRenderAdmission(env, op, {renderId, mode: 'preview'}, ticket.id, token);
  assert.ok(deadlineAt >= started + nativeRenderPolicy.previewDeadlineMs - 1000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 1);
  assert.equal(db.prepare('SELECT status FROM pipeline_renders WHERE id=?').get(renderId).status, 'rendering');
  assert.equal(await claimRenderAdmission(env, op, {renderId, mode: 'preview'}, ticket.id, token), deadlineAt);
});

test('overlapping claims recover the first committed batch after a zero-row retry', async t => {
  const {db, env, add} = fixture(t);
  const pending = add('claim-overlap', {mode: 'preview'});
  const ticket = await requestRenderAdmission(env, pending.renderId, pending.op, 'attempt-overlap', 0);
  const token = db.prepare('SELECT lease_token FROM pipeline_render_admissions WHERE id=?').get(ticket.id).lease_token;
  const originalDB = env.DB, coordinator = env.COORDINATOR.getByName('global-v1');
  const originalExtend = coordinator.extend.bind(coordinator);
  let firstBatchEntered, resumeFirstBatch, secondExtendEntered, resumeSecondExtend;
  const firstBatch = new Promise(resolve => {firstBatchEntered = resolve;});
  const allowFirstBatch = new Promise(resolve => {resumeFirstBatch = resolve;});
  const secondExtend = new Promise(resolve => {secondExtendEntered = resolve;});
  const allowSecondExtend = new Promise(resolve => {resumeSecondExtend = resolve;});
  let batchCalls = 0, extendCalls = 0;
  env.DB = {...originalDB, async batch(statements) {
    if (++batchCalls === 1) {firstBatchEntered(); await allowFirstBatch;}
    return originalDB.batch(statements);
  }};
  coordinator.extend = async (...args) => {
    if (++extendCalls === 2) {secondExtendEntered(); await allowSecondExtend;}
    return originalExtend(...args);
  };
  const input = {renderId: pending.renderId, mode: 'preview'};
  const first = claimRenderAdmission(env, pending.op, input, ticket.id, token);
  await firstBatch;
  const second = claimRenderAdmission(env, pending.op, input, ticket.id, token);
  await secondExtend;
  resumeFirstBatch();
  const firstDeadline = await first;
  resumeSecondExtend();
  assert.equal(await second, firstDeadline, 'a zero-row batch must use the original attempt clock');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts WHERE id=?').get(ticket.id).n, 1);
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions WHERE id=?').get(ticket.id).status, 'running');
  assert.equal(db.prepare('SELECT status FROM pipeline_renders WHERE id=?').get(pending.renderId).status, 'rendering');
});

test('a completed physical attempt replays its admission wait after the queue deadline', async t => {
  const {env, events, add} = fixture(t);
  const {op, renderId} = add();
  const ticket = await requestRenderAdmission(env, renderId, op, 'attempt-replayed', 0);
  const saved = new Map(), timeouts = [];
  const step = {
    async do(name, _options, action) {
      if (!saved.has(name)) saved.set(name, await action());
      return saved.get(name);
    },
    async waitForEvent(_name, options) {
      timeouts.push(options.timeout);
      return {payload: events[0].payload};
    },
  };
  const first = await waitForRenderAdmission(env, step, 'native-project-admission', ticket, 0);
  await claimRenderAdmission(env, op, {renderId, mode: 'export'}, ticket.id, first);
  await env.COORDINATOR.getByName('global-v1').release(ticket.id, first);
  const replayed = await waitForRenderAdmission(env, step, 'native-project-admission', {...ticket, queueDeadlineAt: Date.now() - 60_000}, 0);
  assert.equal(replayed, first);
  assert.deepEqual(timeouts, [], 'checkpointed grants survive replay without another event wait');
});

test('first wait after queue cutoff consumes a previously admitted buffered event', async t => {
  const {db, env, events, add} = fixture(t);
  const pending = add('slow-workflow');
  const ticket = await requestRenderAdmission(env, pending.renderId, pending.op, 'attempt-late-wait', 0);
  const admittedAt = Date.now() - 6000, cutoff = Date.now() - 3000;
  db.prepare('UPDATE pipeline_render_admissions SET admitted_at=?,queue_deadline_at=? WHERE id=?')
    .run(admittedAt, cutoff, ticket.id);
  const late = {...ticket, queueDeadlineAt: cutoff};
  const step = {async do(_name, _options, action) {return action();},
    async waitForEvent() {assert.fail('an admitted ticket remains valid after its original queue cutoff');}};
  const token = await waitForRenderAdmission(env, step, 'late-first-wait', late, 0);
  assert.equal(token, events[0].payload.leaseToken);
  db.prepare("UPDATE pipeline_render_admissions SET status='queued' WHERE id=?").run(ticket.id);
  await assert.rejects(waitForRenderAdmission(env, step, 'never-admitted', late, 0), /RENDER_QUEUE_EXPIRED/);
});

test('a queue wait timeout recovers an on-time admission whose event delivery was delayed', async t => {
  const {db, env, leases, add, addTicket} = fixture(t);
  const pending = add('late-notification');
  const id = addTicket(pending);
  const ticket = {id, queueDeadlineAt: Date.now() + 60_000,
    operationDeadlineAt: db.prepare('SELECT operation_deadline_at FROM pipeline_renders WHERE id=?').get(pending.renderId).operation_deadline_at};
  const token = '11111111-1111-4111-8111-000000000099', checkpointed = new Map();
  let firstWait = true;
  const step = {
    async do(name, _options, action) {
      if (!checkpointed.has(name)) checkpointed.set(name, await action());
      return checkpointed.get(name);
    },
    async waitForEvent() {
      if (firstWait) {
        firstWait = false;
        const now = Date.now(), cutoff = now - 1000;
        ticket.queueDeadlineAt = cutoff; // Simulate the original wait reaching its cutoff.
        db.prepare("UPDATE pipeline_render_admissions SET status='admitted',admitted_at=?,queue_deadline_at=?,lease_token=? WHERE id=?")
          .run(now - 2000, cutoff, token, id);
        leases.set(id, {workspace: pending.op.workspace_id, generation: pending.op.generation,
          token, deadline: ticket.operationDeadlineAt});
      }
      throw Error('EVENT_WAIT_TIMEOUT');
    },
    async sleepUntil() {},
  };
  assert.equal(await waitForRenderAdmission(env, step, 'admission-timeout', ticket, 0), token);
  assert.ok(checkpointed.has('admission-timeout-resolved-0-0'));
  await claimRenderAdmission(env, pending.op, {renderId: pending.renderId, mode: 'export'}, id, token);
  await env.COORDINATOR.getByName('global-v1').release(id, token);
  assert.equal(await waitForRenderAdmission(env, step, 'admission-timeout', ticket, 0), token,
    'a physically claimed attempt must replay without another admission');

  const tooLate = add('late-grant');
  const lateId = addTicket(tooLate);
  const cutoff = Date.now() - 1000;
  db.prepare("UPDATE pipeline_render_admissions SET status='admitted',admitted_at=?,queue_deadline_at=?,lease_token=? WHERE id=?")
    .run(Date.now(), cutoff, token, lateId);
  await assert.rejects(waitForRenderAdmission(env, {
    async do(_name, _options, action) {return action();},
    async waitForEvent() {throw Error('EVENT_WAIT_TIMEOUT');},
  }, 'admission-late', {id:lateId,queueDeadlineAt:cutoff,operationDeadlineAt:ticket.operationDeadlineAt}, 0), /RENDER_QUEUE_EXPIRED/);
});

test('a cached grant that expires before physical claim can be re-admitted on Workflow replay', async t => {
  const {db, env, leases, stoppedShards, add} = fixture(t);
  const pending = add('checkpointed-no-start', {mode: 'preview'});
  const ticket = await requestRenderAdmission(env, pending.renderId, pending.op, 'attempt-checkpointed', 0);
  const checkpointed = new Map();
  const step = {
    async do(name, _options, action) {
      if (!checkpointed.has(name)) checkpointed.set(name, await action());
      return checkpointed.get(name);
    },
    async waitForEvent() {assert.fail('persisted admission must be available before an event wait');},
  };
  const expiredToken = await waitForRenderAdmission(env, step, 'checkpointed', ticket, 0);
  assert.ok(checkpointed.has('checkpointed-check-0'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 0);
  await env.SHARDS.getByName(ticket.id).stopAndSettle(false);
  await env.COORDINATOR.getByName('global-v1').release(ticket.id, expiredToken);
  assert.ok(stoppedShards.has(ticket.id));

  const newToken = await waitForRenderAdmission(env, step, 'checkpointed', ticket, 0);
  assert.notEqual(newToken, expiredToken);
  assert.ok(checkpointed.has('checkpointed-regrant-1-check-0'));
  assert.equal(leases.get(ticket.id).token, newToken);
  assert.equal(stoppedShards.has(ticket.id), false);
  assert.equal(db.prepare('SELECT queue_deadline_at FROM pipeline_render_admissions WHERE id=?').get(ticket.id).queue_deadline_at,
    ticket.queueDeadlineAt, 'a resumed grant must not extend the original queue deadline');
  await claimRenderAdmission(env, pending.op, {renderId: pending.renderId, mode: 'preview'}, ticket.id, newToken);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 1);
});

test('a lost queue-step checkpoint reuses the original released no-start ticket', async t => {
  const {db, env, leases, stoppedShards, add} = fixture(t);
  const pending = add('queue-step-interrupted', {mode:'preview'}), id = 'attempt-lost-queue-step';
  const original = await requestRenderAdmission(env, pending.renderId, pending.op, id, 0);
  const expiredToken = leases.get(id).token;
  await env.SHARDS.getByName(id).stopAndSettle(false);
  await env.COORDINATOR.getByName('global-v1').release(id, expiredToken);
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions WHERE id=?').get(id).status, 'released');
  const replayed = await requestRenderAdmission(env, pending.renderId, pending.op, id, 0);
  assert.deepEqual(replayed, original, 'a replay must not extend the original queue window');
  const newToken = await waitForRenderAdmission(env, {
    async do(_name, _options, action) {return action();},
    async waitForEvent() {assert.fail('the restored ticket should grant from durable state');},
  }, 'lost-queue-checkpoint', replayed, 0);
  assert.notEqual(newToken, expiredToken);
  assert.equal(stoppedShards.has(id), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 0);

  await env.SHARDS.getByName(id).stopAndSettle(false);
  await env.COORDINATOR.getByName('global-v1').release(id, newToken);
  db.prepare('UPDATE pipeline_operations SET status=? WHERE id=?').run('cancelled', pending.op.id);
  await assert.rejects(requestRenderAdmission(env, pending.renderId, pending.op, id, 0), /RENDER_FENCED/);
});

test('event backoff uses one durable absolute wake time across Workflow replay', async t => {
  const {db, env, add, addTicket} = fixture(t);
  const pending = add('wake-at-replay'), id = addTicket(pending);
  const deadlines = db.prepare('SELECT queue_deadline_at,operation_deadline_at FROM pipeline_renders WHERE id=?').get(pending.renderId);
  const ticket = {id,queueDeadlineAt:deadlines.queue_deadline_at,operationDeadlineAt:deadlines.operation_deadline_at};
  const checkpointed = new Map(), wakeTimes = [];
  const step = {
    async do(name, _options, action) {
      if (!checkpointed.has(name)) checkpointed.set(name, await action());
      return checkpointed.get(name);
    },
    async waitForEvent() {return {payload: {attemptId:id, leaseToken:'stale-token'}};},
    async sleepUntil(_name, wakeAt) {
      wakeTimes.push(wakeAt);
      if (wakeTimes.length === 1) await dispatchRenderAdmissions(env);
    },
  };
  const first = await waitForRenderAdmission(env, step, 'absolute-backoff', ticket, 0);
  const realNow = Date.now;
  let replayed;
  try {
    Date.now = () => realNow() + 65_000; // Replay after the original 60-second event wait elapsed.
    replayed = await waitForRenderAdmission(env, step, 'absolute-backoff', ticket, 0);
  } finally {Date.now = realNow;}
  assert.equal(replayed, first);
  assert.equal(wakeTimes.length, 1, 'a replay uses the checkpointed event without an extra backoff');
  assert.ok(wakeTimes[0] <= Date.now() + 1_100, 'event floods are throttled for one second, not a full heartbeat');
  assert.ok(checkpointed.has('absolute-backoff-check-0'), 'the original absolute heartbeat stays checkpointed');
});

test('an undeliverable grant is requeued after no-start lease expiry, without extending its queue window', async t => {
  const {db, env, leases, stoppedShards, add, addTicket} = fixture(t);
  const pending = add('preview-with-lost-event', {mode: 'preview'});
  const id = addTicket(pending);
  const initial = db.prepare('SELECT queue_deadline_at FROM pipeline_render_admissions WHERE id=?').get(id).queue_deadline_at;
  const ticket = {id, queueDeadlineAt: initial,
    operationDeadlineAt: db.prepare('SELECT operation_deadline_at FROM pipeline_renders WHERE id=?').get(pending.renderId).operation_deadline_at};
  env.RENDER_WORKFLOW = {get() {return {
    async sendEvent() {throw Error('EVENT_SERVICE_UNAVAILABLE');},
    async status() {return {status: 'running'};},
  };}};
  let firstLeaseToken;
  const realNow = Date.now;
  let simulatedNow = realNow();
  const step = {
    async do(_name, _options, action) {return action();},
    async waitForEvent(_name, {timeout}) {
      assert.ok(Number.parseInt(timeout) <= 60, 'the Workflow must wake before the 5-minute lease expires');
      if (!firstLeaseToken) {
        await dispatchRenderAdmissions(env);
        firstLeaseToken = leases.get(id).token;
        await env.SHARDS.getByName(id).stopAndSettle(false); // Coordinator alarm fences the never-started Shard.
        await env.COORDINATOR.getByName('global-v1').release(id, firstLeaseToken);
        assert.ok(stoppedShards.has(id));
      }
      throw Error('EVENT_WAIT_TIMEOUT');
    },
    async sleepUntil(_name, wakeAt) {simulatedNow = wakeAt;},
  };
  let token;
  try {
    Date.now = () => Math.max(realNow(), simulatedNow);
    token = await waitForRenderAdmission(env, step, 'lost-event', ticket, 0);
  } finally {Date.now = realNow;}
  assert.notEqual(token, firstLeaseToken, 're-admission requires a fresh lease token');
  assert.equal(leases.get(id).token, token);
  assert.equal(stoppedShards.has(id), false, 'a never-bound ShardDO must be unfenced before its ticket is reused');
  const restored = db.prepare('SELECT status,lease_token,queue_deadline_at,admitted_at FROM pipeline_render_admissions WHERE id=?').get(id);
  assert.equal(restored.status, 'admitted');
  assert.equal(restored.lease_token, token);
  assert.equal(restored.queue_deadline_at, initial);
  assert.ok(restored.admitted_at);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 0);
  await claimRenderAdmission(env, pending.op, {renderId: pending.renderId, mode: 'preview'}, id, token);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 1);
});

test('a stale buffered event and an expired Coordinator lease cannot revive the old grant', async t => {
  const {db, env, leases, add, addTicket} = fixture(t);
  const pending = add('stale-grant', {mode: 'preview'}), id = addTicket(pending);
  await dispatchRenderAdmissions(env);
  const oldToken = leases.get(id).token;
  leases.get(id).deadline = Date.now() - 1; // Alarm has not yet updated D1.
  const ticket = {id,
    queueDeadlineAt: db.prepare('SELECT queue_deadline_at FROM pipeline_render_admissions WHERE id=?').get(id).queue_deadline_at,
    operationDeadlineAt: db.prepare('SELECT operation_deadline_at FROM pipeline_renders WHERE id=?').get(pending.renderId).operation_deadline_at};
  let waitCount = 0;
  let backoffs = 0;
  const step = {
    async do(_name, _options, action) {return action();},
    async waitForEvent() {
      waitCount++;
      if (waitCount === 1) {
        await env.SHARDS.getByName(id).stopAndSettle(false);
        await env.COORDINATOR.getByName('global-v1').release(id, oldToken);
        return {payload: {attemptId: id, leaseToken: oldToken}};
      }
      if (waitCount === 2) throw Error('EVENT_API_UNAVAILABLE');
      return {payload: {attemptId: id, leaseToken: leases.get(id).token}};
    },
    async sleepUntil() {backoffs++; await dispatchRenderAdmissions(env);},
  };
  const recovered = await waitForRenderAdmission(env, step, 'stale-buffered', ticket, 0);
  assert.notEqual(recovered, oldToken);
  assert.equal(leases.get(id).token, recovered);
  assert.equal(waitCount, 1, 'the stale grant is revalidated and restored immediately');
  assert.equal(backoffs, 0, 'a recoverable no-start ticket does not need to sleep at all');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 0);
});

test('a fresh grant arriving after a stale event wakes the same wait window before the queue cutoff', async t => {
  const {db, env, leases, add, addTicket} = fixture(t);
  const occupying = add('same-workspace'), pending = add('same-workspace');
  const occupantId = addTicket(occupying), waitingId = addTicket(pending);
  await dispatchRenderAdmissions(env);
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions WHERE id=?').get(waitingId).status, 'queued');
  const deadlines = db.prepare('SELECT queue_deadline_at,operation_deadline_at FROM pipeline_renders WHERE id=?').get(pending.renderId);
  const ticket = {id:waitingId,queueDeadlineAt:deadlines.queue_deadline_at,operationDeadlineAt:deadlines.operation_deadline_at};
  let events = 0;
  const step = {
    async do(_name, _options, action) {return action();},
    async waitForEvent() {
      if (++events === 1) return {payload: {attemptId:waitingId,leaseToken:'stale-buffered-token'}};
      await env.SHARDS.getByName(occupantId).stopAndSettle(false);
      await env.COORDINATOR.getByName('global-v1').release(occupantId, leases.get(occupantId).token);
      await dispatchRenderAdmissions(env);
      return {payload: {attemptId:waitingId,leaseToken:leases.get(waitingId).token}};
    },
    async sleepUntil() {assert.fail('a stale event must not suppress subsequent real grant events');},
  };
  const token = await waitForRenderAdmission(env, step, 'stale-then-fresh', ticket, 0);
  assert.equal(token, leases.get(waitingId).token);
  assert.equal(events, 2, 'the Workflow re-listened rather than waiting for the next 60-second heartbeat');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_attempts').get().n, 0);
});

test('an old in-flight notification cannot acknowledge the newly granted lease', async t => {
  const {db, env, leases, add, addTicket} = fixture(t);
  const pending = add('delayed-event'), id = addTicket(pending);
  let unblockFirst, sawFirst;
  const firstSendStarted = new Promise(resolve => {sawFirst = resolve;});
  const firstSendBlocked = new Promise(resolve => {unblockFirst = resolve;});
  let calls = 0;
  env.RENDER_WORKFLOW = {get() {return {
    async sendEvent() {
      calls++;
      if (calls === 1) {sawFirst(); await firstSendBlocked;}
      else throw Error('EVENT_API_DOWN');
    },
    async status() {return {status: 'running'};},
  };}};
  const oldDispatch = dispatchRenderAdmissions(env);
  try {
    await Promise.race([firstSendStarted, oldDispatch.then(() => {throw Error('MISSING_FIRST_NOTIFICATION');})]);
    const oldToken = leases.get(id).token;
    await env.SHARDS.getByName(id).stopAndSettle(false);
    await env.COORDINATOR.getByName('global-v1').release(id, oldToken);
    const deadlines = db.prepare('SELECT queue_deadline_at,operation_deadline_at FROM pipeline_renders WHERE id=?').get(pending.renderId);
    const token = await waitForRenderAdmission(env, {
      async do(_name, _options, action) {return action();},
      async waitForEvent() {assert.fail('a restored ticket must be visible in persisted state');},
    }, 'old-in-flight', {id,queueDeadlineAt:deadlines.queue_deadline_at,operationDeadlineAt:deadlines.operation_deadline_at}, 0);
    assert.notEqual(token, oldToken);
  } finally {unblockFirst(); await oldDispatch;}
  assert.equal(db.prepare('SELECT notification_sent_at FROM pipeline_render_admissions WHERE id=?').get(id).notification_sent_at,
    null, 'the old lease notification must not mark the new lease as delivered');
});

test('a physically started attempt and a cancelled operation cannot be restored as unstarted admissions', async t => {
  const {db, env, leases, stoppedShards, add, addTicket} = fixture(t);
  const physical = add('already-started'), cancelled = add('no-longer-active');
  const physicalId = addTicket(physical), cancelledId = addTicket(cancelled);
  await dispatchRenderAdmissions(env);
  const firstToken = leases.get(physicalId).token;
  await claimRenderAdmission(env, physical.op, {renderId: physical.renderId, mode: 'export'}, physicalId, firstToken);
  db.prepare("UPDATE pipeline_renders SET status='queued' WHERE id=?").run(physical.renderId);
  await env.SHARDS.getByName(physicalId).stopAndSettle(false);
  await env.COORDINATOR.getByName('global-v1').release(physicalId, firstToken);
  db.prepare("UPDATE pipeline_operations SET status='cancelled',generation=1 WHERE id=?").run(cancelled.op.id);
  const cancelledToken = leases.get(cancelledId).token;
  await env.SHARDS.getByName(cancelledId).stopAndSettle(false);
  await env.COORDINATOR.getByName('global-v1').release(cancelledId, cancelledToken);
  const wait = {async do(_name, _options, action) {return action();},
    async waitForEvent() {return {payload: {expired: true}};}};
  for (const [id, renderId] of [[physicalId, physical.renderId], [cancelledId, cancelled.renderId]]) {
    const deadlines = db.prepare('SELECT queue_deadline_at,operation_deadline_at FROM pipeline_renders WHERE id=?').get(renderId);
    const owner = id === physicalId ? physical.op : cancelled.op;
    assert.equal(await canRetryUnstartedAdmission(env, owner, renderId,
      {id,queueDeadlineAt:deadlines.queue_deadline_at,operationDeadlineAt:deadlines.operation_deadline_at}, 0), false,
    'a claim failure cannot retry an already-physical or cancelled ticket');
    await assert.rejects(waitForRenderAdmission(env, wait, 'no-retry-' + id,
      {id,queueDeadlineAt:deadlines.queue_deadline_at,operationDeadlineAt:deadlines.operation_deadline_at}, 0), /RENDER_QUEUE_EXPIRED/);
    assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions WHERE id=?').get(id).status, 'released');
    assert.equal(leases.has(id), false);
    assert.ok(stoppedShards.has(id), 'a physically bound or cancelled Shard must remain fenced');
  }
});

test('failed notifications rotate past older undeliverable events and terminal workflows are retired', async t => {
  const {db, env, add, addTicket} = fixture(t);
  const old = [];
  for (let i = 0; i < 40; i++) {
    const pending = add('expired-' + i);
    old.push(pending.renderId);
    const id = addTicket(pending, 0, Date.now() - 20_000 + i);
    db.prepare("UPDATE pipeline_render_admissions SET status='expired' WHERE id=?").run(id);
  }
  const live = add('live');
  const liveId = addTicket(live);
  let liveFailures = 1, terminal = false, liveDelivered = 0;
  env.RENDER_WORKFLOW = {get(renderId) {return {
    async sendEvent() {
      if (renderId !== live.renderId) throw Error('workflow endpoint unavailable');
      if (liveFailures--) throw Error('transient event failure');
      liveDelivered++;
    },
    async status() {return {status: renderId === old[0] && terminal ? 'terminated' : 'running'};},
  };}};
  await dispatchRenderAdmissions(env);
  assert.equal(db.prepare('SELECT notification_failures FROM pipeline_render_admissions WHERE id=?').get(liveId).notification_failures, 1);
  assert.equal(liveDelivered, 0);
  db.prepare('UPDATE pipeline_render_admissions SET notification_retry_at=0 WHERE id=?').run(liveId);
  await dispatchRenderAdmissions(env);
  assert.equal(liveDelivered, 1, 'newly recoverable admitted work is not starved by older failed expirations');
  assert.ok(db.prepare('SELECT notification_sent_at FROM pipeline_render_admissions WHERE id=?').get(liveId).notification_sent_at);
  terminal = true;
  db.prepare('UPDATE pipeline_render_admissions SET notification_retry_at=0 WHERE render_id=?').run(old[0]);
  await dispatchRenderAdmissions(env);
  assert.ok(db.prepare('SELECT notification_sent_at FROM pipeline_render_admissions WHERE render_id=?').get(old[0]).notification_sent_at,
    'a terminal Workflow cannot receive the event and is retired from retry candidates');
});

test('requeue is replay-safe only for a stopped, settled, released previous attempt', async t => {
  const {db, env, leases, add, addTicket} = fixture(t);
  const pending = add();
  const attemptId = addTicket(pending);
  await dispatchRenderAdmissions(env);
  const token = leases.get(attemptId).token;
  await claimRenderAdmission(env, pending.op, {renderId: pending.renderId, mode: 'export'}, attemptId, token);
  await assert.rejects(requeueRenderAfterAttempt(env, pending.op, pending.renderId, attemptId), /RENDER_FENCED/);
  db.prepare("UPDATE pipeline_attempts SET status='failed',stopped_at=? WHERE id=?").run(Date.now(), attemptId);
  await env.COORDINATOR.getByName('global-v1').release(attemptId, token);
  await requeueRenderAfterAttempt(env, pending.op, pending.renderId, attemptId);
  await requeueRenderAfterAttempt(env, pending.op, pending.renderId, attemptId);
  assert.equal(db.prepare('SELECT status FROM pipeline_renders WHERE id=?').get(pending.renderId).status, 'queued');
  addTicket(pending, 1);
  await assert.rejects(requeueRenderAfterAttempt(env, pending.op, pending.renderId, attemptId), /RENDER_FENCED/);
  db.prepare("UPDATE pipeline_operations SET status='cancelled',generation=1 WHERE id=?").run(pending.op.id);
  await assert.rejects(requeueRenderAfterAttempt(env, pending.op, pending.renderId, attemptId), /RENDER_FENCED/);
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
