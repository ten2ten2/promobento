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

test('generated source author alias binds to the exact trusted request and wrong licenses remain rejected',async()=>{
  const {bindGeneratedAudioPlan}=await import('../src/audio-binding.mjs');
  const {verifyAudioRights,generatedAudioRequestHash}=await import('../../renderer/src/creative-audio/index.mjs');
  const generated={id:'music',kind:'procedural_score',algorithmVersion:'huashu-audio-v1',seed:7,style:'pulse',bpm:112,root:60,sections:[{id:'open',frameIndex:0,energy:.5}],ending:'button'};
  const frozen={eventId:'music-event',kind:'music',sourceId:'music',frameStart:0,frameEndExclusive:450,sourceOffsetFrames:0,gainDb:-3,fadeInFrames:3,fadeOutFrames:15};
  const resources={resourceIds:['music'],generatedAudio:[generated],audioEvents:[frozen]},p={totalFrames:450,events:[{...frozen,licenseRef:'generated:music'}]};delete p.events[0].sourceId;
  const bound=bindGeneratedAudioPlan(p,resources,{totalFrames:450}),rights=verifyAudioRights([generated],450);
  assert.equal(bound.events[0].licenseRef,rights[0].licenseRef);assertAudioPlanResources(bound,resources);
  assert.throws(()=>assertAudioPlanResources({...bound,events:[{...bound.events[0],licenseRef:'invented-rights'}]},resources),/MISMATCH/);
  const abc={id:'music',kind:'abc_score',algorithmVersion:'huashu-audio-v1',seed:7,abc:'X:1\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\nC D E F|',marks:[]};
  assert.throws(()=>bindGeneratedAudioPlan(p,{...resources,generatedAudio:[abc]},{totalFrames:450}),/AUDIO_RIGHTS_REQUIRED/);
  const audioRights={schemaVersion:'2.7.0',kind:'admission_audio_rights',approvals:[{sourceId:'music',requestHash:generatedAudioRequestHash(abc,450),basis:'original_composition_reviewed',evidenceRef:'unit-test-only',reviewer:'operator',allowedUses:['process','mix','preview','export']}]};
  const approved=bindGeneratedAudioPlan(p,{...resources,generatedAudio:[abc]},{totalFrames:450,audioRights});
  assertAudioPlanResources(approved,{...resources,generatedAudio:[abc]},{audioRights});
  assert.throws(()=>bindGeneratedAudioPlan(p,{...resources,generatedAudio:[{...abc,seed:8}]},{totalFrames:450,audioRights}),/BINDING_MISMATCH/);
});

test('director saves resolved generated rights and refuses raw ABC without operator approval before rendering',async t=>{
  const {verifyAudioRights}=await import('../../renderer/src/creative-audio/index.mjs');
  const directory=mkdtempSync(join(tmpdir(),'generated-agent-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const input=project();input.audioMode='music';await initializeProject({directory,project:input});
  const generated={id:'music',kind:'abc_score',algorithmVersion:'huashu-audio-v1',seed:1,scoreId:'launch',marks:[]},rights=verifyAudioRights([generated],450)[0];
  const p=plan();p.audioPlan={totalFrames:450,events:[{...event(),licenseRef:'generated:music'}]};
  p.source.resources={schemaVersion:'2.7.0',kind:'admission_resources',resourceIds:['music'],generatedAudio:[generated],audioEvents:[{...event(),sourceId:'music'}]};
  await createWork({directory,projectId:input.id,config:config(),operationId:'generated',provider:provider({plans:[p]}),method:mockMethod,render:async args=>{
    assert.equal(args.audioRights,null);const result=await mockRender(args);result.report.capture.media={resourceManifest:{audioEvents:[{...event(),licenseRef:rights.licenseRef,sourceHash:'b'.repeat(64)}]}};return result;
  }});
  const stored=parseCanonicalJson(readFileSync(join(directory,'operations/generated/run.json')));
  assert.equal(stored.plans[0].audioPlan.events[0].licenseRef,rights.licenseRef);assert.equal(stored.outputStatus,'withheld');
  delete p.source.resources.generatedAudio[0].scoreId;p.source.resources.generatedAudio[0].abc='X:1\nK:C\nC D E F|';let rendered=0,calls=0;
  const api=provider({plans:[p]}),generate=api.generate;api.generate=async input=>{calls++;return generate(input);};
  await assert.rejects(createWork({directory,projectId:input.id,config:config(),operationId:'raw-unapproved',provider:api,method:mockMethod,render:async()=>{rendered++;}}),/AUDIO_RIGHTS_REQUIRED/);
  assert.equal(rendered,0);assert.equal(calls,1);
});
