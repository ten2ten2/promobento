import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {canonical,digest,targets as legalTargets} from '../../../packages/contracts/index.mjs';
import {readAdmissionSource} from '../../renderer/src/admission-source.mjs';
import {renderAdmission} from '../../renderer/src/admission-run.mjs';
import {assertProject,assertConfig,assertSchema,assertPlan,production,validateProduction,presets} from './schema.mjs';
import {withStore,checkedId} from './store.mjs';
import {createCostLedger,latestCosts} from './costs.mjs';
import {createOpenAIProvider} from './openai.mjs';
import {runModelCall,modelIdentity} from './model-call.mjs';
import {assertAudioPlanResources,assertAudioPlanFrozen,bindGeneratedAudioPlan} from './audio-binding.mjs';
import {publicErrorCode,privateErrorDiagnostic} from './errors.mjs';
import {compositionMethod,DIRECTOR_INSTRUCTIONS,METHOD_VERSION} from './prompts.mjs';
import {collectEditEvidence} from './edit-evidence.mjs';
import {recallProjectExperience} from './experience.mjs';
import {methodTopics} from './method-library.mjs';
const captureSavedFrame=async args=>(await import('../../renderer/src/edit-evidence.mjs')).captureEditEvidence(args);

const uid=prefix=>prefix+'-'+randomUUID();
const operationPath=id=>'operations/'+checkedId(id)+'/run.json';
const projectPath=id=>'projects/'+checkedId(id)+'.json';
const safeTarget=target=>target.replaceAll(':','_');
const now=()=>new Date().toISOString();
const baseState=()=>({revisionId:null,candidateOperationId:null});
function usage(ledger,operation) {
  const latest=latestCosts(ledger.events());
  const quantity=metric=>latest.reduce((sum,event)=>sum+event.usage.filter(item=>item.metric===metric).reduce((sum,item)=>sum+(item.quantity??0),0),0);
  return {inputTokens:quantity('input_tokens'),outputTokens:quantity('output_tokens'),cachedInputTokens:quantity('cached_input_tokens'),
    costMicros:ledger.total(),activeSeconds:Math.ceil((operation.activeMs??0)/1000),internalRepairs:operation.internalRepairs};
}
function projectRecord(store,id) {const record=store.read(projectPath(id));assertProject(record.input);return record;}
function requireBase(record,operation) {if(record.current.revisionId!==operation.baseRevisionId)throw Error('LOCAL_AGENT_BASE_CONFLICT');}
export function reviewSubject(operation) {return digest({projectInputHash:operation.projectInputHash,plans:operation.plans,candidates:operation.candidates,
  kind:operation.kind,baseRevisionId:operation.baseRevisionId,researchResponseHash:operation.researchResponseHash??null,researchArtifact:operation.researchArtifact??null});}
