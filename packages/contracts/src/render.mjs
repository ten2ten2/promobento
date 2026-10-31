import {digest} from './digest.mjs';
import {validate} from '../generated/render-job.mjs';

export const WEBGL_BLOCKS=Object.freeze(['object-studio@1','device-3d@1']);
export const filmUsesWebgl=spec=>spec.scenes.some(scene=>scene.kind==='block'&&WEBGL_BLOCKS.includes(scene.block)||scene.kind==='custom'&&scene.runtime3D==='om3-studio-v1');
export const renderPageTiming=(spec,policy)=>({initTimeoutMs:filmUsesWebgl(spec)?policy.startupWebglMs:policy.startupMs,
  frameTimeoutMs:filmUsesWebgl(spec)?policy.frameTimeoutWebglMs:policy.frameTimeoutMs});
export function renderDeadlineMs(job,partition,policy){
 if(partition.shards.some(shard=>shard.instance==='standard-4'))return Math.max(...partition.shards.map(shard=>
  (shard.end-shard.start)/(job.quality==='review'?2:1)*(shard.instance==='standard-4'?policy.perFrameBasisWebglMs:policy.perFrameBasisMs)+policy.shardOverheadMs))+policy.totalMs.webglExtra;
 return job.quality==='review'?policy.totalMs.review:job.durationSeconds===15?policy.totalMs.final15:policy.totalMs.final30;
}

export function assertRenderJob(job) {
  if (!validate(job) || job.kind !== 'render_job') throw Error('RENDER_JOB_INVALID');
  if (job.durationSeconds * 30 !== job.totalFrames || new Set(job.resources.map(resource => resource.resourceId)).size !== job.resources.length)
    throw Error('RENDER_JOB_INVALID');
  if (job.quality === 'still' ? !job.frames?.length : job.frames || job.crops) throw Error('RENDER_JOB_INVALID');
  if ([...(job.frames ?? []), ...(job.crops ?? []).map(crop => crop.frame)].some(frame => frame >= job.totalFrames)) throw Error('FRAME_OUT_OF_RANGE');
}

/** Cost-aligned initial partition; measured WebGL frame costs can request more 15-frame units at G1. */
export function planShards(job, spec, {seed, maxShards = 6, webglBlocks = WEBGL_BLOCKS, webglMaxShards = 24} = {}) {
  assertRenderJob(job);
  if (job.quality === 'still' || spec.totalFrames !== job.totalFrames || typeof seed !== 'string' || !seed.length) throw Error('SHARD_PLAN_INPUT_INVALID');
  if (![maxShards, webglMaxShards].every(value => Number.isInteger(value) && value >= 1 && value <= 64)) throw Error('SHARD_LIMIT_INVALID');
  const webgl = new Set(webglBlocks), usesWebgl = scene => scene.kind === 'block' && webgl.has(scene.block) || scene.kind === 'custom' && scene.runtime3D === 'om3-studio-v1';
  const hasWebgl = spec.scenes.some(usesWebgl), unitFrames = job.quality === 'review' ? 30 : 15, units = job.totalFrames / unitFrames;
  const desired = hasWebgl ? webglMaxShards : 6;
  // Short 2D films also use the existing six-shard allowance: their moving panel must not
  // share a 150-frame serial capture with all surrounding holds. Review cuts on 30-frame boundaries.
  const count = Math.min(units, hasWebgl ? webglMaxShards : maxShards, Math.max(1, Math.ceil(desired / (hasWebgl && job.quality === 'review' ? 2 : 1))));
  const cuts=[0];
  if(hasWebgl){
    const weights=Array.from({length:units},(_,unit)=>spec.scenes.some(scene=>usesWebgl(scene)&&scene.start<(unit+1)*unitFrames&&scene.end>unit*unitFrames)?6:1);
    const prefix=[0];for(const weight of weights)prefix.push(prefix.at(-1)+weight);
    for(let index=1;index<count;index++){
      const lower=cuts.at(-1)/unitFrames+1,upper=units-(count-index),target=prefix.at(-1)*index/count;
      let boundary=lower;while(boundary<upper&&Math.abs(prefix[boundary+1]-target)<Math.abs(prefix[boundary]-target))boundary++;
      cuts.push(boundary*unitFrames);
    }
  }else for(let index=1;index<count;index++)cuts.push(Math.floor(index*units/count)*unitFrames);
  cuts.push(job.totalFrames);
  const shards = Array.from({length: count}, (_, index) => {
    const start=cuts[index],end=cuts[index+1];
    const scenes = spec.scenes.filter(scene => scene.start < end && scene.end > Math.max(0, start - 1));
    const shardKey = digest({identityVersion: 'film-shard-v1', runtimeVersion: job.runtimeVersion, rendererRelease: job.rendererRelease,
      aspectId: job.aspectId, renderProfile: job.renderProfile, quality: job.quality, start, end, style: spec.style,
      seed, audio: job.audioPlanHash ?? null, scenes, texts: spec.texts, assets: spec.assets, resources: job.resources,
      ...(spec.scenes.some(scene=>scene.kind==='custom')?{sourceHash:job.sourceHash}:{})});
    return {index, start, end, instance: scenes.some(usesWebgl) ? 'standard-4' : 'standard-3', shardKey};
  });
  return {schemaVersion: '3.0.0', kind: 'shard_plan', renderId: job.renderId, totalFrames: job.totalFrames, shards};
}

export function assertRenderTask(task) {
  if (!validate(task) || task.kind !== 'render_task') throw Error('TASK_INVALID');
  assertRenderJob(task.job);
  if (task.job.renderProfile.sampleCount !== 1 || task.job.renderProfile.shutterAngle !== 0) throw Error('RENDER_PROFILE_NOT_IMPLEMENTED');
  if (task.mode === 'studio' && task.job.crops?.length) throw Error('STUDIO_CROP_NOT_IMPLEMENTED');
  if (new Set(task.inputs.map(input => input.name)).size !== task.inputs.length) throw Error('TASK_INPUT_DUPLICATE');
  const bytes = task.inputs.reduce((sum, input) => sum + input.byteLength, 0);
  if (bytes > (task.mode === 'assemble' ? 512 : 200) * 1048576) throw Error('TASK_INPUT_BUDGET_EXCEEDED');
  if (task.mode === 'studio' && task.job.quality !== 'still') throw Error('TASK_INVALID');
  if (task.options?.observeAssets && task.mode !== 'studio') throw Error('TASK_SCOPE_INVALID');
  if (task.options && (task.options.target.aspect !== task.job.aspectId || task.options.target.totalFrames !== task.job.totalFrames)) throw Error('TASK_SCOPE_INVALID');
  if (task.mode === 'shard' && (task.shard.start >= task.shard.end || task.shard.end > task.job.totalFrames
    || task.shard.start % 15 || task.shard.end % 15 || task.shard.instance !== task.instance)) throw Error('SHARD_SCOPE_INVALID');
}
