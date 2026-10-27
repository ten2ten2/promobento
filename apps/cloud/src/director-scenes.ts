import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest} from '@promobento/contracts/digest';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {compareSeam} from '@promobento/contracts/seams';
import {customScenePlan} from '@promobento/contracts/custom-source';
import {renderPageTiming} from '@promobento/contracts/render';
import {validate as validObservation} from '@promobento/contracts/validators/frame-observation';
import platform from '../../../config/platform-presets.json';
import policy from '../../../config/agent-policy.json';
import {operation,rights,immutableJson,immutableBytes} from './store.ts';
import {checkedBytes} from './render-workflow.ts';
import type {PipelineEnv,Operation,Json,BlobRef} from './pipeline-types.ts';

/** Only a complete, persisted source/QA result can be returned to D for a new scoped edit. */
export class CustomSceneCheckError extends Error {
  constructor(code:string,readonly failure:Json){super(code);}
}

/** A new studio instance per aspect; raw author bytes are never evaluated in this Worker. */
export async function checkCustomScenes(env:PipelineEnv,op:Operation,context:Json,film:Json,sources:Record<string,string>,deadlineAt:number,repairFailures=false){
  const sourceHash=filmSourceHash(canonical(film),sources),prefix=`operations/${op.id}/custom-check/${sourceHash}`;
  const source=await immutableJson(env,prefix+'/film.json',film),modules:BlobRef[]=[];
  for(const [path,text]of Object.entries(sources))modules.push({...await immutableBytes(env,prefix+'/'+path,new TextEncoder().encode(text),'text/javascript'),name:path});
  const resourceRefs=[...context.resources,...(context.audioSources??[])];
  const release=await env.DB.prepare("SELECT image_digest FROM renderer_releases WHERE id=? AND status='active'").bind(context.rendererRelease).first<Json>();
  if(!release)throw Error('RENDER_ENVIRONMENT_MISMATCH');
  const evidence:Json[]=[];
  for(const scene of film.scenes.filter((scene:Json)=>scene.kind==='custom').sort((a:Json,b:Json)=>Number(b.params.hardest===true)-Number(a.params.hardest===true))){
    const p=customScenePlan(scene,{validateVisibleTextSlots:repairFailures}),reading=p.readingHolds.map(hold=>scene.start+Math.floor((hold.start+hold.end-1)/2));
    const frames=[...new Set([scene.start,scene.end-1,...reading,...p.events.map(event=>scene.start+event.frame)])].sort((a,b)=>a-b);
    for(const aspect of context.aspects){
      if(Date.now()>=deadlineAt)throw Error('OPERATION_DEADLINE');
      await operation(env,op.id,op.generation);await rights(env,op,resourceRefs);
      const layout=(platform.aspectLayouts as Json)[aspect],taskId='custom-'+digest({operationId:op.id,sourceHash,scene:scene.id,aspect}).slice(0,48);
      const task={schemaVersion:'3.0.0',kind:'render_task',mode:'studio',instance:'standard-3',taskId,generation:op.generation,deadlineAt,imageDigest:release.image_digest,
        job:{schemaVersion:'3.0.0',kind:'render_job',renderId:taskId,operationId:op.id,candidateId:taskId,sourceHash,runtimeVersion:context.runtimeVersion,rendererRelease:context.rendererRelease,
          aspectId:aspect,durationSeconds:film.durationSeconds,totalFrames:film.totalFrames,quality:'still',frames,
          renderProfile:{sampleCount:1,shutterAngle:0,sampling:'centered-box-v1',edgePolicy:'clamp-v1'},resources:resourceRefs.map((asset:Json)=>({resourceId:asset.resourceId,sha256:asset.sha256,kind:context.audioSources?.some((audio:Json)=>audio.resourceId===asset.resourceId)?'audio':asset.kind}))},
        options:{target:{aspect,width:layout.width,height:layout.height,safeInsets:layout.safeInsets,fps:30,totalFrames:film.totalFrames},seed:context.seed,fonts:context.fonts,
          resources:context.resources.map((asset:Json)=>({...asset,rightsCleared:true})),confirmedFactIds:context.confirmedFactIds,...renderPageTiming(film,policy.render)},
        inputs:[{...source,name:'film'},...modules,...context.resources.map((asset:Json)=>({name:'resource:'+asset.resourceId,key:asset.key,sha256:asset.sha256,byteLength:asset.byteLength}))]};
      // Resource transport uses the same narrow private contract as ordinary render jobs.
      task.options.resources=context.resources.map((asset:Json)=>({resourceId:asset.resourceId,kind:asset.kind,width:asset.width,height:asset.height,licenseRef:asset.licenseRef,rightsCleared:true}));
      const owner=env.OPERATIONS.getByName(op.id);let failed=false,repairable:CustomSceneCheckError|undefined;
      const images:Json[]=[],observations:Json[]=[],comparisons:Json[]=[];
      let phase='init',currentFrame:number|null=null,expectation:Json|undefined;
      const recordFailure=async(error:unknown)=>{
        const code=error instanceof Error?error.message:String(error);
        const failure={kind:'custom_scene_check_failure',sourceHash,sceneId:scene.id,aspect,code,phase,frame:currentFrame,modules,images,observations,comparisons,...(expectation?{expectation}:{})};
        try{await immutableJson(env,`${prefix}/${scene.id}/${aspect}/failure.json`,failure);}
        catch(evidenceError){throw new Error(code,{cause:evidenceError});}
        if(repairFailures&&['CUSTOM_QA_BLOCK','CUSTOM_HOLD_TEXT_MISSING','CUSTOM_SEEK_MISMATCH'].includes(code))throw new CustomSceneCheckError(code,failure);
      };
      const closeStudio=async()=>{
        try{await owner.closeStudio();}catch(error){if(repairable)throw new Error(repairable.message,{cause:error});if(!failed)throw error;}
      };
      const compareFrame=async(frame:number,mode:'reverse'|'cold',response:Response)=>{
        if(!response.ok)throw Error('CUSTOM_FRAME_CHECK_FAILED');
        const bytes=new Uint8Array(await response.arrayBuffer()),comparison=compareSeam(await checkedBytes(env,images.find(image=>image.frame===frame) as BlobRef),bytes);
        const actual=comparison.verdict==='RENDER_SEAM_BLOCK'?await immutableBytes(env,`${prefix}/${scene.id}/${aspect}/${frame}-${mode}.png`,bytes,'image/png'):undefined;
        comparisons.push({frame,mode,...comparison,...(actual?{actual}:{})});
        if(comparison.verdict==='RENDER_SEAM_BLOCK')throw Error('CUSTOM_SEEK_MISMATCH');
      };
      try{
        await owner.studio(op.id,canonical(task));
        for(const frame of frames){
          phase='forward';currentFrame=frame;
          await operation(env,op.id,op.generation);await rights(env,op,resourceRefs);
          let failureCode:string|undefined;
          if(reading.includes(frame)){
            const response=await owner.checkFrame(op.id,frame);if(!response.ok)throw Error('CUSTOM_FRAME_CHECK_FAILED');
            const checked=parseCanonicalJson(await response.text()) as Json;
            if(!validObservation(checked.observation)||checked.observation.renderId!==taskId||checked.observation.aspectId!==aspect||checked.observation.frame!==frame)throw Error('CUSTOM_OBSERVATION_SCOPE');
            observations.push(checked.observation);
            const holds=p.readingHolds.filter(hold=>scene.start+Math.floor((hold.start+hold.end-1)/2)===frame);
            const expected=repairFailures?[...new Set(holds.flatMap(hold=>hold.visibleTextSlots??[]))]:[];
            // CDP's hit test can conservatively mark transparent overlapping layers as REVIEW;
            // retain that policy instead of silently turning every REVIEW into a blocker.
            const missing=expected.filter(slot=>!checked.observation.texts.some((text:Json)=>text.sceneId===scene.id&&text.slotId===slot&&!text.clipped));
            if(expected.length)expectation={visibleTextSlots:expected,missingTextSlots:missing};
            if(checked.observation.findings.some((finding:Json)=>finding.severity==='BLOCK'))failureCode='CUSTOM_QA_BLOCK';
            else if(missing.length)failureCode='CUSTOM_HOLD_TEXT_MISSING';
          }
          if(failureCode&&!repairFailures)throw Error(failureCode);
          const response=await owner.frame(op.id,frame);if(!response.ok)throw Error('CUSTOM_FRAME_CHECK_FAILED');
          const ref=await immutableBytes(env,`${prefix}/${scene.id}/${aspect}/${frame}.png`,new Uint8Array(await response.arrayBuffer()),'image/png');images.push({frame,...ref});
          if(failureCode)throw Error(failureCode);
          expectation=undefined;
        }
        for(const frame of [...frames].reverse()){
          phase='reverse';currentFrame=frame;
          await operation(env,op.id,op.generation);await rights(env,op,resourceRefs);
          await compareFrame(frame,'reverse',await owner.frame(op.id,frame));
        }
      }catch(error){failed=true;try{await recordFailure(error);}catch(recordError){if(recordError instanceof CustomSceneCheckError)repairable=recordError;throw recordError;}throw error;}
      finally{await closeStudio();}
      const coldFrame=reading[Math.floor(reading.length/2)]!,coldTask={...task,taskId:taskId+'-cold'};
      failed=false;repairable=undefined;
      try{
        phase='cold';currentFrame=coldFrame;
        await owner.studio(op.id,canonical(coldTask));
        await compareFrame(coldFrame,'cold',await owner.frame(op.id,coldFrame));
      }catch(error){failed=true;try{await recordFailure(error);}catch(recordError){if(recordError instanceof CustomSceneCheckError)repairable=recordError;throw recordError;}throw error;}
      finally{await closeStudio();}
      evidence.push({sceneId:scene.id,aspect,images,observations,comparisons});
    }
  }
  const proof=await immutableJson(env,prefix+'/proof.json',{kind:'custom_scene_preflight',sourceHash,modules,evidence});
  return {sourceHash,modules,evidenceKey:proof.key};
}
