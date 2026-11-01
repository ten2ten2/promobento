import type {WorkflowStep} from 'cloudflare:workers';
import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {operation} from './store.ts';
import {renderFailureCode} from './render-recovery.ts';
import {assertNativeExecution, nativeRenderPolicy} from './native-task.ts';
import {requestRenderAdmission, waitForRenderAdmission, claimRenderAdmission, requeueRenderAfterAttempt} from './render-admission.ts';
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
    // A queued Workflow is hibernated; early notifications are buffered by Cloudflare Workflows.
    const leaseToken = await waitForRenderAdmission(step, name + '-admission', ticket, index);
    const value = parseCanonicalJson(await step.do(name, {retries: {limit: 0, delay: '1 second'}, timeout: '15 minutes'}, async () => {
      await operation(env, op.id, op.generation);
      const deadlineAt = await claimRenderAdmission(env, op, input, attemptId, leaseToken);
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
    if (value.kind !== 'render_platform_retry') return value;
    lastCode = value.code;
    if (index + 1 < nativeRenderPolicy.maxAttempts) await step.do(name + '-requeue', {retries: {limit: 0, delay: '1 second'}}, async () =>
      requeueRenderAfterAttempt(env, op, renderId, attemptId));
  }
  throw Error(lastCode);
}
