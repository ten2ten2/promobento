import {reviewFrameTimes,type SourceFile} from '../../../packages/methods/native-authoring.mjs';
import type {Json} from './pipeline-types.ts';
import type {SavedNativeProject} from './native-project.ts';

type Tool=(name:string,stage:string,tool:string,payload:Json,images?:Json[])=>Promise<Json>;
type Persist=(name:string,aspect:string,files:SourceFile[],base?:SavedNativeProject)=>Promise<SavedNativeProject>;
type Render=(name:string,saved:SavedNativeProject,mode:'preview'|'export',frames?:number[])=>Promise<Json>;
type Observe=(movie:Json)=>Promise<{frames:Json[];images:Json[];times:number[]}>;
type Patch=(name:string,aspect:string,saved:SavedNativeProject,payload:Json)=>Promise<{saved:SavedNativeProject;frames:number[]}>;

/** A target is a separate native revision. The first finished target is the source for later recompositions. */
export async function authorAspectStage(input:{
 aspect:string;shape:Json;context:Json;patchMode:boolean;primary:SavedNativeProject|undefined;
 brief:Json;direction:Json|null;treatment:Json|null;materials:Json[];insights:Json[];builtins:string[];
 progress:(stage:string)=>Promise<unknown>;loadBase:(revisionId:string)=>Promise<SavedNativeProject>;
 runTool:Tool;sourceFiles:(saved:SavedNativeProject)=>Promise<SourceFile[]>;persist:Persist;render:Render;observe:Observe;patch:Patch;
}):Promise<{saved:SavedNativeProject;frames:number[]}>{
 const {aspect,shape,context,patchMode,primary,brief,direction,treatment,materials,insights,builtins,progress,loadBase,runTool,sourceFiles,persist,render,observe,patch}=input;
 await progress('author-'+aspect);
 if(patchMode){
  const baseRevision=context.baseRevisions?.[aspect]??(context.aspects.length===1?context.baseRevision:undefined);
  if(!baseRevision)throw Error('DIRECTOR_PATCH_BASE_REQUIRED');
  const base=await loadBase(baseRevision);
  if(base.project.composition.width!==shape.width||base.project.composition.height!==shape.height||base.project.composition.durationSeconds!==context.durationSeconds)throw Error('NATIVE_PATCH_TARGET_INVALID');
  return patch('patch-'+aspect,aspect,base,{task:'Apply the user’s frame/element comments to the existing native project. Preserve unrelated source, stable IDs and the current creative direction. Read the Brief and source before editing.',brief,comments:context.comments});
 }
 if(primary){
  const authored=await runTool('recompose-'+aspect,'author','write_project',{task:'Recompose this completed native film for this separate platform aspect. Preserve its story, source content, duration and sound. Rebuild geometry and reading hierarchy for the supplied dimensions and safe insets; do not stretch or merely crop the other aspect.',brief,direction,treatment,sourceFiles:await sourceFiles(primary),materials,insights,builtins,composition:{durationSeconds:context.durationSeconds,fps:30,width:shape.width,height:shape.height},safeInsets:shape.safeInsets});
  return {saved:await persist('recompose-'+aspect,aspect,authored.files),frames:authored.reviewFrames};
 }
 const hardest=await runTool('hardest-'+aspect,'author','write_project',{task:'Build the hardest shot in native source first. Implement its actual geometry, assets and end state at its intended film time; keep the exact complete composition duration. Return reviewFrames containing that shot’s landing. This preview must establish the hard visual mechanism before the rest is built.',brief,direction,treatment,
  materials,insights,builtins,composition:{durationSeconds:context.durationSeconds,fps:30,width:shape.width,height:shape.height},safeInsets:shape.safeInsets});
 const saved=await persist('hardest-'+aspect,aspect,hardest.files);
 const hardMovie=await render('hardest-'+aspect,saved,'preview',reviewFrameTimes(hardest.reviewFrames,context.durationSeconds));
 const hardEvidence=await observe(hardMovie);
 const hardReview=await runTool('hardest-review-'+aspect,'review','submit_review',{task:'Review only the implemented hardest shot and its actual landing. Other unfinished passages are intentionally not yet authored. Identify concrete defects in the hard shot before the author completes the film.',brief,direction,treatment,frames:hardEvidence.frames,times:hardEvidence.times},hardEvidence.images);
 return patch('complete-'+aspect,aspect,saved,{task:'Complete the entire native film around the hardest shot. Address its concrete review findings and implement every passage of the Treatment, sound and readable ending. Preserve the actual assets and exact duration. Do not submit an unfinished hard-shot study.',brief,direction,treatment,hardestReview:hardReview});
}

/** Review is evidence-bound; a repair changes only this target's immutable revision. */
export async function reviewAspectStage(input:{
 aspect:string;saved:SavedNativeProject;frames:number[];repairs:number;repairLimit:number;durationSeconds:number;
 brief:Json;direction:Json|null;treatment:Json|null;comments:Json[];
 progress:(stage:string)=>Promise<unknown>;render:Render;observe:Observe;runTool:Tool;patch:Patch;
}):Promise<{kind:'passed';saved:SavedNativeProject;review:Json;repairs:number}|{kind:'repair_limit';saved:SavedNativeProject;movie:Json;review:Json;repairs:number}>{
 const {aspect,durationSeconds,repairLimit,brief,direction,treatment,comments,progress,render,observe,runTool,patch}=input;
 let {saved,frames,repairs}=input;
 for(let round=0;;round++){
  await progress('review-'+aspect);
  const movie=await render('review-'+aspect+'-'+round,saved,'preview',reviewFrameTimes(frames,durationSeconds));
  const evidence=await observe(movie);
  const review=await runTool('review-'+aspect+'-'+round,'review','submit_review',{task:'Review this actual native preview against the complete Brief and Treatment. Judge only supplied frame evidence. Return revise for concrete defects; a pass means sampled-frame review, not whole-motion or listening approval.',brief,direction,treatment,comments,frames:evidence.frames,times:evidence.times,revisionId:saved.revisionId},evidence.images);
  if((review.verdict==='pass')!==(review.issues.length===0))throw Error('DIRECTOR_REVIEW_INVALID');
  if(review.verdict==='pass')return {kind:'passed',saved,review:{...review,evidenceRenderId:movie.renderId,scope:'sampled_frames'},repairs};
  if(repairs>=repairLimit)return {kind:'repair_limit',saved,movie,review,repairs};
  repairs++;
  ({saved,frames}=await patch('repair-'+aspect+'-'+round,aspect,saved,{task:'Fix these concrete observed defects with scoped native source edits. Preserve the Brief, approved direction and unaffected source. The next preview will check the changed revision.',brief,direction,treatment,review,evidence:{frames:evidence.frames,times:evidence.times}}));
 }
}
