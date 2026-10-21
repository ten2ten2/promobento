import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../packages/contracts/index.mjs';
import { outputSafetyErrors } from './output-safety.mjs';
const subject={projectId:'project_1',operationId:'operation_1',revisionId:'revision_1',subjectKind:'candidate',
  subjectHash:'a'.repeat(64),targetId:'tiktok:portrait'};
const observation=(value,changes={})=>({subjectHash:value.subjectHash,targetId:value.targetId,representation:value.representation,
  textPresent:true,audioPresent:value.representation!=='text',evidenceRef:'observed_modalities_1',...changes});
const manifest=()=>({schemaVersion:'2.7.0',kind:'output_safety_coverage_manifest',subjectHash:subject.subjectHash,
  targetId:subject.targetId,representation:'trusted_media',samplingPolicyVersion:'sampling_1',textHashes:[digest('observed text')],
  frameCount:450,frames:[{frameIndex:0,sha256:digest('frame 0')},{frameIndex:449,sha256:digest('frame 449')}],
  durationMs:15000,audioSegments:[{startMs:0,endMs:15000,sha256:digest('full audio')}],runtimeStateHash:null,modalityObservationHash:digest(observation({...subject,representation:'trusted_media'}))});
const context=(coverageManifest=manifest())=>({policyVersion:'safety_1',representation:'trusted_media',
  requiredCoverage:['text','visual','audio'],nowMs:Date.parse('2026-10-21T01:00:00Z'),revokedResultIds:[],coverageManifest,
  coveragePolicy:{version:'sampling_1',frameCount:450,durationMs:15000,requiredFrameIndices:[0,449],modalityObservation:observation(coverageManifest)}});
const receipt=(coverageManifest=manifest())=>({schemaVersion:'2.7.0',kind:'output_safety_result',resultId:'safety_result_1',...subject,
  policyVersion:'safety_1',representation:'trusted_media',coverage:['text','visual','audio'],status:'allowed',
  checkedAt:'2026-10-21T00:00:00Z',evidenceRefs:['moderation_observation_1'],coverageManifestHash:digest(coverageManifest)});

test('output approval binds content, target, policy, representation and actual checked samples',()=>{
  assert.deepEqual(outputSafetyErrors(receipt(),subject,context()),[]);
  for (const key of ['projectId','operationId','revisionId','subjectHash','targetId'])
    assert.ok(outputSafetyErrors(receipt(),{...subject,[key]:'different'},context()).includes('OUTPUT_SAFETY_SCOPE_MISMATCH'));
  assert.ok(outputSafetyErrors(receipt(),subject,{...context(),representation:'verified_local_runtime'}).includes('OUTPUT_SAFETY_REPRESENTATION_MISMATCH'));
  assert.ok(outputSafetyErrors(receipt(),subject,{...context(),policyVersion:'safety_2'}).includes('OUTPUT_SAFETY_POLICY_CHANGED'));
  assert.ok(outputSafetyErrors({...receipt(),coverage:['visual']},subject,context()).includes('OUTPUT_SAFETY_COVERAGE_INCOMPLETE'));
  const changed=manifest();changed.frames[1].frameIndex=448;
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
  const coverage={...manifest(),targetId:null,representation:'text',frameCount:null,frames:[],durationMs:null,audioSegments:[]};
  coverage.modalityObservationHash=digest(observation(coverage));
  const result={...receipt(coverage),...text,representation:'text',coverage:['text']};
  const options={...context(coverage),representation:'text',requiredCoverage:['text'],coveragePolicy:{version:'sampling_1',modalityObservation:observation(coverage)}};
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
      durationMs:video?15000:null,audioSegments:[]};
    const observed=observation(coverage,{textPresent:false,audioPresent:false});
    coverage.modalityObservationHash=digest(observed);
    const result={...receipt(coverage),coverage:video?['text','visual','audio']:['text','visual']};
    const options={...context(coverage),requiredCoverage:result.coverage,coveragePolicy:{version:'sampling_1',
      frameCount:coverage.frameCount,durationMs:coverage.durationMs,requiredFrameIndices:video?[0,449]:[0],modalityObservation:observed}};
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
