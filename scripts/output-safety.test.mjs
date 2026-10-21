import assert from 'node:assert/strict';
import test from 'node:test';
import { outputSafetyErrors } from './output-safety.mjs';
const subject={projectId:'project_1',operationId:'operation_1',revisionId:'revision_1',subjectKind:'candidate',subjectHash:'a'.repeat(64)};
const context={policyVersion:'safety_1',representation:'trusted_media',requiredCoverage:['text','visual','audio'],nowMs:Date.parse('2026-10-21T01:00:00Z')};
const receipt=()=>({schemaVersion:'2.7.0',kind:'output_safety_result',resultId:'safety_result_1',...subject,
  policyVersion:'safety_1',representation:'trusted_media',coverage:['text','visual','audio'],status:'allowed',
  checkedAt:'2026-10-21T00:00:00Z',evidenceRefs:['moderation_observation_1']});

test('output approval is bound to actual content, policy, media representation and coverage',()=>{
  assert.deepEqual(outputSafetyErrors(receipt(),subject,context),[]);
  for (const key of ['projectId','operationId','revisionId','subjectHash'])
    assert.ok(outputSafetyErrors(receipt(),{...subject,[key]:'different'},context).includes('OUTPUT_SAFETY_SCOPE_MISMATCH'));
  assert.ok(outputSafetyErrors(receipt(),subject,{...context,representation:'verified_local_runtime'}).includes('OUTPUT_SAFETY_REPRESENTATION_MISMATCH'));
  assert.ok(outputSafetyErrors(receipt(),subject,{...context,policyVersion:'safety_2'}).includes('OUTPUT_SAFETY_POLICY_CHANGED'));
  assert.ok(outputSafetyErrors({...receipt(),coverage:['visual']},subject,context).includes('OUTPUT_SAFETY_COVERAGE_INCOMPLETE'));
});

test('pending, review, blocked and unavailable outputs remain withheld independently of quality waivers',()=>{
  for (const status of ['pending','review_required','blocked','unavailable'])
    assert.ok(outputSafetyErrors({...receipt(),status},subject,{...context,qualityWaiver:true}).includes('OUTPUT_SAFETY_'+status.toUpperCase()));
  assert.deepEqual(outputSafetyErrors(null,subject,context),['OUTPUT_SAFETY_REQUIRED']);
  assert.ok(outputSafetyErrors(receipt(),subject,{...context,revokedResultIds:['safety_result_1']}).includes('OUTPUT_SAFETY_REVOKED'));
  assert.ok(outputSafetyErrors({...receipt(),evidenceRefs:[]},subject,context).includes('OUTPUT_SAFETY_EVIDENCE_REQUIRED'));
  assert.ok(outputSafetyErrors({...receipt(),exampleOnly:true},subject,context).includes('OUTPUT_SAFETY_EXAMPLE_EVIDENCE_FORBIDDEN'));
});

test('a direction card can be reviewed before a revision exists without fabricated frame ranges',()=>{
  const text={...subject,revisionId:null,subjectKind:'direction'};
  const result={...receipt(),...text,representation:'text',coverage:['text']};
  assert.deepEqual(outputSafetyErrors(result,text,{...context,representation:'text',requiredCoverage:['text']}),[]);
  assert.ok(outputSafetyErrors(result,text,{...context,nowMs:0}).length);
});
