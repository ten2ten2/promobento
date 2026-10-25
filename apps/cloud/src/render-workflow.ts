import {WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep} from 'cloudflare:workers';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {planShards, assertRenderJob,renderDeadlineMs} from '@promobento/contracts/render';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {sha256Bytes} from '@promobento/contracts/digest';
import {operation, rights, immutableJson, getJson} from './store.ts';
import {advanceRenderStage,commitRender,recordRenderFailure,renderFailureCode} from './render-recovery.ts';
import {verifyRenderShards} from './render-verification.ts';
import {workflowStarted} from './workflow-state.ts';
import {runRenderTask,AUDIO_INSTANCE} from './render-task.ts';
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
      await step.do('claim-execution',{retries:{limit:0,delay:'1 second'}},async()=>workflowStarted(this.env,'render',row.id,row.operation_id,row.generation));
      const input = parseCanonicalJson(await step.do('load-input', async () => canonical(await getJson(this.env, row.job_key)))) as Json;
      assertRenderJob(input.job);
      const op = await operation(this.env, row.operation_id, row.generation);
      if (input.job.operationId !== op.id || input.job.renderId !== row.id) throw Error('RENDER_SCOPE_INVALID');
      const release = await this.env.DB.prepare('SELECT image_digest FROM renderer_releases WHERE id=? AND status=\'active\'').bind(input.job.rendererRelease).first<{image_digest: string}>();
      if (!release) throw Error('RENDER_ENVIRONMENT_MISMATCH');
      const filmBlob = input.inputs.find((blob: BlobRef) => blob.name === 'film'); if (!filmBlob) throw Error('SOURCE_UNAVAILABLE');
      const raw = await checkedBytes(this.env, filmBlob);
      if (filmSourceHash(raw) !== input.job.sourceHash) throw Error('SOURCE_IDENTITY_MISMATCH');
      const film = parseCanonicalJson(raw) as Json, partition = planShards(input.job, film, {seed: input.options.seed});
      const deadlineAt=await step.do<number>('deadline',async()=>Number(row.created_at)+renderDeadlineMs(input.job,partition,policy.render));
      const task = async (name: string, mode: string, instance: string, additions: Json): Promise<Json> => {
        return runRenderTask(this.env,step,{renderId:row.id,op,job:input.job,imageDigest:release.image_digest,deadlineAt},{name,mode,instance,additions});
      };
      await step.do('mark-sharding', async () => { await advanceRenderStage(this.env,row.id,op,'sharding');return true; });
      try{await this.env.OPERATIONS.getByName(op.id).progress(canonical({operationId:op.id,renderId:row.id,status:'sharding'}));}catch{}
      const shardsPromise = Promise.all(partition.shards.map(shard => task('shard-' + shard.index, 'shard', shard.instance,
        {options: input.options, inputs: input.inputs, shard})));
      const audioPromise = task('audio', 'audio', AUDIO_INSTANCE, {inputs: input.audioInputsBlobs, audioInputs: input.audioInputs});
      const [shards, audio] = await Promise.all([shardsPromise, audioPromise]);
      const output = (result: Json, suffix: string): BlobRef => {
        const value = result.outputs?.find((blob: BlobRef) => blob.key.endsWith(suffix)); if (!value) throw Error('RENDER_OUTPUT_MISSING'); return value;
      };
      const seamReport = parseCanonicalJson(await step.do('verify-shards',{retries:{limit:0,delay:'1 second'}}, async () => {
        if (Date.now() >= deadlineAt) throw Error('RENDER_DEADLINE');
        await operation(this.env, op.id, op.generation); await rights(this.env, op, input.job.resources);
        await advanceRenderStage(this.env,row.id,op,'verifying');
        const seams=await verifyRenderShards({job:input.job,film,partition,shards,imageDigest:release.image_digest,
          read:blob=>checkedBytes(this.env,blob),output});
        const report = {schemaVersion: '3.0.0', kind: 'seam_report', renderId: row.id, seams};
        await immutableJson(this.env, `renders/${row.id}/seams.json`, report); return canonical(report);
      })) as Json;
      await step.do('mark-assembling',async()=>{
        await advanceRenderStage(this.env,row.id,op,'assembling');
        try{await this.env.OPERATIONS.getByName(op.id).progress(canonical({operationId:op.id,renderId:row.id,status:'assembling'}));}catch{}return true;
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
