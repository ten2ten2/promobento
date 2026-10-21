import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseCanonicalJson, createSchemaValidator, digest } from '../packages/contracts/index.mjs';
import { studioErrors, localPreviewValues, boundValueUpdates, factValueUpdates, factBindingUpdates, CandidateReference, creativePlanIdentity, candidateOutputIdentity } from './studio-contracts.mjs';

const load = path => parseCanonicalJson(readFileSync(new URL('../'+path,import.meta.url)));
const schema = load('contracts/production.schema.json');
const validate = createSchemaValidator(schema);
const helpers = {presets:load('config/platform-presets.json')};
const clone = value => structuredClone(value);
const sha = 'a'.repeat(64), otherSha = 'b'.repeat(64);
const envelope = (kind,fields) => ({...(kind === 'source_values' ? {} : {schemaVersion:'2.7.0'}),kind,...fields});
const scope = {production:true,authorized:true,workspaceId:'workspace_studio',projectId:'project_studio'};
const definitions = {
  headline:{id:'headline',label:'Headline',type:'text',factId:'fact_headline'},
  background:{id:'background',label:'Background',type:'color'},
  beat:{id:'beat',label:'Beat',type:'number',min:0,max:449,affectsTiming:true}
};
const context = () => ({...scope,currentRevisionId:'revision_current',editables:clone(definitions),
  facts:{fact_headline:{recordVersion:7,text:'Start with your product.'}},resources:{},
  sourceValues:{headline:'Start with your product.',background:'#123456',beat:12},
  revisions:{revision_old:{workspaceId:scope.workspaceId,projectId:scope.projectId}}
});
function errors(def,value,trusted = context()) {
  const structural = validate(value,schema.$defs[def]);
  return structural.length ? structural : studioErrors(value,trusted,helpers);
}
const accepts = (def,value,trusted) => assert.deepEqual(errors(def,value,trusted),[]);
const rejects = (def,value,trusted) => assert.ok(errors(def,value,trusted).length > 0);
const draft = () => envelope('draft_update_request',{
  requestId:'request_edit',projectId:scope.projectId,baseRevision:'revision_current',
  changes:[{editableId:'headline',value:'Start with your own product.',expectedFactRecordVersion:7}]
});

test('ordinary draft values save without QA data and preserve fact CAS', () => {
  accepts('draftUpdateRequest',draft());
  const plain = draft(); plain.changes=[{editableId:'background',value:'#123456'}];
  accepts('draftUpdateRequest',plain);
  rejects('draftUpdateRequest',{...plain,qaReportHash:sha});
  const stale = context(); stale.facts.fact_headline.recordVersion=8;
  rejects('draftUpdateRequest',draft(),stale);
  const missing = draft(); delete missing.changes[0].expectedFactRecordVersion;
  rejects('draftUpdateRequest',missing);
  const forged = draft(); forged.changes[0].factId='fact_other';
  rejects('draftUpdateRequest',forged);
  const blank = draft(); blank.changes[0].value='   ';
  assert.ok(errors('draftUpdateRequest',blank).includes('EMPTY_FACT'));
  for (const invisible of ['\u200b','\u200d','\u3164']) {
    blank.changes[0].value = invisible;
    assert.ok(errors('draftUpdateRequest',blank).includes('EMPTY_FACT'));
  }
  assert.equal(localPreviewValues({headline:''},context()).headline,'');
  const trusted=context();trusted.editables.note={id:'note',label:'Note',type:'text'};trusted.sourceValues.note='';
  accepts('draftUpdateRequest',{...draft(),changes:[{editableId:'note',value:''}]},trusted);
});

test('draft editing rejects revoked scope, stale base, undeclared values and invalid ranges', () => {
  for (const trusted of [{...context(),authorized:false},{...context(),projectId:'project_other'},
    {...context(),currentRevisionId:'revision_concurrent'}]) rejects('draftUpdateRequest',draft(),trusted);
  for (const changes of [[{editableId:'unknown',value:'x'}],[{editableId:'beat',value:450}],
    [{editableId:'background',value:'url(https://elsewhere.test/pixel)'}],
    [{editableId:'background',value:'#123456',affectsTiming:false}],
    [{editableId:'beat',value:2}],
    [{editableId:'beat',value:2},{editableId:'beat',value:3}]]) rejects('draftUpdateRequest',{...draft(),changes});
});

