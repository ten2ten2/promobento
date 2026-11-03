import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {IdempotencyConflict, requestIdentity} from './idempotency.ts';
import type {RequestIdentity, RequestScope} from './idempotency.ts';

type SqlValue = string | number | null | ArrayBuffer | ArrayBufferView;
type PreconditionStatus = 404 | 409 | 422;

type Precondition = Readonly<{code: string; status: PreconditionStatus}>;

export type GuardedStep =
  | Readonly<{kind: 'assert'; condition: string; bindings: readonly SqlValue[]} & Precondition>
  | Readonly<{kind: 'write'; sql: string; bindings: readonly SqlValue[]; expectedChanges: number} & Precondition>;

function precondition(code: string, status: PreconditionStatus): Precondition {
  if (typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(code)
    || ![404, 409, 422].includes(status)) throw new TypeError('INVALID_PRECONDITION');
  return {code, status};
}

/** SQL text is trusted application code; bind all values from requests. NULL also fails. */
export function assertSql(code: string, condition: string, bindings: readonly SqlValue[] = [],
  status: PreconditionStatus = 409): GuardedStep {
  if (!condition.trim()) throw new TypeError('EMPTY_SQL_ASSERTION');
  return {kind: 'assert', condition, bindings, ...precondition(code, status)};
}

/** The executor inserts an immediate changes() assertion; zero-row updates cannot silently commit. */
export function writeSql(sql: string, bindings: readonly SqlValue[] = [],
  options: Readonly<{expectedChanges?: number; code?: string; status?: PreconditionStatus}> = {}): GuardedStep {
  const {expectedChanges = 1, code = 'WRITE_CONFLICT', status = 409} = options;
  if (!sql.trim() || !Number.isSafeInteger(expectedChanges) || expectedChanges < 0) {
    throw new TypeError('INVALID_GUARDED_WRITE');
  }
  return {kind: 'write', sql, bindings, expectedChanges, ...precondition(code, status)};
}

export class GuardedBatchPreconditionFailed extends Error {
  readonly code = 'GUARDED_BATCH_PRECONDITION_FAILED';
  readonly retryable = false;
  readonly reason: string;
  readonly status: PreconditionStatus;
  constructor(reason: string, status: PreconditionStatus, cause: unknown) {
    super('GUARDED_BATCH_PRECONDITION_FAILED', {cause});
    this.name = 'GuardedBatchPreconditionFailed';
    this.reason = reason;
    this.status = status;
  }
}

export class GuardedBatchOutcomeUnknown extends Error {
  readonly code = 'GUARDED_BATCH_OUTCOME_UNKNOWN';
  readonly retryable = true;
  readonly readError: unknown;
  constructor(batchError: unknown, readError: unknown) {
    super('GUARDED_BATCH_OUTCOME_UNKNOWN', {cause: batchError});
    this.name = 'GuardedBatchOutcomeUnknown';
    this.readError = readError;
  }
}

type ResultRow = {
  workspace_id: string; project_id: string | null; actor_id: string; route_id: string;
  request_id: string; request_hash: string; result_json: string;
};

type BatchOptions<T> = Readonly<{
  scope: RequestScope;
  requestId: string;
  /** SHA-256/JCS digest from the shared contracts package, after request validation. */
  requestHash: string;
  /** Small stable response (usually assigned IDs), committed with all business side effects. */
  result: T;
  steps: readonly GuardedStep[];
}>;

export type GuardedBatchResult<T> = Readonly<{value: T; replayed: boolean}>;

// Application bounds, not claims about D1's platform limits. Never cache media or full projects.
const MAX_RESULT_BYTES = 64 * 1024;
const MAX_BATCH_STATEMENTS = 100;

