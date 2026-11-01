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

/** One movie per physical attempt; a retry requires confirmed stop and settled compute usage. */
export async function runNativeRenderTask(env: PipelineEnv, step: WorkflowStep, context: {
  renderId: string; op: Operation; input: Json; imageDigest: string;
}): Promise<Json> {
  const {renderId, op, input, imageDigest} = context;
  let lastCode = 'RENDER_INTERNAL_ERROR';
  for (let index = 0; index < nativeRenderPolicy.maxAttempts; index++) {
    const name = index ? 'native-project-retry-' + index : 'native-project';
    if (index) {
      await operation(env, op.id, op.generation);
      await step.sleep(name + '-backoff', '15 seconds');
    }
    const attemptId = await step.do(name + '-id', async () => crypto.randomUUID());
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
        try {deadlineAt = await claimRenderAdmission(env, op, input, attemptId, leaseToken);}
        catch (error) {
          const code = String((error as {message?: unknown})?.message ?? error);
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
          await env.DB.prepare('UPDATE pipeline_attempts SET status=?,stopped_at=?,result_json=? WHERE id=?')
            .bind('succeeded', Date.now(), canonical(result), attemptId).run();
          return canonical({...result, attemptId});
        } catch (error) {
          const code = String((error as {message?: unknown})?.message ?? error) === 'Network connection lost.' ? 'RENDER_RPC_CONNECTION_LOST' : renderFailureCode(error);
          let confirmed = false;
          try {
            await compute.stopAndSettle();
            await env.COORDINATOR.getByName('global-v1').release(attemptId, leaseToken);
            if (!await compute.isStopped()) throw Error('COMPUTE_STOP_UNCONFIRMED');
            const pending = await env.DB.prepare('SELECT r.id FROM cost_reservations r LEFT JOIN cost_settlements s ON s.reservation_id=r.id WHERE r.id=? AND s.reservation_id IS NULL')
              .bind(attemptId).first();
            if (pending) throw Error('COMPUTE_SETTLEMENT_UNCONFIRMED');
            await env.DB.prepare('UPDATE pipeline_attempts SET status=?,stopped_at=?,result_json=COALESCE(result_json,?) WHERE id=?')
              .bind('failed', Date.now(), canonical({status: 'failed', code}), attemptId).run();
            confirmed = true;
          } catch { /* Unknown physical stop or cost keeps this attempt reserved and blocks replacement. */ }
          if (!confirmed || !retryable.has(code)) throw code === 'RENDER_RPC_CONNECTION_LOST' ? Error(code) : error;
          return canonical({kind: 'render_platform_retry', code, attemptId});
        }
      })) as Json;
      if (result.kind !== 'render_admission_retry') {value = result; break;}
    }
    if (!value) throw Error('RENDER_QUEUE_EXPIRED');
    if (value.kind !== 'render_platform_retry') return value;
    lastCode = value.code;
    if (index + 1 < nativeRenderPolicy.maxAttempts) await step.do(name + '-requeue', {retries: {limit: 0, delay: '1 second'}}, async () =>
      requeueRenderAfterAttempt(env, op, renderId, attemptId));
  }
  throw Error(lastCode);
}