test('fact edits synchronize every binding and require a draft CAS in either direction', () => {
  const trusted=context();
  trusted.editables.footer={id:'footer',label:'Footer',type:'text',factId:'fact_headline'};
  trusted.sourceValues.footer=trusted.sourceValues.headline;
  const updates={headline:'A revised product name.'};
  assert.deepEqual(boundValueUpdates(updates,trusted.editables),{...updates,footer:updates.headline});
  const changes=[{action:'upsert',factId:'fact_headline',expectedVersion:7,text:updates.headline,evidence:[]}];
  assert.deepEqual(factValueUpdates(changes,trusted.editables),{...updates,footer:updates.headline});
  const facts = [{factId:'fact_headline',text:trusted.sourceValues.headline}];
  const bindings = [{bindingId:'title_binding',factIds:['fact_headline'],expectedText:facts[0].text}];
  const nextFacts = [{...facts[0],text:updates.headline}];
  assert.equal(factBindingUpdates(bindings,facts,nextFacts)[0].expectedText,updates.headline);
  assert.equal(bindings[0].expectedText,facts[0].text);
  assert.throws(()=>factBindingUpdates(bindings,facts,[]),/BOUND_FACT_REMOVAL_REQUIRES_SOURCE_EDIT/);
  const duplicate = [...facts,{factId:'fact_duplicate',text:facts[0].text}];
  assert.throws(()=>factBindingUpdates([{...bindings[0],factIds:['fact_headline','fact_duplicate']}],duplicate,
    [...nextFacts,duplicate[1]]),/FACT_BINDING_TEXT_AMBIGUOUS/);
  const request=envelope('facts_update_request',{requestId:'facts_update',projectId:scope.projectId,baseRevision:'revision_current',changes});
  accepts('factsUpdateRequest',request,trusted);
  const missing=clone(request);delete missing.baseRevision;
  rejects('factsUpdateRequest',missing,trusted);
  rejects('factsUpdateRequest',{...request,baseRevision:'revision_old'},trusted);
  rejects('factsUpdateRequest',{...request,changes:[{action:'remove',factId:'fact_headline',expectedVersion:7}]},trusted);
  const conflict=draft();conflict.changes.push({editableId:'footer',value:'A different value.',expectedFactRecordVersion:7});
  rejects('draftUpdateRequest',conflict,trusted);
  const frozen=envelope('source_values',{values:trusted.sourceValues});
  accepts('sourceValues',frozen,{...trusted,requireFactBindings:true});
  rejects('sourceValues',{...frozen,values:{...frozen.values,footer:'Stale text.'}},{...trusted,requireFactBindings:true});
  trusted.editables.footer.affectsTiming=true;
  assert.throws(()=>localPreviewValues(updates,trusted),/EDITABLE_REQUIRES_AI/);
  rejects('draftUpdateRequest',draft(),trusted);
  rejects('factsUpdateRequest',request,trusted);
});

test('restoring a revision is exclusive with changes and never crosses projects', () => {
  const restore = draft(); delete restore.changes; restore.restoreFromRevisionId='revision_old';
  accepts('draftUpdateRequest',restore);
  rejects('draftUpdateRequest',{...restore,changes:draft().changes});
  const trusted = context(); trusted.revisions.revision_old.projectId='project_other';
  rejects('draftUpdateRequest',restore,trusted);
  const conflict = envelope('draft_update_result',{requestId:'request_edit',projectId:scope.projectId,
    baseRevision:'revision_current',currentRevisionId:'revision_concurrent',state:'conflict',code:'DRAFT_CONFLICT'});
  accepts('draftUpdateResult',conflict);
  rejects('draftUpdateResult',{...conflict,revisionId:'revision_fake'});
  const saved = envelope('draft_update_result',{requestId:'request_edit',projectId:scope.projectId,
    baseRevision:'revision_current',currentRevisionId:'revision_saved',revisionId:'revision_saved',state:'saved',
    qualityEligibility:'unchecked',unconfirmedFactIds:['fact_headline']});
  accepts('draftUpdateResult',saved);
  rejects('draftUpdateResult',{...saved,qualityEligibility:'ready'});
});

test('project actions come with explicit availability and zero balance does not erase downloads', () => {
  const project = envelope('project_result',{projectId:scope.projectId,workspaceId:scope.workspaceId,
    draftRevisionId:'revision_current',lifecycle:'active',audience:'software',task:'A custom software launch.',
    durationSeconds:15,targetIds:['tiktok:portrait'],qualityEligibility:'ready',unconfirmedFactIds:[],
    brandFontSelection:null,accessExpiresAt:null,mediaDeleteAfter:null,versionBalance:0,
    creationBalance:0,editRoundBalance:0,trialStatus:'not_granted',activeRunIds:[],pendingCandidateRevisionIds:[],activePreviewIds:[],activeMediaJobIds:[],activeReleaseIds:[],
    availableActions:[{action:'download_files',enabled:true,reasonCode:null},
      {action:'export_new_version',enabled:false,reasonCode:'NO_VERSION_BALANCE'}],primaryAction:'download_files'});
  accepts('projectResult',project);
  rejects('projectResult',{...project,primaryAction:'export_new_version'});
  const duplicated = clone(project); duplicated.availableActions.push(clone(duplicated.availableActions[0]));
  rejects('projectResult',duplicated);
  const reason = clone(project); reason.availableActions[1].reasonCode=null;
  rejects('projectResult',reason);
});

