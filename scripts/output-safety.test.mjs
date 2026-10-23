import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { digest, parseCanonicalJson, createSchemaValidator } from '../packages/contracts/index.mjs';
import { outputSafetyErrors, expectedSafetyCoverage, scopedSafetyCoveragePolicy } from './output-safety.mjs';
import { candidateSafetyErrors, candidateOutputIdentity } from './studio-contracts.mjs';
const subject={projectId:'project_1',operationId:'operation_1',revisionId:'revision_1',subjectKind:'candidate',
  subjectHash:'a'.repeat(64),targetId:'tiktok:portrait'};
const observation=(value,changes={})=>({subjectHash:value.subjectHash,targetId:value.targetId,representation:value.representation,
  textPresent:true,audioPresent:value.representation!=='text',evidenceRef:'observed_modalities_1',...changes});
const version='output-sampling-v1';
const sourceRange=()=>({kind:'video',sourceFrameCount:450,frameStart:0,frameEndExclusive:450});
const frames=(count=450)=>[...new Set([...Array.from({length:Math.ceil(count/30)},(_,i)=>i*30),count-1])]
  .map(frameIndex=>({frameIndex,sha256:digest('frame '+frameIndex)}));
const manifest=()=>({schemaVersion:'3.0.0',kind:'output_safety_coverage_manifest',subjectHash:subject.subjectHash,
  targetId:subject.targetId,representation:'trusted_media',samplingPolicyVersion:version,textHashes:[digest('observed text')],
  sourceRange:sourceRange(),frameCount:450,frames:frames(),
  durationMs:15000,audioSegments:[{startMs:0,endMs:15000,sha256:digest('full audio')}],runtimeStateHash:null,modalityObservationHash:digest(observation({...subject,representation:'trusted_media'}))});
const context=(coverageManifest=manifest())=>({policyVersion:'safety_1',representation:'trusted_media',
  requiredCoverage:['text','visual','audio'],nowMs:Date.parse('2026-10-21T01:00:00Z'),revokedResultIds:[],coverageManifest,
  coveragePolicy:{version,sourceRange:sourceRange(),frameCount:450,durationMs:15000,markerFrameIndices:[],modalityObservation:observation(coverageManifest)}});
const receipt=(coverageManifest=manifest())=>({schemaVersion:'3.0.0',kind:'output_safety_result',resultId:'safety_result_1',...subject,
  policyVersion:'safety_1',representation:'trusted_media',coverage:['text','visual','audio'],status:'allowed',
  checkedAt:'2026-10-21T00:00:00Z',evidenceRefs:['moderation_observation_1'],coverageManifestHash:digest(coverageManifest)});

test('output approval binds content, target, policy, representation and actual checked samples',()=>{
  assert.deepEqual(outputSafetyErrors(receipt(),subject,context()),[]);
  for (const key of ['projectId','operationId','revisionId','subjectHash','targetId'])
    assert.ok(outputSafetyErrors(receipt(),{...subject,[key]:'different'},context()).includes('OUTPUT_SAFETY_SCOPE_MISMATCH'));
  assert.ok(outputSafetyErrors(receipt(),subject,{...context(),representation:'verified_local_runtime'}).includes('OUTPUT_SAFETY_REPRESENTATION_MISMATCH'));
  assert.ok(outputSafetyErrors(receipt(),subject,{...context(),policyVersion:'safety_2'}).includes('OUTPUT_SAFETY_POLICY_CHANGED'));
  assert.ok(outputSafetyErrors({...receipt(),coverage:['visual']},subject,context()).includes('OUTPUT_SAFETY_COVERAGE_INCOMPLETE'));
  const changed=manifest();changed.frames.at(-1).frameIndex=448;
  assert.ok(outputSafetyErrors(receipt(),subject,context(changed)).includes('OUTPUT_SAFETY_COVERAGE_MANIFEST_MISMATCH'));
  assert.ok(outputSafetyErrors(receipt(changed),subject,context(changed)).includes('OUTPUT_SAFETY_FRAME_COVERAGE_INCOMPLETE'));
  const gap=manifest();gap.audioSegments[0].startMs=1;
  assert.ok(outputSafetyErrors(receipt(gap),subject,context(gap)).includes('OUTPUT_SAFETY_AUDIO_COVERAGE_INCOMPLETE'));
  assert.ok(outputSafetyErrors(receipt(),subject,{...context(),coverageManifest:undefined}).includes('OUTPUT_SAFETY_COVERAGE_MANIFEST_REQUIRED'));
});

