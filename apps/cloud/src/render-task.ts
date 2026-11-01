import type {WorkflowStep} from 'cloudflare:workers';
import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {operation} from './store.ts';
import {renderFailureCode} from './render-recovery.ts';
import {assertNativeExecution, nativeRenderPolicy} from './native-task.ts';
import type {PipelineEnv, Json, Operation} from './pipeline-types.ts';

const retryable = new Set(['RENDER_CAPACITY_UNAVAILABLE', 'RENDER_STARTUP_CONNECTION_LOST', 'RENDER_DISPATCH_CONNECTION_LOST',
  'RENDER_EXECUTE_CONNECTION_LOST', 'RENDER_RPC_CONNECTION_LOST', 'RENDER_BROKER_CONNECTION_LOST',
  'RENDER_BROKER_REGISTRATION_TIMEOUT', 'RENDER_STARTUP_TIMEOUT']);

/** One movie per physical attempt; a retry requires confirmed stop and settled compute usage. */
export async function runNativeRenderTask(env: PipelineEnv, step: WorkflowStep, context: {
  renderId: string; op: Operation; input: Json; imageDigest: string; deadlineAt: number;
}): Promise<Json> {
  const {renderId, op, input, imageDigest, deadlineAt} = context;
  let lastCode = 'RENDER_INTERNAL_ERROR';
  for (let index = 0; index < nativeRenderPolicy.maxAttempts; index++) {
    const name = index ? 'native-project-retry-' + index : 'native-project';
    if (index) {
      if (Date.now() + 15000 >= deadlineAt) throw Error('RENDER_DEADLINE');
      await operation(env, op.id, op.generation);
      await step.sleep(name + '-backoff', '15 seconds');
    }
    const attemptId = await step.do(name + '-id', async () => crypto.randomUUID());
    const value = parseCanonicalJson(await step.do(name, {retries: {limit: 0, delay: '1 second'}, timeout: '15 minutes'}, async () => {
      if (Date.now() >= deadlineAt) throw Error('RENDER_DEADLINE');
      await operation(env, op.id, op.generation);
      const payload = {schemaVersion: '1.0.0', kind: 'native_render_task', taskId: attemptId,
        renderId, operationId: op.id, generation: op.generation, deadlineAt, imageDigest,
        instance: nativeRenderPolicy.instance, rendererRelease: input.rendererRelease, runtimeVersion: input.runtimeVersion,
        revisionId: input.revisionId, mode: input.mode, project: input.project, ...(input.frames ? {frames: input.frames} : {})};
      await assertNativeExecution(payload);
      await env.DB.prepare('INSERT OR IGNORE INTO pipeline_attempts(id,render_id,operation_id,generation,mode,instance,status,started_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM pipeline_renders r JOIN pipeline_operations o ON o.id=r.operation_id WHERE r.id=? AND r.operation_id=? AND r.generation=? AND r.status NOT IN (\'passed\',\'blocked\',\'cancelled\') AND o.status=\'active\' AND o.generation=?)')
        .bind(attemptId, renderId, op.id, op.generation, 'native_' + input.mode, nativeRenderPolicy.instance, 'active', Date.now(),
          renderId, op.id, op.generation, op.generation).run();
      const admitted = await env.DB.prepare('SELECT a.id FROM pipeline_attempts a JOIN pipeline_renders r ON r.id=a.render_id WHERE a.id=? AND a.render_id=? AND a.operation_id=? AND a.generation=? AND a.stopped_at IS NULL AND r.status NOT IN (\'passed\',\'blocked\',\'cancelled\')')
        .bind(attemptId, renderId, op.id, op.generation).first();
      if (!admitted) throw Error('RENDER_FENCED');
      const compute = env.SHARDS.getByName(attemptId);
      try {
        const result = parseCanonicalJson(await compute.execute(canonical(payload))) as Json;
        if (!await compute.isStopped()) throw Error('COMPUTE_STOP_UNCONFIRMED');
        const pending = await env.DB.prepare('SELECT r.id FROM cost_reservations r LEFT JOIN cost_settlements s ON s.reservation_id=r.id WHERE r.id=? AND s.reservation_id IS NULL')
          .bind(attemptId).first();
        if (pending) throw Error('COMPUTE_SETTLEMENT_UNCONFIRMED');
        await env.DB.prepare('UPDATE pipeline_attempts SET status=?,stopped_at=?,result_json=? WHERE id=?')
          .bind('succeeded', Date.now(), canonical(result), attemptId).run();
        return canonical({...result, attemptId});
      } catch (error) {
        const code = String((error as {message?: unknown})?.message ?? error) === 'Network connection lost.' ? 'RENDER_RPC_CONNECTION_LOST' : renderFailureCode(error);
        let confirmed = false;
        try {
          await compute.stopAndSettle();
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
  }
  throw Error(lastCode);
}
