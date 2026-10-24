// Re-render one paid, completed FilmSpec through the actual private review pipeline.
// No models, no local author-JS execution, no replacement for a full creative case.
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {renderPageTiming,planShards,renderDeadlineMs} from '@promobento/contracts/render';
import {deriveAudioPlan,audioPlanHash,GENERATED_LICENSE} from '../../packages/audio/src/plan.mjs';
import {filmBlockEvents} from '../../packages/blocks/src/events.mjs';
import {parseModelJson} from '../../packages/models/src/adapters.mjs';
import platform from '../../config/platform-presets.json' with {type:'json'};
import policy from '../../config/agent-policy.json' with {type:'json'};

export function completedReviewFilm(receipt){
 const calls=receipt.result?.toolCalls;
 if(receipt.kind==='metered_model_response'&&!receipt.result.failure){
  if(calls?.length===1&&calls[0].name==='write_spec'&&Object.keys(calls[0].input??{}).length===1&&calls[0].input.film)
   return{film:calls[0].input.film,sourceKind:'completed_write_spec'};
  if(calls?.length===0&&receipt.result.text){
   const film=parseModelJson(receipt.result.text);
   if(film?.specVersion==='film-v1')return{film,sourceKind:'completed_film_json'};
  }
 }
 throw Error('COMPLETED_FILM_RECEIPT_REQUIRED');
}

export async function probeReviewRender({receipt,context,operationId,prefix,output,json,download,stopping}){
 const {film,sourceKind}=completedReviewFilm(receipt);
 if(film.durationSeconds!==context.durationSeconds||film.scenes.some(scene=>scene.kind!=='block')||film.audio.voice
  ||!['procedural','none'].includes(film.audio.music.kind))throw Error('TRUSTED_BLOCK_GENERATED_AUDIO_REVIEW_REQUIRED');
 const source=await json('objects/'+prefix+'/review-film.json',{method:'PUT',body:new TextEncoder().encode(canonical(film))});
 const plan=deriveAudioPlan(film,filmBlockEvents(film));
 if(plan.sources.some(source=>source.licenseRef!==GENERATED_LICENSE))throw Error('GENERATED_AUDIO_RIGHTS_REQUIRED');
 const audio=await json('objects/'+prefix+'/audio-plan.json',{method:'PUT',body:new TextEncoder().encode(canonical(plan))});
 const renderId='review-'+operationId,aspect='landscape',{ratio,...layout}=platform.aspectLayouts[aspect];
 const job={schemaVersion:'3.0.0',kind:'render_job',renderId,operationId,candidateId:'candidate-'+operationId,
  sourceHash:filmSourceHash(canonical(film)),runtimeVersion:context.runtimeVersion,rendererRelease:context.rendererRelease,aspectId:aspect,
  durationSeconds:film.durationSeconds,totalFrames:film.totalFrames,quality:'review',
  renderProfile:{sampleCount:1,shutterAngle:0,sampling:'centered-box-v1',edgePolicy:'clamp-v1'},
  audioPlanHash:audioPlanHash(plan,{seed:context.seed}),resources:context.resources.map(asset=>({resourceId:asset.resourceId,sha256:asset.sha256,kind:asset.kind}))};
 const input={job,options:{target:{aspect,...layout,fps:30,totalFrames:film.totalFrames},seed:context.seed,fonts:context.fonts,
  resources:context.resources.map(asset=>({resourceId:asset.resourceId,kind:asset.kind,width:asset.width,height:asset.height,licenseRef:asset.licenseRef,rightsCleared:true})),
  confirmedFactIds:context.confirmedFactIds,...renderPageTiming(film,policy.render)},
  inputs:[{...source,name:'film'},...context.resources.map(asset=>({name:'resource:'+asset.resourceId,key:asset.key,sha256:asset.sha256,byteLength:asset.byteLength}))],
  audioInputsBlobs:[{...audio,name:'audio-plan'}],audioInputs:{seed:context.seed,clearedSources:plan.sources.map(source=>({sourceId:source.sourceId,licenseRef:source.licenseRef,rightsCleared:true}))},
  coverFrame:Math.floor(film.totalFrames*.55)};
 const partition=planShards(job,film,{seed:context.seed}),report={scope:'actual_private_review_render_from_completed_paid_spec_no_models',
  sourceCallId:receipt.callId,sourceKind,renderId,sourceHash:job.sourceHash,partition,deadlineMs:renderDeadlineMs(job,partition,policy.render),status:'running'};
 const save=()=>writeFileSync(join(output,'review-render.json'),canonical(report)+'\n');save();
 try{
  const started=Date.now();report.submittedAt=new Date(started).toISOString();save();
  await json('renders',{method:'POST',body:input});
  for(;;){
   if(stopping())throw Error('EVAL_INTERRUPTED');
   const state=await json('renders/'+renderId);report.lastState=state;save();
   if(state.status==='passed'){
    report.result=parseCanonicalJson(state.result_json);report.clientWallMs=Date.now()-started;
    for(const ref of report.result.outputs.filter(ref=>/\/(film.mp4|poster.png)$/.test(ref.key)))await download(ref,'review-'+ref.key.split('/').at(-1));
    report.status='passed';save();return report;
   }
   if(['blocked','cancelled'].includes(state.status))throw Error('REVIEW_'+(parseCanonicalJson(state.result_json).code??state.status));
   // Polling grace is only for observing server cleanup. It never extends the render deadline.
   if(Date.now()-started>=report.deadlineMs+30000)throw Error('EVAL_REVIEW_RESULT_NOT_TERMINAL');
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
 }catch(error){report.status='failed';report.error=String(error.stack??error);save();throw error;}
}
