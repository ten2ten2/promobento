import test from 'node:test';
import assert from 'node:assert/strict';
import {validate as validScript} from '@promobento/contracts/validators/native-script';
import {validate as validSelection} from '@promobento/contracts/validators/material-selection';
import {validate as validReference} from '@promobento/contracts/validators/reference-analysis';
import {assertReferenceAnalysis, assertNativeScript, assertScriptProjection, assertMaterialSelection,
  assertLockedMaterialSelection, scriptChangeImpact, applyScriptTextEdits} from './production-documents.mjs';

const hash = char => char.repeat(64);
const materials = [{resourceId:'product', sha256:hash('a')}, {resourceId:'music', sha256:hash('b')}];
const context = {durationSeconds:15,videoLanguage:'en',facts:[{id:'fact-a'}],cta:'Try PromoBento',materials};
const script = () => ({schemaVersion:'3.0.0',kind:'native_script',videoLanguage:'en',durationFrames:450,
  segments:[
    {id:'title-1',role:'title',displayText:'One clear promise',speechText:null,factIds:['fact-a'],startFrame:0,endFrame:90,timing:{kind:'authored'}},
    {id:'cta-1',role:'cta',displayText:'Try PromoBento today',speechText:null,factIds:[],startFrame:300,endFrame:450,timing:{kind:'authored'}}],
  moments:[
    {id:'hook-1',kind:'hook',startFrame:0,endFrame:90,segmentIds:['title-1'],resourceIds:['product'],timing:{kind:'authored'}},
    {id:'action-1',kind:'cta',startFrame:300,endFrame:450,segmentIds:['cta-1'],resourceIds:[],timing:{kind:'authored'}}]
});
const selection = () => ({schemaVersion:'3.0.0',kind:'material_selection',uses:[
  {beatId:'hero',role:'product_demo',selectedResourceId:'product',alternativeResourceIds:[],reason:'Use the actual UI.',locked:true},
  {beatId:'hero',role:'audio',selectedResourceId:'music',alternativeResourceIds:[],reason:'Use the licensed audio.',locked:true}
]});
const treatment = {beats:[{id:'hero',assetIds:['product','music'],startFrame:0,endFrame:450}]};

test('the authoritative Script validates copy, facts, target frames, and editable source projection',()=>{
  const doc=script();
  assert.equal(validScript(doc),true);
  assert.equal(assertNativeScript(doc,context),doc);
  assert.equal(assertScriptProjection([{path:'index.html',content:'<h1>One clear promise</h1><p>Try PromoBento today</p>'}],doc),true);
  assert.throws(()=>assertScriptProjection([{path:'index.html',content:'<h1>One clear promise</h1>'}],doc),/SCRIPT_SOURCE_PROJECTION_MISSING/);
  assert.throws(()=>assertNativeScript({...doc,durationFrames:900},context),/SCRIPT_SCOPE_INVALID/);
  assert.throws(()=>assertNativeScript({...doc,segments:[doc.segments[0],doc.segments[0]]},context),/SCRIPT_SCOPE_INVALID/);
  assert.throws(()=>assertNativeScript({...doc,segments:[doc.segments[0],{...doc.segments[1],displayText:'Different action'}]},context),/SCRIPT_CTA_MISSING/);
  assert.throws(()=>assertNativeScript({...doc,moments:[{...doc.moments[0],resourceIds:['reference-only']}]},context),/SCRIPT_MOMENT_INVALID/);
  assert.throws(()=>assertNativeScript({...doc,segments:[{...doc.segments[0],factIds:['invented']},doc.segments[1]]},context),/SCRIPT_SEGMENT_INVALID/);
});

