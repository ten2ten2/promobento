import test from 'node:test';
import assert from 'node:assert/strict';
import {digest} from '@promobento/contracts/digest';
import {validate as validScript} from '@promobento/contracts/validators/native-script';
import {validate as validSelection} from '@promobento/contracts/validators/material-selection';
import {validate as validReference} from '@promobento/contracts/validators/reference-analysis';
import {assertReferenceAnalysis, assertNativeScript, assertScriptProjection, assertMaterialSelection,
  assertLockedMaterialSelection, scriptChangeImpact, applyScriptTextEdits,replaceLockedMaterials,
  projectMaterialSources,assertMaterialProjection} from './production-documents.mjs';

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
  assert.equal(assertScriptProjection([{path:'index.html',content:'<script src="index.js"></script>'},
    {path:'index.js',content:'renderTitle("One clear promise"); renderCTA("Try PromoBento today");'}],doc),true);
  assert.throws(()=>assertScriptProjection([{path:'index.html',content:'<h1>One clear promise</h1>'}],doc),/SCRIPT_SOURCE_PROJECTION_MISSING/);
  const escaped=structuredClone(doc);
  escaped.segments[0].displayText='One & only <promise>';
  assert.equal(assertScriptProjection([{path:'index.html',content:'<h1>One &amp; only &lt;promise&gt;</h1><p>Try PromoBento today</p>'}],escaped),true);
  escaped.segments[0].displayText='Try "Pro" \\ today';
  assert.equal(assertScriptProjection([{path:'index.html',content:'<script src="index.js"></script>'},
    {path:'index.js',content:'title.textContent = '+JSON.stringify(escaped.segments[0].displayText)+'; cta.textContent = "Try PromoBento today";'}],escaped),true);
  assert.equal(assertScriptProjection([{path:'index.html',content:'<script src="index.js"></script>'},
    {path:'index.js',content:'title.textContent = "Try \\u0022Pro\\u0022 \\\\ today"; cta.textContent = "Try PromoBento today";'}],escaped),true);
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
  const measured=structuredClone(before);
  measured.segments.push({id:'narration-1',role:'narration',displayText:'Voice over',speechText:'Product costs nine dollars',
    factIds:[],startFrame:30,endFrame:90,timing:{kind:'measured',sourceSha256:hash('c'),firstWord:0,lastWord:3}});
  const spokenEvidence=[{sourceSha256:hash('c'),words:[{text:'Product',start:1,end:1.25},{text:'costs',start:1.25,end:1.5},
    {text:'nine',start:1.5,end:2},{text:'dollars',start:2,end:3}]}];
  assert.equal(assertNativeScript(measured,{...context,timingEvidence:spokenEvidence}),measured);
  const unrelated=structuredClone(measured);unrelated.segments.at(-1).speechText='Goodbye forever';
  assert.throws(()=>assertNativeScript(unrelated,{...context,timingEvidence:spokenEvidence}),/SCRIPT_ALIGNMENT_INVALID/);
  assert.throws(()=>applyScriptTextEdits(measured,[{segmentId:'narration-1',field:'speechText',value:'Product costs nine dollars'}]),/SCRIPT_EDITS_NO_CHANGE/);
  assert.equal(measured.segments.at(-1).timing.kind,'measured','a no-op must not change the original measurement');
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
  for(const different of [
    {...before,videoLanguage:'fr'},
    {...before,segments:[...before.segments].reverse()},
    {...before,moments:[...before.moments].reverse()}
  ]){
    const impact=scriptChangeImpact(before,different,['landscape'],locked);
    assert.equal(impact.changed,true);
    assert.equal(impact.qualityReportsReusable,false);
    assert.deepEqual(impact.affectedAspects,['landscape']);
  }
});

test('selection covers all 144 legal Treatment uses and preserves verified video-source identity',()=>{
  const sources=Array.from({length:12},(_,index)=>({resourceId:'asset-'+index,sha256:hash('a')}));
  const dense={beats:Array.from({length:12},(_,index)=>({id:'beat-'+index,assetIds:sources.map(item=>item.resourceId)}))};
  const uses=dense.beats.flatMap(beat=>beat.assetIds.map(id=>({beatId:beat.id,role:'b_roll',selectedResourceId:id,
    alternativeResourceIds:[],reason:'Licensed',locked:true})));
  assert.equal(uses.length,144);assert.equal(validSelection({schemaVersion:'3.0.0',kind:'material_selection',uses}),true);
  assert.equal(assertMaterialSelection({kind:'material_selection',uses},dense,sources).uses.length,144);
  const manifest=hash('b'),original=hash('c'),path='assets/'+original.slice(0,24)+'.mp4';
  const resource={resourceId:'video',sha256:manifest,sourceSha256:original,sourcePath:path,kind:'video',durationSeconds:15};
  const project={resources:[resource],files:[{path,sha256:original}]};
  assert.deepEqual(projectMaterialSources(project),[{resourceId:'video',sha256:original,path,kind:'video',durationSeconds:15}]);
  const plan={kind:'locked_materials',schemaVersion:'3.0.0',uses:[{beatId:'beat-1',resourceId:'video',sha256:original,
    role:'b_roll',alternatives:[],reason:'Licensed',locked:true}]};
  plan.selectionHash=digest(plan.uses);
  assert.equal(assertLockedMaterialSelection(plan,project.resources),plan);
  assert.throws(()=>projectMaterialSources({resources:[resource],files:[{path,sha256:manifest}]}),/MATERIAL_SOURCE_IDENTITY_INVALID/);
});

