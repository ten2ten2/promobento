import {WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep} from 'cloudflare:workers';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {planShards, assertRenderJob} from '@promobento/contracts/render';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {compareSeam} from '@promobento/contracts/seams';
import {sha256Bytes} from '@promobento/contracts/digest';
import {validate as observationValid} from '@promobento/contracts/validators/frame-observation';
import {validate as renderValid} from '@promobento/contracts/validators/render-job';
import {operation, rights, immutableJson, getJson} from './store.ts';
import {advanceRenderStage,commitRender,recordRenderFailure,renderFailureCode} from './render-recovery.ts';
import policy from '../../../config/agent-policy.json';
import type {PipelineEnv, Json, BlobRef} from './pipeline-types.ts';

export async function checkedBytes(env: PipelineEnv, blob: BlobRef) {
  const object = await env.MEDIA.get(blob.key); if (!object || object.size !== blob.byteLength || object.size > 50 << 20) throw Error('RENDER_OUTPUT_MISSING');
  const bytes = new Uint8Array(await object.arrayBuffer()); if (sha256Bytes(bytes) !== blob.sha256) throw Error('RENDER_OUTPUT_IDENTITY_MISMATCH'); return bytes;
}
export class RenderWorkflow extends WorkflowEntrypoint<PipelineEnv, {renderId: string}> {
  async run(event: WorkflowEvent<{renderId: string}>, step: WorkflowStep) {
    const row = parseCanonicalJson(await step.do('load-render', async () => {
      const value = await this.env.DB.prepare('SELECT * FROM pipeline_renders WHERE id=?').bind(event.payload.renderId).first<Json>();
      if (!value) throw Error('RENDER_NOT_FOUND'); return canonical(value);
    })) as Json;
    try {
      const input = parseCanonicalJson(await step.do('load-input', async () => canonical(await getJson(this.env, row.job_key)))) as Json;
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
        return parseCanonicalJson(await step.do(name, {retries: {limit: 0, delay: '1 second'}, timeout: '10 minutes'}, async () => {
          if (Date.now() >= deadlineAt) throw Error('RENDER_DEADLINE');
          await operation(this.env, op.id, op.generation); await rights(this.env, op, input.job.resources);
          const payload = {schemaVersion: '3.0.0', kind: 'render_task', taskId: attemptId, mode, instance,
            generation: op.generation, deadlineAt, imageDigest: release.image_digest, job: input.job, ...additions};
          await this.env.DB.prepare("INSERT OR IGNORE INTO pipeline_attempts(id,render_id,operation_id,generation,mode,shard_index,instance,status,started_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM pipeline_renders r JOIN pipeline_operations o ON o.id=r.operation_id WHERE r.id=? AND r.operation_id=? AND r.generation=? AND r.status NOT IN ('passed','blocked','cancelled') AND o.status='active' AND o.generation=?)")
            .bind(attemptId, row.id, op.id, op.generation, mode, additions.shard?.index ?? null, instance, 'active', Date.now(),row.id,op.id,op.generation,op.generation).run();
          const admitted=await this.env.DB.prepare("SELECT a.id FROM pipeline_attempts a JOIN pipeline_renders r ON r.id=a.render_id WHERE a.id=? AND a.render_id=? AND a.operation_id=? AND a.generation=? AND a.stopped_at IS NULL AND r.status NOT IN ('passed','blocked','cancelled')")
            .bind(attemptId,row.id,op.id,op.generation).first();
          if(!admitted)throw Error('RENDER_FENCED');
          try {
            const result = parseCanonicalJson(await this.env.SHARDS.getByName(attemptId).execute(canonical(payload))) as Json;
            if (!await this.env.SHARDS.getByName(attemptId).isStopped()) throw Error('COMPUTE_STOP_UNCONFIRMED');
            await this.env.DB.prepare('UPDATE pipeline_attempts SET status=?,stopped_at=?,result_json=? WHERE id=?')
              .bind('succeeded', Date.now(), canonical(result), attemptId).run(); return canonical(result);
          } catch (error) {
            await this.env.SHARDS.getByName(attemptId).stopAndSettle();
            await this.env.DB.prepare('UPDATE pipeline_attempts SET status=?,stopped_at=? WHERE id=?').bind('failed', Date.now(), attemptId).run(); throw error;
          }
        })) as Json;
      };
      await step.do('mark-sharding', async () => { await advanceRenderStage(this.env,row.id,op,'sharding');return true; });
      await this.env.OPERATIONS.getByName(op.id).progress(canonical({operationId:op.id,renderId:row.id,status:'sharding'}));
      const shardsPromise = Promise.all(partition.shards.map(shard => task('shard-' + shard.index, 'shard', shard.instance,
        {options: input.options, inputs: input.inputs, shard})));
      const audioPromise = task('audio', 'audio', 'standard-1', {inputs: input.audioInputsBlobs, audioInputs: input.audioInputs});
      const [shards, audio] = await Promise.all([shardsPromise, audioPromise]);
      const output = (result: Json, suffix: string): BlobRef => {
        const value = result.outputs?.find((blob: BlobRef) => blob.key.endsWith(suffix)); if (!value) throw Error('RENDER_OUTPUT_MISSING'); return value;
      };
      const seamReport = parseCanonicalJson(await step.do('verify-shards', async () => {
        if (Date.now() >= deadlineAt) throw Error('RENDER_DEADLINE');
        await operation(this.env, op.id, op.generation); await rights(this.env, op, input.job.resources);
        await advanceRenderStage(this.env,row.id,op,'verifying');
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
        await immutableJson(this.env, `renders/${row.id}/seams.json`, report); return canonical(report);
      })) as Json;
      await step.do('mark-assembling',async()=>{
        await advanceRenderStage(this.env,row.id,op,'assembling');
        await this.env.OPERATIONS.getByName(op.id).progress(canonical({operationId:op.id,renderId:row.id,status:'assembling'}));return true;
      });
      const assembled = await task('assemble', 'assemble', 'standard-2', {coverFrame: input.coverFrame, inputs: [
        ...shards.map((result, index) => ({...output(result, '/shard.h264'), name: 'shard:' + index})), {...output(audio, '/mixed.wav'), name: 'audio'}]});
      return parseCanonicalJson(await step.do('commit-render', {retries:{limit:0,delay:'1 second'}}, async () => {
        if (Date.now() >= deadlineAt) throw Error('RENDER_DEADLINE');
        await operation(this.env, op.id, op.generation); await rights(this.env, op, input.job.resources);
        const peakMemory = {status: shards.some(result=>result.report.peakMemoryMiB===null)?'unverified':'measured',
          measurements: shards.map(result=>({shardIndex:result.report.shardIndex,peakMemoryMiB:result.report.peakMemoryMiB,
            ...(result.report.peakMemoryMiB===null?{peakMemoryUnavailableReason:result.report.peakMemoryUnavailableReason}:{})}))};
        const result = {renderId: row.id, status: 'passed', outputs: assembled.outputs, media: assembled.report, seamReport, peakMemory,
          observationFrames: shards.flatMap(result => result.outputs.filter((blob: BlobRef) => blob.key.includes('/observation-frames/')))};
        let resultJson: string;
        try { resultJson=canonical(result); }
        catch {
          const invalid=Object.entries(result).find(([,value])=>{try{canonical(value);return false;}catch{return true;}});
          throw Error('RENDER_RESULT_'+(invalid?.[0]??'root').replace(/([a-z])([A-Z])/g,'$1_$2').toUpperCase()+'_NOT_JSON');
        }
        await commitRender(this.env,row.id,op,resultJson);return resultJson;
      })) as Json;
    } catch (error) {
      const code=renderFailureCode(error);
      await step.do('fail-render',{retries:{limit:3,delay:'1 second',backoff:'exponential'},timeout:'1 minute'},async()=>{
        await recordRenderFailure(this.env,row.id,code);return true;
      });
      throw error;
    }
  }
}