test('measured word clocks require same-source evidence, and edits invalidate timing and QA',()=>{
  const before=script();
  const aligned=structuredClone(before),measure={kind:'measured',sourceSha256:hash('c'),firstWord:0,lastWord:0};
  aligned.segments[0].timing=measure;
  aligned.segments[0].startFrame=30;aligned.segments[0].endFrame=60;
  assert.equal(assertNativeScript(aligned,{...context,timingEvidence:[{sourceSha256:hash('c'),words:[{start:1,end:2}]}]}),aligned);
  assert.throws(()=>assertNativeScript(aligned,context),/SCRIPT_ALIGNMENT_INVALID/);
  assert.throws(()=>assertNativeScript({...aligned,segments:[{...aligned.segments[0],endFrame:80},aligned.segments[1]]},
    {...context,timingEvidence:[{sourceSha256:hash('c'),words:[{start:1,end:2}]}]}),/SCRIPT_ALIGNMENT_INVALID/);
  const changed=applyScriptTextEdits(before,[{segmentId:'title-1',field:'displayText',value:'A better promise'}]);
  assert.equal(changed.segments[0].timing.kind,'authored');
  assert.equal(changed.moments[0].timing.kind,'authored');
  assert.equal(before.segments[0].displayText,'One clear promise');
  assert.throws(()=>applyScriptTextEdits(before,[{segmentId:'cta-1',field:'speechText',value:'Nope'}]),/SCRIPT_EDITS_INVALID/);
  assert.throws(()=>applyScriptTextEdits(before,[{segmentId:'cta-1',field:'displayText',value:'Try PromoBento today'}]),/SCRIPT_EDITS_NO_CHANGE/);
  const locked=assertMaterialSelection(selection(),treatment,materials);
  const impact=scriptChangeImpact(before,changed,['landscape','portrait'],locked);
  assert.deepEqual(impact.segmentIds,['title-1']);
  assert.deepEqual(impact.momentIds,['hook-1']);
  assert.deepEqual(impact.affectedAspects,['landscape','portrait']);
  assert.deepEqual(impact.affectedAssetLocks,[]);
  assert.equal(impact.qualityReportsReusable,false);
  assert.equal(scriptChangeImpact(before,before,['landscape'],locked).qualityReportsReusable,true);
  const removed=structuredClone(before);removed.segments.shift();removed.moments.shift();
  assert.deepEqual(scriptChangeImpact(before,removed,['landscape'],locked).segmentIds,['title-1']);
});

test('each Treatment use locks source SHA and alternatives without accepting substitutions',()=>{
  const proposal=selection();
  assert.equal(validSelection(proposal),true);
  const locked=assertMaterialSelection(proposal,treatment,materials);
  assert.equal(locked.kind,'locked_materials');
  assert.equal(assertLockedMaterialSelection(locked,materials),locked);
  assert.throws(()=>assertMaterialSelection({...proposal,uses:proposal.uses.slice(1)},treatment,materials),/MATERIAL_SELECTION_MISMATCH/);
  assert.throws(()=>assertMaterialSelection({...proposal,uses:[proposal.uses[0],proposal.uses[0]]},treatment,materials),/MATERIAL_SELECTION_MISMATCH/);
  assert.throws(()=>assertMaterialSelection(proposal,treatment,[...materials,{...materials[0],sha256:hash('c')}]),/MATERIAL_SELECTION_SOURCE_AMBIGUOUS/);
  const tampered=structuredClone(locked);tampered.uses[0].sha256=hash('c');
  assert.throws(()=>assertLockedMaterialSelection(tampered,materials),/MATERIAL_LOCK_IDENTITY_INVALID/);
  assert.throws(()=>assertLockedMaterialSelection(locked,[{...materials[0],sha256:hash('c')},materials[1]]),/MATERIAL_LOCK_IDENTITY_INVALID/);
});

test('reference observations cite verified sampled frames, never invent audio or off-sample scenes',()=>{
  const evidence={resourceId:'reference-1',sourceSha256:hash('d'),sourceFrameCount:450,sampledFrames:[0,90,180,270,449]};
  const observation={schemaVersion:'3.0.0',kind:'reference_analysis',resourceId:'reference-1',sourceSha256:evidence.sourceSha256,
    sourceFrameCount:450,sampledFrames:evidence.sampledFrames,audioStatus:'not_analyzed',
    summary:{hook:'A reveal.',progression:'Two steps.',payoff:'Final CTA.',visualSystem:'Type and product.',limitations:'Intervals unseen and audio unexamined.'},
    moments:[{id:'m-1',startFrame:0,endFrame:100,evidenceFrames:[0,90],visible:'Product appears.',interpretation:null,visibleText:['Product']}],
    relationships:[]};
  assert.equal(validReference(observation),true);
  assert.equal(assertReferenceAnalysis(observation,evidence),observation);
  assert.throws(()=>assertReferenceAnalysis({...observation,audioStatus:'transcribed'},evidence),/REFERENCE_ANALYSIS_SCOPE_INVALID/);
  assert.throws(()=>assertReferenceAnalysis({...observation,moments:[{...observation.moments[0],evidenceFrames:[99]}]},evidence),/REFERENCE_ANALYSIS_EVIDENCE_INVALID/);
  assert.throws(()=>assertReferenceAnalysis({...observation,relationships:[{fromMomentId:'m-1',toMomentId:'missing',description:'Impossible',evidenceFrames:[0]}]},evidence),/REFERENCE_ANALYSIS_RELATION_INVALID/);
});