function saveOperation(store,operation) {
  operation.updatedAt=now();store.write(operationPath(operation.id),operation);
  const selected=operation.plans.find(plan=>plan.candidateId===operation.selectedCandidateId)??operation.plans[0];
  const result={schemaVersion:'2.7.0',kind:'run_result',runId:operation.id,operationId:operation.id,baseRevision:operation.baseRevisionId,
    state:operation.state,phase:operation.phase,generation:operation.generation,candidateRevisionId:operation.selectedCandidateId,
    usage:operation.usage??{inputTokens:0,outputTokens:0,cachedInputTokens:0,costMicros:0,activeSeconds:0,internalRepairs:operation.internalRepairs},
    outputStatus:operation.outputStatus,...(operation.outputStatus==='allowed'&&selected?{
      directions:operation.plans.map(plan=>plan.direction),treatment:selected.treatment,audioPlan:selected.audioPlan}:{})};
  if(validateProduction(result,production.$defs.runResult).length)throw Error('LOCAL_AGENT_RUN_RESULT_INVALID');
  store.write('operations/'+operation.id+'/run-result.json',result);
}
function newOperation(store,record,kind,operationId) {
  const id=checkedId(operationId??uid('operation'));
  if(store.exists(operationPath(id)))throw Error('LOCAL_AGENT_OPERATION_EXISTS');
  store.mkdir('operations/'+id);
  const operation={id,kind,projectId:record.input.id,caseId:record.input.caseId??null,projectInputHash:record.inputHash,
    baseRevisionId:record.current.revisionId,createdAt:now(),updatedAt:now(),attempt:0,internalRepairs:0,state:'queued',phase:'queued',
    generation:1,outputStatus:'none',review:null,plans:[],candidates:[],selectedCandidateId:null,productionEligible:false};
  saveOperation(store,operation);return operation;
}
function assertRights(source,project) {
  if(!source.resources||!Array.isArray(source.resources.resourceIds)||!Array.isArray(source.resources.audioEvents))throw Error('LOCAL_AGENT_RESOURCES_INVALID');
  const permitted=new Set([...project.rights.map(right=>right.resourceId),...(source.resources.generatedAudio??[]).map(item=>item.id)]);
  if(source.resources.resourceIds.some(id=>!permitted.has(id)))throw Error('LOCAL_AGENT_RESOURCE_RIGHTS_REQUIRED');
  if(project.audioMode==='silent'&&(source.resources.audioEvents.length||source.resources.generatedAudio?.length))throw Error('LOCAL_AGENT_SILENT_PROJECT');
}
function writeSource(store,source,project,candidateId,targetId) {
  assertSchema(source,'source');assertRights(source,project);
  const path='sources/'+checkedId(candidateId)+'/'+safeTarget(targetId);store.mkdir(path);
  const directory=join(store.root,path);
  const files={'candidate.json':canonical({schemaVersion:'2.7.0',kind:'admission_candidate',capabilityProfile:'canvas-media-v1',
    targetId,durationSeconds:project.durationSeconds,seed:project.seed}),'composition.mjs':source.code,
  'declarations.json':canonical(source.declarations),'values.json':canonical({kind:'source_values',values:source.values}),'resources.json':canonical(source.resources)};
  for(const [name,contents] of Object.entries(files))writeFileSync(join(directory,name),contents,{flag:'wx',mode:0o600});
  const checked=readAdmissionSource(directory); // Static parsing only; source never imports on host.
  return {path,sourceHash:checked.sourceHash,sourceArchiveHash:checked.sourceArchiveHash};
}
async function renderSource({store,source,audioPlan,project,candidateId,targetId,ledger,signal,render,audioRights=null}) {
  signal?.throwIfAborted();
  const written=writeSource(store,source,project,candidateId,targetId);
  const output='renders/'+candidateId+'/'+safeTarget(targetId);mkdirSync(join(store.root,'renders',candidateId),{recursive:true,mode:0o700});
  const reservation=ledger.reserve({usdMicros:600*ledger.renderRate,provider:'local-docker',targetId,purpose:'target_preparation'});
  const started=performance.now();let result;
  try {result=await render({sourceDirectory:join(store.root,written.path),outputDirectory:join(store.root,output),signal,audioRights});}
  finally {
    const elapsed=Math.ceil(performance.now()-started);
    ledger.settle(reservation,{usdMicros:Math.ceil(elapsed*ledger.renderRate/1000),usage:[{metric:'wall_ms',unit:'millisecond',quantity:elapsed}],
      rendererImageDigest:result?.report?.image?.imageId??null,reason:'Measured local Docker wall time at the explicitly configured local rate.'});
  }
  signal?.throwIfAborted();
  if(Math.ceil((performance.now()-started)*ledger.renderRate/1000)>reservation.usdMicros)throw Error('LOCAL_AGENT_RENDER_EXCEEDED_RESERVATION');
  if(result.report?.status!=='passed')throw Error('LOCAL_AGENT_RENDER_FAILED');
  assertAudioPlanFrozen(audioPlan,result.report.capture?.media?.resourceManifest?.audioEvents);
  const actual=result.report.capture?.keyframes;
  if(!Array.isArray(actual)||!actual.length)throw Error('LOCAL_AGENT_RENDER_KEYFRAMES_REQUIRED');
  const keyframes=actual.map(frame=>({id:candidateId+'-'+safeTarget(targetId)+'-frame-'+frame.frameIndex,
    ...frame,path:output+'/'+frame.file}));
  return {...written,output,report:output+'/report.json',media:output+'/sample.mp4',poster:output+'/poster.png',keyframes,qaInputHash:result.report.qaInputHash,...(result.report.capture?.video?.sha256?{mediaSha256:result.report.capture.video.sha256}:{})};
}
function operationLedger(store,config,project,operation) {
  const ledger=createCostLedger(store,config,project,operation.id,operation.id+'-attempt-'+operation.attempt);
  ledger.renderRate=config.prices.renderMicrosPerSecond;return ledger;
}
function recordReturnedModel(operation,returnedModel) {
  if(returnedModel) {operation.returnedModels??=[];operation.returnedModels.push({attempt:operation.attempt,...returnedModel});}
}
function publicStatus(operation) {
  return {operationId:operation.id,projectId:operation.projectId,kind:operation.kind,state:operation.state,phase:operation.phase,
    outputStatus:operation.outputStatus,subjectHash:operation.plans.length||operation.researchArtifact?reviewSubject(operation):null,usage:operation.usage??null,
    selectedCandidateId:operation.selectedCandidateId,productionEligible:false,
    ...(operation.outputStatus==='allowed'?{plans:operation.plans,candidates:operation.candidates}:{}),error:operation.error?publicErrorCode(operation.error):null};
}
export async function initializeProject({directory,project}) {
  assertProject(project);return withStore(directory,store=>{
    store.mkdir('projects');const path=projectPath(project.id);
    if(store.exists(path)){const prior=store.read(path);if(prior.inputHash!==digest(project))throw Error('LOCAL_AGENT_PROJECT_EXISTS');return prior;}
    const record={input:project,inputHash:digest(project),current:baseState(),createdAt:now()};store.write(path,record);return record;
  });
}
export async function createWork({directory,projectId,config,kind='creative_generate',operationId,comments=[],provider,signal,
  render=renderAdmission,method=compositionMethod,capture=captureSavedFrame,audioRights=null,expectedRevisionId}) {
  assertConfig(config);
  if(!['creative_generate','agent_patch'].includes(kind))throw Error('LOCAL_AGENT_OPERATION_INVALID');
  return withStore(directory,async store=>{
    const record=projectRecord(store,projectId),project=record.input;
    if(operationId&&store.exists(operationPath(operationId))) {
      const previous=store.read(operationPath(operationId));
      if(previous.projectInputHash!==record.inputHash||previous.kind!==kind||canonical(previous.comments??[])!==canonical(comments)||digest(previous.audioRights??null)!==digest(audioRights)||(expectedRevisionId!==undefined&&previous.baseRevisionId!==expectedRevisionId))throw Error('LOCAL_AGENT_OPERATION_REPLAY_MISMATCH');
      return publicStatus(previous);
    }
    let base=null,renderTargetIds=[project.targetIds[0]];
    if(kind==='agent_patch') {
      if(!record.current.revisionId)throw Error('LOCAL_AGENT_REVISION_REQUIRED');
      if(expectedRevisionId!==undefined&&expectedRevisionId!==record.current.revisionId)throw Error('LOCAL_AGENT_BASE_CONFLICT');
      const accepted=store.read(operationPath(record.current.candidateOperationId));
      const candidate=accepted.candidates.find(candidate=>candidate.id===record.current.revisionId);
      if(!candidate)throw Error('LOCAL_AGENT_REVISION_MISSING');
      const preparedTargetIds=Object.keys(candidate.targets);
      if(!Array.isArray(comments)||comments.length<1||comments.length>5||comments.reduce((sum,comment)=>sum+[...(comment.comment??'')].length,0)>4000||
        comments.some(comment=>validateProduction(comment,production.$defs.editComment).length||!preparedTargetIds.includes(comment.targetId)||comment.frameIndex>=project.durationSeconds*30))
        throw Error('LOCAL_AGENT_PATCH_COMMENTS_INVALID');
      renderTargetIds=comments.some(comment=>comment.editScope==='all-variants')?preparedTargetIds:[...new Set(comments.map(comment=>comment.targetId))];
      base={candidate,plan:accepted.plans.find(plan=>plan.candidateId===candidate.id)};
      if(!base.plan)throw Error('LOCAL_AGENT_REVISION_MISSING');
    }
    const operation=newOperation(store,record,kind,operationId);operation.comments=comments;operation.audioRights=audioRights;
    operation.renderTargetIds=renderTargetIds;
    operation.model=modelIdentity(config,provider?.id??config.provider);saveOperation(store,operation);
    const started=performance.now();let ledger;
    try {
      const api=provider??createOpenAIProvider(config);
      const methods=await method({...project,targetIds:kind==='agent_patch'?renderTargetIds:project.targetIds,stage:kind==='agent_patch'?'patch':'create'});
      const experience=recallProjectExperience(store,project,methodTopics(project.audience,project.task,...comments.map(comment=>comment.comment)));
      operation.methodIdentity=methods.methods?.identity??{version:METHOD_VERSION};
      operation.methodSelection={stage:methods.methods?.stage??null,ids:methods.methods?.selected?.map(card=>card.id)??[]};
      operation.experienceIdentity={generation:experience.generation,contentHash:experience.contentHash};
      let edit={evidence:[],images:[]};
      if(base) {
        operation.state='active';operation.phase='capturing_edit_evidence';saveOperation(store,operation);
        ledger=operationLedger(store,config,project,operation);
        const reservation=ledger.reserve({usdMicros:600*ledger.renderRate,provider:'local-docker',purpose:'quality'}),captureStarted=performance.now();
        const captureSignal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(600000)]);
        try{edit=await collectEditEvidence({store,project,base,comments,operationId:operation.id,capture,signal:captureSignal});}
        finally{const elapsed=Math.ceil(performance.now()-captureStarted);ledger.settle(reservation,{usdMicros:Math.ceil(elapsed*ledger.renderRate/1000),usage:[{metric:'wall_ms',unit:'millisecond',quantity:elapsed}],reason:'Measured isolated edit evidence extraction from the accepted MP4.'});}
        if(Math.ceil((performance.now()-captureStarted)*ledger.renderRate/1000)>reservation.usdMicros)throw Error('LOCAL_AGENT_RENDER_EXCEEDED_RESERVATION');
      }
      operation.editEvidence=edit.evidence;
      const input={methodVersion:METHOD_VERSION,project,mode:kind==='agent_patch'?'patch':project.direct?'direct':'explore',method:methods,experience,base,comments,renderTargetIds,editEvidence:edit.evidence};
      let repair=null;
      for(let attempt=1;attempt<=3;attempt++) {
        const attemptSignal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(600000)]);
        operation.attempt=attempt;operation.state='active';operation.phase=repair?'repair':'directing';
        ledger=operationLedger(store,config,project,operation);saveOperation(store,operation);
        const generated=await runModelCall({config,ledger,provider:api,instructions:DIRECTOR_INSTRUCTIONS,input:{...input,repair},images:edit.images,signal:attemptSignal});
        operation.model=generated.model;recordReturnedModel(operation,generated.returnedModel);operation.phase='validating';operation.state='validating';saveOperation(store,operation);
        const expected=kind==='agent_patch'||project.direct?1:3;
        const value=generated.value;
        try {
          if(!value||Object.keys(value).join(',')!=='plans'||!Array.isArray(value.plans)||value.plans.length!==expected)throw Error('LOCAL_AGENT_PLANS_INVALID');
          const plans=[],candidates=[];
          for(const plan of value.plans) {
            plan.audioPlan=bindGeneratedAudioPlan(plan.audioPlan,plan.source?.resources,{totalFrames:project.durationSeconds*30,audioRights});
            assertPlan(plan,project.durationSeconds*30);
            assertAudioPlanResources(plan.audioPlan,plan.source.resources,{audioRights});
            const candidateId=uid('candidate'),renderedTargets={};
            for(const targetId of renderTargetIds)
              renderedTargets[targetId]=await renderSource({store,source:plan.source,audioPlan:plan.audioPlan,project,candidateId,targetId,ledger,signal:attemptSignal,render,audioRights});
            const direction={...plan.direction,keyframeIds:Object.values(renderedTargets).flatMap(target=>target.keyframes.map(frame=>frame.id))};
            plans.push({...plan,direction,candidateId});
            candidates.push({id:candidateId,operationId:operation.id,baseRevisionId:operation.baseRevisionId,model:generated.model,
              targets:renderedTargets,
              ...(base?{invalidatedTargetIds:Object.keys(base.candidate.targets).filter(targetId=>!renderTargetIds.includes(targetId)),
                invalidationReason:'shared_source_changed_requires_target_preparation'}:{}),productionEligible:false});
          }
          operation.plans=plans;operation.candidates=candidates;operation.state='awaiting_user';operation.phase='output_review';operation.outputStatus='withheld';
          if(expected===1)operation.selectedCandidateId=candidates[0].id;
          break;
        } catch(error) {
          if(attemptSignal.aborted||attempt===3||/BUDGET|CANCEL|AUTHORIZATION|CLEANUP|IMAGE|DAEMON|HOST|AUDIO_RIGHTS/.test(error.message))throw error;
          operation.internalRepairs++;repair={error:String(error.message).slice(0,2048),previousResponse:value};
          operation.lastRepairError=repair.error;saveOperation(store,operation);
        }
      }
    } catch(error) {
      recordReturnedModel(operation,error.returnedModel);
      operation.state=signal?.aborted?'cancelled':/BUDGET/.test(error.message)?'paused_budget':'failed';
      operation.phase='stopped';operation.error=publicErrorCode(error);operation.outputStatus='withheld';
      store.write('operations/'+operation.id+'/private-error.json',privateErrorDiagnostic(error));throw error;
    } finally {
      operation.activeMs=Math.round(performance.now()-started);if(ledger)operation.usage=usage(ledger,operation);saveOperation(store,operation);
    }
    return publicStatus(operation);
  });
}
export async function recordReview({directory,operationId,receipt}) {
  assertSchema(receipt,'review');return withStore(directory,store=>{
    const operation=store.read(operationPath(operationId));
    if(operation.state!=='awaiting_user'||operation.phase!=='output_review')throw Error('LOCAL_AGENT_REVIEW_STATE');
    if(receipt.subjectHash!==reviewSubject(operation)||Date.parse(receipt.reviewedAt)>Date.now()||Date.parse(receipt.reviewedAt)<Date.parse(operation.createdAt))throw Error('LOCAL_AGENT_REVIEW_IDENTITY');
    if(receipt.reviewerId===operation.model?.id)throw Error('LOCAL_AGENT_MODEL_CANNOT_REVIEW');
    operation.review=receipt;operation.outputStatus=receipt.decision;
    operation.phase=receipt.decision==='allowed'?'selection':'withheld';
    if(receipt.decision==='withheld')operation.state='failed';
    else if(operation.kind==='research_baseline'){operation.state='succeeded';operation.phase='reviewed';}
    saveOperation(store,operation);return publicStatus(operation);
  });
}
export async function selectCandidate({directory,operationId,candidateId}) {
  return withStore(directory,store=>{
    const operation=store.read(operationPath(operationId));
    if(operation.outputStatus!=='allowed'||!operation.candidates.some(candidate=>candidate.id===candidateId))throw Error('LOCAL_AGENT_SELECTION_NOT_ALLOWED');
    requireBase(projectRecord(store,operation.projectId),operation);
    operation.selectedCandidateId=candidateId;operation.phase='version_confirmation';saveOperation(store,operation);return publicStatus(operation);
  });
}
export async function acceptCandidate({directory,operationId,expectedRevisionId}) {
  return withStore(directory,store=>{
    const operation=store.read(operationPath(operationId)),record=projectRecord(store,operation.projectId);
    if(operation.state==='succeeded'&&record.current.candidateOperationId===operationId&&record.current.revisionId===operation.selectedCandidateId)return publicStatus(operation);
    if(operation.outputStatus!=='allowed'||!operation.selectedCandidateId||operation.review?.subjectHash!==reviewSubject(operation))throw Error('LOCAL_AGENT_ACCEPT_REVIEW_REQUIRED');
    if(expectedRevisionId!==record.current.revisionId)throw Error('LOCAL_AGENT_BASE_CONFLICT');requireBase(record,operation);
    record.current={revisionId:operation.selectedCandidateId,candidateOperationId:operation.id};store.write(projectPath(operation.projectId),record);
    operation.state='succeeded';operation.phase='accepted';saveOperation(store,operation);return publicStatus(operation);
  });
}
export async function prepareTargets({directory,projectId,config,operationId,signal,render=renderAdmission}) {
  assertConfig(config);return withStore(directory,async store=>{
    const record=projectRecord(store,projectId),project=record.input;
    if(operationId&&store.exists(operationPath(operationId))) {
      const previous=store.read(operationPath(operationId));
      if(previous.projectInputHash!==record.inputHash||previous.kind!=='prepare_targets')throw Error('LOCAL_AGENT_OPERATION_REPLAY_MISMATCH');
      return publicStatus(previous);
    }
    if(!record.current.revisionId)throw Error('LOCAL_AGENT_REVISION_REQUIRED');
    const accepted=store.read(operationPath(record.current.candidateOperationId));
    const sourcePlan=accepted.plans.find(plan=>plan.candidateId===record.current.revisionId);
    if(!sourcePlan)throw Error('LOCAL_AGENT_REVISION_MISSING');
    const operation=newOperation(store,record,'prepare_targets',operationId),candidateId=uid('candidate');
    operation.attempt=1;operation.model=accepted.model;operation.audioRights=accepted.audioRights??null;
    operation.targetRulesVersion=presets.rulesVersion;operation.preparedTargetIds=legalTargets(presets).map(target=>target.targetId);
    const ledger=operationLedger(store,config,project,operation),started=performance.now();
    try {
      operation.state='validating';operation.phase='prepare_targets';saveOperation(store,operation);
      const targets={};
      const existing=accepted.candidates.find(candidate=>candidate.id===record.current.revisionId);
      for(const targetId of operation.preparedTargetIds) {
        signal?.throwIfAborted();
        targets[targetId]=existing.targets[targetId]??await renderSource({store,source:sourcePlan.source,audioPlan:sourcePlan.audioPlan,project,candidateId,targetId,ledger,signal,render,audioRights:operation.audioRights});
      }
      operation.plans=[{...sourcePlan,candidateId}];operation.candidates=[{id:candidateId,operationId:operation.id,baseRevisionId:record.current.revisionId,
        model:accepted.model,targets,productionEligible:false}];operation.selectedCandidateId=candidateId;
      operation.state='awaiting_user';operation.phase='output_review';operation.outputStatus='withheld';
    } catch(error) {operation.state=signal?.aborted?'cancelled':/BUDGET/.test(error.message)?'paused_budget':'failed';operation.error=publicErrorCode(error);store.write('operations/'+operation.id+'/private-error.json',privateErrorDiagnostic(error));throw error;}
    finally {operation.activeMs=Math.round(performance.now()-started);operation.usage=usage(ledger,operation);saveOperation(store,operation);}
    return publicStatus(operation);
  });
}
export async function getOperation({directory,operationId}) {return withStore(directory,store=>publicStatus(store.read(operationPath(operationId))));}
const researchValidationErrors=new Set(['M0A_BASELINE_RESPONSE_INVALID','M0A_BASELINE_SILENT_PROJECT']);
const researchRenderErrors=new Set(['BASELINE_OUTPUT_COUNT','BASELINE_OUTPUT_SPEC','BASELINE_NONDETERMINISTIC',
  'BASELINE_COLD_NONDETERMINISTIC','BASELINE_PAGE_ERRORS','BASELINE_AUDIO_MUST_USE_FROZEN_TRACK']);