test('unknown revocation state and non-allowed outputs cannot pass through quality waivers',()=>{
  for (const status of ['pending','review_required','blocked','unavailable'])
    assert.ok(outputSafetyErrors({...receipt(),status},subject,{...context(),qualityWaiver:true}).includes('OUTPUT_SAFETY_'+status.toUpperCase()));
  assert.deepEqual(outputSafetyErrors(null,subject,context()),['OUTPUT_SAFETY_REQUIRED']);
  assert.ok(outputSafetyErrors(receipt(),subject,{...context(),revokedResultIds:undefined}).includes('OUTPUT_SAFETY_REVOCATION_STATE_REQUIRED'));
  assert.ok(outputSafetyErrors(receipt(),subject,{...context(),revokedResultIds:['safety_result_1']}).includes('OUTPUT_SAFETY_REVOKED'));
  assert.ok(outputSafetyErrors({...receipt(),evidenceRefs:[]},subject,context()).includes('OUTPUT_SAFETY_EVIDENCE_REQUIRED'));
  assert.ok(outputSafetyErrors({...receipt(),exampleOnly:true},subject,context()).includes('OUTPUT_SAFETY_EXAMPLE_EVIDENCE_FORBIDDEN'));
});

test('text review needs no fabricated frame ranges and stays bound to exact text bytes',()=>{
  const text={...subject,revisionId:null,subjectKind:'creative_plan',targetId:null};
  const coverage={...manifest(),targetId:null,representation:'text',sourceRange:null,frameCount:null,frames:[],durationMs:null,audioSegments:[]};
  coverage.modalityObservationHash=digest(observation(coverage));
  const result={...receipt(coverage),...text,representation:'text',coverage:['text']};
  const options={...context(coverage),representation:'text',requiredCoverage:['text'],coveragePolicy:{version,modalityObservation:observation(coverage)}};
  assert.deepEqual(outputSafetyErrors(result,text,options),[]);
  assert.ok(outputSafetyErrors(result,text,{...options,nowMs:0}).length);
});

test('unchanged content can reuse evidence through an explicit current-revision association',()=>{
  const current={...subject,operationId:'operation_2',revisionId:'revision_2'};
  const old={...receipt(),checkedAt:'2026-01-01T00:00:00Z'};
  assert.ok(outputSafetyErrors(old,current,context()).includes('OUTPUT_SAFETY_SCOPE_MISMATCH'));
  const options={...context(),association:{resultId:old.resultId,...current}};
  assert.deepEqual(outputSafetyErrors(old,current,options),[]);
  assert.ok(outputSafetyErrors(old,{...current,subjectHash:digest('changed')},options).includes('OUTPUT_SAFETY_SCOPE_MISMATCH'));
  assert.ok(outputSafetyErrors(old,current,{...options,revokedResultIds:[old.resultId]}).includes('OUTPUT_SAFETY_REVOKED'));
});

test('observed absence of text or audio permits graphics and silent video without invented samples',()=>{
  for (const video of [false,true]) {
    const coverage={...manifest(),textHashes:[],frameCount:video?450:1,frames:video?manifest().frames:[manifest().frames[0]],
      sourceRange:video?sourceRange():{...sourceRange(),kind:'image',frameEndExclusive:1},durationMs:video?15000:null,audioSegments:[]};
    const observed=observation(coverage,{textPresent:false,audioPresent:false});
    coverage.modalityObservationHash=digest(observed);
    const result={...receipt(coverage),coverage:video?['text','visual','audio']:['text','visual']};
    const options={...context(coverage),requiredCoverage:result.coverage,coveragePolicy:{version,sourceRange:coverage.sourceRange,
      frameCount:coverage.frameCount,durationMs:coverage.durationMs,markerFrameIndices:[],modalityObservation:observed}};
    assert.deepEqual(outputSafetyErrors(result,subject,options),[]);
    assert.ok(outputSafetyErrors(result,subject,{...options,coveragePolicy:{...options.coveragePolicy,modalityObservation:undefined}})
      .includes('OUTPUT_SAFETY_MODALITY_OBSERVATION_REQUIRED'));
    const forged={...observed,subjectHash:digest('different content')};
    assert.ok(outputSafetyErrors(result,subject,{...options,coveragePolicy:{...options.coveragePolicy,modalityObservation:forged}})
      .includes('OUTPUT_SAFETY_MODALITY_OBSERVATION_MISMATCH'));
  }
});

