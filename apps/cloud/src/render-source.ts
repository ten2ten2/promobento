import {sha256Bytes} from '@promobento/contracts/digest';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {filmCustomSfx} from '@promobento/contracts/custom-source';
import {assertAudioPlan,audioPlanHash,deriveAudioPlan} from '../../../packages/audio/src/plan.mjs';
import {filmBlockEvents} from '../../../packages/blocks/src/events.mjs';
import type {PipelineEnv,BlobRef} from './pipeline-types.ts';

export async function checkedBytes(env:PipelineEnv,blob:BlobRef){
 const object=await env.MEDIA.get(blob.key);if(!object||object.size!==blob.byteLength||object.size>50<<20)throw Error('RENDER_OUTPUT_MISSING');
 const bytes=new Uint8Array(await object.arrayBuffer());if(sha256Bytes(bytes)!==blob.sha256)throw Error('RENDER_OUTPUT_IDENTITY_MISMATCH');return bytes;
}

// Source bytes are data here: never evaluate custom code in the Worker.
export async function loadCustomSources(env:PipelineEnv,inputs:BlobRef[]){
 const sources:Record<string,string>={};
 for(const blob of inputs.filter(item=>item.name.startsWith('scenes/'))){
  if(blob.byteLength>65536)throw Error('CUSTOM_SOURCE_SIZE');
  sources[blob.name]=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await checkedBytes(env,blob));
 }
 return sources;
}

export async function verifyRenderSource(env:PipelineEnv,film:unknown,inputs:BlobRef[],expected:string){
 const sources=await loadCustomSources(env,inputs);
 if(filmSourceHash(canonical(film),sources)!==expected)throw Error('SOURCE_IDENTITY_MISMATCH');
 return sources;
}

/** Source-authored effects must be present in the immutable audio plan before paid compute. */
export async function verifySourceSfxPlan(env:PipelineEnv,film:Record<string,any>,sources:Record<string,string>,input:Record<string,any>){
 const effects=filmCustomSfx(film as any,sources);if(!effects.length)return;
 const blob=(input.audioInputsBlobs as BlobRef[]|undefined)?.find(item=>item.name==='audio-plan');
 if(!blob||blob.byteLength>4<<20)throw Error('CUSTOM_SFX_AUDIO_PLAN_MISSING');
 const plan=parseCanonicalJson(await checkedBytes(env,blob)) as Record<string,any>;
 assertAudioPlan(plan);
 if(audioPlanHash(plan,{seed:input.audioInputs?.seed})!==input.job.audioPlanHash)throw Error('AUDIO_PLAN_SCOPE_MISMATCH');
 if(plan.mute!==Boolean(film.audio.mute))throw Error('CUSTOM_SFX_AUDIO_PLAN_MISMATCH');
 const reference={...film,audio:{...film.audio,music:{kind:'none'},sfx:[],mute:false}};
 const expected=deriveAudioPlan(reference,filmBlockEvents(reference as any),{sourceSfx:effects});
 if(plan.mute)return;
 for(const event of expected.events){
  const actual=plan.events.find((item:Record<string,any>)=>item.eventId===event.eventId);
  if(!actual||canonical(actual)!==canonical(event))throw Error('CUSTOM_SFX_AUDIO_PLAN_MISMATCH');
 }
}
