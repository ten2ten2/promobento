import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {digest} from '../../../packages/contracts/src/digest.mjs';
import {assertSql, guardedBatch, GuardedBatchOutcomeUnknown, GuardedBatchPreconditionFailed, writeSql} from '../src/shared/guarded-batch.ts';
import {IdempotencyConflict, requestIdentity, resolveRequestId} from '../src/shared/idempotency.ts';
import {createD1Harness, executeSql} from './fixtures/multi-worker.mjs';

let harness;
let db;
before(async () => {
  harness = await createD1Harness();
  db = harness.db;
  // Test-only business shapes. PR1 intentionally does not create customer business tables.
  await executeSql(db, `
    CREATE TABLE test_credit (project TEXT PRIMARY KEY, available INTEGER NOT NULL CHECK (available >= 0));
    CREATE TABLE test_runs (id TEXT PRIMARY KEY, project TEXT NOT NULL);
    CREATE TABLE test_outbox (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES test_runs(id));
    CREATE TABLE test_projects (id TEXT PRIMARY KEY, version INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE test_snapshots (id TEXT PRIMARY KEY, project TEXT NOT NULL, version INTEGER NOT NULL);
    CREATE TABLE test_payments (payment_id TEXT PRIMARY KEY, grant_id TEXT NOT NULL UNIQUE);
    CREATE TABLE test_grants (id TEXT PRIMARY KEY, payment_id TEXT NOT NULL UNIQUE);
    CREATE TABLE test_payloads (id TEXT PRIMARY KEY, payload BLOB NOT NULL);
  `);
});
after(async () => {await harness?.dispose();});

const scope = projectId => ({workspaceId: 'workspace-a', projectId, actorId: 'actor-a', routeId: 'test.submit', routeParams: {}});
const request = (projectId, requestId, overrides = {}) => ({
  scope: scope(projectId), requestId, requestHash: digest({projectId, action: 'submit'}),
  result: {runId: requestId}, steps: [assertSql('ALWAYS_TRUE', '1')], ...overrides,
});
const reserve = (project, runId) => [
  writeSql('UPDATE test_credit SET available = available - 1 WHERE project = ? AND available >= 1', [project]),
  writeSql('INSERT INTO test_runs (id, project) VALUES (?, ?)', [runId, project]),
  writeSql('INSERT INTO test_outbox (id, run_id) VALUES (?, ?)', [runId, runId]),
];
async function count(table, column, value) {
  // Only fixed test identifiers are passed here; all varying values are bound.
  return (await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).bind(value).first()).n;
}
async function credit(project, available) {
  await db.prepare('INSERT INTO test_credit (project, available) VALUES (?, ?)').bind(project, available).run();
}

/** Inject response loss/read failures around real workerd D1, never replace its SQL engine. */
function observedDatabase({onRead, onBatch} = {}) {
  const observed = {sessions: [], reads: 0, batches: 0};
  const database = {
    withSession(mode) {
      observed.sessions.push(mode);
      const session = db.withSession(mode);
      return {
        prepare(sql) {
          const prepared = session.prepare(sql);
          if (!sql.startsWith('SELECT workspace_id')) return prepared;
          return {bind(...values) {
            const bound = prepared.bind(...values);
            return {async first() {
              const ordinal = ++observed.reads;
              const row = await bound.first();
              await onRead?.({ordinal, row});
              return row;
            }};
          }};
        },
        async batch(statements) {
          observed.batches++;
          if (onBatch) return onBatch(session, statements);
          return session.batch(statements);
        },
      };
    },
  };
  return {database, observed};
}

test('T0: commit business data, outbox and canonical result in one real D1 batch', async () => {
  await credit('t0', 2);
  const options = request('t0', 't0-run', {result: {z: 1, runId: 't0-run'}, steps: reserve('t0', 't0-run')});
  const {database, observed} = observedDatabase();
  assert.deepEqual(await guardedBatch(database, options), {value: {runId: 't0-run', z: 1}, replayed: false});
  assert.deepEqual(observed.sessions, ['first-primary']);
  assert.equal((await db.prepare('SELECT available FROM test_credit WHERE project = ?').bind('t0').first()).available, 1);
  assert.equal(await count('test_runs', 'id', 't0-run'), 1);
  assert.equal(await count('test_outbox', 'run_id', 't0-run'), 1);
  const row = await db.prepare('SELECT result_json, request_hash FROM saas_request_results WHERE request_id = ?').bind('t0-run').first();
  assert.equal(row.result_json, '{"runId":"t0-run","z":1}');
  assert.equal(row.request_hash, options.requestHash);
  assert.equal((await db.prepare("SELECT type FROM sqlite_master WHERE name = 'saas_batch_assert'").first()).type, 'view');
});

