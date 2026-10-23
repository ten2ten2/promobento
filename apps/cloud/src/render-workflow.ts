import {WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep} from 'cloudflare:workers';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {planShards, assertRenderJob} from '@promobento/contracts/render';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {compareSeam} from '@promobento/contracts/seams';
import {sha256Bytes} from '@promobento/contracts/digest';
import {validate as observationValid} from '@promobento/contracts/validators/frame-observation';
import {validate as renderValid} from '@promobento/contracts/validators/render-job';
import {operation, rights, immutableJson, getJson} from './store.ts';
import policy from '../../../config/agent-policy.json';
import type {PipelineEnv, Json, BlobRef} from './pipeline-types.ts';

export async function checkedBytes(env: PipelineEnv, blob: BlobRef) {
  const object = await env.MEDIA.get(blob.key); if (!object || object.size !== blob.byteLength || object.size > 50 << 20) throw Error('RENDER_OUTPUT_MISSING');
  const bytes = new Uint8Array(await object.arrayBuffer()); if (sha256Bytes(bytes) !== blob.sha256) throw Error('RENDER_OUTPUT_IDENTITY_MISMATCH'); return bytes;
}
export class RenderWorkflow extends WorkflowEntrypoint<PipelineEnv, {renderId: string}> {
  async run(event: WorkflowEvent<{renderId: string}>, step: WorkflowStep) {
    const row = await step.do('load-render', async () => {
      const value = await this.env.DB.prepare('SELECT * FROM pipeline_renders WHERE id=?').bind(event.payload.renderId).first<Json>();
      if (!value) throw Error('RENDER_NOT_FOUND'); return value;
    });
    const input = await step.do('load-input', async () => getJson(this.env, row.job_key));
    assertRenderJob(input.job);
    const deadlineAt = await step.do<number>('deadline', async () => Number(row.created_at) + (input.job.quality === 'review' ? policy.render.totalMs.review : input.job.durationSeconds === 15 ? policy.render.totalMs.final15 : policy.render.totalMs.final30));
    const op = await operation(this.env, row.operation_id, row.generation);
    if (input.job.operationId !== op.id || input.job.renderId !== row.id) throw Error('RENDER_SCOPE_INVALID');
    const release = await this.env.DB.prepare('SELECT image_digest FROM renderer_releases WHERE id=? AND status=\'active\'').bind(input.job.rendererRelease).first<{image_digest: string}>();
    if (!release) throw Error('RENDER_ENVIRONMENT_MISMATCH');
    const filmBlob = input.inputs.find((blob: BlobRef) => blob.name === 'film'); if (!filmBlob) throw Error('SOURCE_UNAVAILABLE');
    const raw = await checkedBytes(this.env, filmBlob);
    if (filmSourceHash(raw) !== input.job.sourceHash) throw Error('SOURCE_IDENTITY_MISMATCH');
    const film = await getJson(this.env, filmBlob.key), partition = planShards(input.job, film, {seed: input.options.seed});
    const task = async (name: string, mode: string, instance: string, additions: Json): Promise<Json> => {
      const attemptId = await step.do(name + '-id', async () => crypto.randomUUID());
      return step.do(name, {retries: {limit: 0, delay: '1 second'}, timeout: '10 minutes'}, async () => {
        if (Date.now() >= deadlineAt) throw Error('RENDER_DEADLINE');
        await operation(this.env, op.id, op.generation); await rights(this.env, op, input.job.resources);
        const payload = {schemaVersion: '3.0.0', kind: 'render_task', taskId: attemptId, mode, instance,
          generation: op.generation, deadlineAt, imageDigest: release.image_digest, job: input.job, ...additions};
        await this.env.DB.prepare('INSERT OR IGNORE INTO pipeline_attempts(id,render_id,operation_id,generation,mode,shard_index,instance,status,started_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .bind(attemptId, row.id, op.id, op.generation, mode, additions.shard?.index ?? null, instance, 'active', Date.now()).run();
        try {
          const result = parseCanonicalJson(await this.env.SHARDS.getByName(attemptId).execute(canonical(payload))) as Json;
          if (!await this.env.SHARDS.getByName(attemptId).isStopped()) throw Error('COMPUTE_STOP_UNCONFIRMED');
          await this.env.DB.prepare('UPDATE pipeline_attempts SET status=?,stopped_at=?,result_json=? WHERE id=?')
            .bind('succeeded', Date.now(), canonical(result), attemptId).run(); return result;
        } catch (error) {
          await this.env.SHARDS.getByName(attemptId).stopAndSettle();
          await this.env.DB.prepare('UPDATE pipeline_attempts SET status=?,stopped_at=? WHERE id=?').bind('failed', Date.now(), attemptId).run(); throw error;
        }
      });
    };
    try {
      await step.do('mark-sharding', async () => { await this.env.DB.prepare('UPDATE pipeline_renders SET status=? WHERE id=?').bind('sharding', row.id).run(); return true; });
      await this.env.OPERATIONS.getByName(op.id).progress(canonical({operationId:op.id,renderId:row.id,status:'sharding'}));
      const shardsPromise = Promise.all(partition.shards.map(shard => task('shard-' + shard.index, 'shard', shard.instance,
        {options: input.options, inputs: input.inputs, shard})));
      const audioPromise = task('audio', 'audio', 'standard-1', {inputs: input.audioInputsBlobs, audioInputs: input.audioInputs});
      const [shards, audio] = await Promise.all([shardsPromise, audioPromise]);
      const output = (result: Json, suffix: string): BlobRef => {
        const value = result.outputs?.find((blob: BlobRef) => blob.key.endsWith(suffix)); if (!value) throw Error('RENDER_OUTPUT_MISSING'); return value;
      };
      const seamReport = await step.do('verify-shards', async () => {
        if (Date.now() >= deadlineAt) throw Error('RENDER_DEADLINE');
        await operation(this.env, op.id, op.generation); await rights(this.env, op, input.job.resources);
        const seams = [];
        for (const [index, result] of shards.entries()) {
          if (!renderValid(result.report) || result.report.kind !== 'shard_receipt' || result.report.imageDigest !== release.image_digest) throw Error('SHARD_RECEIPT_INVALID');
          const observations = await getJson(this.env, output(result, '/observations.json').key) as unknown as Json[];
          if (!observations.length) throw Error('QA_OBSERVATION_MISSING');
          for (const observation of observations) if (!observationValid(observation) || observation.findings.some((finding: Json) => finding.severity === 'BLOCK')) throw Error('QA_BLOCK');
          if (index) {
            const frame = partition.shards[index]!.start - 1;
            const a = await checkedBytes(this.env, output(shards[index - 1]!, `/seam-frames/${frame}-last.png`));
            const b = await checkedBytes(this.env, output(result, `/seam-frames/${frame}-cold.png`));
            const seam = {frame, ...compareSeam(a, b)}; if (seam.verdict === 'RENDER_SEAM_BLOCK') throw Error('RENDER_SEAM_BLOCK'); seams.push(seam);
          }
        }
        const report = {schemaVersion: '3.0.0', kind: 'seam_report', renderId: row.id, seams};
        await immutableJson(this.env, `renders/${row.id}/seams.json`, report); return report;
      });
      await this.env.OPERATIONS.getByName(op.id).progress(canonical({operationId:op.id,renderId:row.id,status:'assembling'}));
      const assembled = await task('assemble', 'assemble', 'standard-2', {coverFrame: input.coverFrame, inputs: [
        ...shards.map((result, index) => ({...output(result, '/shard.h264'), name: 'shard:' + index})), {...output(audio, '/mixed.wav'), name: 'audio'}]});
      return await step.do('commit-render', async () => {
        if (Date.now() >= deadlineAt) throw Error('RENDER_DEADLINE');
        await operation(this.env, op.id, op.generation); await rights(this.env, op, input.job.resources);
        const peakMemory = {status: shards.some(result=>result.report.peakMemoryMiB===null)?'unverified':'measured',
          measurements: shards.map(result=>({shardIndex:result.report.shardIndex,peakMemoryMiB:result.report.peakMemoryMiB,
            ...(result.report.peakMemoryMiB===null?{peakMemoryUnavailableReason:result.report.peakMemoryUnavailableReason}:{})}))};
        const result = {renderId: row.id, status: 'passed', outputs: assembled.outputs, media: assembled.report, seamReport, peakMemory,
          observationFrames: shards.flatMap(result => result.outputs.filter((blob: BlobRef) => blob.key.includes('/observation-frames/')))};
        const changed = await this.env.DB.prepare("UPDATE pipeline_renders SET status='passed',result_json=?,finished_at=? WHERE id=? AND EXISTS(SELECT 1 FROM pipeline_operations WHERE id=? AND generation=? AND status='active')")
          .bind(canonical(result), Date.now(), row.id, op.id, op.generation).run();
        if (changed.meta.changes !== 1) throw Error('OPERATION_FENCED');
        await this.env.OPERATIONS.getByName(op.id).progress(canonical({operationId:op.id,renderId:row.id,status:'passed'}));return result;
      });
    } catch (error) {
      const active = await this.env.DB.prepare("SELECT id FROM pipeline_attempts WHERE render_id=? AND status='active'").bind(row.id).all<{id: string}>();
      const stops = await Promise.allSettled(active.results.map(attempt => this.env.SHARDS.getByName(attempt.id).stopAndSettle()));
      const code=error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'RENDER_INTERNAL_ERROR';
      await this.env.DB.prepare('UPDATE pipeline_renders SET status=?,finished_at=?,result_json=? WHERE id=?').bind('blocked', Date.now(), canonical({status:'blocked',code}), row.id).run();
      if (stops.some(result => result.status === 'rejected')) throw Error('COMPUTE_STOP_UNCONFIRMED'); throw error;
    }
  }
}
