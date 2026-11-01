import type {WorkflowStep} from 'cloudflare:workers';
import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {operation} from './store.ts';
import {renderFailureCode} from './render-recovery.ts';
import {assertNativeExecution, nativeRenderPolicy} from './native-task.ts';
import {requestRenderAdmission, waitForRenderAdmission, claimRenderAdmission, canRetryUnstartedAdmission, requeueRenderAfterAttempt} from './render-admission.ts';
import type {PipelineEnv, Json, Operation} from './pipeline-types.ts';

const retryable = new Set(['RENDER_CAPACITY_UNAVAILABLE', 'RENDER_STARTUP_CONNECTION_LOST', 'RENDER_DISPATCH_CONNECTION_LOST',
  'RENDER_EXECUTE_CONNECTION_LOST', 'RENDER_RPC_CONNECTION_LOST', 'RENDER_BROKER_CONNECTION_LOST',
  'RENDER_BROKER_REGISTRATION_TIMEOUT', 'RENDER_STARTUP_TIMEOUT']);
const hardRecoveryErrors = new Set(['RENDER_ATTEMPT_SCOPE_INVALID', 'NATIVE_RENDER_EVIDENCE_INVALID',
  'OPERATION_FENCED', 'RENDER_ADMISSION_CONFLICT', 'RENDER_ATTEMPT_OUTCOME_CONFLICT']);
const outcomePending = Symbol('render-outcome-pending');
type Recovered = Json | typeof outcomePending | null;

/** An unavailable DO/storage RPC cannot hold the Workflow's recovery preflight forever. */
async function bounded<T>(request: Promise<T>, ms = 7_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error('RENDER_RECOVERY_TIMEOUT')), ms);
    })]);
  } finally {if (timer !== undefined) clearTimeout(timer);}
}

const isUnknownRecovery = (error: unknown) =>
  !hardRecoveryErrors.has(String((error as {message?: unknown})?.message ?? error));

/** The physical result can be committed before Workflow checkpoints its step.do return. */
async function completedRenderAttempt(env: PipelineEnv, op: Operation, renderId: string,
  attemptId: string, index: number, mode: string): Promise<Json | null> {
  const row = await env.DB.prepare(`SELECT p.result_json FROM pipeline_attempts p
    JOIN pipeline_render_admissions a ON a.id=p.id
    JOIN pipeline_renders r ON r.id=p.render_id
    JOIN pipeline_operations o ON o.id=p.operation_id
    WHERE p.id=? AND p.render_id=? AND p.operation_id=? AND p.generation=? AND p.mode=?
      AND p.status='succeeded' AND p.stopped_at IS NOT NULL AND p.result_json IS NOT NULL
      AND a.render_id=p.render_id AND a.operation_id=p.operation_id AND a.generation=p.generation
      AND a.attempt_index=? AND a.workspace_id=? AND a.status='released'
      AND a.lease_token IS NOT NULL AND a.attempt_deadline_at IS NOT NULL
      AND r.generation=p.generation AND r.status IN ('rendering','verifying','passed')
      AND o.generation=p.generation AND o.status='active'
      AND NOT EXISTS(SELECT 1 FROM cost_reservations c LEFT JOIN cost_settlements s ON s.reservation_id=c.id
        WHERE c.id=p.id AND s.reservation_id IS NULL)`)
    .bind(attemptId, renderId, op.id, op.generation, 'native_' + mode, index, op.workspace_id)
    .first<{result_json: string}>();
  if (!row) return null;
  const result = parseCanonicalJson(row.result_json) as Json;
  if (!result || typeof result !== 'object' || Array.isArray(result) || result.status !== 'succeeded')
    throw Error('NATIVE_RENDER_EVIDENCE_INVALID');
  return {...result, attemptId};
}

