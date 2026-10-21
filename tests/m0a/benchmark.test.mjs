import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseCanonicalJson,digest,targets} from '../../packages/contracts/index.mjs';
import {sha256File} from '../../apps/renderer/src/browser-bundle.mjs';
import {expectedCases,summarizeCosts,summarizeBlindReview,summarizeBenchmark,readBenchmark,createBlindPack} from '../../research/m0a/benchmark.mjs';
import {baselineSandboxArguments} from '../../research/m0a/baseline-runner.mjs';
import {withStudyLock,runM0aPair,finishBaselineAttempts,validateBaselineResponse} from '../../research/m0a/run-pair.mjs';
import {reviewSubject,initializeProject} from '../../apps/agent-runner/src/runner.mjs';
import {project as mockProject,config as mockConfig} from '../../apps/agent-runner/test/fixtures.mjs';
import {benchmarkErrorCode} from '../../research/m0a/errors.mjs';

// Every receipt, cost and response below is deliberately synthetic unit-test data.
const cases=parseCanonicalJson(readFileSync(new URL('../../research/m0a/engineering-cases.json',import.meta.url)));
const rows=expectedCases(cases);
const models=[{key:'synthetic-a',provider:'synthetic-provider',id:'synthetic-model-a',settingsHash:digest('a')},
  {key:'synthetic-b',provider:'synthetic-provider',id:'synthetic-model-b',settingsHash:digest('b')}];
const manifest=()=>({kind:'m0a_benchmark',version:1,caseSetFile:'cases.json',selectedModelKey:'synthetic-a',modelCandidates:models,producerIds:['producer'],runs:[],blindReview:null,economicsFiles:[]});
const cost=()=>({schemaVersion:'2.7.0',kind:'cost_event',eventId:'cost-1',chargeId:'charge-1',dedupKey:'charge-1-actual',environment:'local',scope:'project',
  workspaceId:'workspace',projectId:'project',actorUserId:'producer',trialOwnerUserId:null,operationId:'operation',attemptId:'attempt',targetId:null,orderId:null,releaseId:null,
  reservationId:'reservation',purpose:'paid_creation',provider:'synthetic-provider',model:'synthetic-model-a',providerRequestId:'synthetic-request',priceVersion:'synthetic-price',
  methodPackageVersion:'synthetic-method',rendererImageDigest:null,usage:[{metric:'input_tokens',unit:'token',quantity:100}],usdMicros:300,status:'actual',
  occurredAt:'2026-10-20T00:00:00Z',recordedAt:'2026-10-20T00:00:01Z',supersedesEventId:null,reason:null});
const registry=()=>({kind:'m0a_independent_reviewers',recruitment:'Synthetic unit-test registry, no actual human recruited.',biases:['Synthetic fixture, not observed opinions.'],reviewers:[{
  reviewerId:'reviewer',kind:'human',role:'target_user',audiences:['software','course'],participatedInProduction:false,verificationEvidenceRef:'synthetic:test'}]});
const mapping=()=>({kind:'m0a_blind_mapping',packId:'pack',selectedModelKey:'synthetic-a',pairs:rows.map(row=>({caseId:row.caseId,A:{arm:'promobento'},B:{arm:'huashu-motion'}}))});
const ballots=()=>rows.flatMap((row,index)=>['A','B'].map(slot=>({reviewerId:'reviewer',packId:'pack',caseId:row.caseId,slot,wouldPublish:index<8,
  watchedAtNormalSpeed:true,reviewedAt:'2026-10-20T00:00:00Z',evidenceRef:'synthetic:test'})));
const score=options=>summarizeBlindReview({mapping:mapping(),registry:registry(),ballots:ballots(),manifest:manifest(),cases:rows,...options});