test('first creation and every candidate type use the same current-pointer and acceptance boundary', () => {
  const trusted={...context(),currentRevisionId:null};
  const creation=envelope('agent_request',{requestId:'first_creation',baseRevision:null,operation:'creative_generate',
    mode:'direct',instruction:'Show the product.',targetIds:['tiktok:portrait']});
  accepts('agentRequest',creation,trusted);
  rejects('agentRequest',creation,context());
  rejects('agentRequest',{...creation,operation:'prepare_targets'},trusted);
  rejects('agentRequest',creation,{...trusted,authorized:false});
  const request=envelope('candidate_action_request',{requestId:'accept_candidate',projectId:scope.projectId,
    baseRevision:null,candidateRevisionId:'revision_candidate'});
  const candidate={...candidateCase().candidate,workspaceId:scope.workspaceId,projectId:scope.projectId,baseRevision:null,
    candidateRevisionId:'revision_candidate',state:'ready'};
  const accept={...trusted,...candidateCase().trusted,candidate:{...candidate,affectedTargetIds:['tiktok:portrait']},candidateAction:'accept'};
  accepts('candidateActionRequest',request,accept);
  rejects('candidateActionRequest',request,{...accept,candidateSafetyChecks:{}});
  rejects('candidateActionRequest',request,{...accept,candidate:{...candidate,state:'withheld'}});
  rejects('candidateActionRequest',request,{...accept,currentRevisionId:'revision_concurrent'});
  accepts('candidateActionRequest',request,{...accept,candidateAction:'reject',currentRevisionId:'revision_concurrent'});
  rejects('candidateActionRequest',request,{...accept,candidate:{...candidate,workspaceId:'another_workspace'}});
  for (const operation of ['creative_generate','agent_patch','prepare_targets']) {
    const result=envelope('candidate_result',{projectId:scope.projectId,runId:'run_candidate',operation,
      baseRevision:operation === 'creative_generate' ? null : 'revision_current',candidateRevisionId:'revision_candidate',
      state:'ready',affectedTargetIds:['tiktok:portrait'],agentInterpretation:'Explain the product.',impactSummary:'Updates the opening scene.'});
    accepts('candidateResult',result,{...context(),...candidateCase(result).trusted});
    rejects('candidateResult',result,{...context(),candidateSafetyChecks:{}});
    accepts('candidateResult',{...result,state:'withheld',agentInterpretation:null,impactSummary:null},context());
  }
});

test('comments refer to a saved revision showing exactly the submitted frame values', () => {
  const request=load('contracts/edit-request.example.json');
  delete request.exampleOnly;
  const trusted={...context(),currentRevisionId:request.baseRevision,displayedRevisionId:request.baseRevision,hasUnsavedValues:false};
  accepts('editRequest',request,trusted);
  rejects('editRequest',request,{...trusted,hasUnsavedValues:true});
  rejects('editRequest',request,{...trusted,displayedRevisionId:'revision_not_displayed'});
  rejects('editRequest',request,{...trusted,currentRevisionId:'revision_concurrent'});
});

test('job status never fabricates progress, success or retry eligibility', () => {
  const job = envelope('job_result',{...scope,jobId:'job_media',revisionId:null,targetId:null,
    operation:'media_processing',state:'running',stage:'media_processing',progress:{unit:'bytes',completed:201,total:450},
    errorCode:null,canRetry:false,retryAfterMs:null,result:null});
  delete job.production; delete job.authorized;
  accepts('jobResult',job);
  accepts('jobResult',{...job,progress:null});
  accepts('jobResult',{...job,state:'failed',errorCode:'FRAME_TIMEOUT',canRetry:true,retryAfterMs:5000});
  rejects('jobResult',{...job,progress:{unit:'bytes',completed:451,total:450}});
  rejects('jobResult',{...job,state:'succeeded',stage:'completed'});
  rejects('jobResult',{...job,canRetry:true});
  const completed={...job,state:'succeeded',stage:'completed',progress:{unit:'bytes',completed:450,total:450},result:{kind:'asset',assetId:'asset_finished'}};
  accepts('jobResult',completed);
  rejects('jobResult',{...completed,result:null});
  rejects('jobResult',{...completed,result:{kind:'release',releaseId:'wrong_result'}});
  rejects('jobResult',{...job,result:completed.result});
});

function preview() {
  return envelope('preview_session_result',{requestId:'request_preview',projectId:scope.projectId,workspaceId:scope.workspaceId,
    revisionId:'revision_current',targetId:'tiktok:portrait',sessionId:'session_preview',mode:'local_full',
    previewOrigin:'https://preview.example.test',frameUrl:'https://preview.example.test/session/session_preview',
    nonce:'n'.repeat(40),expiresAt:'2026-10-21T00:10:00Z',manifestHash:sha,previewPolicyVersion:load('config/preview.json').policyVersion,
    pixelScale:0.5,width:1080,height:1920,fps:30,frameCount:450,mixedAudioHash:otherSha,mixedAudioUrl:'https://media.example.test/audio/grant_current'});
}
function previewContext() {
  return {...context(),localPreviewAllowed:true,previewSafetyCheck:localSafetyCheck(),previewOrigin:'https://preview.example.test',appOrigin:'https://app.example.test',
    now:Date.parse('2026-10-21T00:00:00Z'),audioGrants:{[otherSha]:'https://media.example.test/audio/grant_current'},revisions:{revision_current:{workspaceId:scope.workspaceId,
      projectId:scope.projectId,targetIds:['tiktok:portrait'],manifestHash:sha,totalFrames:450,mixedAudioHash:otherSha}}};
}
test('local preview keeps full duration and logical dimensions while rejecting origin or scale substitution', () => {
  accepts('previewSessionResult',preview(),previewContext());
  for (const change of [{pixelScale:1},{width:540,height:960},{frameCount:900},{mixedAudioHash:sha},
    {mixedAudioUrl:null},{mixedAudioUrl:'https://media.example.test/audio/other_project'},
    {previewOrigin:'https://app.example.test',frameUrl:'https://app.example.test/session/x'},
    {frameUrl:'https://preview.example.test.evil.test/session/x'},
    {frameUrl:'https://user@preview.example.test/session/x'},
    {expiresAt:'2026-10-21T00:00:00Z'}]) rejects('previewSessionResult',{...preview(),...change},previewContext());
  rejects('previewSessionResult',preview(),{...previewContext(),previewOrigin:null});
  const request = envelope('preview_session_request',{requestId:'request_preview',projectId:scope.projectId,
    revisionId:'revision_current',targetId:'tiktok:portrait'});
  accepts('previewSessionRequest',request,previewContext());
  rejects('previewSessionRequest',{...request,pixelScale:1},previewContext());
  rejects('previewSessionRequest',request,{...previewContext(),localPreviewAllowed:false});
  assert.ok(errors('previewSessionRequest',request,{...previewContext(),previewSafetyCheck:null}).includes('LOCAL_PREVIEW_SAFETY_REQUIRED'));
  assert.ok(errors('previewSessionResult',preview(),{...previewContext(),previewSafetyCheck:undefined}).includes('LOCAL_PREVIEW_SAFETY_REQUIRED'));
});

