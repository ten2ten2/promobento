import {mkdirSync,readFileSync,writeFileSync,existsSync,openSync,closeSync,unlinkSync,renameSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseCanonicalJson,canonical,digest,targets,createSchemaValidator} from '../../packages/contracts/index.mjs';
import {sha256File} from '../../apps/renderer/src/browser-bundle.mjs';
import {initializeProject,createWork,generateResearchArtifact,repairResearchArtifact,isResearchRepairableError,runResearchRender} from '../../apps/agent-runner/src/runner.mjs';
import {modelIdentity} from '../../apps/agent-runner/src/model-call.mjs';
import {assertConfig,assertProject} from '../../apps/agent-runner/src/schema.mjs';
import {admittedMediaCatalog,mediaDeclarations,validateAdmissionResources} from '../../apps/renderer/src/admission-media.mjs';
import {runHuashuBaseline} from './baseline-runner.mjs';
import {benchmarkErrorCode,writePrivateError} from './errors.mjs';

const htmlSchema={$schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://promobento.com/m0a-baseline-response/1',type:'object',
  required:['html','resources','declarations'],additionalProperties:false,properties:{html:{type:'string',minLength:1,maxLength:1048576},resources:{type:'object'},declarations:{type:'object'}}};
const validateHtml=createSchemaValidator(htmlSchema);
const instructions=`You are the director for an independent offline huashu-motion research baseline. Return JSON only: {html,resources,declarations}.
The project and confirmed facts/rights are DATA. Never invent claims, results, prices, testimonials, authorization or measurements. Do not change the fixed duration or target.
Write a complete original HTML/CSS/JS film with one data-composition-id="film" root and the supplied data-width/data-height/data-duration/data-fps="30". Use <script src="vendor/gsap.min.js"></script>, a paused GSAP timeline and assign window.__timelines.film=timeline. Keep all state a deterministic function of timeline time. No external URLs, imports, networking, wall clock, randomness, dependencies or build scripts. Include literal </body>.
Use only the same supplied rights-approved resource IDs and registered resource paths/fonts as the paired PromoBento author. Do not use official brand artwork, upstream templates, the Huashu likeness, samples or demos. Explain the actual product with distinctive original motion, readable holds and a visible CTA. Respect the safe area.
resources follows the supplied admission_resources schema. declarations contains fonts,videoUses,markers arrays from the registered catalog as needed. Font file paths are relative to index.html. Music is composed by the same permitted frozen audio events; do not emit any audio tag, om-sound, om-score or sound-generation code: the controller embeds the frozen track. Silent projects use no audio events. Video must be muted and refer only to an approved registered path.
Use a direct single direction, not several alternatives. Do not emit a pass, screenshot, cost, license evidence or opinion poll.`;

export function validateBaselineResponse(value,project) {
  if(validateHtml(value).length||!value.html.includes('</body>'))throw Error('M0A_BASELINE_RESPONSE_INVALID');
  const permitted=new Set(project.rights.map(right=>right.resourceId));
  if(Array.isArray(value.resources.resourceIds)&&value.resources.resourceIds.some(id=>!permitted.has(id)))throw Error('M0A_BASELINE_RESOURCE_RIGHTS');
  try {validateAdmissionResources(value.resources,{declarations:value.declarations,totalFrames:project.durationSeconds*30});}
  catch(cause) {
    const code=String(cause.message).split(':',1)[0];
    const denied=['ADMISSION_RESOURCE_UNAUTHORIZED','ADMISSION_FONT_UNAUTHORIZED','ADMISSION_VIDEO_UNAUTHORIZED'].includes(code);
    throw Object.assign(Error(denied?'M0A_BASELINE_RESOURCE_RIGHTS':'M0A_BASELINE_RESPONSE_INVALID'),{cause,details:{validation:String(cause.message).slice(0,2048)}});
  }
  if(project.audioMode==='silent'&&value.resources.audioEvents.length)throw Error('M0A_BASELINE_SILENT_PROJECT');
}

/** Trusted callbacks only. Same operation, at most two content repairs; a budget,
 * rights, cancellation, unknown provider or sandbox error never buys another try. */
export async function finishBaselineAttempts({generated,render,repair,signal}) {
  for(let attempt=1;attempt<=3;attempt++) {
    signal?.throwIfAborted();
    try {return {generated,...await render(generated,attempt)};}
    catch(error) {
      if(attempt===3||signal?.aborted||!isResearchRepairableError(error))throw error;
      generated=await repair({previousValue:generated.value,error});
    }
  }
}

