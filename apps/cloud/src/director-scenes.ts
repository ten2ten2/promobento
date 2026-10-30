import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest} from '@promobento/contracts/digest';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {compareSeam} from '@promobento/contracts/seams';
import {customScenePlan} from '@promobento/contracts/custom-source';
import {filmUsesWebgl,planShards,renderPageTiming} from '@promobento/contracts/render';
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

/** Prior evidence must identify this scene, aspect, frame and each exact resource. */
export function hasPriorVisibleAssets(previous:Json|undefined,failure:Json,scene:Json,film:Json,missing:string[]){
  return previous?.code==='CUSTOM_SEEK_MISMATCH'&&previous.aspect===failure.aspect&&missing.length>0
    &&previous.observations.some((observation:Json)=>observation.frame===failure.frame&&missing.every(key=>
      observation.assets?.some((asset:Json)=>asset.sceneId===scene.id&&asset.resourceId===film.assets[key]?.resourceId&&asset.visibility==='visible')));
}

/** A second, distinct seek failure may be fixed only after the exact earlier blocked frame is clear. */
export function hasClearedQaBeforeSeek(previous:Json|undefined,failure:Json){
  if(previous?.code!=='CUSTOM_QA_BLOCK'||failure.code!=='CUSTOM_SEEK_MISMATCH'||previous.aspect!==failure.aspect
    ||previous.sceneId!==failure.sceneId||previous.frame===failure.frame)return false;
  const before=previous.observations?.find((item:Json)=>item.frame===previous.frame);
  const after=failure.observations?.find((item:Json)=>item.frame===previous.frame);
  return Boolean(Array.isArray(before?.findings)&&before.findings.some((item:Json)=>item.severity==='BLOCK')
    &&Array.isArray(after?.findings)&&!after.findings.some((item:Json)=>item.severity==='BLOCK'));
}

/** Inert placeholders allow one completed scene to be checked before other modules are authored.
 * They are executed only by the renderer, never used for a candidate or a final proof. */
export function probeCustomSources(film:Json,sceneId:string,sources:Record<string,string>){
  const result={...sources};
  for(const scene of film.scenes.filter((item:Json)=>item.kind==='custom'&&item.id!==sceneId)){
    const plan=customScenePlan(scene);
    const reads=[...plan.textSlots.map(id=>`ctx.text(${canonical(id)});`),...plan.assetKeys.map(id=>`ctx.asset(${canonical(id)});`)].join('');
    result[scene.module]=`PB.scene(${canonical(scene.id)},ctx=>{${reads}const timeline=gsap.timeline({paused:true});timeline.to({},{duration:${(scene.end-scene.start)/30}});return {timeline};});`;
  }
  return result;
}

