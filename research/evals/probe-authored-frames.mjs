// Recheck a previously authored source in the isolated staging studio; never execute it locally.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {digest} from '@promobento/contracts/digest';
import {customScenePlan} from '@promobento/contracts/custom-source';
import {compareSeam} from '@promobento/contracts/seams';
import {renderPageTiming} from '@promobento/contracts/render';
import {validate as validObservation} from '@promobento/contracts/validators/frame-observation';
import {completedReviewFilm} from './probe-review-render.mjs';
import platform from '../../config/platform-presets.json' with {type:'json'};
import policy from '../../config/agent-policy.json' with {type:'json'};

export function readAuthoredSnapshot(directory){
 const root=resolve(directory);if(!root.startsWith(resolve('artifacts')+'/'))throw Error('PRIVATE_AUTHORED_SNAPSHOT_REQUIRED');
 const receipt=parseCanonicalJson(readFileSync(join(root,'film-receipt.json'))),failure=parseCanonicalJson(readFileSync(join(root,'failure.json')));
 const {film}=completedReviewFilm(receipt),sources={};
 for(const scene of film.scenes.filter(scene=>scene.kind==='custom')){
  if(scene.module!==`scenes/${scene.id}/index.js`||!/^[a-z][a-z0-9-]{0,47}$/.test(scene.id))throw Error('CUSTOM_EDIT_SCOPE');
  sources[scene.module]=readFileSync(join(root,scene.module),'utf8');
 }
 if(!Object.keys(sources).length||!receipt.quote||failure.kind!=='custom_scene_check_failure'||filmSourceHash(canonical(film),sources)!==failure.sourceHash)throw Error('AUTHORED_SNAPSHOT_IDENTITY_MISMATCH');
 const partialSceneId=typeof failure.sceneId==='string'&&film.scenes.some(scene=>scene.kind==='custom'&&scene.id===failure.sceneId)
  &&Array.isArray(failure.modules)&&failure.modules.length===Object.keys(sources).length
  &&failure.modules.every(module=>Object.hasOwn(sources,module.name)&&module.key?.includes(`/custom-probe/${failure.sceneId}/${failure.sourceHash}/`))?failure.sceneId:null;
 return{film,sources,failure,receipt,partialSceneId};
}

// Only a complete preflight can authorize a standalone render of the identical source.
// A partial probe or a failure record never counts as a completed film.
export function readCompletedAuthoredSnapshot(directory,aspect){
 const root=resolve(directory);if(!root.startsWith(resolve('artifacts')+'/'))throw Error('PRIVATE_AUTHORED_SNAPSHOT_REQUIRED');
 const receipt=parseCanonicalJson(readFileSync(join(root,'film-receipt.json'))),proof=parseCanonicalJson(readFileSync(join(root,'proof.json')));
 const {film}=completedReviewFilm(receipt),sources={},custom=film.scenes.filter(scene=>scene.kind==='custom');
 for(const scene of custom){
  if(scene.module!==`scenes/${scene.id}/index.js`||!/^[a-z][a-z0-9-]{0,47}$/.test(scene.id))throw Error('CUSTOM_EDIT_SCOPE');
  sources[scene.module]=readFileSync(join(root,scene.module),'utf8');
 }
 if(!custom.length||!receipt.quote||proof.kind!=='custom_scene_preflight'||filmSourceHash(canonical(film),sources)!==proof.sourceHash
  ||!Array.isArray(proof.modules)||proof.modules.length!==custom.length||proof.modules.some(module=>!Object.hasOwn(sources,module.name)||!module.key?.includes(`/custom-check/${proof.sourceHash}/`))
  ||!Array.isArray(proof.evidence)||custom.some(scene=>!proof.evidence.some(e=>e.sceneId===scene.id&&e.aspect===aspect&&Array.isArray(e.comparisons)
   &&e.comparisons.some(c=>c.mode==='reverse')&&e.comparisons.some(c=>c.mode==='cold')&&e.comparisons.every(c=>c.verdict!=='RENDER_SEAM_BLOCK'))))throw Error('AUTHORED_SNAPSHOT_IDENTITY_MISMATCH');
 return{film,sources,receipt,proof};
}