test('T1: typed false/NULL assertions and zero-row conditional writes roll back the whole batch', async () => {
  for (const [suffix, failedStep, reason, status] of [
    ['false', assertSql('CREDITS_EXHAUSTED', '0'), 'CREDITS_EXHAUSTED', 409],
    ['null', assertSql('RESOURCE_NOT_FOUND', 'NULL', [], 404), 'RESOURCE_NOT_FOUND', 404],
    ['zero-update', writeSql('UPDATE test_credit SET available = available - 1 WHERE project = ?',
      ['absent-project'], {code: 'STALE_VERSION'}), 'STALE_VERSION', 409],
    ['invalid', assertSql('INVALID_STATE', '0', [], 422), 'INVALID_STATE', 422],
  ]) {
    const project = `t1-${suffix}`;
    await credit(project, 1);
    await assert.rejects(guardedBatch(db, request(project, project, {
      steps: [...reserve(project, project), failedStep],
    })), error => error instanceof GuardedBatchPreconditionFailed && error.reason === reason
      && error.status === status && error.retryable === false
      && /PRECONDITION_FAILED:/u.test(String(error.cause)));
    assert.equal((await db.prepare('SELECT available FROM test_credit WHERE project = ?').bind(project).first()).available, 1);
    assert.equal(await count('test_runs', 'id', project), 0);
    assert.equal(await count('test_outbox', 'run_id', project), 0);
    assert.equal(await count('saas_request_results', 'request_id', project), 0);
  }
});

test('T1: a business CHECK failure stays a database error and rolls back earlier writes', async () => {
  const project = 't1-business-check';
  await credit(project, 0);
  await assert.rejects(guardedBatch(db, request(project, project, {steps: [
    writeSql('INSERT INTO test_runs (id, project) VALUES (?, ?)', [project, project]),
    writeSql('INSERT INTO test_outbox (id, run_id) VALUES (?, ?)', [project, project]),
    writeSql('UPDATE test_credit SET available = available - 1 WHERE project = ?', [project]),
  ]})), error => !(error instanceof GuardedBatchPreconditionFailed)
    && /CHECK constraint failed/u.test(String(error)));
  assert.equal((await db.prepare('SELECT available FROM test_credit WHERE project = ?').bind(project).first()).available, 0);
  assert.equal(await count('test_runs', 'id', project), 0);
  assert.equal(await count('test_outbox', 'run_id', project), 0);
  assert.equal(await count('saas_request_results', 'request_id', project), 0);
});

