import test from 'node:test';
import assert from 'node:assert/strict';
import {digest} from '@promobento/contracts/digest';
import {validate as validScript} from '@promobento/contracts/validators/native-script';
import {validate as validSelection} from '@promobento/contracts/validators/material-selection';
import {validate as validReference} from '@promobento/contracts/validators/reference-analysis';
import huashu from './huashu-motion/source.mjs';
import {assertReferenceAnalysis, assertNativeScript, assertScriptProjection, assertMaterialSelection,
  assertLockedMaterialSelection, scriptChangeImpact, applyScriptTextEdits,replaceLockedMaterials,
  projectMaterialSources,assertMaterialProjection,lockScriptAudioSources,assertScriptAudioLocks,assertScriptTreatmentSources} from './production-documents.mjs';

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
  assert.equal(assertScriptProjection([{path:'index.html',content:
    '<script type="module">title.textContent = '+JSON.stringify(escaped.segments[0].displayText)+
    '; cta.textContent = "Try PromoBento today";</script>'}],escaped),true,
  'escaped display copy inside a supported inline HTML script remains valid');
  assert.equal(assertScriptProjection([{path:'index.html',content:
    '<h1><span>One clear </span><strong>promise</strong></h1><p>Try <b>PromoBento</b> today</p>'}],doc),true,
  'display text can be spread across inline HTML nodes');
  assert.throws(()=>assertScriptProjection([{path:'index.html',content:
    '<!-- One clear promise --><p>Try PromoBento today</p>'}],doc),/SCRIPT_SOURCE_PROJECTION_MISSING/,
  'an HTML comment is not displayed copy');
  assert.throws(()=>assertScriptProjection([{path:'index.html',content:
    '<div title="One clear promise">Try PromoBento today</div>'}],doc),/SCRIPT_SOURCE_PROJECTION_MISSING/,
  'an inert HTML attribute is not displayed copy');
  assert.throws(()=>assertScriptProjection([{path:'index.html',content:
    '<script type="application/json">{"title":"One clear promise","cta":"Try PromoBento today"}</script>'}],doc),
  /SCRIPT_SOURCE_PROJECTION_MISSING/,'an inert JSON block cannot masquerade as executable display copy');
  assert.throws(()=>assertScriptProjection([{path:'index.html',content:
    '<script src="src/main.js">title.textContent="One clear promise";cta.textContent="Try PromoBento today";</script>'}],doc),
  /SCRIPT_SOURCE_PROJECTION_MISSING/,'inline code is inert when the script has a src attribute');
  assert.throws(()=>assertScriptProjection([{path:'index.html',content:'<h1></h1><p>Try PromoBento today</p>'},
    {path:'index.js',content:'// "One clear promise"\n/* title.textContent="One clear promise"; */'}],doc),
  /SCRIPT_SOURCE_PROJECTION_MISSING/,'JavaScript comments cannot establish visible copy');
  assert.equal(assertScriptProjection([{path:'index.html',content:'<h1></h1><p>Try PromoBento today</p>'},
    {path:'index.js',content:'title.textContent = "One clear promise"; // an actual binding'}],doc),true,
  'a real JavaScript string literal remains recognized alongside comments');
  const variables='[{"id":"title","type":"string","default":"One clear promise"}]';
  assert.equal(assertScriptProjection([{path:'index.html',content:
    `<html data-composition-variables='${variables}'><body><h1 data-var-text="title"></h1><p>Try PromoBento today</p></body></html>`}],doc),true,
  'the native variable text binding renders its approved default');
  assert.equal(assertScriptProjection([{path:'index.html',content:
    `<html data-composition-variables='${variables}'><body><h1 data-om-var="title"></h1><p>Try PromoBento today</p><script>const V=OM.vars(); title.textContent=V.title;</script></body></html>`}],doc),true,
  'a native script can build the visible title from its declared variable');
  for (const [name, content] of Object.entries(huashu.templateSources).filter(([,html]) => /CLIP\.mount\s*\(/.test(html))) {
    const root=/<html\b[^>]*data-composition-variables='([\s\S]*?)'>/.exec(content);
    const defaults=JSON.parse(root[1]);
    const title=defaults.find(variable => typeof variable.default === 'string' &&
      content.includes('{{' + variable.id + '}}') && variable.default.length>2);
    assert.ok(title,`native CLIP template ${name} exposes visible cue copy`);
    assert.doesNotThrow(()=>assertScriptProjection([{path:'index.html',content}],{segments:[{role:'title',displayText:title.default}]}),
      `${name} passes with its real CLIP-mounted variable binding`);
  }
  const literalCue='<html><body><script type="application/json" id="clip-spec">'+
    '{"grammar":"y5_kinetic_type","data":{"palette":"white"},"cues":[{"kind":"title","text":"One clear promise"},'+
    '{"kind":"point","text":"Try PromoBento today"}]}</script><script>CLIP.mount({id:"film"})</script></body></html>';
  assert.doesNotThrow(()=>assertScriptProjection([{path:'index.html',content:literalCue}],doc),
    'mounted CLIP cues may render literal display copy without composition variables');
  const kinetic=huashu.templateSources['kinetic-type/index.html'];
  const editedKinetic=kinetic.replace(/("text"\s*:\s*)"\{\{titleWord\}\}"/,'$1"A literal product headline"');
  assert.notEqual(editedKinetic,kinetic,'the pinned kinetic-type template must expose a replaceable title cue');
  assert.doesNotThrow(()=>assertScriptProjection([{path:'index.html',content:editedKinetic}],
    {segments:[{role:'title',displayText:'A literal product headline'}]}),
  'the actual pinned kinetic-type template accepts a directly authored cue');
  assert.throws(()=>assertScriptProjection([{path:'index.html',content:literalCue.replace('CLIP.mount','CLIP.unmounted')}],doc),
    /SCRIPT_SOURCE_PROJECTION_MISSING/,'unmounted cue JSON cannot authorize literal copy');
  assert.throws(()=>assertScriptProjection([{path:'index.html',content:literalCue.replace('"text":"One clear promise"',
    '"metadata":"One clear promise"')}],doc),/SCRIPT_SOURCE_PROJECTION_MISSING/,
  'metadata unrelated to a rendered cue cannot authorize display copy');
  for(const content of [
    `<html data-composition-variables='${variables}'><body><h1></h1><p>Try PromoBento today</p></body></html>`,
    `<html data-composition-variables='${variables}'><body><!-- <h1 data-var-text="title"></h1> --><p>Try PromoBento today</p></body></html>`,
    `<html data-composition-variables='${variables}'><body><h1 data-om-var="title"></h1><p>Try PromoBento today</p></body></html>`
  ]) assert.throws(()=>assertScriptProjection([{path:'index.html',content}],doc),/SCRIPT_SOURCE_PROJECTION_MISSING/,
    'unbound composition metadata is not proof that text is rendered');
  assert.throws(()=>assertScriptProjection([{path:'index.html',content:
    `<html data-composition-variables='${variables}'><body><script type="application/json" id="clip-spec">{"text":"{{title}}"}</script><p>Try PromoBento today</p></body></html>`}],doc),
    /SCRIPT_SOURCE_PROJECTION_MISSING/,'an unmounted CLIP-like JSON spec must not satisfy Script projection');
  assert.throws(()=>assertScriptProjection([{path:'index.html',content:
    `<html data-composition-variables='${variables}'><body><script type="application/json" id="clip-spec">{"text":"{{title}}"}</script><p>Try PromoBento today</p><script>/* CLIP.mount({}) */ const note="CLIP.mount";</script></body></html>`}],doc),
    /SCRIPT_SOURCE_PROJECTION_MISSING/,'a comment or literal mentioning the renderer does not mount the cue spec');
  assert.throws(()=>assertScriptProjection([{path:'index.html',content:
    `<html data-composition-variables='${variables}'><body><script type="application/json">{"data-var-text":"title"}</script><p>Try PromoBento today</p></body></html>`}],doc),
    /SCRIPT_SOURCE_PROJECTION_MISSING/,'inert JSON must not impersonate a data-var-text attribute');
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
  measured.moments.push({id:'narrated-moment',kind:'demonstration',startFrame:30,endFrame:90,
    segmentIds:['narration-1'],resourceIds:['voice'],timing:{kind:'measured',sourceSha256:hash('c'),firstWord:0,lastWord:3}});
  const spokenEvidence=[{sourceSha256:hash('c'),words:[{text:'Product',start:1,end:1.25},{text:'costs',start:1.25,end:1.5},
    {text:'nine',start:1.5,end:2},{text:'dollars',start:2,end:3}]}];
  const spokenContext={...context,timingEvidence:spokenEvidence,materials:[...materials,{resourceId:'voice',sha256:hash('c'),kind:'audio'}]};
  assert.equal(assertNativeScript(measured,spokenContext),measured);
  const unrelated=structuredClone(measured);unrelated.segments.at(-1).speechText='Goodbye forever';
  assert.throws(()=>assertNativeScript(unrelated,spokenContext),/SCRIPT_ALIGNMENT_INVALID/);
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
  assert.doesNotThrow(()=>assertMaterialProjection([{path:'src/assets.json',content:JSON.stringify({productPath:newPath})}],
    updated.selection,rights),'a same-origin JSON source may supply the selected path');
  assert.throws(()=>assertMaterialProjection([{path:'index.html',content:`<img src="${oldPath}">`}],updated.selection,rights),/MATERIAL_LOCK_PROJECT_MISMATCH/);
  assert.throws(()=>assertMaterialProjection([{path:'src/assets.json',content:JSON.stringify({productPath:oldPath})}],
    updated.selection,rights),/MATERIAL_LOCK_PROJECT_MISMATCH/,'JSON cannot smuggle an unselected historical source');
  const voice={resourceId:'voice',sourceSha256:hash('f'),sha256:hash('f'),kind:'audio',sourcePath:'assets/'+hash('f').slice(0,24)+'.wav'};
  const voiced={moments:[{resourceIds:['voice']}]};
  const voiceLocks=lockScriptAudioSources(voiced,[...rights,voice],updated.selection);
  assert.doesNotThrow(()=>assertMaterialProjection([{path:'index.html',content:`<audio src="${voice.sourcePath}">`}],
    updated.selection,[...rights,voice],voiced,voiceLocks),'Script-referenced licensed voice need not be a visual Treatment use');
  assert.throws(()=>assertMaterialProjection([{path:'index.html',content:`<audio src="${voice.sourcePath}">`}],
    updated.selection,[...rights,voice],{moments:[{resourceIds:[]}]}),/MATERIAL_LOCK_PROJECT_MISMATCH/);
  assert.throws(()=>assertMaterialProjection([{path:'index.html',content:`<img src="${oldPath}">`}],
    updated.selection,[...rights,voice],voiced,voiceLocks),/MATERIAL_LOCK_PROJECT_MISMATCH/,'Script audio cannot authorize a substituted image');
  const unselectedImage={resourceId:'unselected-visual',sha256:hash('9'),kind:'image',
    sourceSha256:hash('9'),sourcePath:'assets/'+hash('9').slice(0,24)+'.png'};
  assert.throws(()=>assertMaterialProjection([{path:'index.html',content:'<div>Source omitted</div>'}],
    updated.selection,[...rights,unselectedImage],{moments:[{resourceIds:['unselected-visual']}]},[]),
  /MATERIAL_LOCK_PROJECT_MISMATCH/,'a Script Moment must not silently refer to an unselected visual');
  assert.throws(()=>assertMaterialProjection([{path:'index.html',content:'<div>Source omitted</div>'}],
    null,[voice],{moments:[{resourceIds:['voice']}]},[]),
  /MATERIAL_LOCK_PROJECT_MISMATCH/,'Script-only audio is unusable until its exact version is locked');
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
  const withAlternative=structuredClone(prior);
  withAlternative.uses[0].alternatives.push({resourceId:next.resourceId,sha256:next.sha256});
  withAlternative.selectionHash=digest(withAlternative.uses);
  const promoted=replaceLockedMaterials(withAlternative,before,
    [{fromResourceId:'product',toResourceId:'new-product'}],[next],[...materials,next]);
  assert.deepEqual(promoted.selection.uses[0].alternatives,[{resourceId:'product',sha256:old.sha256}],
    'promoting an already registered alternative swaps its position with the old primary');
  assert.equal(promoted.selection.uses[0].resourceId,next.resourceId);
  assert.doesNotThrow(()=>assertLockedMaterialSelection(promoted.selection,[...materials,next]));
  const alternateV1={resourceId:'new-product',sha256:hash('c')};
  const alternateV2={resourceId:'new-product',sha256:hash('e')};
  const alternateV3={resourceId:'new-product',sha256:hash('f')};
  const withOlderAlternative=structuredClone(prior);
  withOlderAlternative.uses[0].alternatives.push({resourceId:alternateV1.resourceId,sha256:alternateV1.sha256});
  withOlderAlternative.selectionHash=digest(withOlderAlternative.uses);
  const upgraded=replaceLockedMaterials(withOlderAlternative,before,
    [{fromResourceId:'product',toResourceId:'new-product'}],[alternateV2],[...materials,alternateV1]);
  assert.deepEqual(upgraded.selection.uses[0].alternatives,[{resourceId:'product',sha256:old.sha256}],
    'promoting a newer SHA retires the older alternative version instead of duplicating its resource ID');
  const nextVersion=replaceLockedMaterials(upgraded.selection,upgraded.script,
    [{fromResourceId:'new-product',toResourceId:'new-product'}],[alternateV3],
    [...materials,alternateV1,alternateV2]);
  assert.equal(nextVersion.selection.uses[0].sha256,alternateV3.sha256,
    'a second same-ID version upgrade must remain possible');
  const switchedAgain=replaceLockedMaterials(upgraded.selection,upgraded.script,
    [{fromResourceId:'new-product',toResourceId:'third-product'}],
    [{resourceId:'third-product',sha256:hash('f')}],[...materials,alternateV1,alternateV2]);
  assert.equal(switchedAgain.selection.uses[0].resourceId,'third-product',
    'a second replacement to a new resource ID must remain possible');
  const duplicate=structuredClone(upgraded.selection);
  duplicate.uses[0].alternatives.push({resourceId:'third-product',sha256:hash('c')},
    {resourceId:'third-product',sha256:hash('d')});
  duplicate.selectionHash=digest(duplicate.uses);
  assert.throws(()=>assertLockedMaterialSelection(duplicate,[...materials,
    {resourceId:'third-product',sha256:hash('c')},{resourceId:'third-product',sha256:hash('d')},alternateV2]),
  /MATERIAL_LOCK_IDENTITY_INVALID/,'one resource ID cannot appear under multiple alternative SHAs');
  assert.throws(()=>replaceLockedMaterials(withOlderAlternative,before,
    [{fromResourceId:'new-product',toResourceId:'product'}],[{resourceId:'product',sha256:hash('d')}],
    [...materials,alternateV1]),/MATERIAL_REPLACEMENT_INVALID/,
  'replacing an alternative must not silently discard a new SHA under the still-selected ID');
  const scriptVoice={resourceId:'voice',sha256:hash('e'),kind:'audio'};
  const scriptOnly=structuredClone(before);
  scriptOnly.moments[0].resourceIds.push('voice');
  const voiceReplacement={resourceId:'new-voice',sha256:hash('f'),kind:'audio'};
  const changedVoice=replaceLockedMaterials(prior,scriptOnly,
    [{fromResourceId:'voice',toResourceId:'new-voice'}],[voiceReplacement],[...materials,scriptVoice]);
  assert.deepEqual(changedVoice.script.moments[0].resourceIds,['product','new-voice']);
  assert.equal(changedVoice.selection.selectionHash,prior.selectionHash,
    'a Script-only audio change does not mutate Treatment material locks');
  const selectedAudio={resourceId:'selected-voice',sha256:hash('a'),kind:'audio'};
  const existingOther={resourceId:'other-voice',sha256:hash('b'),kind:'audio'};
  const newOther={resourceId:'other-voice',sha256:hash('c'),kind:'audio'};
  const activeUses=[{beatId:'spoken-beat',resourceId:selectedAudio.resourceId,sha256:selectedAudio.sha256,
    role:'voice',alternatives:[],reason:'Selected narration',locked:true}];
  const activeSelection={schemaVersion:'3.0.0',kind:'locked_materials',uses:activeUses,selectionHash:digest(activeUses)};
  const twoVoices={moments:[{id:'narration',resourceIds:[selectedAudio.resourceId],segmentIds:[],timing:{kind:'authored'}},
    {id:'background',resourceIds:[existingOther.resourceId],segmentIds:[],timing:{kind:'authored'}}],segments:[]};
  assert.throws(()=>replaceLockedMaterials(activeSelection,twoVoices,
    [{fromResourceId:selectedAudio.resourceId,toResourceId:newOther.resourceId}],
    [newOther],[selectedAudio,existingOther],[{resourceId:existingOther.resourceId,sha256:existingOther.sha256}]),
  /MATERIAL_LOCK_VERSION_CONFLICT/,'a selected B-v2 cannot coexist with a Script-only B-v1 lock');
  const conflictingUses=[...activeUses,{...activeUses[0],beatId:'another-beat',sha256:hash('d')}];
  assert.throws(()=>assertLockedMaterialSelection({...activeSelection,uses:conflictingUses,
    selectionHash:digest(conflictingUses)},[selectedAudio,{...selectedAudio,sha256:hash('d')}]),
  /MATERIAL_LOCK_VERSION_CONFLICT/,'separate beats cannot select two SHA versions of the same ID');
});

