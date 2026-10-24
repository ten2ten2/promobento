// One actual failed card frame, using its approved private material and current pinned renderer.
// Only constructs data locally; the FilmSpec runs in the container's Chromium sandbox.
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {canonical} from '@promobento/contracts/canonical';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {renderPageTiming} from '@promobento/contracts/render';
import {deriveAudioPlan,audioPlanHash} from '../../packages/audio/src/plan.mjs';
import {filmBlockEvents} from '../../packages/blocks/src/events.mjs';
import platform from '../../config/platform-presets.json' with {type:'json'};
import policy from '../../config/agent-policy.json' with {type:'json'};

export async function probeCardLayout({receipt,context,operationId,prefix,output,json,call}){
 const calls=receipt.result?.toolCalls;
 if(receipt.kind!=='metered_model_response'||receipt.result.failure||calls?.length!==1||calls[0].name!=='write_spec'
  ||Object.keys(calls[0].input??{}).length!==1||!calls[0].input.film)throw Error('COMPLETED_WRITE_SPEC_RECEIPT_REQUIRED');
 const spec=calls[0].input.film,frame=270,scene=spec.scenes.find(scene=>scene.block==='feature-grid@1'&&scene.start<=frame&&frame<scene.end);
 const pairs=scene?.params.items.map(item=>({titleSlot:item.textSlot,subtitleSlot:item.subtitleSlot}));
 if(spec.durationSeconds!==context.durationSeconds||spec.totalFrames!==450||spec.scenes.some(scene=>scene.kind!=='block')||!scene||pairs?.length!==3
  ||scene.params.items.some(item=>!item.assetKey||!item.subtitleSlot))throw Error('THREE_IMAGE_TITLE_SUBTITLE_CARDS_REQUIRED');
 const source=await json('objects/'+prefix+'/card-layout.json',{method:'PUT',body:new TextEncoder().encode(canonical(spec))});
 const taskId='layout-'+operationId,layout=platform.aspectLayouts.landscape;
 const plan=deriveAudioPlan(spec,filmBlockEvents(spec));
 const task={schemaVersion:'3.0.0',kind:'render_task',mode:'studio',instance:'standard-3',taskId,
  job:{schemaVersion:'3.0.0',kind:'render_job',renderId:taskId,operationId,candidateId:'candidate-'+operationId,
   sourceHash:filmSourceHash(canonical(spec)),runtimeVersion:context.runtimeVersion,rendererRelease:context.rendererRelease,aspectId:'landscape',
   durationSeconds:15,totalFrames:450,quality:'still',frames:[frame],renderProfile:{sampleCount:1,shutterAngle:0,sampling:'centered-box-v1',edgePolicy:'clamp-v1'},
   audioPlanHash:audioPlanHash(plan,{seed:context.seed}),resources:context.resources.map(asset=>({resourceId:asset.resourceId,sha256:asset.sha256,kind:asset.kind}))},
  options:{target:{aspect:'landscape',width:layout.width,height:layout.height,safeInsets:layout.safeInsets,fps:30,totalFrames:450},seed:context.seed,
   fonts:context.fonts,confirmedFactIds:context.confirmedFactIds,resources:context.resources.map(asset=>({resourceId:asset.resourceId,kind:asset.kind,width:asset.width,height:asset.height,licenseRef:asset.licenseRef,rightsCleared:true})),
   ...renderPageTiming(spec,policy.render)},inputs:[{...source,name:'film'},...context.resources.map(asset=>({name:'resource:'+asset.resourceId,key:asset.key,sha256:asset.sha256,byteLength:asset.byteLength}))]};
 const report={scope:'same_failed_FilmSpec_material_font_seed_landscape_1080p_still_no_models',frame,sourceCallId:receipt.callId,pairs,status:'running'};
 const save=()=>writeFileSync(join(output,'layout-check.json'),canonical(report)+'\n');let failure;save();
 try{
  report.ready=await json('studio',{method:'POST',body:task});
  writeFileSync(join(output,'layout-landscape.png'),new Uint8Array(await(await call('operations/'+operationId+'/frames/'+frame)).arrayBuffer()));
  report.check=await json('operations/'+operationId+'/studio/check/'+frame,{method:'POST'});
  const observation=report.check.observation;
  if(report.check.frameIndex!==frame||observation.frame!==frame||observation.renderId!==taskId||observation.aspectId!=='landscape'
   ||observation.findings.some(finding=>finding.severity==='BLOCK'))throw Error('LAYOUT_OBSERVATION_INVALID');
  for(const pair of pairs){
   const titles=observation.texts.filter(text=>text.slotId===pair.titleSlot),subtitles=observation.texts.filter(text=>text.slotId===pair.subtitleSlot);
   if(titles.length!==1||subtitles.length!==1)throw Error('LAYOUT_TEXT_MISSING');
   pair.title=titles[0].box;pair.subtitle=subtitles[0].box;pair.verticalGapPx=pair.subtitle.y-pair.title.y-pair.title.height;
   if(pair.verticalGapPx<4)throw Error('LAYOUT_TEXT_OVERLAP');
  }
  report.status='passed';save();return report;
 }catch(error){failure=error;report.status='failed';report.error=String(error.stack??error);save();throw error;}
 finally{try{await call('operations/'+operationId+'/studio/close',{method:'POST'});}catch(error){report.cleanupError=String(error.stack??error);report.status='failed';save();if(!failure)throw error;}}
}