test('T2: concurrent distinct requests competing for the last credit produce exactly one run and outbox', async () => {
  await credit('t2', 1);
  const outcomes = await Promise.allSettled(Array.from({length: 12}, (_, index) => {
    const id = `t2-run-${index}`;
    return guardedBatch(db, request('t2', id, {steps: reserve('t2', id)}));
  }));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected').length, 11);
  assert.equal((await db.prepare('SELECT available FROM test_credit WHERE project = ?').bind('t2').first()).available, 0);
  assert.equal(await count('test_runs', 'project', 't2'), 1);
  assert.equal(await count('saas_request_results', 'project_id', 't2'), 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM test_outbox JOIN test_runs ON test_runs.id = test_outbox.run_id WHERE test_runs.project = ?').bind('t2').first()).n, 1);
});

test('T3: replay, concurrent primary-key conflicts and lost commit acknowledgements reuse the stored result', async () => {
  await credit('t3-race', 1);
  let arrived = 0;
  let release;
  const allMissing = new Promise(resolve => {release = resolve;});
  const {database, observed} = observedDatabase({onRead: async ({ordinal, row}) => {
    if (ordinal > 8) return;
    assert.equal(row, null);
    if (++arrived === 8) release();
    await allMissing;
  }});
  const responses = await Promise.all(Array.from({length: 8}, (_, index) => {
    const runId = `t3-race-${index}`;
    return guardedBatch(database, request('t3-race', 'same-request', {result: {runId}, steps: reserve('t3-race', runId)}));
  }));
  assert.equal(observed.batches, 8); // All preflight reads missed; seven real PK failures recovered.
  assert.equal(responses.filter(result => result.replayed === false).length, 1);
  assert.ok(responses.every(result => result.value.runId === responses[0].value.runId));
  assert.equal(await count('test_runs', 'project', 't3-race'), 1);
  assert.ok(observed.sessions.every(mode => mode === 'first-primary'));
  const replay = await guardedBatch(db, request('t3-race', 'same-request', {
    result: {runId: 'must-not-replace'}, steps: reserve('t3-race', 'must-not-replace'),
  }));
  assert.deepEqual(replay, {value: responses[0].value, replayed: true});
  assert.equal(await count('test_runs', 'id', 'must-not-replace'), 0);

  await credit('t3-lost', 1);
  const lost = observedDatabase({onBatch: async (session, statements) => {
    await session.batch(statements);
    throw new Error('LOST_COMMIT_ACK');
  }});
  const recovered = await guardedBatch(lost.database, request('t3-lost', 't3-lost-run', {steps: reserve('t3-lost', 't3-lost-run')}));
  assert.deepEqual(recovered, {value: {runId: 't3-lost-run'}, replayed: true});
  assert.equal(lost.observed.batches, 1);
  assert.deepEqual(lost.observed.sessions, ['first-primary', 'first-primary']);

  await credit('t3-unknown', 1);
  const unknown = observedDatabase({
    onRead: ({ordinal}) => {if (ordinal === 2) throw new Error('RECOVERY_READ_UNAVAILABLE');},
    onBatch: async (session, statements) => {await session.batch(statements); throw new Error('LOST_COMMIT_ACK');},
  });
  await assert.rejects(guardedBatch(unknown.database, request('t3-unknown', 't3-unknown-run', {steps: reserve('t3-unknown', 't3-unknown-run')})),
    error => error instanceof GuardedBatchOutcomeUnknown && error.retryable && error.cause.message === 'LOST_COMMIT_ACK');
  assert.equal(unknown.observed.batches, 1);
  assert.equal((await guardedBatch(db, request('t3-unknown', 't3-unknown-run', {steps: reserve('t3-unknown', 't3-unknown-run')}))).replayed, true);
});

test('T4: changed body conflicts while workspace/project/actor/route scopes stay independent', async () => {
  const original = request('t4', 'same-id');
  await guardedBatch(db, original);
  assert.equal(requestIdentity(original.scope, original.requestId, original.requestHash).key,
    requestIdentity(original.scope, original.requestId, digest({changed: true})).key);
  await assert.rejects(guardedBatch(db, {...original, requestHash: digest({changed: true})}), IdempotencyConflict);
  for (const changed of [
    {workspaceId: 'workspace-b'}, {projectId: 'project-b'}, {projectId: null},
    {actorId: 'actor-b'}, {routeId: 'test.other'}, {routeParams: {runId: 'run-b'}},
  ]) {
    const variant = {...original, scope: {...original.scope, ...changed}};
    assert.equal((await guardedBatch(db, variant)).replayed, false);
  }
  assert.equal(await count('saas_request_results', 'request_id', 'same-id'), 7);

  // Both initial reads miss; the losing PK conflict must still reject a changed
  // request hash when recovering the winner's row, rather than returning its data.
  let missing = 0;
  let release;
  const barrier = new Promise(resolve => {release = resolve;});
  const competing = observedDatabase({onRead: async ({ordinal, row}) => {
    if (ordinal > 2) return;
    assert.equal(row, null);
    if (++missing === 2) release();
    await barrier;
  }});
  const conflicts = await Promise.allSettled([1, 2].map(body => guardedBatch(competing.database,
    request('t4-conflict-race', 'same-race-id', {requestHash: digest({body}), result: {body}}))));
  assert.equal(conflicts.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(conflicts.find(result => result.status === 'rejected').reason instanceof IdempotencyConflict);
  assert.equal(competing.observed.batches, 2);
  assert.equal(await count('saas_request_results', 'project_id', 't4-conflict-race'), 1);

  const key = requestIdentity(original.scope, original.requestId, original.requestHash).key;
  await db.prepare('UPDATE saas_request_results SET actor_id = ? WHERE idempotency_key = ?').bind('wrong-actor', key).run();
  await assert.rejects(guardedBatch(db, original), IdempotencyConflict);

  assert.equal(resolveRequestId('id-a', 'id-a'), 'id-a');
  assert.equal(resolveRequestId(undefined, 'id-b'), 'id-b');
  assert.throws(() => resolveRequestId('id-a', 'id-b'), IdempotencyConflict);
  assert.throws(() => resolveRequestId(null, null), /IDEMPOTENCY_KEY_REQUIRED/u);
  assert.throws(() => resolveRequestId('line\nbreak', null), /INVALID_IDEMPOTENCY_ID/u);
  assert.throws(() => resolveRequestId('\ud800', null), /INVALID_UNICODE/u);
  assert.throws(() => requestIdentity({...original.scope, routeParams: undefined}, 'id', original.requestHash),
    /INVALID_ROUTE_PARAMS/u);
  assert.throws(() => requestIdentity({...original.scope, routeParams: {'bad/name': 'id'}}, 'id', original.requestHash),
    /INVALID_ROUTE_PARAMS/u);
  assert.notEqual(requestIdentity({...original.scope, routeParams: {runId: 'a'}}, 'id', original.requestHash).key,
    requestIdentity({...original.scope, routeParams: {runId: 'b'}}, 'id', original.requestHash).key);
});

test('T5: concurrent freezes at the same version allow one snapshot; deletion blocks a late freeze', async () => {
  await db.prepare('INSERT INTO test_projects (id, version) VALUES (?, ?)').bind('t5', 4).run();
  const freeze = (project, id) => request(project, id, {steps: [
    assertSql('VERSION_CONFLICT', 'EXISTS (SELECT 1 FROM test_projects WHERE id = ? AND version = 4 AND deleted = 0)', [project]),
    writeSql('UPDATE test_projects SET version = version + 1 WHERE id = ? AND version = 4 AND deleted = 0', [project]),
    writeSql('INSERT INTO test_snapshots (id, project, version) VALUES (?, ?, ?)', [id, project, 4]),
  ]});
  const outcomes = await Promise.allSettled([guardedBatch(db, freeze('t5', 't5-a')), guardedBatch(db, freeze('t5', 't5-b'))]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(await count('test_snapshots', 'project', 't5'), 1);
  assert.equal((await db.prepare('SELECT version FROM test_projects WHERE id = ?').bind('t5').first()).version, 5);

  await db.prepare('INSERT INTO test_projects (id, version, deleted) VALUES (?, ?, ?)').bind('t5-deleted', 4, 1).run();
  await assert.rejects(guardedBatch(db, freeze('t5-deleted', 't5-late')), GuardedBatchPreconditionFailed);
  assert.equal(await count('test_snapshots', 'project', 't5-deleted'), 0);
  assert.equal(await count('saas_request_results', 'request_id', 't5-late'), 0);
});

test('T6: an outbox failure rolls back the earlier reserve, run and result; failed recovery never retries', async () => {
  await credit('t6', 1);
  await db.prepare('INSERT INTO test_runs (id, project) VALUES (?, ?)').bind('t6-existing', 'other-project').run();
  await db.prepare('INSERT INTO test_outbox (id, run_id) VALUES (?, ?)').bind('t6-run', 't6-existing').run();
  const failed = observedDatabase();
  await assert.rejects(guardedBatch(failed.database, request('t6', 't6-run', {steps: reserve('t6', 't6-run')})), /UNIQUE constraint failed/u);
  assert.equal(failed.observed.batches, 1);
  assert.deepEqual(failed.observed.sessions, ['first-primary', 'first-primary']);
  assert.equal((await db.prepare('SELECT available FROM test_credit WHERE project = ?').bind('t6').first()).available, 1);
  assert.equal(await count('test_runs', 'id', 't6-run'), 0);
  assert.equal(await count('saas_request_results', 'request_id', 't6-run'), 0);

  const beforeWrite = observedDatabase({onRead: () => {throw new Error('PRIMARY_READ_UNAVAILABLE');}});
  await assert.rejects(guardedBatch(beforeWrite.database, request('t6', 't6-no-write')), /PRIMARY_READ_UNAVAILABLE/u);
  assert.equal(beforeWrite.observed.batches, 0);
  const uncertain = observedDatabase({
    onBatch: () => {throw new Error('BATCH_UNAVAILABLE');},
    onRead: ({ordinal}) => {if (ordinal === 2) throw new Error('PRIMARY_READ_UNAVAILABLE');},
  });
  await assert.rejects(guardedBatch(uncertain.database, request('t6', 't6-not-committed')), GuardedBatchOutcomeUnknown);
  assert.equal(uncertain.observed.batches, 1);
});

test('T7: duplicate payment observations cannot grant twice, even with different request IDs', async () => {
  const payment = (requestId, grantId) => request('t7', requestId, {result: {grantId}, steps: [
    writeSql('INSERT INTO test_payments (payment_id, grant_id) VALUES (?, ?)', ['provider-payment-1', grantId]),
    writeSql('INSERT INTO test_grants (id, payment_id) VALUES (?, ?)', [grantId, 'provider-payment-1']),
    writeSql('INSERT INTO test_runs (id, project) VALUES (?, ?)', [grantId, 't7']),
    writeSql('INSERT INTO test_outbox (id, run_id) VALUES (?, ?)', [grantId, grantId]),
  ]});
  const submissions = [payment('callback-1', 'grant-1'), payment('callback-2', 'grant-2')];
  const outcomes = await Promise.allSettled(submissions.map(options => guardedBatch(db, options)));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  const winner = outcomes.findIndex(result => result.status === 'fulfilled');
  const failure = outcomes.find(result => result.status === 'rejected');
  assert.match(String(failure.reason), /UNIQUE constraint failed/u);
  assert.equal(await count('test_payments', 'payment_id', 'provider-payment-1'), 1);
  assert.equal(await count('test_grants', 'payment_id', 'provider-payment-1'), 1);
  assert.equal(await count('test_runs', 'project', 't7'), 1);
  assert.equal(await count('saas_request_results', 'project_id', 't7'), 1);
  assert.equal((await guardedBatch(db, submissions[winner])).replayed, true);
});

test('bounded results, safe counts and empty plans are rejected before a database call', async () => {
  const unreachable = {withSession() {throw new Error('MUST_NOT_ACCESS_DB');}};
  await assert.rejects(guardedBatch(unreachable, request('validation', 'oversized', {result: 'a'.repeat(65537)})), /BATCH_RESULT_TOO_LARGE/u);
  await assert.rejects(guardedBatch(unreachable, request('validation', 'no-steps', {steps: []})), /INVALID_BATCH_SIZE/u);
  await assert.rejects(guardedBatch(unreachable, request('validation', 'many-steps', {steps: Array.from({length: 100}, () => assertSql('ONE', '1'))})), /INVALID_BATCH_SIZE/u);
  assert.throws(() => writeSql('UPDATE anything SET value = 0', [], {expectedChanges: -1}), /INVALID_GUARDED_WRITE/u);
  assert.throws(() => writeSql('UPDATE anything SET value = 0', [], {expectedChanges: 1.5}), /INVALID_GUARDED_WRITE/u);
  assert.throws(() => assertSql('EMPTY', ' '), /EMPTY_SQL_ASSERTION/u);
  assert.throws(() => assertSql('bad.reason', '1'), /INVALID_PRECONDITION/u);
  assert.throws(() => writeSql('UPDATE anything SET value = 0', [], {status: 500}), /INVALID_PRECONDITION/u);
});

test('the submitted scope, result, SQL steps and binary bindings are snapshots across the preflight await', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const bindings = ['snapshot-original', bytes];
  const options = request('snapshot', 'snapshot-request', {
    result: {id: 'snapshot-original'},
    steps: [writeSql('INSERT INTO test_payloads (id, payload) VALUES (?, ?)', bindings)],
  });
  const {database} = observedDatabase({onRead: () => {
    bytes[0] = 99;
    bindings[0] = 'snapshot-mutated';
    options.scope.actorId = 'mutated-actor';
    options.result.id = 'snapshot-mutated';
    options.steps[0].sql = 'INVALID SQL';
    options.steps.push(assertSql('ALWAYS_FALSE', '0'));
  }});
  const response = await guardedBatch(database, options);
  assert.deepEqual(response, {value: {id: 'snapshot-original'}, replayed: false});
  assert.equal((await db.prepare('SELECT hex(payload) AS bytes FROM test_payloads WHERE id = ?').bind('snapshot-original').first()).bytes, '010203');
  assert.equal(await count('test_payloads', 'id', 'snapshot-mutated'), 0);
  assert.equal((await db.prepare('SELECT actor_id FROM saas_request_results WHERE request_id = ?').bind('snapshot-request').first()).actor_id, 'actor-a');
});