test('nominal local playback cannot claim a final motion sample or renderer permission', () => {
  const session=preview();
  const command={protocolVersion:'2.7.0',sessionId:session.sessionId,requestId:'request_seek',sequence:3,
    revisionId:session.revisionId,targetId:session.targetId,command:'seek',frameIndex:23,previewEpoch:0};
  const response={...command,event:'preview-frame-ready',manifestHash:session.manifestHash};
  delete response.command;
  const trusted={...previewContext(),previewSession:session,seekCommand:command,previewEpoch:0,lastSequence:2};
  accepts('localPreviewReady',response,trusted);
  rejects('localPreviewReady',{...response,requestId:'request_old'},trusted);
  rejects('localPreviewReady',{...response,sequence:2},trusted);
  rejects('localPreviewReady',{...response,manifestHash:otherSha},trusted);
  rejects('localPreviewReady',response,{...trusted,disposed:true});
  rejects('localPreviewReady',response,{...trusted,previewSession:undefined});
  rejects('renderReady',{...response,event:'frame-ready'},trusted);
  rejects('renderSample',{...command,command:'sample',sampleIndex:0},{...trusted,rendererSession:true});
  const init={...command,command:'init',manifestHash:session.manifestHash,frameCount:450,width:1080,height:1920,
    fps:30,seed:'studio_seed',mode:'local_preview',pixelScale:0.5,
    renderProfile:{sampleCount:4,shutterAngle:180,sampling:'centered-box-v1',edgePolicy:'clamp-v1'}};
  delete init.frameIndex;
  accepts('renderInit',init,trusted);
  rejects('renderInit',{...init,revisionId:'revision_other'},trusted);
  rejects('renderInit',{...init,width:540,height:960},trusted);
  rejects('renderInit',{...init,mode:'trusted_render',pixelScale:1},trusted);
});

test('local overlays replace only preview values; epochs and sequence numbers reject stale work', () => {
  const session=preview(),trusted={...previewContext(),previewSession:session,previewEpoch:0,lastSequence:1};
  const command={protocolVersion:'2.7.0',sessionId:session.sessionId,requestId:'request_values',sequence:2,
    revisionId:session.revisionId,targetId:session.targetId,command:'set-values',manifestHash:sha,
    requestedEpoch:1,valuesOverlay:{headline:'Unsaved local text.'}};
  const before=clone(trusted);
  accepts('localValues',command,trusted);
  assert.equal(localPreviewValues(command.valuesOverlay,trusted).headline,'Unsaved local text.');
  assert.deepEqual(trusted,before);
  assert.deepEqual(localPreviewValues({},trusted),trusted.sourceValues);
  assert.throws(()=>localPreviewValues({},{...trusted,sourceValues:{}}),/EDITABLE_VALUES_INCOMPLETE/);
  rejects('localValues',{...command,requestedEpoch:0},trusted);
  rejects('localValues',{...command,sequence:1},trusted);
  rejects('localValues',command,{...trusted,commandInFlight:true});
  rejects('localValues',{...command,manifestHash:otherSha},trusted);
  rejects('localValues',{...command,valuesOverlay:{beat:20}},trusted);
  rejects('localValues',{...command,valuesOverlay:{unknown:1}},trusted);
  rejects('localValues',command,{...trusted,rendererSession:true});
  rejects('draftUpdateRequest',{...draft(),valuesOverlay:command.valuesOverlay},trusted);
  const seek={...command,command:'seek',requestId:'seek_before_change',sequence:3,frameIndex:20,previewEpoch:0};
  delete seek.manifestHash;delete seek.valuesOverlay;delete seek.requestedEpoch;
  accepts('renderSeek',seek,trusted);
  for (const change of [{sessionId:'session_other'},{revisionId:'revision_old'},{targetId:'instagram_feed:square'},{frameIndex:450}]) {
    rejects('renderSeek',{...seek,...change},trusted);
    rejects('frameInspect',{...seek,...change,command:'inspect',x01:0.5,y01:0.5},trusted);
  }
  rejects('renderSeek',seek,{...trusted,disposed:true});
  rejects('frameInspect',{...seek,command:'inspect',x01:0.5,y01:0.5},{...trusted,disposed:true});
  const response={...seek,event:'preview-frame-ready',manifestHash:sha};delete response.command;
  rejects('localPreviewReady',response,{...trusted,previewEpoch:1,seekCommand:seek});
  rejects('renderSeek',seek,{...trusted,previewEpoch:1});
  const inspect={...seek,command:'inspect',x01:0.5,y01:0.5};
  const hit={...response,event:'hit-result',hit:null};
  rejects('frameHitResult',hit,{...trusted,previewEpoch:1,inspectCommand:inspect});
  const currentInspect={...inspect,previewEpoch:1},currentHit={...hit,previewEpoch:1};
  accepts('frameHitResult',currentHit,{...trusted,previewEpoch:1,inspectCommand:currentInspect});
  rejects('frameHitResult',{...currentHit,manifestHash:otherSha},{...trusted,previewEpoch:1,inspectCommand:currentInspect});
});