test('the engineering matrix is exactly software3/course3 × 15/30 and main subjects stay distinct',()=>{
  assert.equal(rows.length,12);assert.equal(rows.filter(row=>row.audience==='software').length,6);
  const actual=parseCanonicalJson(readFileSync(new URL('../../research/m0a/cases.json',import.meta.url)));
  assert.equal(actual.kind,'user_selected_research_cases');assert.equal(expectedCases(actual).length,12);
  assert.ok(actual.cards.every(card=>card.facts.every(fact=>fact.confirmation==='pending_owner')));
  assert.throws(()=>expectedCases({...cases,cards:cases.cards.slice(1)}),/THREE_PLUS_THREE/);
});
test('cost replacements count once, include failed attempts and reject unknown usage as settled',()=>{
  const first={...cost(),status:'estimated',usdMicros:900,usage:[{metric:'pending_charge',unit:'request',quantity:null}]};
  const actual={...cost(),eventId:'cost-2',supersedesEventId:'cost-1',reason:'Synthetic final usage'};
  const failed={...cost(),eventId:'cost-3',chargeId:'charge-failed',attemptId:'failed-attempt',usdMicros:100};
  const total=summarizeCosts([first,actual,failed]);assert.equal(total.usdMicros,400);assert.equal(total.charges,2);assert.equal(total.settled,true);
  assert.equal(summarizeCosts([first]).settled,false);assert.equal(summarizeCosts([]).settled,false);
  assert.throws(()=>summarizeCosts([cost(),cost()]),/LEDGER_INVALID/);
});
test('a nonlinear or cross-operation cost replacement is rejected',()=>{
  assert.throws(()=>summarizeCosts([cost(),{...cost(),eventId:'next',supersedesEventId:'cost-1',operationId:'other',reason:'Synthetic invalid chain'}]),/CHAIN_INVALID/);
});
test('8 of 12 groups and no lower approval rate pass the subjective threshold',()=>{
  const result=score();assert.equal(result.passed,true);assert.equal(result.promobentoApprovedGroups,8);assert.equal(result.baselineApprovedGroups,8);assert.equal(result.independentReviewers,1);
  const votes=ballots();votes.find(vote=>vote.slot==='A').wouldPublish=false;assert.equal(score({ballots:votes}).passed,false);
});
test('producers, model identities and nonhuman raters cannot vote as independent targets',()=>{
  for(const reviewerId of ['producer','synthetic-model-a','synthetic-a']) {
    const r=registry();r.reviewers[0].reviewerId=reviewerId;assert.throws(()=>score({registry:r}),/NONINDEPENDENT/);
  }
  const r=registry();r.reviewers[0].kind='agent';assert.throws(()=>score({registry:r}),/REGISTRY_INVALID/);
});
test('duplicate, wrong-pack, wrong-audience and half-pair votes are rejected',()=>{
  assert.throws(()=>score({ballots:[...ballots(),ballots()[0]]}),/BALLOT_IDENTITY/);
  const wrong=ballots();wrong[0].packId='other';assert.throws(()=>score({ballots:wrong}),/BALLOT_IDENTITY/);
  const r=registry();r.reviewers[0].audiences=['course'];assert.throws(()=>score({registry:r}),/BALLOT_IDENTITY/);
  assert.throws(()=>score({ballots:ballots().slice(1)}),/INCOMPLETE_REVIEW_PAIR/);
});
test('empty opinions never become a zero-cost or approval pass',()=>{
  const result=score({ballots:[]});assert.equal(result.passed,false);assert.equal(result.promobentoApprovalRate,null);
});