function bindValue(value: SqlValue): SqlValue {
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer;
  if (value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value;
  throw new TypeError('INVALID_SQL_BINDING');
}

function assertion(session: D1DatabaseSession, code: string, condition: string, bindings: readonly SqlValue[]) {
  return session.prepare(`INSERT INTO saas_batch_assert (code, passed)
    VALUES (?, CASE WHEN (${condition}) THEN 1 ELSE 0 END)`).bind(code, ...bindings.map(bindValue));
}

function failedPrecondition(error: unknown, codes: ReadonlyMap<string, PreconditionStatus>) {
  const message = error instanceof Error ? error.message : '';
  const match = /PRECONDITION_FAILED:([A-Z][A-Z0-9_]{0,63})(?![A-Z0-9_])/u.exec(message);
  const reason = match?.[1];
  const status = reason ? codes.get(reason) : undefined;
  return reason === undefined || status === undefined ? null : new GuardedBatchPreconditionFailed(reason, status, error);
}

async function readResult<T>(session: D1DatabaseSession, identity: RequestIdentity): Promise<{value: T} | null> {
  const row = await session.prepare(`SELECT workspace_id, project_id, actor_id, route_id,
      request_id, request_hash, result_json FROM saas_request_results WHERE idempotency_key = ?`)
    .bind(identity.key).first<ResultRow>();
  if (!row) return null;
  const {scope} = identity;
  if (row.workspace_id !== scope.workspaceId || row.project_id !== scope.projectId ||
    row.actor_id !== scope.actorId || row.route_id !== scope.routeId ||
    row.request_id !== identity.requestId || row.request_hash !== identity.requestHash) {
    throw new IdempotencyConflict();
  }
  // Use the original committed response, never rebuild it from current project state.
  return {value: parseCanonicalJson(row.result_json) as T};
}

/**
 * Execute one atomic D1 batch, including its idempotent result. Callers must check
 * current authentication/authorization before using this helper, including on replay.
 * Permission, version, lifecycle and balance conditions needed at commit time must
 * also be SQL assertions in this batch. External effects belong in a durable outbox.
 *
 * This helper never automatically retries. After a failed/uncertain batch it reads
 * the result on the primary. Only a matching committed result proves success. If
 * absent, the original error is preserved; a caller may retry the same request/key.
 * A failed recovery read leaves the outcome unknown, with no second batch issued.
 */
export async function guardedBatch<T>(db: D1Database, options: BatchOptions<T>): Promise<GuardedBatchResult<T>> {
  const identity = requestIdentity(options.scope, options.requestId, options.requestHash);
  const resultJson = canonical(options.result);
  if (new TextEncoder().encode(resultJson).byteLength > MAX_RESULT_BYTES) throw new TypeError('BATCH_RESULT_TOO_LARGE');
  const statementCount = 1 + options.steps.reduce((count, step) => count + (step.kind === 'write' ? 2 : 1), 0);
  if (!options.steps.length || statementCount > MAX_BATCH_STATEMENTS) throw new TypeError('INVALID_BATCH_SIZE');

  const session = db.withSession('first-primary');
  const codes = new Map<string, PreconditionStatus>();
  // Insert first: concurrent identical requests fail their PK before any side effect.
  // Any later CHECK/unique/error rolls this row back together with the business data.
  const statements = [session.prepare(`INSERT INTO saas_request_results
    (idempotency_key, workspace_id, project_id, actor_id, route_id, request_id, request_hash, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(identity.key, identity.scope.workspaceId,
    identity.scope.projectId, identity.scope.actorId, identity.scope.routeId, identity.requestId,
    identity.requestHash, resultJson, Date.now())];
  for (const step of options.steps) {
    const condition = precondition(step.code, step.status);
    const previousStatus = codes.get(condition.code);
    if (previousStatus !== undefined && previousStatus !== condition.status) throw new TypeError('AMBIGUOUS_PRECONDITION');
    codes.set(condition.code, condition.status);
    if (step.kind === 'assert') statements.push(assertion(session, condition.code, step.condition, step.bindings));
    else {
      if (!Number.isSafeInteger(step.expectedChanges) || step.expectedChanges < 0) throw new TypeError('INVALID_GUARDED_WRITE');
      statements.push(session.prepare(step.sql).bind(...step.bindings.map(bindValue)));
      statements.push(assertion(session, condition.code, 'changes() = ?', [step.expectedChanges]));
    }
  }

  // Compile/bind before the first await: a caller reusing an array or binary buffer
  // cannot change the transaction while its primary preflight read is pending.
  const previous = await readResult<T>(session, identity);
  if (previous) return {value: previous.value, replayed: true};

  try {
    const results = await session.batch(statements);
    if (results.length !== statements.length || results.some(result => result.success !== true)) {
      throw new Error('D1_BATCH_RESULT_UNCONFIRMED');
    }
  } catch (batchError) {
    let recovered: {value: T} | null;
    try {
      // A fresh first-primary session avoids a replica returning a stale missing row.
      recovered = await readResult<T>(db.withSession('first-primary'), identity);
    } catch (readError) {
      if (readError instanceof IdempotencyConflict) throw readError;
      throw new GuardedBatchOutcomeUnknown(batchError, readError);
    }
    if (recovered) return {value: recovered.value, replayed: true};
    const preconditionError = failedPrecondition(batchError, codes);
    if (preconditionError) throw preconditionError;
    throw batchError;
  }
  // Snapshot before the await means callers cannot mutate the returned result in flight.
  return {value: parseCanonicalJson(resultJson) as T, replayed: false};
}