test('explicit source replacement updates Script and lock hashes and rejects mismatched author code',()=>{
  const before=script();const old=materials[0],next={resourceId:'new-product',sha256:hash('d')};
  const oldPath='assets/'+old.sha256.slice(0,24)+'.png',newPath='assets/'+next.sha256.slice(0,24)+'.png';
  const prior=assertMaterialSelection(selection(),treatment,materials);
  const updated=replaceLockedMaterials(prior,before,[{fromResourceId:'product',toResourceId:'new-product'}],[next],materials);
  assert.equal(updated.selection.uses[0].resourceId,'new-product');
  assert.equal(updated.selection.uses[0].sha256,next.sha256);
  assert.notEqual(updated.selection.selectionHash,prior.selectionHash);
  assert.deepEqual(updated.script.moments[0].resourceIds,['new-product']);
  const rights=[{...old,sourcePath:oldPath,sourceSha256:old.sha256},{...next,sourcePath:newPath,sourceSha256:next.sha256},
    {...materials[1],sourcePath:'assets/'+materials[1].sha256.slice(0,24)+'.wav',sourceSha256:materials[1].sha256}];
  assert.doesNotThrow(()=>assertMaterialProjection([{path:'index.html',content:`<img src="${newPath}">`}],updated.selection,rights));
  assert.throws(()=>assertMaterialProjection([{path:'index.html',content:`<img src="${oldPath}">`}],updated.selection,rights),/MATERIAL_LOCK_PROJECT_MISMATCH/);
  const voice={resourceId:'voice',sourceSha256:hash('f'),sha256:hash('f'),kind:'audio',sourcePath:'assets/'+hash('f').slice(0,24)+'.wav'};
  const voiced={moments:[{resourceIds:['voice']}]};
  assert.doesNotThrow(()=>assertMaterialProjection([{path:'index.html',content:`<audio src="${voice.sourcePath}">`}],
    updated.selection,[...rights,voice],voiced),'Script-referenced licensed voice need not be a visual Treatment use');
  assert.throws(()=>assertMaterialProjection([{path:'index.html',content:`<audio src="${voice.sourcePath}">`}],
    updated.selection,[...rights,voice],{moments:[{resourceIds:[]}]}),/MATERIAL_LOCK_PROJECT_MISMATCH/);
  assert.throws(()=>assertMaterialProjection([{path:'index.html',content:`<img src="${oldPath}">`}],
    updated.selection,[...rights,voice],voiced),/MATERIAL_LOCK_PROJECT_MISMATCH/,'Script audio cannot authorize a substituted image');
  const retired={resources:rights,files:[{path:newPath,sha256:next.sha256},
    {path:rights[2].sourcePath,sha256:materials[1].sha256}]};
  assert.deepEqual(projectMaterialSources(retired,updated.selection,updated.script).map(item=>item.resourceId),
    ['new-product','music'],'retained old rights need no longer retain discarded source bytes');
  assert.throws(()=>projectMaterialSources({...retired,files:[]},updated.selection,updated.script),
    /MATERIAL_SOURCE_IDENTITY_INVALID/,'a missing currently selected source cannot be silently retired');
  assert.throws(()=>replaceLockedMaterials(prior,before,[{fromResourceId:'missing',toResourceId:'new-product'}],[next],materials),/MATERIAL_REPLACEMENT_INVALID/);
  assert.throws(()=>replaceLockedMaterials(prior,before,[{fromResourceId:'music',toResourceId:'product'}],materials,materials),
    /MATERIAL_REPLACEMENT_INVALID/,'two locked uses of one beat cannot collapse into one asset');
  assert.throws(()=>replaceLockedMaterials(prior,before,[
    {fromResourceId:'product',toResourceId:'new-product'},
    {fromResourceId:'new-product',toResourceId:'other-product'}
  ],[next,{resourceId:'other-product',sha256:hash('e')}],materials),
  /MATERIAL_REPLACEMENT_INVALID/,'replacements must not cascade through one another');
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
  assert.equal(assertMaterialSelection(proposal,treatment,[...materials,structuredClone(materials[0])]).selectionHash,locked.selectionHash);
  assert.throws(()=>assertMaterialSelection(proposal,treatment,[...materials,{...materials[0],kind:'video'}]),/MATERIAL_SELECTION_SOURCE_AMBIGUOUS/);
  assert.equal(assertLockedMaterialSelection(locked,[...materials,{...materials[0],sha256:hash('c')}]),locked,
    'a later revision of the same resource must not invalidate an existing exact SHA lock');
  assert.equal(assertLockedMaterialSelection(locked,[{...materials[0],sha256:hash('c')},...materials]),locked,
    'the order of retained resource revisions must not affect the lock');
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
  const another={...observation.moments[0],id:'m-2',startFrame:200,endFrame:450,evidenceFrames:[270]};
  const valid={...observation,moments:[observation.moments[0],another],relationships:[
    {fromMomentId:'m-1',toMomentId:'m-2',description:'A visible continuation.',evidenceFrames:[0,270]}]};
  assert.equal(assertReferenceAnalysis(valid,evidence),valid);
  assert.throws(()=>assertReferenceAnalysis({...valid,relationships:[{...valid.relationships[0],evidenceFrames:[180]}]},evidence),/REFERENCE_ANALYSIS_RELATION_INVALID/,
    'a cited sample from neither linked moment cannot support the relationship');
  assert.throws(()=>assertReferenceAnalysis({...valid,relationships:[{...valid.relationships[0],toMomentId:'m-1'}]},evidence),/REFERENCE_ANALYSIS_RELATION_INVALID/);
});