/** A new studio instance per aspect; raw author bytes are never evaluated in this Worker. */
export async function checkCustomScenes(env:PipelineEnv,op:Operation,context:Json,film:Json,sources:Record<string,string>,deadlineAt:number,repairFailures=false,probeSceneId?:string,assetChecksRequired=false,repairHiddenAssets=false,checkShardSeams=false,reportUnverifiedAssets=false,checkReviewShardHistory=false){
  const sourceHash=filmSourceHash(canonical(film),sources),prefix=probeSceneId
    ?`operations/${op.id}/custom-probe/${probeSceneId}/${sourceHash}`:`operations/${op.id}/custom-check/${sourceHash}`;
  const source=await immutableJson(env,prefix+'/film.json',film),modules:BlobRef[]=[];
  for(const [path,text]of Object.entries(sources))modules.push({...await immutableBytes(env,prefix+'/'+path,new TextEncoder().encode(text),'text/javascript'),name:path});
  const resourceRefs=[...context.resources,...(context.audioSources??[])];
  const release=await env.DB.prepare("SELECT image_digest FROM renderer_releases WHERE id=? AND status='active'").bind(context.rendererRelease).first<Json>();
  if(!release)throw Error('RENDER_ENVIRONMENT_MISMATCH');
  const evidence:Json[]=[];
  for(const scene of film.scenes.filter((scene:Json)=>scene.kind==='custom'&&(!probeSceneId||scene.id===probeSceneId)).sort((a:Json,b:Json)=>Number(b.params.hardest===true)-Number(a.params.hardest===true))){
    const p=customScenePlan(scene,{validateVisibleTextSlots:repairFailures,validateAssetChecks:assetChecksRequired});
    // A placeholder cannot establish behavior in a shared frame; defer those frames to the full check.
    const eligible=(frame:number)=>!probeSceneId||film.scenes.filter((item:Json)=>item.start<=frame&&frame<item.end).length===1;
    const reading=p.readingHolds.map(hold=>scene.start+Math.floor((hold.start+hold.end-1)/2)).filter(eligible);
    const assetFrames=assetChecksRequired?(p.assetChecks??[]).map(check=>scene.start+check.frame).filter(eligible):[];
    const frames=[...new Set([scene.start,scene.end-1,...reading,...assetFrames,...p.events.map(event=>scene.start+event.frame)])].filter(eligible).sort((a,b)=>a-b);
    if(!frames.length){evidence.push({sceneId:scene.id,scope:'probe_no_unshared_frames',images:[],observations:[],comparisons:[]});continue;}
    for(const aspect of context.aspects){
      if(Date.now()>=deadlineAt)throw Error('OPERATION_DEADLINE');
      await operation(env,op.id,op.generation);await rights(env,op,resourceRefs);
      const layout=(platform.aspectLayouts as Json)[aspect],taskId='custom-'+digest({operationId:op.id,sourceHash,scene:scene.id,aspect,...(probeSceneId?{probeSceneId}:{})}).slice(0,48);
      const task={schemaVersion:'3.0.0',kind:'render_task',mode:'studio',instance:'standard-3',taskId,generation:op.generation,deadlineAt,imageDigest:release.image_digest,
        job:{schemaVersion:'3.0.0',kind:'render_job',renderId:taskId,operationId:op.id,candidateId:taskId,sourceHash,runtimeVersion:context.runtimeVersion,rendererRelease:context.rendererRelease,
          aspectId:aspect,durationSeconds:film.durationSeconds,totalFrames:film.totalFrames,quality:'still',frames,
          renderProfile:{sampleCount:1,shutterAngle:0,sampling:'centered-box-v1',edgePolicy:'clamp-v1'},resources:resourceRefs.map((asset:Json)=>({resourceId:asset.resourceId,sha256:asset.sha256,kind:context.audioSources?.some((audio:Json)=>audio.resourceId===asset.resourceId)?'audio':asset.kind}))},
        options:{target:{aspect,width:layout.width,height:layout.height,safeInsets:layout.safeInsets,fps:30,totalFrames:film.totalFrames},seed:context.seed,fonts:context.fonts,
          resources:context.resources.map((asset:Json)=>({...asset,rightsCleared:true})),confirmedFactIds:context.confirmedFactIds,...renderPageTiming(film,policy.render),
          ...(assetFrames.length?{observeAssets:true}:{})},
        inputs:[{...source,name:'film'},...modules,...context.resources.map((asset:Json)=>({name:'resource:'+asset.resourceId,key:asset.key,sha256:asset.sha256,byteLength:asset.byteLength}))]};
      // Reproduce the real 2D review/final shard cuts, including the preceding warm
      // frame: cold seek of a reading hold alone missed a history-dependent shadow.
      // WebGL's adaptive partition needs its own bounded check; its final seam gate remains unchanged.
      const boundaries:number[]=[],reviewSequences=new Map<number,number[]>();
      if(checkShardSeams&&!filmUsesWebgl(film)){
        const {frames:_,...job}=task.job;
        if(checkReviewShardHistory&&film.durationSeconds===15){
          const shards=planShards({...job,quality:'review'},film,{seed:context.seed}).shards;
          for(const shard of shards.slice(0,-1)){
            const boundary=shard.end-1,sequence=[...(shard.start?[shard.start-1]:[])];
            for(let at=shard.start;at<shard.end;at+=2)sequence.push(at);
            sequence.push(boundary);
            // Probes with placeholder scenes cannot prove a mixed source's history.
            if(boundary>=scene.start&&boundary<scene.end&&film.scenes.filter((item:Json)=>item.start<=boundary&&boundary<item.end).length===1
              &&(!probeSceneId||sequence.every(at=>at>=scene.start&&at<scene.end&&eligible(at))))reviewSequences.set(boundary,[...new Set(sequence)]);
          }
        }
        for(const quality of ['review','final'])for(const shard of planShards({...job,quality},film,{seed:context.seed}).shards.slice(1)){
          const frame=shard.start-1;
          if(frame>=scene.start&&frame<scene.end&&film.scenes.filter((item:Json)=>item.start<=frame&&frame<item.end).length===1)boundaries.push(frame);
        }
        task.job.frames=[...new Set([...frames,...boundaries,...boundaries.map(frame=>frame-1).filter(frame=>frame>=scene.start&&eligible(frame))])].sort((a,b)=>a-b);
      }
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
        const lastAssets=observations.at(-1)?.assets??[],missing=expectation?.missingAssetKeys;
        const hiddenAssets=repairHiddenAssets&&code==='CUSTOM_REQUIRED_ASSET_NOT_VISIBLE'&&Array.isArray(missing)&&missing.length>0&&missing.every((key:string)=>{
          const matched=lastAssets.filter((asset:Json)=>asset.sceneId===scene.id&&asset.resourceId===film.assets[key].resourceId);
          return matched.length>0&&matched.every((asset:Json)=>asset.visibility==='hidden');
        });
        const unverifiedAssets=reportUnverifiedAssets&&code==='CUSTOM_REQUIRED_ASSET_NOT_VISIBLE'&&Array.isArray(missing)&&missing.length>0&&missing.every((key:string)=>{
          const matched=lastAssets.filter((asset:Json)=>asset.sceneId===scene.id&&asset.resourceId===film.assets[key].resourceId);
          return matched.length>0&&matched.every((asset:Json)=>asset.visibility==='unverified');
        });
        if(repairFailures&&(['CUSTOM_QA_BLOCK','CUSTOM_HOLD_TEXT_MISSING','CUSTOM_SEEK_MISMATCH'].includes(code)||hiddenAssets||unverifiedAssets))throw new CustomSceneCheckError(code,failure);
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
        for(const frame of task.job.frames){
          phase='forward';currentFrame=frame;
          await operation(env,op.id,op.generation);await rights(env,op,resourceRefs);
          let failureCode:string|undefined;
          if(reading.includes(frame)||assetFrames.includes(frame)){
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
            if(assetFrames.includes(frame)){
              if(!Array.isArray(checked.observation.assets))throw Error('RENDER_ASSET_OBSERVATION_UNAVAILABLE');
              const keys=[...new Set((p.assetChecks??[]).filter(check=>scene.start+check.frame===frame).flatMap(check=>check.assetKeys))];
              const missingAssets=keys.filter(key=>!checked.observation.assets.some((asset:Json)=>asset.sceneId===scene.id&&asset.resourceId===film.assets[key].resourceId&&asset.visibility==='visible'));
              expectation={...expectation,visibleAssetKeys:keys,missingAssetKeys:missingAssets};
              if(missingAssets.length&&!failureCode)failureCode='CUSTOM_REQUIRED_ASSET_NOT_VISIBLE';
            }
          }
          if(failureCode&&!repairFailures)throw Error(failureCode);
          const response=await owner.frame(op.id,frame);if(!response.ok)throw Error('CUSTOM_FRAME_CHECK_FAILED');
          const ref=await immutableBytes(env,`${prefix}/${scene.id}/${aspect}/${frame}.png`,new Uint8Array(await response.arrayBuffer()),'image/png');images.push({frame,...ref});
          if(failureCode)throw Error(failureCode);
          expectation=undefined;
        }
        for(const frame of [...task.job.frames].reverse()){
          phase='reverse';currentFrame=frame;
          await operation(env,op.id,op.generation);await rights(env,op,resourceRefs);
          await compareFrame(frame,'reverse',await owner.frame(op.id,frame));
        }
      }catch(error){failed=true;try{await recordFailure(error);}catch(recordError){if(recordError instanceof CustomSceneCheckError)repairable=recordError;throw recordError;}throw error;}
      finally{await closeStudio();}
      const coldFrame=reading.length?reading[Math.floor(reading.length/2)]!:frames[Math.floor(frames.length/2)]!;
      for(const frame of [...new Set([coldFrame,...boundaries])]){
        const sequence=reviewSequences.get(frame);
        const coldTask={...task,job:{...task.job,frames:sequence??task.job.frames},taskId:taskId+(frame===coldFrame?'-cold':'-cold-'+frame)};
        failed=false;repairable=undefined;let studioOpen=false;
        try{
          phase='cold';currentFrame=frame;
          if(checkShardSeams){await operation(env,op.id,op.generation);await rights(env,op,resourceRefs);}
          studioOpen=true;await owner.studio(op.id,canonical(coldTask));
          const coldResponse=await owner.frame(op.id,frame);
          if(!coldResponse.ok)throw Error('CUSTOM_FRAME_CHECK_FAILED');
          await compareFrame(frame,'cold',sequence?coldResponse.clone():coldResponse);
          if(sequence){
            const cold=new Uint8Array(await coldResponse.arrayBuffer());let warm:Uint8Array|undefined;
            await closeStudio();studioOpen=false;
            const warmTask={...coldTask,taskId:taskId+'-seq-'+frame};
            studioOpen=true;await owner.studio(op.id,canonical(warmTask));
            phase='shard-sequential';currentFrame=frame;
            for(const at of sequence){
              if(Date.now()>=deadlineAt)throw Error('OPERATION_DEADLINE');
              await operation(env,op.id,op.generation);await rights(env,op,resourceRefs);
              const response=await owner.frame(op.id,at);if(!response.ok)throw Error('CUSTOM_FRAME_CHECK_FAILED');
              const bytes=new Uint8Array(await response.arrayBuffer());if(at===frame)warm=bytes;
            }
            if(!warm)throw Error('CUSTOM_FRAME_CHECK_FAILED');
            const comparison=compareSeam(cold,warm);
            const actual=comparison.verdict==='RENDER_SEAM_BLOCK'?await immutableBytes(env,`${prefix}/${scene.id}/${aspect}/${frame}-shard-sequential.png`,warm,'image/png'):undefined;
            comparisons.push({frame,mode:'shard-sequential',...comparison,...(actual?{actual}:{})});
            if(actual){expectation={kind:'review_shard_history',start:sequence[0],end:frame,stride:2};throw Error('CUSTOM_SEEK_MISMATCH');}
          }
        }catch(error){failed=true;try{await recordFailure(error);}catch(recordError){if(recordError instanceof CustomSceneCheckError)repairable=recordError;throw recordError;}throw error;}
        finally{if(studioOpen)await closeStudio();}
      }
      evidence.push({sceneId:scene.id,aspect,images,observations,comparisons});
    }
  }
  const proof=await immutableJson(env,prefix+'/proof.json',{kind:probeSceneId?'custom_scene_probe':'custom_scene_preflight',sourceHash,modules,evidence,...(probeSceneId?{sceneId:probeSceneId,scope:'unshared_frames_only_placeholders_not_candidate'}:{})});
  return {sourceHash,modules,evidenceKey:proof.key};
}