test('a rejected values update preserves the applied epoch and a corrected retry can succeed', () => {
  const session=preview(),trusted={...previewContext(),previewSession:session,previewEpoch:0,lastSequence:1};
  const command={protocolVersion:'2.7.0',sessionId:session.sessionId,requestId:'values_rejected',sequence:2,
    revisionId:session.revisionId,targetId:session.targetId,command:'set-values',manifestHash:sha,
    requestedEpoch:1,valuesOverlay:{background:'bad'}};
  const rejected={...command,event:'values-rejected',appliedEpoch:0,code:'VALUES_INVALID'};
  delete rejected.command;delete rejected.valuesOverlay;
  accepts('localValuesRejected',rejected,{...trusted,valuesCommand:command});
  rejects('localValuesRejected',{...rejected,appliedEpoch:1},{...trusted,valuesCommand:command});
  const retry={...command,requestId:'values_retry',sequence:3,valuesOverlay:{background:'#ABCDEF'}};
  accepts('localValues',retry,{...trusted,lastSequence:2});
  assert.equal(localPreviewValues(retry.valuesOverlay,trusted).background,'#abcdef');
  const applied={...retry,event:'values-applied',appliedEpoch:1};delete applied.command;delete applied.valuesOverlay;
  accepts('localValuesApplied',applied,{...trusted,valuesCommand:retry});
  rejects('localValuesApplied',{...applied,requestId:command.requestId},{...trusted,valuesCommand:retry});
  rejects('localValuesApplied',{...applied,appliedEpoch:0},{...trusted,valuesCommand:retry});
  rejects('localValuesApplied',applied,{...trusted,valuesCommand:retry,previewEpoch:1});
  rejects('localValuesApplied',applied,{...trusted,valuesCommand:retry,rendererSession:true});
  const seek={...retry,command:'seek',requestId:'seek_applied',sequence:4,frameIndex:20,previewEpoch:1};
  delete seek.requestedEpoch;delete seek.valuesOverlay;delete seek.manifestHash;
  accepts('renderSeek',seek,{...trusted,previewEpoch:1,lastSequence:3});
  rejects('renderSeek',seek,{...trusted,previewEpoch:0,lastSequence:3});
});

test('all render profile consumers use the configured standard and motion combinations', () => {
  const base={sampling:'centered-box-v1',edgePolicy:'clamp-v1'};
  for (const [sampleCount,shutterAngle] of [[1,0],[4,180],[8,180]]) accepts('renderProfile',{...base,sampleCount,shutterAngle},{});
  for (const [sampleCount,shutterAngle] of [[1,180],[4,0],[8,90],[4,360]]) rejects('renderProfile',{...base,sampleCount,shutterAngle},{});
});

test('inspect has its own wire command and a bound response from declared regions', () => {
  const command = {protocolVersion:'2.7.0',sessionId:'session_preview',requestId:'request_inspect',sequence:2,
    revisionId:'revision_current',targetId:'tiktok:portrait',command:'inspect',frameIndex:20,x01:0.2,y01:0.1};
  const hit = {...command,event:'hit-result',manifestHash:sha,
    hit:{regionId:'headline_region',sourcePath:'src/main.ts',line:12,bounds:{x:100,y:100,width:400,height:100}}};
  delete hit.command; delete hit.x01; delete hit.y01;
  const trusted = {...scope,totalFrames:450,manifestHash:sha,inspectCommand:command,
    regions:{headline_region:{sourcePath:'src/main.ts',line:12}},
    regionBounds:{headline_region:{x:100,y:100,width:400,height:100}}};
  accepts('frameInspect',command,trusted); accepts('frameHitResult',hit,trusted);
  rejects('renderSeek',command,trusted);
  rejects('frameHitResult',{...hit,requestId:'request_other'},trusted);
  rejects('frameHitResult',{...hit,manifestHash:otherSha},trusted);
  rejects('frameHitResult',{...hit,hit:{...hit.hit,sourcePath:'../secrets'}},trusted);
  rejects('frameHitResult',{...hit,hit:{...hit.hit,regionId:'undeclared'}},trusted);
  rejects('frameHitResult',hit,{...trusted,disposed:true});
  const overlapping={...trusted,width:1080,height:1920,
    regions:{...trusted.regions,top_region:{sourcePath:'src/main.ts',line:13}},
    regionBounds:{...trusted.regionBounds,top_region:hit.hit.bounds},regionOrder:['headline_region','top_region']};
  rejects('frameHitResult',hit,overlapping);
  accepts('frameHitResult',{...hit,hit:{...hit.hit,regionId:'top_region',line:13}},overlapping);
  const edge={...command,x01:1};
  accepts('frameInspect',edge,overlapping);
  accepts('frameHitResult',{...hit,hit:null},{...overlapping,inspectCommand:edge});
  rejects('frameHitResult',hit,{...overlapping,inspectCommand:edge});
});