/** A confirmed, settled failure (retryable or terminal) survives a lost Workflow checkpoint. */
async function completedFailedAttempt(env: PipelineEnv, op: Operation, renderId: string,
  attemptId: string, index: number, mode: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT p.result_json FROM pipeline_attempts p
    JOIN pipeline_render_admissions a ON a.id=p.id
    JOIN pipeline_renders r ON r.id=p.render_id
    JOIN pipeline_operations o ON o.id=p.operation_id
    WHERE p.id=? AND p.render_id=? AND p.operation_id=? AND p.generation=? AND p.mode=?
      AND p.status='failed' AND p.stopped_at IS NOT NULL AND p.result_json IS NOT NULL
      AND a.render_id=p.render_id AND a.operation_id=p.operation_id AND a.generation=p.generation
      AND a.attempt_index=? AND a.workspace_id=? AND a.status='released'
      AND a.lease_token IS NOT NULL AND a.attempt_deadline_at IS NOT NULL
      AND r.generation=p.generation AND r.status IN ('rendering','queued')
      AND o.generation=p.generation AND o.status='active'
      AND NOT EXISTS(SELECT 1 FROM cost_reservations c LEFT JOIN cost_settlements s ON s.reservation_id=c.id
        WHERE c.id=p.id AND s.reservation_id IS NULL)`)
    .bind(attemptId, renderId, op.id, op.generation, 'native_' + mode, index, op.workspace_id)
    .first<{result_json: string}>();
  if (!row) return null;
  const result = parseCanonicalJson(row.result_json) as Json;
  return result?.status === 'failed' && typeof result.code === 'string' ? result.code : null;
}

/** A lost Shard RPC can leave its durable success ahead of the D1 attempt row. */
async function reconcileShardSuccess(env: PipelineEnv, op: Operation, renderId: string,
  attemptId: string, index: number, mode: string): Promise<Recovered> {
  let row: {lease_token: string; attempt_deadline_at: number} | null;
  try {row = await bounded(env.DB.prepare(`SELECT a.lease_token,a.attempt_deadline_at FROM pipeline_attempts p
    JOIN pipeline_render_admissions a ON a.id=p.id
    JOIN pipeline_renders r ON r.id=p.render_id
    JOIN pipeline_operations o ON o.id=p.operation_id
    WHERE p.id=? AND p.render_id=? AND p.operation_id=? AND p.generation=? AND p.mode=?
      AND p.status IN ('active','stopped') AND a.render_id=p.render_id
      AND a.operation_id=p.operation_id AND a.generation=p.generation
      AND a.attempt_index=? AND a.workspace_id=? AND a.status IN ('running','released')
      AND a.lease_token IS NOT NULL AND a.attempt_deadline_at IS NOT NULL
      AND r.generation=p.generation AND r.status IN ('rendering','verifying')
      AND o.generation=p.generation AND o.status='active'`)
    .bind(attemptId, renderId, op.id, op.generation, 'native_' + mode, index, op.workspace_id)
    .first<{lease_token: string; attempt_deadline_at: number}>());}
  catch {return outcomePending;}
  if (!row) return null;
  const shard = env.SHARDS.getByName(attemptId);
  const scope = {attemptId, renderId, operationId: op.id, generation: op.generation, leaseToken: row.lease_token};
  let stored: string | null;
  try {stored = await bounded(shard.recoverCompletedResult(scope));}
  catch (error) {
    if (!isUnknownRecovery(error)) throw error;
    if (Date.now() < row.attempt_deadline_at) return outcomePending;
    // Stopping is a separate barrier: a stopped container does not prove its
    // in-flight coroutine has finished persisting the durable result.
    try {
      await bounded(shard.stopAndSettle());
      stored = await bounded(shard.recoverCompletedResult(scope));
    } catch (afterStopError) {
      if (!isUnknownRecovery(afterStopError)) throw afterStopError;
      return outcomePending;
    }
  }
  if (!stored) return null;
  const result = parseCanonicalJson(stored) as Json;
  if (!result || typeof result !== 'object' || Array.isArray(result) || result.status !== 'succeeded')
    throw Error('NATIVE_RENDER_EVIDENCE_INVALID');
  let changed;
  try {
    changed = await bounded(env.DB.prepare(`UPDATE pipeline_attempts SET status='succeeded',stopped_at=COALESCE(stopped_at,?),result_json=?
      WHERE id=? AND render_id=? AND operation_id=? AND generation=? AND mode=? AND status IN ('active','stopped')
        AND stopped_at IS NOT NULL
        AND EXISTS(SELECT 1 FROM pipeline_render_admissions a WHERE a.id=pipeline_attempts.id
          AND a.status='released' AND a.lease_token=? AND a.attempt_index=? AND a.workspace_id=?)
        AND EXISTS(SELECT 1 FROM pipeline_renders r JOIN pipeline_operations o ON o.id=r.operation_id
          WHERE r.id=pipeline_attempts.render_id AND r.generation=pipeline_attempts.generation
          AND r.status IN ('rendering','verifying') AND o.status='active' AND o.generation=r.generation)
        AND NOT EXISTS(SELECT 1 FROM cost_reservations c LEFT JOIN cost_settlements s ON s.reservation_id=c.id
          WHERE c.id=pipeline_attempts.id AND s.reservation_id IS NULL)`)
      .bind(Date.now(), canonical(result), attemptId, renderId, op.id, op.generation,
        'native_' + mode, row.lease_token, index, op.workspace_id).run());
  } catch (error) {
    // The success update itself may have committed even if its response vanished.
    try {
      const completed = await bounded(completedRenderAttempt(env, op, renderId, attemptId, index, mode));
      if (completed) return completed;
    } catch { /* Its read may also be unavailable; preserve the unknown outcome. */ }
    if (isUnknownRecovery(error)) return outcomePending;
    throw error;
  }
  if (!changed.meta.changes) {
    const completed = await completedRenderAttempt(env, op, renderId, attemptId, index, mode);
    if (completed) return completed;
    throw Error('RENDER_ATTEMPT_OUTCOME_CONFLICT');
  }
  return {...result, attemptId};
}

/** A lost D1 batch response is not evidence that its claim transaction rolled back. */
async function claimWithRecheck(env: PipelineEnv, op: Operation, input: Json, attemptId: string, token: string) {
  try {return await claimRenderAdmission(env, op, input, attemptId, token);}
  catch (error) {
    if (String((error as {message?: unknown})?.message ?? error) !== 'Network connection lost.') throw error;
    return claimRenderAdmission(env, op, input, attemptId, token);
  }
}

/** Confirm stop, cost and fencing before converting an absent success into a retryable failure. */
async function settleKnownFailure(env: PipelineEnv, op: Operation, renderId: string, attemptId: string,
  index: number, mode: string, fallbackCode?: string): Promise<Recovered> {
  let row: {lease_token: string; result_json: string | null} | null;
  try {
    row = await bounded(env.DB.prepare(`SELECT a.lease_token,p.result_json FROM pipeline_attempts p
      JOIN pipeline_render_admissions a ON a.id=p.id
      JOIN pipeline_renders r ON r.id=p.render_id JOIN pipeline_operations o ON o.id=p.operation_id
      WHERE p.id=? AND p.render_id=? AND p.operation_id=? AND p.generation=? AND p.mode=?
        AND p.status IN ('active','stopped') AND a.attempt_index=? AND a.workspace_id=?
        AND a.status IN ('running','released') AND a.lease_token IS NOT NULL
        AND r.status IN ('rendering','verifying') AND r.generation=p.generation
        AND o.status='active' AND o.generation=p.generation`)
      .bind(attemptId, renderId, op.id, op.generation, 'native_' + mode, index, op.workspace_id)
      .first<{lease_token: string; result_json: string | null}>());
  } catch {return outcomePending;}
  if (!row) return outcomePending;
  const diagnostic = row.result_json ? parseCanonicalJson(row.result_json) as Json : null;
  const code = diagnostic?.status === 'failed' && typeof diagnostic.code === 'string'
    ? diagnostic.code : fallbackCode;
  // Missing diagnostics from a lost execution coroutine are not proof of failure.
  if (!code) return outcomePending;
  const shard = env.SHARDS.getByName(attemptId);
  try {
    await bounded(shard.stopAndSettle());
    await bounded(env.COORDINATOR.getByName('global-v1').release(attemptId, row.lease_token));
    if (!await bounded(shard.isStopped())) return outcomePending;
    const unsettled = await bounded(env.DB.prepare(`SELECT c.id FROM cost_reservations c
      LEFT JOIN cost_settlements s ON s.reservation_id=c.id WHERE c.id=? AND s.reservation_id IS NULL`)
      .bind(attemptId).first());
    if (unsettled) return outcomePending;
    // A failed Shard may never have bound its taskId, so its stop RPC cannot
    // update D1. Only a confirmed stop plus released lease can fill that gap.
    await bounded(env.DB.prepare(`UPDATE pipeline_attempts SET
      status=CASE WHEN status='active' THEN 'stopped' ELSE status END,stopped_at=COALESCE(stopped_at,?)
      WHERE id=? AND render_id=? AND operation_id=? AND generation=? AND status IN ('active','stopped')
        AND EXISTS(SELECT 1 FROM pipeline_render_admissions a WHERE a.id=pipeline_attempts.id
          AND a.status='released' AND a.lease_token=?)`)
      .bind(Date.now(), attemptId, renderId, op.id, op.generation, row.lease_token).run());
  } catch {return outcomePending;}
  const recovered = await reconcileShardSuccess(env, op, renderId, attemptId, index, mode);
  if (recovered !== null) return recovered;
  let changed;
  try {
    changed = await bounded(env.DB.prepare(`UPDATE pipeline_attempts SET
      status='failed',stopped_at=COALESCE(stopped_at,?),result_json=COALESCE(result_json,?)
      WHERE id=? AND render_id=? AND operation_id=? AND generation=? AND mode=? AND status IN ('active','stopped')
        AND stopped_at IS NOT NULL AND EXISTS(SELECT 1 FROM pipeline_render_admissions a
          WHERE a.id=pipeline_attempts.id AND a.status='released' AND a.lease_token=?
            AND a.attempt_index=? AND a.workspace_id=?)
        AND NOT EXISTS(SELECT 1 FROM cost_reservations c LEFT JOIN cost_settlements s ON s.reservation_id=c.id
          WHERE c.id=pipeline_attempts.id AND s.reservation_id IS NULL)`)
      .bind(Date.now(), canonical({status: 'failed', code}), attemptId, renderId, op.id, op.generation,
        'native_' + mode, row.lease_token, index, op.workspace_id).run());
  } catch {return outcomePending;}
  if (!changed.meta.changes) {
    const completed = await completedRenderAttempt(env, op, renderId, attemptId, index, mode);
    if (completed) return completed;
    const failedCode = await completedFailedAttempt(env, op, renderId, attemptId, index, mode);
    if (failedCode) {
      if (retryable.has(failedCode)) return {kind: 'render_platform_retry', code: failedCode, attemptId};
      throw Error(failedCode);
    }
    return outcomePending;
  }
  const knownCode = await completedFailedAttempt(env, op, renderId, attemptId, index, mode);
  if (!knownCode) return outcomePending;
  if (retryable.has(knownCode)) return {kind: 'render_platform_retry', code: knownCode, attemptId};
  throw Error(knownCode); // Preserve the Shard's durable non-retryable diagnosis.
}

/** Workflow-level, checkpointed reconciliation survives a Shard outliving its 5s RPC window. */
async function waitForPendingOutcome(env: PipelineEnv, step: WorkflowStep, name: string, op: Operation,
  renderId: string, attemptId: string, index: number, mode: string, operationDeadlineAt: number,
  fallbackCode?: string): Promise<Json> {
  const checks = Math.ceil(nativeRenderPolicy.exportOperationMs / 5_000) + 4;
  for (let check = 0; check < checks; check++) {
    let readable = false, priorFailure: string | null = null;
    try {
      await bounded(operation(env, op.id, op.generation));
      const completed = await bounded(completedRenderAttempt(env, op, renderId, attemptId, index, mode));
      if (completed) return completed;
      priorFailure = await bounded(completedFailedAttempt(env, op, renderId, attemptId, index, mode));
      readable = true;
    } catch (error) {
      if (!isUnknownRecovery(error)) throw error;
    }
    if (priorFailure) {
      if (!retryable.has(priorFailure)) throw Error(priorFailure);
      return {kind: 'render_platform_retry', code: priorFailure, attemptId};
    }
    if (readable) {
      const recovered = await reconcileShardSuccess(env, op, renderId, attemptId, index, mode);
      if (recovered && recovered !== outcomePending) return recovered;
      if (recovered === null) {
        const settled = await settleKnownFailure(env, op, renderId, attemptId, index, mode, fallbackCode);
        if (settled && settled !== outcomePending) return settled;
      }
    }
    // An unknown outcome is not a failed render until its total operation
    // deadline. In particular, never re-admit another paid physical attempt.
    if (Date.now() >= operationDeadlineAt) throw Error('RENDER_ATTEMPT_OUTCOME_UNKNOWN');
    const wakeAt = await step.do<number>(name + '-outcome-wake-' + check,
      {retries: {limit: 0, delay: '1 second'}}, async () => Math.min(operationDeadlineAt, Date.now() + 5_000));
    await step.sleepUntil(name + '-outcome-wait-' + check, wakeAt);
  }
  throw Error('RENDER_ATTEMPT_OUTCOME_UNKNOWN');
}

/** One movie per physical attempt; a retry requires confirmed stop and settled compute usage. */
export async function runNativeRenderTask(env: PipelineEnv, step: WorkflowStep, context: {
  renderId: string; op: Operation; input: Json; imageDigest: string; operationDeadlineAt?: number;
}): Promise<Json> {
  const {renderId, op, input, imageDigest} = context;
  const operationDeadlineAt = context.operationDeadlineAt ?? (await bounded(env.DB.prepare(`SELECT operation_deadline_at
    FROM pipeline_renders WHERE id=? AND operation_id=? AND generation=?`)
    .bind(renderId, op.id, op.generation).first<{operation_deadline_at: number}>()))?.operation_deadline_at;
  if (!operationDeadlineAt) throw Error('RENDER_OPERATION_DEADLINE');
  let lastCode = 'RENDER_INTERNAL_ERROR';
  for (let index = 0; index < nativeRenderPolicy.maxAttempts; index++) {
    const name = index ? 'native-project-retry-' + index : 'native-project';
    if (index) {
      await operation(env, op.id, op.generation);
      await step.sleep(name + '-backoff', '15 seconds');
    }
    const attemptId = await step.do(name + '-id', async () => crypto.randomUUID());
    // Also handle a lost queue-step checkpoint: a released, settled physical
    // attempt must not request a fresh grant or launch compute a second time.
    let completed: Json | null, preflightUnknown = false;
    try {completed = await bounded(completedRenderAttempt(env, op, renderId, attemptId, index, input.mode));}
    catch (error) {
      if (!isUnknownRecovery(error)) throw error;
      completed = null; preflightUnknown = true;
    }
    if (completed) return completed;
    let priorFailure: string | null;
    try {priorFailure = await bounded(completedFailedAttempt(env, op, renderId, attemptId, index, input.mode));}
    catch (error) {
      if (!isUnknownRecovery(error)) throw error;
      const pending = await waitForPendingOutcome(env, step, name, op, renderId, attemptId, index,
        input.mode, operationDeadlineAt);
      if (pending.kind !== 'render_platform_retry') return pending;
      lastCode = pending.code;
      if (index + 1 < nativeRenderPolicy.maxAttempts) {
        await step.do(name + '-requeue', {retries: {limit: 0, delay: '1 second'}}, async () =>
          requeueRenderAfterAttempt(env, op, renderId, attemptId));
        continue;
      }
      throw Error(lastCode);
    }
    if (priorFailure) {
      if (!retryable.has(priorFailure)) throw Error(priorFailure);
      lastCode = priorFailure;
      if (index + 1 < nativeRenderPolicy.maxAttempts) {
        await step.do(name + '-requeue', {retries: {limit: 0, delay: '1 second'}}, async () =>
          requeueRenderAfterAttempt(env, op, renderId, attemptId));
        continue;
      }
      throw Error(lastCode);
    }
    const recovered = preflightUnknown ? outcomePending
      : await reconcileShardSuccess(env, op, renderId, attemptId, index, input.mode);
    if (recovered && recovered !== outcomePending) return recovered;
    if (recovered === outcomePending) {
      const pending = await waitForPendingOutcome(env, step, name, op, renderId, attemptId, index,
        input.mode, operationDeadlineAt);
      if (pending.kind !== 'render_platform_retry') return pending;
      lastCode = pending.code;
      if (index + 1 < nativeRenderPolicy.maxAttempts) {
        await step.do(name + '-requeue', {retries: {limit: 0, delay: '1 second'}}, async () =>
          requeueRenderAfterAttempt(env, op, renderId, attemptId));
        continue;
      }
      throw Error(lastCode);
    }
    const ticket = parseCanonicalJson(await step.do(name + '-queue', {retries: {limit: 3, delay: '1 second'}}, async () =>
      canonical(await requestRenderAdmission(env, renderId, op, attemptId, index)))) as {
        id: string; requestedAt: number; queueDeadlineAt: number; operationDeadlineAt: number;
      };
    // A grant can expire after its final recheck but before claim. Retry the
    // admission (not the physical attempt) only if no physical row was created.
    let value: Json | null = null;
    const admissionRounds = Math.ceil(nativeRenderPolicy.queueWaitMs / 60_000) + 3;
    for (let round = 0; round < admissionRounds; round++) {
      const roundName = round ? name + '-grant-retry-' + round : name;
      const leaseToken = await waitForRenderAdmission(env, step, roundName + '-admission', ticket, index);
      const result = parseCanonicalJson(await step.do(roundName, {retries: {limit: 0, delay: '1 second'}, timeout: '15 minutes'}, async () => {
        await operation(env, op.id, op.generation);
        let deadlineAt: number;
        try {deadlineAt = await claimWithRecheck(env, op, input, attemptId, leaseToken);}
        catch (error) {
          const code = String((error as {message?: unknown})?.message ?? error);
          // Another continuation may have finished and released this same
          // attempt between the preflight read and the physical claim.
          if (code === 'RENDER_FENCED' || code === 'RENDER_LEASE_FENCED') {
            const finished = await completedRenderAttempt(env, op, renderId, attemptId, index, input.mode)
              ?? await reconcileShardSuccess(env, op, renderId, attemptId, index, input.mode);
            if (finished === outcomePending) return canonical({kind: 'render_outcome_pending', attemptId});
            if (finished) return canonical(finished);
          }
          if ((code === 'RENDER_FENCED' || code === 'RENDER_LEASE_FENCED')
            && await canRetryUnstartedAdmission(env, op, renderId, ticket, index))
            return canonical({kind: 'render_admission_retry'});
          throw error;
        }
        const payload = {schemaVersion: '1.0.0', kind: 'native_render_task', taskId: attemptId,
          renderId, operationId: op.id, generation: op.generation, deadlineAt, leaseToken, queuedAt: ticket.requestedAt, imageDigest,
          instance: nativeRenderPolicy.instance, rendererRelease: input.rendererRelease, runtimeVersion: input.runtimeVersion,
          revisionId: input.revisionId, mode: input.mode, project: input.project, ...(input.frames ? {frames: input.frames} : {})};
        await assertNativeExecution(payload);
        const compute = env.SHARDS.getByName(attemptId);
        try {
          const result = parseCanonicalJson(await compute.execute(canonical(payload))) as Json;
          if (!await compute.isStopped()) throw Error('COMPUTE_STOP_UNCONFIRMED');
          const pending = await env.DB.prepare('SELECT r.id FROM cost_reservations r LEFT JOIN cost_settlements s ON s.reservation_id=r.id WHERE r.id=? AND s.reservation_id IS NULL')
            .bind(attemptId).first();
          if (pending) throw Error('COMPUTE_SETTLEMENT_UNCONFIRMED');
          await env.COORDINATOR.getByName('global-v1').release(attemptId, leaseToken);
          const written = await env.DB.prepare(`UPDATE pipeline_attempts SET status='succeeded',stopped_at=COALESCE(stopped_at,?),result_json=?
            WHERE id=? AND render_id=? AND operation_id=? AND generation=? AND status IN ('active','stopped')
              AND EXISTS(SELECT 1 FROM pipeline_render_admissions a WHERE a.id=pipeline_attempts.id AND a.status='released')`)
            .bind(Date.now(), canonical(result), attemptId, renderId, op.id, op.generation).run();
          if (!written.meta.changes) {
            const previous = await completedRenderAttempt(env, op, renderId, attemptId, index, input.mode);
            if (previous) return canonical(previous);
            throw Error('RENDER_ATTEMPT_OUTCOME_CONFLICT');
          }
          return canonical({...result, attemptId});
        } catch (error) {
          const code = String((error as {message?: unknown})?.message ?? error) === 'Network connection lost.' ? 'RENDER_RPC_CONNECTION_LOST' : renderFailureCode(error);
          // Shard persists success before its RPC return and cleanup. A lost
          // response must not spend another physical attempt if success exists.
          const completed = await completedRenderAttempt(env, op, renderId, attemptId, index, input.mode)
            ?? await reconcileShardSuccess(env, op, renderId, attemptId, index, input.mode);
          if (completed === outcomePending) return canonical({kind: 'render_outcome_pending', code, attemptId});
          if (completed) return canonical(completed);
          const settled = await settleKnownFailure(env, op, renderId, attemptId, index, input.mode, code);
          if (settled === outcomePending) return canonical({kind: 'render_outcome_pending', code, attemptId});
          if (settled) return canonical(settled);
          throw error;
        }
      })) as Json;
      if (result.kind !== 'render_admission_retry') {
        value = result.kind === 'render_outcome_pending'
          ? await waitForPendingOutcome(env, step, roundName, op, renderId, attemptId, index,
            input.mode, operationDeadlineAt, result.code)
          : result;
        break;
      }
    }
    if (!value) throw Error('RENDER_QUEUE_EXPIRED');
    if (value.kind !== 'render_platform_retry') return value;
    lastCode = value.code;
    if (index + 1 < nativeRenderPolicy.maxAttempts) await step.do(name + '-requeue', {retries: {limit: 0, delay: '1 second'}}, async () =>
      requeueRenderAfterAttempt(env, op, renderId, attemptId));
  }
  throw Error(lastCode);
}