test('a Script-only recording locks one runnable ID/SHA and cannot authorize another version of the same ID',()=>{
  const a=hash('a'),b=hash('b'),pathA='assets/'+a.slice(0,24)+'.wav',pathB='assets/'+b.slice(0,24)+'.wav';
  const voiceScript={moments:[{resourceIds:['voice']}]};
  const old={resourceId:'voice',sha256:a,sourceSha256:a,sourcePath:pathA,kind:'audio'};
  const replacement={resourceId:'voice',sha256:b,sourceSha256:b,sourcePath:pathB,kind:'audio'};
  const locks=lockScriptAudioSources(voiceScript,[{resourceId:'voice',sha256:a,kind:'audio'}]);
  assert.deepEqual(locks,[{resourceId:'voice',sha256:a}]);
  assert.doesNotThrow(()=>assertMaterialProjection([{path:'index.html',content:`<audio src="${pathA}">`}],null,[old,replacement],voiceScript,locks));
  assert.throws(()=>assertMaterialProjection([{path:'index.html',content:`<audio src="${pathB}">`}],null,[old,replacement],voiceScript,locks),
    /MATERIAL_LOCK_PROJECT_MISMATCH/);
  assert.deepEqual(projectMaterialSources({resources:[old,replacement],files:[{path:pathA,sha256:a}]},null,voiceScript),
    [{resourceId:'voice',sha256:a,path:pathA,kind:'audio',durationSeconds:null}]);
  assert.throws(()=>projectMaterialSources({resources:[old,replacement],files:[{path:pathA,sha256:a},{path:pathB,sha256:b}]},null,voiceScript),
    /SCRIPT_AUDIO_SOURCE_AMBIGUOUS/);
  const blank={schemaVersion:'3.0.0',kind:'locked_materials',uses:[],selectionHash:digest([])};
  const switched=replaceLockedMaterials(blank,voiceScript,[{fromResourceId:'voice',toResourceId:'voice'}],
    [{resourceId:'voice',sha256:b,kind:'audio'}],[old],[{resourceId:'voice',sha256:a}]);
  assert.deepEqual(switched.script.moments[0].resourceIds,['voice']);
  assert.throws(()=>replaceLockedMaterials(blank,voiceScript,[{fromResourceId:'voice',toResourceId:'voice'}],
    [{resourceId:'voice',sha256:a,kind:'audio'}],[old],[{resourceId:'voice',sha256:a}]),/MATERIAL_REPLACEMENT_INVALID/,
    'an explicit same-ID request must be a real byte-version change');
  assert.throws(()=>replaceLockedMaterials(blank,voiceScript,[{fromResourceId:'voice',toResourceId:'voice'}],
    [{resourceId:'voice',sha256:b,kind:'audio'}],[old],[]),/MATERIAL_REPLACEMENT_INVALID/,
    'an ambiguous baseline without an exact lock cannot authorize a same-ID replacement');
});