test('source values are complete, typed and derived from the sole static declaration set', () => {
  const values = envelope('source_values',{values:{headline:'Start with your product.',background:'#123456',beat:12}});
  accepts('sourceValues',values);
  const missing = clone(values); delete missing.values.beat;
  rejects('sourceValues',missing);
  rejects('sourceValues',{...values,values:{...values.values,unknown:true}});
  rejects('sourceValues',{...values,values:{...values.values,beat:450}});
  rejects('sourceValues',{...values,values:{...values.values,background:'#ABCDEF'}});
  const large={...context(),editables:{table:{id:'table',label:'Table',type:'data'}},sourceValues:{table:[]}};
  const rows=Array.from({length:180},()=>({text:'x'.repeat(6000)}));
  assert.throws(()=>localPreviewValues({table:rows},large),/SOURCE_VALUES_TOO_LARGE/);
});

test('editable assets use the trusted drawable catalog and one shared path rule', () => {
  const trusted={...context(),editables:{art:{id:'art',label:'Art',type:'asset'}},sourceValues:{art:'media/allowed.png'},
    resources:{'media/allowed.png':{mediaType:'image/png'},'media/evidence.png':{mediaType:'image/png'},
      'media/license.pdf':{mediaType:'application/pdf'}},drawableResourcePaths:['media/allowed.png','media/license.pdf']};
  assert.equal(localPreviewValues({},trusted).art,'media/allowed.png');
  for (const path of ['media/evidence.png','media/license.pdf','%2e%2e/private.png','C:/private.png','media/x?token']) {
    trusted.resources[path] ??= {mediaType:'image/png'};
    assert.throws(()=>localPreviewValues({art:path},trusted),/EDITABLE_ASSET_UNAVAILABLE/);
  }
});

test('runtime media declarations bind exact source intervals, font bytes and audio marker timing', () => {
  const time = numerator => ({numerator,denominator:1});
  const declarations = envelope('runtime_declarations',{editables:Object.values(definitions),
    markers:[{id:'impact',label:'Impact',frame:30,audioEventId:'audio_impact'}],
    regions:[{id:'headline_region',label:'Headline',sourcePath:'src/main.ts',line:12}],
    videoUses:[{id:'demo',assetPath:'media/demo.mp4',sourceStart:time(2),sourceEndExclusive:time(7),timelineStart:time(1),playbackRate:time(1)}],
    fonts:[{registryVersion:'registry_test',fontId:'font_test',weights:[400],fallbackFontIds:[],
      assets:[{weight:400,path:'fonts/test.woff2',sha256:sha}]}]});
  const trusted = {...context(),totalFrames:450,audioEvents:[{eventId:'audio_impact',frameStart:30}],drawableResourcePaths:['media/demo.mp4'],
    sharedEditables:Object.values(definitions),
    resources:{'media/demo.mp4':{mediaType:'video/mp4'},'fonts/test.woff2':{mediaType:'font/woff2',sha256:sha}},
    videoSources:{'media/demo.mp4':{duration:time(10)}},fontRegistry:{font_test:{registryVersion:'registry_test',weights:[400]}}};
  accepts('runtimeDeclarations',declarations,trusted);
  accepts('runtimeDeclarations',declarations,{...trusted,audioEvents:[{eventId:'audio_other',frameStart:30},...trusted.audioEvents]});
  rejects('runtimeDeclarations',declarations,{...trusted,audioEvents:[{eventId:'audio_other',frameStart:30}]});
  rejects('runtimeDeclarations',declarations,{...trusted,sharedEditables:Object.values(definitions).slice(0,2)});
  rejects('runtimeDeclarations',declarations,{...trusted,drawableResourcePaths:[]});
  for (const mutate of [
    v => { v.videoUses[0].sourceEndExclusive=time(11); },
    v => { v.videoUses[0].timelineStart=time(12); },
    v => { v.videoUses[0].playbackRate=time(0); },
    v => { v.markers[0].frame=31; },
    v => { v.fonts[0].assets[0].sha256=otherSha; },
    v => { v.fonts[0].fallbackFontIds=['font_missing']; },
    v => { v.editables[1].factId='fact_color'; }
  ]) { const value=clone(declarations); mutate(value); rejects('runtimeDeclarations',value,trusted); }
});