test('missing samples remain blocked when trusted observations show text or audio is present',()=>{
  const coverage={...manifest(),textHashes:[],audioSegments:[]};
  const result=receipt(coverage),options=context(coverage);
  const errors=outputSafetyErrors(result,subject,options);
  assert.ok(errors.includes('OUTPUT_SAFETY_TEXT_COVERAGE_INCOMPLETE'));
  assert.ok(errors.includes('OUTPUT_SAFETY_AUDIO_COVERAGE_INCOMPLETE'));
  const unboundAbsence={...options,coveragePolicy:{...options.coveragePolicy,
    modalityObservation:observation(coverage,{textPresent:false,audioPresent:false})}};
  assert.ok(outputSafetyErrors(result,subject,unboundAbsence).includes('OUTPUT_SAFETY_MODALITY_OBSERVATION_MISMATCH'));
});

function localRuntimeCase() {
  const coverage={...manifest(),representation:'verified_local_runtime',runtimeStateHash:digest('observed runtime')};
  const observed=observation(coverage);
  coverage.modalityObservationHash=digest(observed);
  const result={...receipt(coverage),representation:coverage.representation};
  const options={...context(coverage),representation:coverage.representation};
  options.coveragePolicy.modalityObservation=observed;
  options.coveragePolicy.runtimeStateHash=coverage.runtimeStateHash;
  return {coverage,result,options};
}

test('local runtime requires the full trusted length and the same minimum visual coverage as media',()=>{
  assert.deepEqual((x=>outputSafetyErrors(x.result,subject,x.options))(localRuntimeCase()),[]);
  for (const [mutate,code] of [
    [x=>{x.coverage.frameCount=30;x.coverage.durationMs=1000;x.coverage.frames=[];x.coverage.audioSegments[0].endMs=1000;},'OUTPUT_SAFETY_MEDIA_LENGTH_MISMATCH'],
    [x=>{x.coverage.frames=[];},'OUTPUT_SAFETY_FRAME_COVERAGE_INCOMPLETE'],
    [x=>{x.coverage.frames=x.coverage.frames.filter(frame=>frame.frameIndex!==30);},'OUTPUT_SAFETY_FRAME_COVERAGE_INCOMPLETE'],
    [x=>{x.options.coveragePolicy.sourceRange.frameEndExclusive=30;},'OUTPUT_SAFETY_SOURCE_RANGE_INVALID'],
    [x=>{x.coverage.sourceRange.frameStart=1;},'OUTPUT_SAFETY_SOURCE_RANGE_MISMATCH']
  ]) {
    const x=localRuntimeCase();mutate(x);x.result.coverageManifestHash=digest(x.coverage);
    assert.ok(outputSafetyErrors(x.result,subject,x.options).includes(code));
  }
});

test('candidate admission cannot reuse a runtime receipt that covers only the first second',()=>{
  const candidate={projectId:subject.projectId,candidateRevisionId:subject.revisionId,affectedTargetIds:[subject.targetId],
    agentInterpretation:'Introduce the product',impactSummary:'Changed the product introduction'};
  const contentHash=digest('trusted candidate content');
  const x=localRuntimeCase(),identity=digest(candidateOutputIdentity(candidate,subject.targetId,contentHash));
  x.coverage.subjectHash=identity;x.result.subjectHash=identity;x.options.coveragePolicy.modalityObservation.subjectHash=identity;
  x.coverage.modalityObservationHash=digest(x.options.coveragePolicy.modalityObservation);
  x.result.coverageManifestHash=digest(x.coverage);
  const trusted={workspaceId:'workspace_1',projectId:subject.projectId,operationId:subject.operationId,candidateContentHashes:{[subject.targetId]:contentHash},
    candidateSafetyChecks:{[subject.targetId]:{receipt:x.result,options:x.options}},revisions:{[candidate.candidateRevisionId]:{
      workspaceId:'workspace_1',projectId:subject.projectId,targetIds:[subject.targetId],totalFrames:450,
      runtimeDeclarationsByTarget:{[subject.targetId]:{schemaVersion:'3.0.0',kind:'runtime_declarations',
        editables:[],markers:[],regions:[],videoUses:[],fonts:[]}}}}};
  assert.deepEqual(candidateSafetyErrors(candidate,trusted),[]);
  x.coverage.frameCount=30;x.coverage.durationMs=1000;x.coverage.frames=[];x.coverage.audioSegments[0].endMs=1000;
  x.result.coverageManifestHash=digest(x.coverage);
  assert.ok(candidateSafetyErrors(candidate,trusted).includes('OUTPUT_SAFETY_MEDIA_LENGTH_MISMATCH'));
});