function fixture(t,{full=false}={}) {
  const directory=mkdtempSync(join(tmpdir(),'m0a-benchmark-unit-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const store=join(directory,'agent'),studyFile=join(directory,'study.json'),study={operations:[]};
  mkdirSync(join(store,'projects'),{recursive:true});writeFileSync(join(store,'cost-events.jsonl'),'');
  const m=manifest();writeFileSync(join(directory,'cases.json'),JSON.stringify(cases));
  const writeRun=(row,model,arm)=>{
    const folder=join(directory,row.caseId,model.key,arm),operationId=row.caseId+'-'+model.key+'-'+arm;
    mkdirSync(folder,{recursive:true});mkdirSync(join(store,'operations',operationId),{recursive:true});mkdirSync(join(store,'renders',operationId),{recursive:true});
    const identity={provider:model.provider,id:model.id,settingsHash:model.settingsHash};
    const events=[{...cost(),operationId,eventId:operationId+'-event',chargeId:operationId+'-charge',model:model.id}];
    writeFileSync(join(store,'cost-events.jsonl'),readFileSync(join(store,'cost-events.jsonl'),'utf8')+events.map(JSON.stringify).join('\n')+'\n');
    const input={id:'project-'+row.caseId,caseId:row.caseId,durationSeconds:row.durationSeconds,targetIds:['instagram_feed:square']},inputHash=digest(input);
    writeFileSync(join(store,'projects',input.id+'.json'),JSON.stringify({input,inputHash}));
    const artifactPath=join(store,'renders',operationId,'sample.mp4'),reportPath=join(store,'renders',operationId,'report.json');
    writeFileSync(artifactPath,'synthetic-media-not-real-video');const artifactHash=sha256File(artifactPath),sourceHash=digest('synthetic-source'),qaInputHash=digest('synthetic-qa');
    const report=arm==='promobento'?{kind:'m0a_admission_result',status:'passed',sourceHash,qaInputHash,capture:{targetId:'instagram_feed:square',width:1080,height:1080,
      durationSeconds:row.durationSeconds,frameCount:row.durationSeconds*30,video:{sha256:artifactHash}}}:{kind:'m0a_baseline_render',status:'passed',artifactSha256:artifactHash,sourceHash,
      width:1080,height:1080,durationSeconds:row.durationSeconds,frames:row.durationSeconds*30,determinism:{status:'passed'}};
    writeFileSync(reportPath,JSON.stringify(report));
    const target={sourceHash,qaInputHash,media:relative(store,artifactPath),report:relative(store,reportPath)};
    const operation={id:operationId,projectId:input.id,caseId:row.caseId,projectInputHash:inputHash,model:identity,kind:arm==='promobento'?'creative_generate':'research_baseline',baseRevisionId:null,
      returnedModels:[{attempt:1,provider:model.provider,id:model.id}],plans:[],candidates:arm==='promobento'?[{id:'candidate',targets:{'instagram_feed:square':target}}]:[],selectedCandidateId:arm==='promobento'?'candidate':null,outputStatus:'allowed',review:{decision:'allowed'},state:'succeeded',attempt:1};
    if(arm==='huashu-motion')operation.researchArtifact={artifactSha256:artifactHash,sourceHash,reportHash:digest(report)};
    operation.review.subjectHash=reviewSubject(operation);
    writeFileSync(join(store,'operations',operationId,'run.json'),JSON.stringify(operation));
    const result={kind:'m0a_arm_result',caseId:row.caseId,durationSeconds:row.durationSeconds,modelKey:model.key,arm,projectInputHash:inputHash,model:identity,
      operationBudgetMicros:1000,operationDirectory:relative(folder,store),studyFile:relative(folder,studyFile),operationIds:[operationId],costEvents:events,status:'rendered',stage:'initial',revision:null,error:null,productionEligible:false,
      artifact:{path:relative(folder,artifactPath),sha256:artifactHash},report:{path:relative(folder,reportPath),sha256:sha256File(reportPath)}};
    writeFileSync(join(folder,'result.json'),JSON.stringify(result));
    study.operations.push({id:operationId,caseId:row.caseId,modelKey:model.key,model:identity,arm,stage:'initial',commentsHash:null});writeFileSync(studyFile,JSON.stringify(study));
    m.runs.push({caseId:row.caseId,modelKey:model.key,arm,file:row.caseId+'/'+model.key+'/'+arm+'/result.json'});return {folder,store,studyFile,result,operation,operationId,report,artifactPath,reportPath};
  };
  if(full)for(const row of rows)for(const model of models)for(const arm of ['promobento','huashu-motion'])writeRun(row,model,arm);
  const save=()=>writeFileSync(join(directory,'manifest.json'),JSON.stringify(m));save();
  return {directory,m,save,writeRun,path:join(directory,'manifest.json')};
}
test('missing model pairs, reviews and real economics remain visible blockers',t=>{
  const f=fixture(t);const result=summarizeBenchmark(f.path);assert.equal(result.benchmarkPassed,false);assert.equal(result.missingPairs.length,24);
  assert.ok(result.blockers.includes('fictional_engineering_inputs'));assert.ok(result.blockers.includes('economics_not_calibrated'));
  assert.throws(()=>createBlindPack(f.path,join(f.directory,'blind')),/REQUIRES_REVIEWED/);
});
test('same input and budget are enforced for both arms and both model settings',t=>{
  const f=fixture(t),a=f.writeRun(rows[0],models[0],'promobento'),b=f.writeRun(rows[0],models[0],'huashu-motion');f.save();readBenchmark(f.path);
  b.result.operationBudgetMicros=2000;writeFileSync(join(b.folder,'result.json'),JSON.stringify(b.result));assert.throws(()=>readBenchmark(f.path),/UNFAIR_PAIR/);
  b.result.operationBudgetMicros=1000;writeFileSync(join(b.folder,'result.json'),JSON.stringify(b.result));
  const other=f.writeRun(rows[0],models[1],'promobento');other.result.operationBudgetMicros=2000;writeFileSync(join(other.folder,'result.json'),JSON.stringify(other.result));f.save();
  assert.throws(()=>readBenchmark(f.path),/UNFAIR_MODEL_COMPARISON/);assert.ok(a);
});
test('the matrix cannot merge separate study registries to reset its shared budget',t=>{
  const f=fixture(t);f.writeRun(rows[0],models[0],'promobento');const b=f.writeRun(rows[0],models[0],'huashu-motion');f.save();
  writeFileSync(join(b.folder,'other-study.json'),readFileSync(b.studyFile));b.result.studyFile='other-study.json';
  writeFileSync(join(b.folder,'result.json'),JSON.stringify(b.result));assert.throws(()=>readBenchmark(f.path),/MULTIPLE_STUDY_LEDGERS/);
});
test('artifact substitution and cost ledger omissions fail before assessment',t=>{
  const f=fixture(t),a=f.writeRun(rows[0],models[0],'promobento');f.save();
  writeFileSync(a.artifactPath,'changed');assert.throws(()=>readBenchmark(f.path),/ARTIFACT_MISMATCH/);
  writeFileSync(a.artifactPath,'synthetic-media-not-real-video');a.result.costEvents=[];writeFileSync(join(a.folder,'result.json'),JSON.stringify(a.result));
  assert.throws(()=>readBenchmark(f.path),/COST_LEDGER_MISMATCH/);
});
test('updating receipt hashes cannot splice a different video or report into a reviewed candidate',t=>{
  const f=fixture(t),a=f.writeRun(rows[0],models[0],'promobento');f.save();
  writeFileSync(a.artifactPath,'substituted-synthetic-video');a.result.artifact.sha256=sha256File(a.artifactPath);
  writeFileSync(join(a.folder,'result.json'),JSON.stringify(a.result));
  assert.throws(()=>readBenchmark(f.path),/REVIEWED_ARTIFACT_MISMATCH/);
  writeFileSync(a.artifactPath,'synthetic-media-not-real-video');a.result.artifact.sha256=sha256File(a.artifactPath);
  for(const mutate of [report=>{report.sourceHash=digest('other-source');},report=>{report.qaInputHash=digest('other-qa');},
    report=>{report.capture.targetId='tiktok:portrait';},report=>{report.capture.frameCount=900;},report=>{report.capture.durationSeconds=30;}]) {
    const report=structuredClone(a.report);mutate(report);writeFileSync(a.reportPath,JSON.stringify(report));a.result.report.sha256=sha256File(a.reportPath);
    writeFileSync(join(a.folder,'result.json'),JSON.stringify(a.result));assert.throws(()=>readBenchmark(f.path),/REVIEWED_ARTIFACT_MISMATCH/);
  }
  writeFileSync(a.reportPath,JSON.stringify(a.report));a.result.report.sha256=sha256File(a.reportPath);
  const other=join(a.folder,'other-report.json');writeFileSync(other,JSON.stringify(a.report));a.result.report.path='other-report.json';
  writeFileSync(join(a.folder,'result.json'),JSON.stringify(a.result));assert.throws(()=>readBenchmark(f.path),/REVIEWED_ARTIFACT_MISMATCH/);
});
test('baseline media, source, duration and report remain bound to its actual review subject',t=>{
  const f=fixture(t),a=f.writeRun(rows[0],models[0],'huashu-motion');f.save();
  for(const mutate of [report=>{report.artifactSha256=digest('other-video');},report=>{report.sourceHash=digest('other-source');},
    report=>{report.durationSeconds=30;},report=>{report.frames=900;},report=>{report.determinism.status='fabricated-pass';}]) {
    const report=structuredClone(a.report);mutate(report);writeFileSync(a.reportPath,JSON.stringify(report));a.result.report.sha256=sha256File(a.reportPath);
    writeFileSync(join(a.folder,'result.json'),JSON.stringify(a.result));assert.throws(()=>readBenchmark(f.path),/REVIEWED_ARTIFACT_MISMATCH/);
  }
});
test('omitted study attempts and omitted producers cannot enter a complete benchmark',t=>{
  const f=fixture(t),a=f.writeRun(rows[0],models[0],'promobento');f.save();
  const study=parseCanonicalJson(readFileSync(a.studyFile)),original=structuredClone(study);
  study.operations.push({...study.operations[0],id:'omitted-failed-attempt'});writeFileSync(a.studyFile,JSON.stringify(study));
  assert.throws(()=>readBenchmark(f.path),/OMITTED_STUDY_ATTEMPT/);
  writeFileSync(a.studyFile,JSON.stringify(original));f.m.producerIds=['someone-else'];f.save();
  assert.throws(()=>readBenchmark(f.path),/PRODUCER_INVENTORY_INCOMPLETE/);
});
test('complete initial outputs do not satisfy the required paired revision',t=>{
  const f=fixture(t,{full:true}),result=summarizeBenchmark(f.path);
  assert.equal(result.missingPairs.length,0);assert.ok(result.blockers.includes('paired_revision_missing_or_unchanged'));
  assert.ok(result.arms.every(arm=>arm.technicalPassed&&arm.reviewAllowed&&!arm.revisionComplete));
});
test('the study lock excludes a second writer and releases after rejection or cancellation',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'m0a-study-lock-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  await withStudyLock(directory,async()=>{
    assert.equal(existsSync(join(directory,'.benchmark-lock')),true);
    await assert.rejects(withStudyLock(directory,()=>assert.fail('concurrent writer entered')),/M0A_STUDY_BUSY/);
  });
  assert.equal(existsSync(join(directory,'.benchmark-lock')),false);
  await assert.rejects(withStudyLock(directory,()=>{throw Error('synthetic-cancel');}),/synthetic-cancel/);
  assert.equal(existsSync(join(directory,'.benchmark-lock')),false);
  await assert.rejects(withStudyLock(directory,()=>{writeFileSync(join(directory,'.benchmark-lock'),JSON.stringify({token:'different-owner'}));}),/LOCK_CHANGED/);
  assert.equal(existsSync(join(directory,'.benchmark-lock')),true);
});
test('a patch cannot silently use the other model setting accepted as the current base',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'m0a-patch-base-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const project={...mockProject(),targetIds:['instagram_feed:square']},store=join(directory,'agent'),pair=join(directory,'old-pair');
  await initializeProject({directory:store,project});
  for(const arm of ['promobento','huashu-motion']) {
    mkdirSync(join(pair,arm),{recursive:true});mkdirSync(join(store,'operations',arm),{recursive:true});
    writeFileSync(join(pair,arm,'result.json'),JSON.stringify({projectInputHash:digest(project),modelKey:'synthetic-a',status:'rendered',operationIds:[arm]}));
    writeFileSync(join(store,'operations',arm,'run.json'),JSON.stringify({id:arm,outputStatus:'allowed',review:{decision:'allowed'},state:'succeeded',selectedCandidateId:'original-a'}));
  }
  const path=join(store,'projects',project.id+'.json'),record=parseCanonicalJson(readFileSync(path));
  record.current={candidateOperationId:'other-model-operation',revisionId:'other-model-revision'};writeFileSync(path,JSON.stringify(record));
  await assert.rejects(runM0aPair({directory,project,config:mockConfig(),modelKey:'synthetic-a',upstreamDirectory:'/must-not-run',basePairDirectory:pair,
    comments:[{targetId:'instagram_feed:square',frameIndex:30,comment:'Synthetic patch only.',editScope:'shot'}]}),/PATCH_CURRENT_BASE_MISMATCH/);
  assert.equal(existsSync(join(store,'cost-events.jsonl')),false);assert.equal(existsSync(join(directory,'.benchmark-lock')),false);
});
test('public error codes do not expose unreviewed parser excerpts, HTML or provider diagnostics',()=>{
  const secret='Unreviewed product claim <b>do not print</b>';
  for(const error of [new SyntaxError('Unexpected token '+secret),Error(secret),Object.assign(Error(secret),{code:'UNAPPROVED_MODEL_TEXT'})])
    assert.equal(benchmarkErrorCode(error),'M0A_OPERATION_FAILED');
  assert.equal(benchmarkErrorCode(Error('BASELINE_EXECUTION_FAILED: '+secret)),'BASELINE_EXECUTION_FAILED');
  assert.equal(benchmarkErrorCode(Error('M0A_ECONOMICS_EVIDENCE_MISMATCH: '+secret)),'M0A_ECONOMICS_EVIDENCE_MISMATCH');
});
test('the real CLI prints only a stable code for a malformed unreviewed request',t=>{
  const directory=mkdtempSync(join(tmpdir(),'m0a-cli-private-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const request=join(directory,'request.json'),claim='UNREVIEWED_PRODUCT_CLAIM';writeFileSync(request,'{"claim":'+claim+'}');
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../../scripts/benchmark-m0a.mjs',import.meta.url)),'run-pair','--request',request],{encoding:'utf8'});
  assert.equal(result.status,1);assert.deepEqual(parseCanonicalJson(result.stderr),{error:'M0A_OPERATION_FAILED'});
  assert.ok(!result.stderr.includes(claim));assert.equal(result.stdout,'');
});
test('baseline content repairs reuse the callback scope and stop at two repairs, rights or cancellation',async()=>{
  let renders=0,repairs=0;
  const generated={value:{synthetic:1}},repair=async({previousValue,error})=>{
    assert.equal(previousValue.synthetic,repairs+1);assert.equal(error.message,'BASELINE_NONDETERMINISTIC');repairs++;return {value:{synthetic:repairs+1}};
  };
  const success=await finishBaselineAttempts({generated,repair,render:async(value,attempt)=>{renders++;assert.equal(value.value.synthetic,attempt);
    if(attempt<3)throw Error('BASELINE_NONDETERMINISTIC');return {artifact:'synthetic-third-attempt'};}});
  assert.equal(success.artifact,'synthetic-third-attempt');assert.equal(renders,3);assert.equal(repairs,2);
  repairs=0;await assert.rejects(finishBaselineAttempts({generated,repair,render:async()=>{throw Error('BASELINE_NONDETERMINISTIC');}}),/NONDETERMINISTIC/);
  assert.equal(repairs,2);
  for(const code of ['M0A_BASELINE_RESOURCE_RIGHTS','BASELINE_CLEANUP_FAILED','BASELINE_IMAGE_MISMATCH','BASELINE_EXECUTION_FAILED','LOCAL_AGENT_USAGE_UNKNOWN'])
    await assert.rejects(finishBaselineAttempts({generated,repair:()=>assert.fail('must not retry '+code),render:async()=>{throw Error(code);}}),new RegExp(code));
  const controller=new AbortController();controller.abort(Error('synthetic-cancel'));
  await assert.rejects(finishBaselineAttempts({generated,signal:controller.signal,repair:()=>assert.fail(),render:()=>assert.fail()}),/synthetic-cancel/);
});
test('baseline response validation keeps authorization denials outside content repair',()=>{
  const value={html:'<body>synthetic only</body>',resources:{schemaVersion:'2.7.0',kind:'admission_resources',resourceIds:[],audioEvents:[]},
    declarations:{fonts:[],videoUses:[],markers:[]}},project=mockProject();validateBaselineResponse(value,project);
  value.resources.resourceIds=['unapproved-resource'];assert.throws(()=>validateBaselineResponse(value,project),/RESOURCE_RIGHTS/);
  project.rights=[{resourceId:'unapproved-resource'}];assert.throws(()=>validateBaselineResponse(value,project),/RESOURCE_RIGHTS/);
  value.resources.resourceIds=[];value.declarations.fonts=[{fontId:'invented-font'}];assert.throws(()=>validateBaselineResponse(value,project),/RESOURCE_RIGHTS/);
});
test('requested model aliases retain real returned versions and reject snapshot drift across arms or cases',t=>{
  const f=fixture(t),a=f.writeRun(rows[0],models[0],'promobento'),b=f.writeRun(rows[0],models[0],'huashu-motion');f.save();
  const save=a=>writeFileSync(join(a.store,'operations',a.operationId,'run.json'),JSON.stringify(a.operation));
  a.operation.returnedModels=[{attempt:1,provider:models[0].provider,id:'synthetic-pinned-snapshot'}];save(a);
  assert.throws(()=>readBenchmark(f.path),/RETURNED_MODEL_DRIFT/);
  b.operation.returnedModels=structuredClone(a.operation.returnedModels);save(b);
  assert.equal(readBenchmark(f.path).pairs[0].promobento.returnedModel.id,'synthetic-pinned-snapshot');
  a.operation.returnedModels=[];save(a);assert.throws(()=>readBenchmark(f.path),/RETURNED_MODEL_MISSING/);
});

const economicsFor=a=>({schemaVersion:'2.7.0',kind:'m0a_economics_input',
  group:{modelSettingId:a.result.modelKey,durationSeconds:a.result.durationSeconds,targetIds:['instagram_feed:square']},
  unitCosts:{creations:{totalCostMicros:300,unsettledCostMicros:0,attempts:1,usableResults:1,
    evidenceRefs:['operation:'+a.operationId],chargeRefs:['operation:'+a.operationId+'/charge:'+a.result.costEvents[0].chargeId]},
    patchRounds:null,assetSegments:null,targetBatches:null,deliveryBatches:null},cohort:null,
  scenarios:[{id:'synthetic-assumption',sku:'project_pack',expectedUse:{creations:1,patchRounds:0,assetSegments:0,targetBatches:0,deliveryBatches:0},
    initialTargetPreparationIncludedInTrial:true,averageTrialCostMicros:300,trialConversionRate:0.2,netReceiptMicros:38000000,otherCostMicros:1000000,
    basis:'hypothesis',evidenceRefs:['synthetic-assumption-not-observed-market']} ]});
test('economics bind selected model, duration, target, operations, exact charges and measured totals',t=>{
  const f=fixture(t),a=f.writeRun(rows[0],models[0],'promobento');f.m.economicsFiles=['economics.json'];f.save();
  const input=economicsFor(a),save=value=>writeFileSync(join(f.directory,'economics.json'),JSON.stringify(value));save(input);
  const result=summarizeBenchmark(f.path);assert.equal(result.economics.status,'incomplete');
  assert.equal(result.economics.groups[0].unitCosts.creations.averageCostMicros,300);
  for(const [mutate,code] of [
    [value=>{value.group.modelSettingId='synthetic-b';},/GROUP_MISMATCH/],
    [value=>{value.group.durationSeconds=30;},/GROUP_UNOBSERVED/],
    [value=>{value.group.targetIds=['tiktok:portrait'];},/GROUP_UNOBSERVED/],
    [value=>{value.unitCosts.creations.evidenceRefs=['operation:unrelated'];},/EVIDENCE_MISMATCH/],
    [value=>{value.unitCosts.creations.chargeRefs=['operation:unrelated\/charge:unrelated'];},/CHARGE_REFS_MISMATCH/],
    [value=>{value.unitCosts.creations.totalCostMicros=1;},/MEASUREMENT_MISMATCH/],
    [value=>{value.unitCosts.creations.attempts=2;},/MEASUREMENT_MISMATCH/],
    [value=>{value.unitCosts.creations.usableResults=0;},/MEASUREMENT_MISMATCH/],
    [value=>{value.unitCosts.assetSegments={...value.unitCosts.creations,evidenceRefs:['operation:unrelated'],chargeRefs:['charge:unrelated']};},/UNIT_UNOBSERVED/]
  ]) {const changed=structuredClone(input);mutate(changed);save(changed);assert.throws(()=>summarizeBenchmark(f.path),code);}
});
test('economics include failed operations and cannot price a seven-target batch as a single target',t=>{
  const f=fixture(t),a=f.writeRun(rows[0],models[0],'promobento'),store=a.store;f.m.economicsFiles=['economics.json'];f.save();
  const all=targets(parseCanonicalJson(readFileSync(new URL('../../config/platform-presets.json',import.meta.url)))).map(target=>target.targetId);
  const failed={...a.operation,id:'synthetic-failed-creation',state:'failed',outputStatus:'withheld',review:null,attempt:2};
  const prepared={...a.operation,id:'synthetic-seven-target-prepare',kind:'prepare_targets',preparedTargetIds:all,
    candidates:[{id:'prepared',targets:Object.fromEntries(all.map(target=>[target,{}]))}],selectedCandidateId:'prepared'};
  prepared.review={decision:'allowed',subjectHash:reviewSubject(prepared)};
  const addOperation=operation=>{
    mkdirSync(join(store,'operations',operation.id));writeFileSync(join(store,'operations',operation.id,'run.json'),JSON.stringify(operation));
    const event={...cost(),operationId:operation.id,eventId:operation.id+'-event',chargeId:operation.id+'-charge'};
    writeFileSync(join(store,'cost-events.jsonl'),readFileSync(join(store,'cost-events.jsonl'),'utf8')+JSON.stringify(event)+'\n');return event;
  };
  const failedCost=addOperation(failed),targetCost=addOperation(prepared),input=economicsFor(a);
  const save=()=>writeFileSync(join(f.directory,'economics.json'),JSON.stringify(input));save();
  assert.throws(()=>summarizeBenchmark(f.path),/EVIDENCE_MISMATCH/);
  input.unitCosts.creations.totalCostMicros=600;input.unitCosts.creations.attempts=3;
  input.unitCosts.creations.evidenceRefs.push('operation:'+failed.id);
  input.unitCosts.creations.chargeRefs.push('operation:'+failed.id+'/charge:'+failedCost.chargeId);
  input.unitCosts.targetBatches={totalCostMicros:300,unsettledCostMicros:0,attempts:1,usableResults:1,
    evidenceRefs:['operation:'+prepared.id],chargeRefs:['operation:'+prepared.id+'/charge:'+targetCost.chargeId]};save();
  assert.throws(()=>summarizeBenchmark(f.path),/UNIT_UNOBSERVED/);
  input.group.targetIds=all;save();const result=summarizeBenchmark(f.path);
  assert.equal(result.economics.groups[0].unitCosts.creations.averageCostMicros,600);
  assert.equal(result.economics.groups[0].unitCosts.targetBatches.averageCostMicros,300);
  assert.equal(result.economics.status,'incomplete');assert.equal(result.economics.missingGroups.length,1);
  prepared.candidates[0].targets={'instagram_feed:square':{}};prepared.review.subjectHash=reviewSubject(prepared);
  writeFileSync(join(store,'operations',prepared.id,'run.json'),JSON.stringify(prepared));
  assert.throws(()=>summarizeBenchmark(f.path),/TARGET_BATCH_IDENTITY/);
});
test('blind material hides arm names and balances A/B, keeping mapping outside viewer folder',t=>{
  const f=fixture(t,{full:true}),out=createBlindPack(f.path,join(f.directory,'blind'));
  const privateMap=parseCanonicalJson(readFileSync(out.privateMapping)),html=readFileSync(join(out.directory,'index.html'),'utf8');
  assert.equal(privateMap.pairs.filter(pair=>pair.A.arm==='promobento').length,6);assert.equal(privateMap.pairs.length,12);
  assert.ok(!html.includes('huashu-motion'));assert.ok(!html.includes('promobento'));assert.ok(!out.privateMapping.startsWith(out.directory+'/'));
});
test('upstream execution flags permit no network, privilege, host writes or unbounded tmpfs',()=>{
  const args=baselineSandboxArguments({name:'promobento-baseline-00000000-0000-4000-8000-000000000000',imageId:'sha256:'+'a'.repeat(64),mounts:[{source:'/tmp/project',target:'/project'}]});
  assert.ok(args.includes('none'));assert.ok(args.includes('--read-only'));assert.ok(args.includes('no-new-privileges=true'));
  assert.ok(args.some(x=>x.includes('size=2147483648')));assert.ok(args.some(x=>x==='type=bind,src=/tmp/project,dst=/project,readonly'));
  assert.throws(()=>baselineSandboxArguments({name:'oops',imageId:'sha256:'+'a'.repeat(64),mounts:[]}),/SANDBOX_ID/);
});