test('fact edits share final values byte limits, declared types and visible text checks with draft saves',()=>{
  const trusted=context(),changes=[];
  for (let i=0;i<100;i++) {
    const id='fact_text_'+i,factId='fact_'+i;
    trusted.editables[id]={id,label:id,type:'text',factId};trusted.sourceValues[id]='Old';
    changes.push({action:'upsert',factId,expectedVersion:1,text:'汉'.repeat(6000),evidence:[]});
  }
  const request=envelope('facts_update_request',{requestId:'large_facts',projectId:scope.projectId,baseRevision:trusted.currentRevisionId,changes});
  assert.ok(errors('factsUpdateRequest',request,trusted).some(error=>error.includes('VALUES') && error.includes('LARGE')));
  for (const text of ['\u200b','\u200d','\u3164','   ']) {
    const value={...request,changes:[{action:'upsert',factId:'fact_headline',expectedVersion:7,text,evidence:[]}]};
    assert.ok(errors('factsUpdateRequest',value,trusted).includes('EMPTY_FACT'));
  }
  const valid={...request,changes:[{action:'upsert',factId:'fact_headline',expectedVersion:7,text:'A visible 👩‍💻 name.',evidence:[]}]};
  accepts('factsUpdateRequest',valid,trusted);
  const invalid=context();invalid.sourceValues.background='not a color';
  assert.ok(errors('draftUpdateRequest',draft(),invalid).includes('EDITABLE_COLOR_INVALID'));
  assert.ok(errors('factsUpdateRequest',valid,invalid).includes('EDITABLE_COLOR_INVALID'));
});

function candidateCase(overrides={}) {
  const candidate=envelope('candidate_result',{projectId:scope.projectId,runId:'run_candidate',operation:'creative_generate',
    baseRevision:null,candidateRevisionId:'revision_candidate',state:'ready',affectedTargetIds:['tiktok:portrait'],
    agentInterpretation:'Show the product launch.',impactSummary:'Creates the opening and closing scenes.',...overrides});
  const reviewedHash=digest(candidateOutputIdentity(candidate,'tiktok:portrait',sha));
  const observation={subjectHash:reviewedHash,targetId:'tiktok:portrait',representation:'trusted_media',
    textPresent:true,audioPresent:true,evidenceRef:'candidate_modality_observation'};
  const manifest={schemaVersion:'2.7.0',kind:'output_safety_coverage_manifest',subjectHash:reviewedHash,targetId:'tiktok:portrait',
    representation:'trusted_media',samplingPolicyVersion:'sample_v1',textHashes:[digest('approved text')],frameCount:450,
    frames:[{frameIndex:0,sha256:digest('approved frame')}],durationMs:15000,
    audioSegments:[{startMs:0,endMs:15000,sha256:digest('approved audio')}],runtimeStateHash:null,modalityObservationHash:digest(observation)};
  const receipt={schemaVersion:'2.7.0',kind:'output_safety_result',resultId:'safety_candidate',projectId:scope.projectId,
    operationId:'operation_candidate',revisionId:candidate.candidateRevisionId,targetId:'tiktok:portrait',subjectKind:'candidate',
    subjectHash:reviewedHash,policyVersion:'safety_v1',representation:'trusted_media',coverage:['text','visual','audio'],status:'allowed',
    checkedAt:'2026-10-21T00:00:00Z',evidenceRefs:['evidence_1'],coverageManifestHash:digest(manifest)};
  const options={policyVersion:'safety_v1',representation:'trusted_media',requiredCoverage:['text','visual','audio'],
    nowMs:Date.parse('2026-10-21T00:01:00Z'),revokedResultIds:[],coverageManifest:manifest,
    coveragePolicy:{version:'sample_v1',frameCount:450,durationMs:15000,requiredFrameIndices:[0],modalityObservation:observation}};
  const trusted={...scope,actorUserId:'user_1',operationId:'operation_candidate',candidateContentHashes:{'tiktok:portrait':sha},
    candidateSafetyChecks:{'tiktok:portrait':{receipt,options}}};
  const request=envelope('candidate_action_request',{requestId:'accept_1',projectId:scope.projectId,baseRevision:null,
    candidateRevisionId:candidate.candidateRevisionId});
  return {candidate,trusted,request,book:new CandidateReference({...scope,candidates:[candidate]})};
}
test('candidate controller replays stored results before state and safety checks, preserving authorization',()=>{
  const {book,request,trusted}=candidateCase();
  const result=book.decide('accept',request,trusted);
  assert.equal(result.state,'accepted');
  assert.equal(book.currentRevisionId,result.candidateRevisionId);
  const changed={...trusted,candidateContentHashes:{},candidateSafetyChecks:{}};
  assert.deepEqual(book.decide('accept',request,changed),result);
  assert.throws(()=>book.decide('reject',request,trusted),/IDEMPOTENCY_CONFLICT/);
  assert.throws(()=>book.decide('accept',{...request,baseRevision:'changed'},trusted),/IDEMPOTENCY_CONFLICT/);
  assert.throws(()=>book.decide('accept',request,{...trusted,authorized:false}),/FORBIDDEN/);
  assert.throws(()=>book.decide('accept',request,{...trusted,workspaceId:'other'}),/FORBIDDEN/);
  assert.throws(()=>book.decide('accept',{...request,requestId:'new_request'},trusted),/CANDIDATE_NOT_READY/);
  assert.equal(book.requests.size,1);
});
test('candidate acceptance derives permission from each actual target; cancellation leaves accepted drafts intact',()=>{
  const denied=candidateCase();
  assert.throws(()=>denied.book.decide('accept',denied.request,{...denied.trusted,safetyAllowed:true,candidateSafetyChecks:{}}),/CANDIDATE_SAFETY_REQUIRED/);
  assert.equal(denied.book.currentRevisionId,null);
  denied.book.candidates.get(denied.candidate.candidateRevisionId).impactSummary='Unreviewed replacement';
  assert.throws(()=>denied.book.decide('accept',denied.request,denied.trusted),/OUTPUT_SAFETY_SCOPE_MISMATCH/);
  const {book,request,trusted,candidate}=candidateCase();
  assert.equal(book.cancelRun(candidate.runId,trusted)[0].state,'cancelled');
  assert.deepEqual(book.cancelRun(candidate.runId,trusted),[]);
  assert.throws(()=>book.decide('accept',request,trusted),/CANDIDATE_NOT_READY/);
  const accepted=candidateCase();accepted.book.decide('accept',accepted.request,accepted.trusted);
  assert.deepEqual(accepted.book.cancelRun(accepted.candidate.runId,accepted.trusted),[]);
  const rejected=candidateCase();const result=rejected.book.decide('reject',rejected.request,rejected.trusted);
  assert.deepEqual(rejected.book.decide('reject',rejected.request,rejected.trusted),result);
  assert.equal(rejected.book.currentRevisionId,null);
});