function researchErrorCode(error) {
  const value=typeof error?.code==='string'?error.code:error?.message;
  if(typeof value!=='string')return null;
  const code=value.split(':',1)[0];return researchValidationErrors.has(code)||researchRenderErrors.has(code)?code:null;
}
/** Closed list: unknown execution, permissions, rights, billing and cleanup failures never auto-repair. */
export function isResearchRepairableError(error) {return researchErrorCode(error)!==null;}
const researchAttemptPath=operation=>'operations/'+operation.id+'/attempts/'+operation.attempt;
function researchIdentity(record,config,provider,instructions,input) {
  return {projectInputHash:record.inputHash,configHash:digest(config),requestedModel:modelIdentity(config,provider?.id??config.provider),
    requestHash:digest({instructions,input:{...input,project:record.input}})};
}
function assertResearchIdentity(operation,record,config) {
  if(operation.kind!=='research_baseline'||operation.projectId!==record.input.id||operation.projectInputHash!==record.inputHash||
    operation.researchIdentity?.configHash!==digest(config))throw Error('LOCAL_AGENT_BASELINE_IDENTITY_MISMATCH');
}
function saveResearchOperation(store,operation) {
  store.mkdir(researchAttemptPath(operation));
  store.write(researchAttemptPath(operation)+'/attempt.json',{
    operationId:operation.id,attempt:operation.attempt,internalRepairs:operation.internalRepairs,state:operation.state,phase:operation.phase,
    model:operation.model,returnedModel:operation.returnedModels?.find(item=>item.attempt===operation.attempt)??null,identity:operation.researchIdentity,responseHash:operation.researchResponseHash??null,
    artifact:operation.researchArtifact??null,failure:operation.researchFailure??null,usage:operation.usage??null});
  saveOperation(store,operation);
}
function recordResearchFailure(store,operation,error,stage,signal) {
  const diagnostic=privateErrorDiagnostic(error);
  operation.state=signal?.aborted?'cancelled':/BUDGET/.test(publicErrorCode(error))?'paused_budget':'failed';
  operation.phase='stopped';operation.outputStatus='withheld';operation.error=publicErrorCode(error);
  operation.researchFailure={stage,code:researchErrorCode(error),diagnosticHash:digest(diagnostic)};
  store.write(researchAttemptPath(operation)+'/'+stage+'-error.json',diagnostic);
}
async function authorResearchAttempt({store,record,operation,config,instructions,input,provider,signal,repair=null}) {
  const ledger=operationLedger(store,config,record.input,operation),started=performance.now();
  operation.state='active';operation.phase=repair?'repair':'directing';saveResearchOperation(store,operation);
  try {
    const result=await runModelCall({config,ledger,provider:provider??createOpenAIProvider(config),instructions,
      input:{...input,project:record.input,...(repair?{repair}:{})},signal});
    // Save every parseable paid response even if the provider unexpectedly changes the actual model.
    store.write(researchAttemptPath(operation)+'/response.json',result.value);
    recordReturnedModel(operation,result.returnedModel);
    if(operation.researchActualModel&&canonical(operation.researchActualModel)!==canonical(result.returnedModel))
      throw Error('LOCAL_AGENT_BASELINE_MODEL_MISMATCH');
    operation.researchActualModel=result.returnedModel;operation.model=result.model;
    operation.state='active';operation.phase='awaiting_render';operation.outputStatus='withheld';operation.researchResponseHash=digest(result.value);
    store.write('operations/'+operation.id+'/response.json',result.value);
    return {operationId:operation.id,projectInputHash:operation.projectInputHash,caseId:record.input.caseId??null,attempt:operation.attempt,
      model:result.model,returnedModel:result.returnedModel,value:result.value,costEvents:ledger.events(),productionEligible:false};
  } catch(error){recordReturnedModel(operation,error.returnedModel);recordResearchFailure(store,operation,error,'model',signal);throw error;}
  finally {operation.activeMs=(operation.activeMs??0)+Math.ceil(performance.now()-started);operation.usage=usage(ledger,operation);saveResearchOperation(store,operation);}
}
/** Baseline authors use the exact same model/cost boundary; returned data is never executed here. */
export async function generateResearchArtifact({directory,projectId,config,operationId,instructions,input,provider,signal}) {
  assertConfig(config);return withStore(directory,async store=>{
    const record=projectRecord(store,projectId),identity=researchIdentity(record,config,provider,instructions,input);
    const operation=newOperation(store,record,'research_baseline',operationId);
    operation.attempt=1;operation.model=identity.requestedModel;operation.researchIdentity=identity;
    return authorResearchAttempt({store,record,operation,config,instructions,input,provider,signal});
  });
}
/** A content repair is another attempt in the SAME operation, never a new budget or free retry. */
export async function repairResearchArtifact({directory,projectId,config,operationId,instructions,input,previousValue,error,provider,signal}) {
  assertConfig(config);return withStore(directory,async store=>{
    const record=projectRecord(store,projectId),operation=store.read(operationPath(operationId));
    assertResearchIdentity(operation,record,config);
    if(canonical(operation.researchIdentity)!==canonical(researchIdentity(record,config,provider,instructions,input)))
      throw Error('LOCAL_AGENT_BASELINE_IDENTITY_MISMATCH');
    if(operation.attempt>=3||operation.internalRepairs>=2)throw Error('LOCAL_AGENT_BASELINE_REPAIR_LIMIT');
    const code=researchErrorCode(error),validation=operation.state==='active'&&operation.phase==='awaiting_render'&&researchValidationErrors.has(code);
    const rendered=operation.state==='failed'&&operation.researchFailure?.stage==='render'&&researchRenderErrors.has(code);
    if(operation.review||operation.researchArtifact||(!validation&&!rendered))throw Error('LOCAL_AGENT_BASELINE_REPAIR_NOT_ALLOWED');
    const ledger=operationLedger(store,config,record.input,operation);
    if(latestCosts(ledger.events()).some(event=>event.status==='estimated'))throw Error('LOCAL_AGENT_USAGE_UNKNOWN');
    if(digest(previousValue)!==operation.researchResponseHash||digest(store.read('operations/'+operation.id+'/response.json'))!==operation.researchResponseHash)
      throw Error('LOCAL_AGENT_BASELINE_PREVIOUS_RESPONSE_MISMATCH');
    if(rendered&&(operation.researchFailure.code!==code||operation.researchFailure.diagnosticHash!==digest(privateErrorDiagnostic(error))))
      throw Error('LOCAL_AGENT_BASELINE_ERROR_MISMATCH');
    signal?.throwIfAborted();
    const diagnostic=privateErrorDiagnostic(error);
    store.write(researchAttemptPath(operation)+'/repair-trigger.json',diagnostic);
    operation.attempt++;operation.internalRepairs++;operation.researchArtifact=null;operation.review=null;operation.error=null;
    operation.researchFailure=null;operation.researchResponseHash=null;operation.outputStatus='withheld';
    return authorResearchAttempt({store,record,operation,config,instructions,input,provider,signal,
      repair:{error:diagnostic,previousValue}});
  });
}
/** Trusted baseline orchestration passes a renderer callback; model responses never select callbacks. */
export async function runResearchRender({directory,projectId,config,operationId,render,signal}) {
  assertConfig(config);return withStore(directory,async store=>{
    const record=projectRecord(store,projectId),operation=store.read(operationPath(operationId));assertResearchIdentity(operation,record,config);
    if(operation.state!=='active'||operation.phase!=='awaiting_render')throw Error('LOCAL_AGENT_BASELINE_STATE');
    const ledger=operationLedger(store,config,record.input,operation),started=performance.now();let result,reservation;
    const renderSignal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(600000)]);
    operation.state='validating';operation.phase='rendering';saveResearchOperation(store,operation);
    try {
      renderSignal.throwIfAborted();
      reservation=ledger.reserve({usdMicros:600*ledger.renderRate,provider:'local-docker',purpose:'quality'});
      result=await render({signal:renderSignal});renderSignal.throwIfAborted();
      store.write(researchAttemptPath(operation)+'/renderer-report.json',result);
      if(result?.status!=='passed')throw Error('LOCAL_AGENT_RENDER_FAILED');
      if(!/^[a-f0-9]{64}$/.test(result?.artifactSha256)||!/^[a-f0-9]{64}$/.test(result?.sourceHash))throw Error('LOCAL_AGENT_BASELINE_ARTIFACT_IDENTITY');
      operation.researchArtifact={artifactSha256:result.artifactSha256,sourceHash:result.sourceHash,reportHash:digest(result)};
      store.write('operations/'+operation.id+'/renderer-report.json',result);
      operation.state='awaiting_user';operation.phase='output_review';operation.error=null;operation.researchFailure=null;
    }
    catch(error){recordResearchFailure(store,operation,error,'render',signal);throw error;}
    finally {
      const elapsed=Math.ceil(performance.now()-started);
      if(reservation)ledger.settle(reservation,{usdMicros:Math.ceil(elapsed*ledger.renderRate/1000),usage:[{metric:'wall_ms',unit:'millisecond',quantity:elapsed}],
        reason:'Measured isolated baseline renderer wall time at the explicitly configured local rate.'});
      operation.activeMs=(operation.activeMs??0)+elapsed;operation.usage=usage(ledger,operation);saveResearchOperation(store,operation);
    }
    return {result,costEvents:ledger.events()};
  });
}
/** Reconcile only from an operator's actual provider invoice/usage evidence, never model output. */
export async function reconcileCharge({directory,projectId,config,operationId,chargeId,receipt}) {
  assertConfig(config);return withStore(directory,store=>{
    const record=projectRecord(store,projectId),operation=store.read(operationPath(operationId));
    if(operation.projectId!==projectId)throw Error('LOCAL_AGENT_OPERATION_PROJECT_MISMATCH');
    const ledger=operationLedger(store,config,record.input,operation);
    const prior=latestCosts(ledger.events()).find(event=>event.chargeId===chargeId);
    if(!prior||typeof receipt?.evidenceRef!=='string'||!receipt.evidenceRef.trim()||typeof receipt?.reconciledBy!=='string'||!receipt.reconciledBy.trim())
      throw Error('LOCAL_AGENT_RECONCILIATION_EVIDENCE_REQUIRED');
    const event=ledger.settle(prior,{usdMicros:receipt.usdMicros,usage:receipt.usage,providerRequestId:receipt.providerRequestId??prior.providerRequestId,
      reconciled:true,reason:'Provider reconciliation by '+receipt.reconciledBy+': '+receipt.evidenceRef});
    operation.usage=usage(ledger,operation);saveOperation(store,operation);return event;
  });
}
