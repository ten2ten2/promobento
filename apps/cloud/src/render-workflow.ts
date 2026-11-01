import {WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep} from 'cloudflare:workers';
import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {nativeProjectHash} from '@promobento/contracts/native-project';
import {operation, getJson} from './store.ts';
import {advanceRenderStage, commitRender, recordRenderFailure, renderFailureCode} from './render-recovery.ts';
import {verifyNativeResult} from './render-verification.ts';
import {workflowStarted} from './workflow-state.ts';
import {runNativeRenderTask} from './render-task.ts';
import {verifyNativeInputs, validateFrameTimes, NATIVE_COMMIT} from './native-project.ts';
import {nativeRenderPolicy} from './native-task.ts';
import type {PipelineEnv, Json} from './pipeline-types.ts';

export class RenderWorkflow extends WorkflowEntrypoint<PipelineEnv, {renderId: string}> {
  async run(event: WorkflowEvent<{renderId: string}>, step: WorkflowStep) {
    const row = parseCanonicalJson(await step.do('load-render', async () => {
      const value = await this.env.DB.prepare('SELECT * FROM pipeline_renders WHERE id=?').bind(event.payload.renderId).first<Json>();
      if (!value) throw Error('RENDER_NOT_FOUND');
      return canonical(value);
    })) as Json;
    // Immutable source lives in R2; only the pointer is checkpointed, never an entire project in Workflow state.
    const input = await getJson(this.env, row.job_key);
    // Refusing an old execution does not rewrite its historical row or consume another reservation.
    if (input.schemaVersion !== '1.0.0' || input.kind !== 'native_render_request') throw Error('LEGACY_RENDER_REQUIRES_RECONCILIATION');
    try {
      await step.do('claim-execution', {retries: {limit: 0, delay: '1 second'}}, async () =>
        workflowStarted(this.env, 'render', row.id, row.operation_id, row.generation));
      const op = await operation(this.env, row.operation_id, row.generation);
      if (input.operationId !== op.id || input.renderId !== row.id || input.runtimeVersion !== NATIVE_COMMIT) throw Error('RENDER_SCOPE_INVALID');
      await verifyNativeInputs(this.env, input.project);
      if (await nativeProjectHash(input.project) !== input.revisionId) throw Error('SOURCE_IDENTITY_MISMATCH');
      validateFrameTimes(input.project, input.mode, input.frames);
      const release = await this.env.DB.prepare('SELECT image_digest,runtime_version FROM renderer_releases WHERE id=? AND status=\'active\'')
        .bind(input.rendererRelease).first<{image_digest: string; runtime_version: string}>();
      if (!release || release.runtime_version !== NATIVE_COMMIT) throw Error('RENDER_ENVIRONMENT_MISMATCH');
      const deadlineAt = await step.do<number>('native-deadline', async () =>
        Number(row.created_at) + (input.mode === 'preview' ? nativeRenderPolicy.previewDeadlineMs : nativeRenderPolicy.exportDeadlineMs));
      await step.do('mark-rendering', async () => {await advanceRenderStage(this.env, row.id, op, 'rendering'); return true;});
      try {await this.env.OPERATIONS.getByName(op.id).progress(canonical({operationId: op.id, renderId: row.id, status: 'rendering'}));} catch {}
      const rendered = await runNativeRenderTask(this.env, step, {renderId: row.id, op, input, imageDigest: release.image_digest, deadlineAt});
      return parseCanonicalJson(await step.do('verify-and-commit-native-render', {retries: {limit: 0, delay: '1 second'}}, async () => {
        if (Date.now() >= deadlineAt) throw Error('RENDER_DEADLINE');
        await operation(this.env, op.id, op.generation);
        await advanceRenderStage(this.env, row.id, op, 'verifying');
        await verifyNativeResult(this.env, input, rendered);
        const result = {kind: 'native_render_result', renderId: row.id, revisionId: input.revisionId,
          mode: input.mode, status: 'passed', outputs: rendered.outputs, report: rendered.report,
          attemptId: rendered.attemptId, environmentHealth: rendered.environmentHealth ?? null,
          lifecycleTimings: rendered.lifecycleTimings ?? null};
        const serialized = canonical(result);
        if (Date.now() >= deadlineAt) throw Error('RENDER_DEADLINE');
        await operation(this.env, op.id, op.generation);
        await commitRender(this.env, row.id, op, serialized);
        return serialized;
      })) as Json;
    } catch (error) {
      const code = renderFailureCode(error);
      await step.do('fail-render', {retries: {limit: 3, delay: '1 second', backoff: 'exponential'}, timeout: '1 minute'}, async () => {
        await recordRenderFailure(this.env, row.id, code);
        return true;
      });
      throw error;
    }
  }
}