test('registered policy supplies minimum frames and caller requirements can only add coverage',()=>{
  const coverage=manifest(),options=context(coverage);
  options.coveragePolicy.requiredFrameIndices=[0];
  options.coveragePolicy.maxFrameGap=900;
  coverage.frames=[coverage.frames[0]];
  assert.ok(outputSafetyErrors(receipt(coverage),subject,options).includes('OUTPUT_SAFETY_FRAME_COVERAGE_INCOMPLETE'));
  assert.ok(outputSafetyErrors(receipt(coverage),subject,{...options,requiredCoverage:['text']}).includes('OUTPUT_SAFETY_FRAME_COVERAGE_INCOMPLETE'));
  coverage.frames=frames();options.coveragePolicy.requiredFrameIndices=[17];
  assert.ok(outputSafetyErrors(receipt(coverage),subject,options).includes('OUTPUT_SAFETY_FRAME_COVERAGE_INCOMPLETE'));
  coverage.frames.push({frameIndex:17,sha256:digest('frame 17')});coverage.frames.sort((a,b)=>a.frameIndex-b.frameIndex);
  assert.deepEqual(outputSafetyErrors(receipt(coverage),subject,options),[]);
});

test('unknown sampling versions cannot approve media or text',()=>{
  const coverage=manifest(),options=context(coverage);
  coverage.samplingPolicyVersion='unregistered';options.coveragePolicy.version='unregistered';
  assert.ok(outputSafetyErrors(receipt(coverage),subject,options).includes('OUTPUT_SAFETY_SAMPLING_POLICY_REQUIRED'));
  assert.throws(()=>expectedSafetyCoverage({version:'unregistered'},'text'),/OUTPUT_SAFETY_SAMPLING_POLICY_REQUIRED/);
});

test('trusted marker lists are explicit, unique, in range and part of the minimum sample set',()=>{
  for (const markers of [undefined,[5,5],[-1],[450],[0.5]]) {
    const coverage=manifest(),options=context(coverage);
    if (markers===undefined) delete options.coveragePolicy.markerFrameIndices;
    else options.coveragePolicy.markerFrameIndices=markers;
    assert.ok(outputSafetyErrors(receipt(coverage),subject,options).includes('OUTPUT_SAFETY_SAMPLING_INPUT_INVALID'));
  }
  const coverage=manifest(),options=context(coverage);options.coveragePolicy.markerFrameIndices=[17];
  assert.ok(outputSafetyErrors(receipt(coverage),subject,options).includes('OUTPUT_SAFETY_FRAME_COVERAGE_INCOMPLETE'));
  coverage.frames.push({frameIndex:17,sha256:digest('scene change')});coverage.frames.sort((a,b)=>a.frameIndex-b.frameIndex);
  assert.deepEqual(outputSafetyErrors(receipt(coverage),subject,options),[]);
});

test('a screenshot and a short clip bind their source interval and use output-relative sample indices',()=>{
  for (const [kind,start,end] of [['image',123,124],['video',123,155],['video',0,900]]) {
    const range={kind,sourceFrameCount:900,frameStart:start,frameEndExclusive:end};
    const policy={version,sourceRange:range,markerFrameIndices:[0,130,899]};
    const expected=expectedSafetyCoverage(policy,'trusted_media');
    const coverage={...manifest(),sourceRange:range,frameCount:expected.frameCount,durationMs:expected.durationMs,
      frames:expected.requiredFrameIndices.map(frameIndex=>({frameIndex,sha256:digest('frame '+frameIndex)})),
      audioSegments:kind==='image'?[]:[{startMs:0,endMs:expected.durationMs,sha256:digest('clip audio')}]};
    const observed=observation(coverage,{audioPresent:kind!=='image'});coverage.modalityObservationHash=digest(observed);
    const options={...context(coverage),coveragePolicy:{...policy,frameCount:expected.frameCount,durationMs:expected.durationMs,modalityObservation:observed}};
    assert.deepEqual(outputSafetyErrors(receipt(coverage),subject,options),[]);
    if (kind==='video' && start===123) {
      assert.deepEqual(expected.requiredFrameIndices,[0,7,30,31]);
      assert.equal(expected.durationMs,1067);
    }
    options.coveragePolicy={...options.coveragePolicy,sourceRange:{...range,frameStart:range.frameStart+1}};
    assert.ok(outputSafetyErrors(receipt(coverage),subject,options).length);
  }
});