test('persisted Script-only audio locks restore the active version when historical bytes remain runnable',()=>{
  const old=hash('a'),next=hash('b');
  const oldPath='assets/'+old.slice(0,24)+'.wav',nextPath='assets/'+next.slice(0,24)+'.wav';
  const project={resources:[
    {resourceId:'voice',sha256:old,sourceSha256:old,sourcePath:oldPath,kind:'audio'},
    {resourceId:'voice',sha256:next,sourceSha256:next,sourcePath:nextPath,kind:'audio'},
    {resourceId:'other',sha256:old,sourceSha256:old,sourcePath:oldPath,kind:'audio'}],
    files:[{path:oldPath,sha256:old},{path:nextPath,sha256:next}]};
  const selectionUses=[{beatId:'b',resourceId:'other',sha256:old,alternatives:[],locked:true}];
  const selection={schemaVersion:'3.0.0',kind:'locked_materials',uses:selectionUses,selectionHash:digest(selectionUses)};
  const sourceScript={moments:[{resourceIds:['voice','other']}]};
  assert.throws(()=>projectMaterialSources(project,selection,sourceScript),/SCRIPT_AUDIO_SOURCE_AMBIGUOUS/);
  const locks=[{resourceId:'voice',sha256:next}];
  assert.equal(projectMaterialSources(project,selection,sourceScript,locks).length,3);
  assert.deepEqual(assertScriptAudioLocks(sourceScript,project.resources,selection,locks),locks);
  assert.throws(()=>projectMaterialSources(project,selection,sourceScript,[{resourceId:'voice',sha256:hash('c')}]),/SCRIPT_AUDIO_SOURCE_INVALID/);
  assert.throws(()=>projectMaterialSources({...project,files:[{path:oldPath,sha256:old}]},selection,sourceScript,locks),/SCRIPT_AUDIO_SOURCE_INVALID/);
});