test('run responses withhold all creative prose until the exact text bundle is approved',()=>{
  const result=envelope('run_result',{runId:'run_plan',operationId:'operation_plan',baseRevision:null,state:'validating',
    phase:'text_review',generation:1,candidateRevisionId:null,outputStatus:'withheld',
    usage:{inputTokens:1,cachedInputTokens:0,outputTokens:1,activeSeconds:1,costMicros:1,internalRepairs:0}});
  accepts('runResult',result);
  rejects('runResult',{...result,directions:[]});
  const ready={...result,outputStatus:'allowed',treatment:{totalFrames:450,beats:[{frameStart:0,frameEndExclusive:450,event:'Show the product.'}]}};
  const subjectHash=digest(creativePlanIdentity(ready));
  const observation={subjectHash,targetId:null,representation:'text',textPresent:true,audioPresent:false,evidenceRef:'plan_modality_observation'};
  const manifest={schemaVersion:'2.7.0',kind:'output_safety_coverage_manifest',subjectHash,targetId:null,representation:'text',
    samplingPolicyVersion:'plan_text_v1',textHashes:[subjectHash],frameCount:null,frames:[],durationMs:null,audioSegments:[],runtimeStateHash:null,modalityObservationHash:digest(observation)};
  const check={receipt:{schemaVersion:'2.7.0',kind:'output_safety_result',resultId:'plan_safety',projectId:scope.projectId,
    operationId:ready.operationId,revisionId:null,targetId:null,subjectKind:'creative_plan',subjectHash,
    policyVersion:'safety_v1',representation:'text',coverage:['text'],status:'allowed',checkedAt:'2026-10-21T00:00:00Z',
    evidenceRefs:['plan_evidence'],coverageManifestHash:digest(manifest)},options:{policyVersion:'safety_v1',representation:'text',
      requiredCoverage:['text'],nowMs:Date.parse('2026-10-21T00:01:00Z'),revokedResultIds:[],coverageManifest:manifest,
      coveragePolicy:{version:'plan_text_v1',modalityObservation:observation}}};
  assert.ok(errors('runResult',ready,context()).includes('OUTPUT_SAFETY_REQUIRED'));
  accepts('runResult',ready,{...context(),planSafetyCheck:check});
  const changed=clone(ready);changed.treatment.beats[0].event='Unreviewed replacement.';
  assert.ok(errors('runResult',changed,{...context(),planSafetyCheck:check}).includes('OUTPUT_SAFETY_SCOPE_MISMATCH'));
});

function localSafetyCheck() {
  const {trusted}=candidateCase(),check=clone(trusted.candidateSafetyChecks['tiktok:portrait']);
  Object.assign(check.receipt,{subjectKind:'preview',revisionId:'revision_current',operationId:null,subjectHash:sha,representation:'verified_local_runtime'});
  Object.assign(check.options.coverageManifest,{subjectHash:sha,representation:'verified_local_runtime',runtimeStateHash:otherSha});
  Object.assign(check.options.coveragePolicy.modalityObservation,{subjectHash:sha,representation:'verified_local_runtime'});
  check.options.coverageManifest.modalityObservationHash=digest(check.options.coveragePolicy.modalityObservation);
  check.receipt.coverageManifestHash=digest(check.options.coverageManifest);
  Object.assign(check.options,{representation:'verified_local_runtime'});
  check.options.coveragePolicy.runtimeStateHash=otherSha;
  return check;
}