test('coverage arrays have matching schema limits and reject excessive length before inspecting items',()=>{
  const config=parseCanonicalJson(readFileSync(new URL('../config/output-safety-sampling.json',import.meta.url)));
  const schema=parseCanonicalJson(readFileSync(new URL('../contracts/production.schema.json',import.meta.url)));
  const validate=createSchemaValidator(schema),defs=schema.$defs;
  for (const [key,maximum,definition] of [['evidenceRefs',config.limits.maxEvidenceRefs,defs.outputSafetyResult],
    ['textHashes',config.limits.maxTextHashes,defs.outputSafetyCoverageManifest],
    ['audioSegments',config.limits.maxAudioSegments,defs.outputSafetyCoverageManifest],
    ['frames',config.limits.maxFrames,defs.outputSafetyCoverageManifest]]) {
    assert.equal(definition.properties[key].maxItems,maximum);
    const coverage=manifest(),result=receipt(coverage),options=context(coverage);
    const value=new Array(maximum+1);
    Object.defineProperty(value,0,{enumerable:true,get(){throw Error('oversized array was traversed');}});
    (key==='evidenceRefs'?result:coverage)[key]=value;
    assert.deepEqual(outputSafetyErrors(result,subject,options),['OUTPUT_SAFETY_INPUT_TOO_LARGE']);
    const plain=Array(maximum+1).fill(key==='evidenceRefs'?'evidence_1':key==='textHashes'?'a'.repeat(64)
      :key==='frames'?{frameIndex:0,sha256:'a'.repeat(64)}:{startMs:0,endMs:1,sha256:'a'.repeat(64)});
    const field={...definition.properties[key],uniqueItems:false};
    assert.ok(validate(plain,field).some(error=>error.includes('must NOT have more than')));
  }
  const coverage=manifest();coverage.unexpected=Array(200000).fill('x');
  assert.deepEqual(outputSafetyErrors(receipt(),subject,context(coverage)),['OUTPUT_SAFETY_INPUT_TOO_LARGE']);
});

test('source projection overrides receipt-supplied dimensions and markers using trusted declarations',()=>{
  const policy={version,sourceRange:{kind:'video',sourceFrameCount:450,frameStart:0,frameEndExclusive:30},
    frameCount:30,durationMs:1000,markerFrameIndices:[]};
  const declarations={schemaVersion:'3.0.0',kind:'runtime_declarations',markers:[{frame:17},{frame:17},{frame:899}]};
  const derived=scopedSafetyCoveragePolicy(policy,{totalFrames:900,runtimeDeclarations:declarations});
  assert.deepEqual(derived.sourceRange,{kind:'video',sourceFrameCount:900,frameStart:0,frameEndExclusive:900});
  assert.equal(derived.frameCount,900);assert.equal(derived.durationMs,30000);
  assert.deepEqual(derived.markerFrameIndices,[17,899]);
  assert.deepEqual(policy.markerFrameIndices,[]);
  assert.throws(()=>scopedSafetyCoveragePolicy(policy,{totalFrames:900}),/OUTPUT_SAFETY_SOURCE_DECLARATIONS_REQUIRED/);
  assert.throws(()=>scopedSafetyCoveragePolicy(policy,{totalFrames:30,runtimeDeclarations:declarations}),/OUTPUT_SAFETY_SOURCE_LENGTH_INVALID/);
  assert.throws(()=>scopedSafetyCoveragePolicy(policy,{totalFrames:450,runtimeDeclarations:declarations}),/OUTPUT_SAFETY_SAMPLING_INPUT_INVALID/);
});
