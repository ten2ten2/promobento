import {validate} from '@promobento/contracts/validators/audio-admission';
import {digest,sha256Bytes} from '@promobento/contracts/digest';
import {filmCustomSfx} from '@promobento/contracts/custom-source';
import {deriveAudioPlan,GENERATED_LICENSE} from '../../../packages/audio/src/plan.mjs';
import {filmBlockEvents} from '../../../packages/blocks/src/events.mjs';
import {getJson,rights} from './store.ts';
import type {PipelineEnv,Operation,Json} from './pipeline-types.ts';

export interface AdmittedMusic {kind:'score'|'upload';resourceId:string;sha256:string;key:string;byteLength:number;licenseRef:string;
 scoreRef?:string;text?:string;approvals:Array<{totalFrames:number;requestHash:string}>}

/** Called before any model call. Only the trusted rights store can supply licence and score approvals. */
export async function admitDirectorAudio(env:PipelineEnv,op:Operation,input:unknown):Promise<AdmittedMusic[]>{
 if(!validate({kind:'audio_source_catalog',sources:input}))throw Error('AUDIO_CATALOG_INVALID');
 const sources=input as Json[],ids=new Set<string>(),refs=new Set<string>(),admitted:AdmittedMusic[]=[];
 for(const source of sources){
  if(ids.has(source.resourceId)||source.key.split('/').includes('..')||source.scoreRef&&refs.has(source.scoreRef))throw Error('AUDIO_CATALOG_INVALID');
  ids.add(source.resourceId);if(source.scoreRef)refs.add(source.scoreRef);
  await rights(env,op,[source]); // No source read/decoding before clearance, even during free preview.
  const row=await env.DB.prepare('SELECT license_ref,evidence_key,scope FROM pipeline_rights WHERE operation_id=? AND resource_id=? AND sha256=? AND revoked_at IS NULL')
   .bind(op.id,source.resourceId,source.sha256).first<Json>();
  if(!row)throw Error('AUDIO_RIGHTS_PENDING');
  const evidence=await getJson(env,row.evidence_key);
  if(!validate(evidence)||evidence.kind!=='audio_source_rights'||evidence.operationId!==op.id||evidence.resourceId!==source.resourceId
   ||evidence.sha256!==source.sha256||evidence.licenseRef!==row.license_ref||evidence.scope!==row.scope)throw Error('AUDIO_RIGHTS_EVIDENCE_INVALID');
  const head=await env.MEDIA.head(source.key);
  if(!head||head.size!==source.byteLength||head.customMetadata?.sha256!==source.sha256)throw Error('AUDIO_SOURCE_IDENTITY_MISMATCH');
  const music:AdmittedMusic={kind:source.kind,resourceId:source.resourceId,sha256:source.sha256,key:source.key,byteLength:source.byteLength,
   licenseRef:row.license_ref,approvals:[]};
  if(source.kind==='score'){
   const object=await env.MEDIA.get(source.key);if(!object||object.size!==source.byteLength)throw Error('AUDIO_SOURCE_IDENTITY_MISMATCH');
   const bytes=new Uint8Array(await object.arrayBuffer());
   if(bytes.length!==source.byteLength||sha256Bytes(bytes)!==source.sha256)throw Error('AUDIO_SOURCE_IDENTITY_MISMATCH');
   try{music.text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes);}catch{throw Error('SCORE_TEXT_INVALID');}
   music.scoreRef=source.scoreRef;const frames=new Set<number>();
   if(!evidence.scoreApprovals?.length)throw Error('SCORE_APPROVAL_REQUIRED');
   for(const approval of evidence.scoreApprovals){
    if(frames.has(approval.totalFrames)||approval.requestHash!==digest({text:music.text,totalFrames:approval.totalFrames}))throw Error('SCORE_APPROVAL_REQUIRED');
    frames.add(approval.totalFrames);music.approvals.push(approval);
   }
  }
  admitted.push(music);
 }
 return admitted;
}

/** Selectors are creative input; they grant no rights. Plans and container inputs are assembled by the host. */
export function directorAudio(film:Json,catalog:AdmittedMusic[],seed:string,sceneSources?:Record<string,string>){
 if(!film.audio.mute&&film.audio.voice)throw Error('AUDIO_VOICE_PLAN_REQUIRED');
 const request=film.audio.music,external=!film.audio.mute&&['score','upload'].includes(request.kind);
 const music=external?catalog.find(item=>item.kind===request.kind&&(item.kind==='score'?item.scoreRef===request.scoreRef:item.resourceId===request.resourceId)):undefined;
 if(external&&!music)throw Error('AUDIO_EXTERNAL_PLAN_REQUIRED');
 const approval=music?.kind==='score'?music.approvals.find(item=>item.totalFrames===film.totalFrames):undefined;
 if(music?.kind==='score'&&!approval)throw Error('SCORE_APPROVAL_REQUIRED');
 const sourceSfx=sceneSources?filmCustomSfx(film as any,sceneSources):[];
 const plan=deriveAudioPlan(film,filmBlockEvents(film as any),{...(music?{externalMusic:music}:{}),sourceSfx});
 const clearedSources=plan.sources.map((source:Json)=>{
  if(source.sourceId==='music'&&music)return{sourceId:'music',licenseRef:music.licenseRef,sha256:music.sha256,rightsCleared:true,...(approval?{requestHash:approval.requestHash}:{})};
  if(source.licenseRef!==GENERATED_LICENSE)throw Error('AUDIO_RIGHTS_PENDING');return{sourceId:source.sourceId,licenseRef:source.licenseRef,rightsCleared:true};
 });
 return{plan,blobs:music?[{name:'audio:music',key:music.key,sha256:music.sha256,byteLength:music.byteLength}]:[],
  inputs:{seed,clearedSources,...(music?.kind==='score'?{scores:[['music',music.text!]]}:{})}};
}