test('Script validation rejects an unselected visual before caching but permits independent audio',()=>{
  const treatment={beats:[{assetIds:['selected']}]};
  const admitted=[{resourceId:'selected',kind:'image'},{resourceId:'unselected',kind:'image'},{resourceId:'voice',kind:'audio'}];
  const source={moments:[{resourceIds:['selected','voice']}]};
  assert.doesNotThrow(()=>assertScriptTreatmentSources(source,treatment,admitted));
  assert.throws(()=>assertScriptTreatmentSources({moments:[{resourceIds:['unselected']}]},treatment,admitted),/MATERIAL_LOCK_PROJECT_MISMATCH/);
});

test('a changed recorded source invalidates its measured Segment and Moment clocks',()=>{
  const oldAudio={resourceId:'music',sha256:hash('b'),kind:'audio'};
  const nextAudio={resourceId:'new-voice',sha256:hash('e'),kind:'audio'};
  const prior=assertMaterialSelection(selection(),treatment,materials);
  const spoken=script(),clock={kind:'measured',sourceSha256:oldAudio.sha256,firstWord:0,lastWord:1};
  spoken.segments.push({id:'speech',role:'narration',displayText:'Narration',speechText:'Hello world',factIds:[],
    startFrame:30,endFrame:60,timing:clock});
  spoken.moments.push({id:'voiced',kind:'demonstration',startFrame:30,endFrame:60,
    segmentIds:['speech'],resourceIds:['music'],timing:clock});
  spoken.segments.push({id:'unlinked-caption',role:'caption',displayText:'Hello world',speechText:null,factIds:[],
    startFrame:30,endFrame:60,timing:clock});
  spoken.moments[0].segmentIds.push('unlinked-caption');
  const measuredContext={...context,materials:[materials[0],oldAudio],timingEvidence:[{sourceSha256:oldAudio.sha256,
    words:[{text:'Hello',start:1,end:1.5},{text:'world',start:1.5,end:2}]}]};
  assert.doesNotThrow(()=>assertNativeScript(spoken,measuredContext));
  const unbound=structuredClone(spoken);unbound.moments.at(-1).resourceIds=[];
  assert.throws(()=>assertNativeScript(unbound,measuredContext),/SCRIPT_ALIGNMENT_INVALID/,
    'measured speech must point to its actual licensed media, not only a matching SHA in unrelated evidence');
  const changed=replaceLockedMaterials(prior,spoken,[{fromResourceId:'music',toResourceId:'new-voice'}],
    [nextAudio],[materials[0],oldAudio]);
  assert.equal(changed.script.moments.at(-1).resourceIds[0],'new-voice');
  assert.equal(changed.script.moments.at(-1).timing.kind,'authored');
  assert.equal(changed.script.segments.at(-1).timing.kind,'authored');
  assert.equal(changed.script.segments.find(segment=>segment.id==='unlinked-caption').timing.kind,'authored',
    'a measured caption must retire with source bytes even if its Moment only lists a visual resource');
  assert.equal(spoken.segments.at(-1).timing.kind,'measured','parent measured evidence remains untouched');
  const shared=structuredClone(spoken),otherVoice={resourceId:'other-voice',sha256:oldAudio.sha256,kind:'audio'};
  shared.segments.push({...shared.segments.find(segment=>segment.id==='speech'),id:'untouched-speech'});
  shared.moments.push({...shared.moments.at(-1),id:'untouched-moment',segmentIds:['untouched-speech'],resourceIds:['other-voice']});
  assert.doesNotThrow(()=>assertNativeScript(shared,{...measuredContext,materials:[materials[0],oldAudio,otherVoice]}));
  const scoped=replaceLockedMaterials(prior,shared,[{fromResourceId:'music',toResourceId:'new-voice'}],
    [nextAudio],[...materials,oldAudio,otherVoice],[{resourceId:'other-voice',sha256:oldAudio.sha256}]);
  assert.equal(scoped.script.moments.at(-1).timing.kind,'measured',
    'an unaffected Moment using the original audio bytes keeps its measured clock');
  assert.equal(scoped.script.segments.at(-1).timing.kind,'measured');
  assert.equal(scoped.script.segments.find(segment=>segment.id==='unlinked-caption').timing.kind,'measured',
    'the unlinked caption keeps its measured time when another locked resource still retains the same bytes');
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