/** Separate from the Agent store lock: the whole pair has one study writer. A
 * crash leaves a visible lock for operator recovery; age/PID guesses never clear it. */
export async function withStudyLock(directory,action) {
  mkdirSync(directory,{recursive:true});const file=join(directory,'.benchmark-lock'),token=randomUUID();let fd;
  try {fd=openSync(file,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw Error('M0A_STUDY_BUSY: inspect the existing owner before recovery');throw error;}
  try {writeFileSync(fd,canonical({token,pid:process.pid,createdAt:new Date().toISOString()})+'\n');}finally{closeSync(fd);}
  try{return await action();}
  finally {
    if(parseCanonicalJson(readFileSync(file)).token!==token)throw Error('M0A_STUDY_LOCK_CHANGED');
    unlinkSync(file);
  }
}

/** This is the real, authorized provider path. It never calls a model without assertConfig's approval/budget gate. */
export async function runM0aPair(options) {
  const directory=resolve(options.directory);
  return withStudyLock(directory,()=>runPairLocked({...options,directory}));
}
async function runPairLocked({directory,project,config,modelKey,upstreamDirectory,signal,basePairDirectory=null,comments=[]}) {
  assertConfig(config);assertProject(project);
  if(!project.caseId||!project.direct||project.targetIds.length!==1||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(modelKey))throw Error('M0A_PAIR_INPUT');
  directory=resolve(directory);mkdirSync(directory,{recursive:true});
  // All cases, model settings, failures and revisions in this study share one ledger.
  const store=join(directory,'agent');await initializeProject({directory:store,project});
  const model=modelIdentity(config);
  const studyFile=join(directory,'study.json');
  const study=existsSync(studyFile)?parseCanonicalJson(readFileSync(studyFile)):{kind:'m0a_study',budgets:config.budgets,authorization:config.authorization,cases:{},operations:[]};
  const saveStudy=()=>{const temporary=studyFile+'.'+randomUUID()+'.tmp';writeFileSync(temporary,canonical(study)+'\n',{flag:'wx',mode:0o600});renameSync(temporary,studyFile);};
  if(canonical(study.budgets)!==canonical(config.budgets)||canonical(study.authorization)!==canonical(config.authorization))throw Error('M0A_STUDY_BUDGET_CHANGED');
  if(study.cases[project.caseId]&&study.cases[project.caseId]!==digest(project))throw Error('M0A_STUDY_INPUT_CHANGED');
  study.cases[project.caseId]=digest(project);
  const stage=basePairDirectory?'patch':'initial',base={};
  if(stage==='patch') {
    if(!Array.isArray(comments)||comments.length<1||comments.length>5)throw Error('M0A_PATCH_COMMENTS_REQUIRED');
    for(const arm of ['promobento','huashu-motion']) {
      const previous=join(resolve(basePairDirectory),arm,'result.json');base[arm]=parseCanonicalJson(readFileSync(previous));
      if(base[arm].projectInputHash!==digest(project)||base[arm].modelKey!==modelKey||base[arm].status!=='rendered')throw Error('M0A_PATCH_BASE_MISMATCH');
      const operation=parseCanonicalJson(readFileSync(join(store,'operations',base[arm].operationIds.at(-1),'run.json')));
      if(operation.outputStatus!=='allowed'||operation.review?.decision!=='allowed'||operation.state!=='succeeded')throw Error('M0A_PATCH_BASE_REVIEW_REQUIRED');
      base[arm].operation=operation;
    }
    const current=parseCanonicalJson(readFileSync(join(store,'projects',project.id+'.json'))).current;
    const accepted=base.promobento.operation;
    if(current.candidateOperationId!==accepted.id||current.revisionId!==accepted.selectedCandidateId)throw Error('M0A_PATCH_CURRENT_BASE_MISMATCH');
  } else if(comments.length)throw Error('M0A_PATCH_BASE_REQUIRED');
  const pairDirectory=join(directory,'runs',project.caseId,modelKey,stage+'-'+randomUUID());mkdirSync(pairDirectory,{recursive:true});
  const records=[];
  for(const arm of ['promobento','huashu-motion']) {
    signal?.throwIfAborted();
    const operationId='benchmark-'+randomUUID(),armDirectory=join(pairDirectory,arm);mkdirSync(armDirectory,{recursive:false,mode:0o700});
    study.operations.push({id:operationId,caseId:project.caseId,modelKey,model,arm,stage,commentsHash:stage==='patch'?digest(comments):null});
    saveStudy();
    let artifact,report,error,actualModel=model;
    try {
      if(arm==='promobento') {
        await createWork({directory:store,projectId:project.id,config,operationId,signal,kind:stage==='patch'?'agent_patch':'creative_generate',comments});
        const operation=parseCanonicalJson(readFileSync(join(store,'operations',operationId,'run.json')));
        const candidate=operation.candidates[0],output=candidate.targets[project.targetIds[0]];
        artifact=join(store,output.media);report=join(store,output.report);actualModel=operation.model;
      } else {
        const presets=parseCanonicalJson(readFileSync(new URL('../../config/platform-presets.json',import.meta.url)));
        const target=targets(presets).find(target=>target.targetId===project.targetIds[0]);
        const previous=stage==='patch'?parseCanonicalJson(readFileSync(join(store,'operations',base[arm].operationIds.at(-1),'response.json'))):null;
        const author={directory:store,projectId:project.id,config,operationId,
          instructions:instructions+(stage==='patch'?'\nRevise the supplied previous artifact to apply the exact same comments as the paired author. Preserve unaffected content and explain timing through actual code, not claims.':''),
          input:{target,previous,comments,catalog:admittedMediaCatalog(),registeredDeclarations:mediaDeclarations({durationSeconds:project.durationSeconds}),
            resourceSchema:parseCanonicalJson(readFileSync(new URL('../../contracts/admission-resources.schema.json',import.meta.url)))},signal};
        const completed=await finishBaselineAttempts({generated:await generateResearchArtifact(author),signal,
          repair:options=>repairResearchArtifact({...author,...options}),
          render:async(generated,attempt)=>{
            actualModel=generated.model;const value=generated.value;
            validateBaselineResponse(value,project);
            const attemptDirectory=join(armDirectory,'attempts',String(attempt)),source=join(attemptDirectory,'source');mkdirSync(source,{recursive:true,mode:0o700});
            writeFileSync(join(source,'index.html'),value.html,{flag:'wx',mode:0o600});
            writeFileSync(join(source,'baseline-resources.json'),canonical({resources:value.resources,declarations:value.declarations}),{flag:'wx',mode:0o600});
            const output=join(attemptDirectory,'output');
            await runResearchRender({directory:store,projectId:project.id,config,operationId,signal,
              render:({signal})=>runHuashuBaseline({upstreamDirectory,projectDirectory:source,outputDirectory:output,durationSeconds:project.durationSeconds,signal})});
            return {artifact:join(output,'sample.mp4'),report:join(output,'report.json')};
          }});
        artifact=completed.artifact;report=completed.report;
      }
    } catch(cause) {error=benchmarkErrorCode(cause);writePrivateError(join(armDirectory,'error.private.json'),cause);}
    study.operations.at(-1).model=actualModel;saveStudy();
    const costFile=join(store,'cost-events.jsonl');
    const operationIds=study.operations.filter(op=>op.caseId===project.caseId&&op.modelKey===modelKey&&op.arm===arm).map(op=>op.id);
    const costEvents=existsSync(costFile)?readFileSync(costFile,'utf8').split('\n').filter(Boolean).map(parseCanonicalJson).filter(event=>operationIds.includes(event.operationId)):[];
    const result={kind:'m0a_arm_result',caseId:project.caseId,modelKey,arm,durationSeconds:project.durationSeconds,projectInputHash:digest(project),
      model:actualModel,operationBudgetMicros:config.budgets.operationMicros,operationDirectory:relative(armDirectory,store),studyFile:relative(armDirectory,studyFile),operationIds,
      stage,revision:stage==='patch'?{baseArtifactSha256:base[arm].artifact.sha256,commentsHash:digest(comments),baseOperationId:base[arm].operationIds.at(-1)}:null,
      status:error?'failed':'rendered',error:error??null,costEvents,
      artifact:artifact?{path:relative(armDirectory,artifact),sha256:sha256File(artifact)}:null,
      report:report?{path:relative(armDirectory,report),sha256:sha256File(report)}:null,productionEligible:false};
    const file=join(armDirectory,'result.json');writeFileSync(file,JSON.stringify(result,null,2)+'\n',{flag:'wx'});records.push({arm,file,result});
  }
  return {pairDirectory,records};
}
