import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseCanonicalJson} from '../../../packages/contracts/index.mjs';
import {assertAudioPlanResources,assertAudioPlanFrozen} from '../src/audio-binding.mjs';
import {initializeProject,createWork} from '../src/runner.mjs';
import {project,config,plan,provider,mockMethod,mockRender} from './fixtures.mjs';
const event=()=>({eventId:'score',kind:'music',frameStart:0,frameEndExclusive:450,sourceOffsetFrames:0,gainDb:0,fadeInFrames:0,fadeOutFrames:0});
const audioPlan=()=>({totalFrames:450,events:[{...event(),licenseRef:'rights_m0a_procedural_audio_cc0'}]});
const resources=()=>({schemaVersion:'2.7.0',kind:'admission_resources',resourceIds:['original-score'],audioEvents:[{...event(),sourceId:'original-score'}]});
test('AudioPlan binds catalog license, all audio fields and additive automation including omitted-flat semantics',()=>{
  const p=audioPlan(),r=resources();assert.doesNotThrow(()=>assertAudioPlanResources(p,r));
  p.events[0].gainAutomation=[{frameOffset:0,gainDb:0},{frameOffset:450,gainDb:0}];assert.doesNotThrow(()=>assertAudioPlanResources(p,r));
  p.events[0].gainAutomation[0].gainDb=-96;assert.throws(()=>assertAudioPlanResources(p,r),/AUDIO_PLAN_MISMATCH/);
  r.audioEvents[0].gainAutomation=p.events[0].gainAutomation;assert.doesNotThrow(()=>assertAudioPlanResources(p,r));
  p.events[0].licenseRef='wrong-license';assert.throws(()=>assertAudioPlanResources(p,r),/AUDIO_PLAN_MISMATCH/);
  p.events[0].licenseRef='rights_m0a_procedural_audio_cc0';r.audioEvents[0].sourceOffsetFrames=1;
  assert.throws(()=>assertAudioPlanResources(p,r),/AUDIO_PLAN_MISMATCH/);
});
test('optional AudioPlan sourceHash must match the actual frozen source, not a model claim',()=>{
  const p=audioPlan(),frozen=[{...p.events[0],sourceHash:'a'.repeat(64)}];
  assert.doesNotThrow(()=>assertAudioPlanFrozen(p,frozen));p.events[0].sourceHash='b'.repeat(64);
  assert.throws(()=>assertAudioPlanFrozen(p,frozen),/AUDIO_PLAN_SOURCE_MISMATCH/);
  p.events[0].sourceHash='a'.repeat(64);assert.doesNotThrow(()=>assertAudioPlanFrozen(p,frozen));
  frozen[0].gainAutomation=[{frameOffset:0,gainDb:-96},{frameOffset:450,gainDb:-96}];assert.throws(()=>assertAudioPlanFrozen(p,frozen),/SOURCE_MISMATCH/);
});
test('workflow rejects a fabricated AudioPlan source hash after actual renderer evidence, retaining fees and withheld state',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'audio-binding-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const input=project();input.audioMode='music';input.rights=[{resourceId:'original-score',evidenceRef:'mock permission',confirmedBy:'unit-test',confirmedAt:'2026-01-01T00:00:00Z'}];
  const p=plan();p.audioPlan=audioPlan();p.audioPlan.events[0].sourceHash='a'.repeat(64);p.source.resources=resources();
  await initializeProject({directory,project:input});let rendered=0;
  await assert.rejects(createWork({directory,projectId:input.id,config:config(),operationId:'audio',provider:provider({plans:[p]}),method:mockMethod,
    render:async()=>{rendered++;const result=await mockRender();result.report.capture.media={resourceManifest:{audioEvents:[{...audioPlan().events[0],sourceHash:'b'.repeat(64)}]}};return result;}}),/AUDIO_PLAN_SOURCE_MISMATCH/);
  const operation=parseCanonicalJson(readFileSync(join(directory,'operations/audio/run.json')));
  assert.equal(rendered,3);assert.equal(operation.outputStatus,'withheld');assert.equal(operation.usage.costMicros,360);assert.equal(operation.candidates.length,0);
});
