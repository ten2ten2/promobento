import {readFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest,sha256Bytes} from '@promobento/contracts/digest';
import {validate} from '@promobento/contracts/validators/audio-admission';
import {decodeSampleWav} from '../../packages/audio/src/samples.mjs';

const approvalFile='docs/evidence/2026-10-24-s1-audio-review/original-score-test-clearance.json';

/** This eval option is deliberately limited to the owner's exact original score and derived WAVs. */
export function approvedMusic({kind,bytes,totalFrames,approval}){
 if(!['score','upload'].includes(kind)||![450,900].includes(totalFrames)||approval.kind!=='s1_internal_original_music_clearance'
  ||approval.decidedBy!=='owner'||approval.publicUseCleared!==false||approval.scope!=='internal_eval_only'
  ||approval.decision!=='approve_15_and_30_second_internal_ABC_and_derived_WAV_tests')throw Error('EVAL_MUSIC_APPROVAL_REQUIRED');
 const sha256=sha256Bytes(bytes),licenseRef='LicenseRef-PromoBento-S1-Original-Score';
 if(kind==='score'){
  if(bytes.length!==approval.scoreSource.byteLength||sha256!==approval.scoreSource.sha256)throw Error('EVAL_SCORE_IDENTITY_MISMATCH');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(!approval.scoreApprovals.some(item=>item.totalFrames===totalFrames&&item.requestHash===digest({text,totalFrames})))throw Error('EVAL_SCORE_APPROVAL_MISMATCH');
 }else{
  const output=approval.sourcePreparation?.outputs?.find(item=>item.sha256===sha256&&item.byteLength===bytes.length);
  if(!output||output.totalFrames!==totalFrames||output.sampleRate!==48000||output.channels!==2||output.sampleFrames!==totalFrames*1600)throw Error('EVAL_DERIVED_WAV_IDENTITY_MISMATCH');
  const pcm=decodeSampleWav(bytes);
  if(pcm.L.length!==output.totalFrames*1600||pcm.R.length!==pcm.L.length)throw Error('EVAL_DERIVED_WAV_DURATION_MISMATCH');
 }
 const resourceId='res_s1_original_'+kind+'_'+sha256.slice(0,12),selector=kind==='score'?{kind,scoreRef:'audio/s1-original.abc'}:{kind,resourceId};
 return{kind,bytes,sha256,resourceId,licenseRef,selector,totalFrames,approval,
  basis:'Owner approved this original ABC and its derived WAV for internal 15/30-second tests; 15 seconds uses the first half. '+approvalFile,
  source:approvalFile+(kind==='score'?'#/scoreSource':'#/sourcePreparation')};
}

export function readApprovedMusic(kind,file,totalFrames){
 const approval=parseCanonicalJson(readFileSync(approvalFile));
 // Read the owner decision before loading or decoding the selected source.
 if(!resolve(file).startsWith(resolve('artifacts')+sep))throw Error('EVAL_APPROVED_SOURCE_PATH_REQUIRED');
 return approvedMusic({kind,bytes:new Uint8Array(readFileSync(file)),totalFrames,approval});
}

/** A new operation gets its own rights evidence before the director can read the source. */
export async function admitMusic(music,{operationId,prefix,json,call}){
 const extension=music.kind==='score'?'abc':'wav',mediaType=music.kind==='score'?'text/vnd.abc':'audio/wav';
 const object=await json('objects/evals/s1-approved-music/'+music.sha256+'.'+extension,{method:'PUT',body:music.bytes,mediaType});
 if(object.sha256!==music.sha256||object.byteLength!==music.bytes.length)throw Error('EVAL_MUSIC_UPLOAD_IDENTITY_MISMATCH');
 const source={kind:music.kind,resourceId:music.resourceId,...object,...(music.kind==='score'?{scoreRef:music.selector.scoreRef}:{})};
 const evidence={kind:'audio_source_rights',operationId,resourceId:music.resourceId,sha256:music.sha256,licenseRef:music.licenseRef,
  scope:'internal_eval_only',approvedBy:'owner',source:music.source,basis:music.basis,
  ...(music.kind==='score'?{scoreApprovals:music.approval.scoreApprovals}:{})};
 if(!validate({kind:'audio_source_catalog',sources:[source]})||!validate(evidence))throw Error('EVAL_AUDIO_ADMISSION_INVALID');
 const rights=await json('objects/'+prefix+'/music-rights.json',{method:'PUT',body:new TextEncoder().encode(canonical(evidence))});
 await call('rights',{method:'POST',body:{operationId,resourceId:music.resourceId,sha256:music.sha256,licenseRef:music.licenseRef,
  evidenceKey:rights.key,scope:'internal_eval_only'}});
 return{source,evidenceKey:rights.key,selector:music.selector,totalFrames:music.totalFrames};
}