export async function probeAuthoredFrames({snapshot,context,operationId,prefix,output,json,call}){
 const{film,sources,failure,receipt,partialSceneId}=snapshot;if(film.durationSeconds!==context.durationSeconds)throw Error('AUTHORED_SNAPSHOT_DURATION_MISMATCH');
 const source=await json('objects/'+prefix+'/authored-film.json',{method:'PUT',body:new TextEncoder().encode(canonical(film))});
 const modules=[];for(const[path,text]of Object.entries(sources))modules.push({...await json('objects/'+prefix+'/'+path,{method:'PUT',body:new TextEncoder().encode(text),mediaType:'text/javascript'}),name:path});
 const resources=context.resources.map(asset=>({resourceId:asset.resourceId,sha256:asset.sha256,kind:asset.kind}));
 const report={scope:partialSceneId?'same_original_partial_scene_probe_with_placeholders_no_models':'same_original_authored_source_in_staging_studio_no_models',sourceHash:failure.sourceHash,sourceCallId:receipt.callId,...(partialSceneId?{partialSceneId}:{}),status:'running',aspects:[]};
 const save=()=>writeFileSync(join(output,'authored-frame-check.json'),canonical(report)+'\n');save();
 try{
  for(const aspect of context.aspects)for(const scene of film.scenes.filter(scene=>scene.kind==='custom'&&(!partialSceneId||scene.id===partialSceneId))){
   const p=customScenePlan(scene,{validateVisibleTextSlots:true,validateAssetChecks:true});
   const reading=p.readingHolds.map(hold=>scene.start+Math.floor((hold.start+hold.end-1)/2));
   const assetFrames=(p.assetChecks??[]).map(check=>scene.start+check.frame);
   const eligible=frame=>!partialSceneId||film.scenes.filter(item=>item.start<=frame&&frame<item.end).length===1;
   const frames=[...new Set([scene.start,scene.end-1,...reading,...assetFrames,...p.events.map(event=>scene.start+event.frame)])].filter(eligible).sort((a,b)=>a-b);
   if(!frames.length)throw Error('CUSTOM_PROBE_NO_UNSHARED_FRAMES');
   const layout=platform.aspectLayouts[aspect],taskId='authored-'+digest({operationId,sceneId:scene.id,aspect,sourceHash:failure.sourceHash}).slice(0,48);
   const task={schemaVersion:'3.0.0',kind:'render_task',mode:'studio',instance:'standard-3',taskId,
    job:{schemaVersion:'3.0.0',kind:'render_job',renderId:taskId,operationId,candidateId:taskId,sourceHash:failure.sourceHash,
     runtimeVersion:context.runtimeVersion,rendererRelease:context.rendererRelease,aspectId:aspect,durationSeconds:film.durationSeconds,totalFrames:film.totalFrames,
     quality:'still',frames,renderProfile:{sampleCount:1,shutterAngle:0,sampling:'centered-box-v1',edgePolicy:'clamp-v1'},resources},
    options:{target:{aspect,width:layout.width,height:layout.height,safeInsets:layout.safeInsets,fps:30,totalFrames:film.totalFrames},seed:context.seed,fonts:context.fonts,
     resources:context.resources.map(asset=>({resourceId:asset.resourceId,kind:asset.kind,width:asset.width,height:asset.height,licenseRef:asset.licenseRef,rightsCleared:true})),
     confirmedFactIds:context.confirmedFactIds,...renderPageTiming(film,policy.render),observeAssets:true},
    inputs:[{...source,name:'film'},...modules,...context.resources.map(asset=>({name:'resource:'+asset.resourceId,key:asset.key,sha256:asset.sha256,byteLength:asset.byteLength}))]};
   const evidence={aspect,sceneId:scene.id,frames,observations:[],comparisons:[]};report.aspects.push(evidence);save();let active=false,primaryFailure;
   try{
    active=true;await json('studio',{method:'POST',body:task});const baseline=new Map();
    for(const frame of frames){
     const observation=await json(`operations/${operationId}/studio/check/${frame}`,{method:'POST'});
     const bytes=new Uint8Array(await(await call(`operations/${operationId}/frames/${frame}`)).arrayBuffer());baseline.set(frame,bytes);writeFileSync(join(output,`${aspect}-${frame}.png`),bytes);
     evidence.observations.push(observation.observation);save();const data=observation.observation;
     if(!validObservation(data)||observation.frameIndex!==frame||data.renderId!==taskId||data.aspectId!==aspect||data.frame!==frame)throw Error('CUSTOM_OBSERVATION_SCOPE');
     if(data.findings.some(f=>f.severity==='BLOCK'))throw Error('CUSTOM_QA_BLOCK');
     const slots=[...new Set(p.readingHolds.filter(hold=>scene.start+Math.floor((hold.start+hold.end-1)/2)===frame).flatMap(hold=>hold.visibleTextSlots??[]))];
     if(slots.some(slot=>!data.texts.some(text=>text.sceneId===scene.id&&text.slotId===slot&&!text.clipped)))throw Error('CUSTOM_HOLD_TEXT_MISSING');
     const keys=[...new Set((p.assetChecks??[]).filter(check=>scene.start+check.frame===frame).flatMap(check=>check.assetKeys))];
     if(keys.some(key=>!data.assets?.some(asset=>asset.sceneId===scene.id&&asset.resourceId===film.assets[key].resourceId&&asset.visibility==='visible')))throw Error('CUSTOM_REQUIRED_ASSET_NOT_VISIBLE');
    }
    for(const frame of [...frames].reverse()){
     const actual=new Uint8Array(await(await call(`operations/${operationId}/frames/${frame}`)).arrayBuffer()),comparison=compareSeam(baseline.get(frame),actual);
     evidence.comparisons.push({frame,mode:'reverse',...comparison});if(comparison.verdict==='RENDER_SEAM_BLOCK')throw Error('CUSTOM_SEEK_MISMATCH');
    }
    await call(`operations/${operationId}/studio/close`,{method:'POST'});active=false;
    active=true;await json('studio',{method:'POST',body:{...task,taskId:taskId+'-cold'}});
    const eligibleReading=reading.filter(eligible),frame=eligibleReading.length?eligibleReading[Math.floor(eligibleReading.length/2)]:frames[Math.floor(frames.length/2)];
    const actual=new Uint8Array(await(await call(`operations/${operationId}/frames/${frame}`)).arrayBuffer()),comparison=compareSeam(baseline.get(frame),actual);
    evidence.comparisons.push({frame,mode:'cold',...comparison});if(comparison.verdict==='RENDER_SEAM_BLOCK')throw Error('CUSTOM_SEEK_MISMATCH');
   }catch(error){primaryFailure=error;throw error;}
   finally{if(active)try{await call(`operations/${operationId}/studio/close`,{method:'POST'});}catch(error){evidence.cleanupError=String(error);if(!primaryFailure)throw error;}save();}
  }
  report.status='passed';save();return report;
 }catch(error){report.status='failed';report.error=String(error.stack??error);save();throw error;}
}
