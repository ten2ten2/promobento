import test from 'node:test';
import assert from 'node:assert/strict';
import {load, validateSchema, semanticErrors, canonical, digest, contentIdentity, factContentIdentity, variantIdentity, outputArtifactIdentity as markedArtifactIdentity, resourceRightsErrors, targets, presets, safePath, transition, QuotaReference, RevisionReference, TrialReference, OperationBudgetReference, CheckoutReference, matchesFrameReady, matchesSampleReady, matchesProtocolFailure, sampleTime, audioIdentity, qaInputIdentity, hasCalibratedCostLimits} from './contract-validation.mjs';
const c = load('contracts/composition.example.json'), r = load('contracts/release-snapshot.example.json'), edit = load('contracts/edit-request.example.json');
const outputArtifactIdentity = (composition, variant, kind, rules = presets) => markedArtifactIdentity(composition,variant,kind,r.markingProfileVersion,rules);
const clone = x => structuredClone(x), invalid = v => semanticErrors(v, {composition:c}).length > 0;
for (const name of ['composition','release-snapshot','edit-request','fact-manifest','export-manifest','resource-manifest']) test('positive contract: '+name, () => assert.deepEqual(semanticErrors(load('contracts/'+name+'.example.json'), {composition:c}), []));
const protocol = load('tests/contracts/protocol-fixtures.json').valid;
for (const [name,v] of Object.entries(protocol)) test('protocol structure: '+name,()=>assert.deepEqual(validateSchema(v),[]));
const mutateCases = [
 ['45 seconds',c,x=>{x.durationSeconds=45;}],['fps 60',c,x=>{x.fps=60;}],['frame arithmetic',c,x=>{x.totalFrames=450;}],
 ['illegal target pairing',c,x=>{x.variants[0].aspectId='square';x.variants[0].targetId='tiktok:square';}],
 ['missing frozen variants',c,x=>{x.variants.pop();}],['duplicate variant',c,x=>{x.variants.push(x.variants[0]);}],
 ['unknown preset',c,x=>{x.variants[0].presetId='fake';}],['unknown preset version',c,x=>{x.variants[0].presetVersion='99';}],
 ['path traversal',c,x=>{x.variants[0].entrypoint='../server.key';}],['absolute source path',c,x=>{x.variants[0].entrypoint='/app/key';}],
 ['encoded path traversal',c,x=>{x.variants[0].entrypoint='%2e%2e/key';}],['cover out of range',c,x=>{x.variants[0].coverFrame=900;}],
 ['website theme contamination',c,x=>{x.themePreference='dark';}],['unknown manifest field',c,x=>{x.arbitrary=1;}],
 ['edit last frame overflow',edit,x=>{x.comments[0].frameIndex=900;}],['edit negative frame',edit,x=>{x.comments[0].frameIndex=-1;}],
 ['edit noninteger frame',edit,x=>{x.comments[0].frameIndex=1.5;}],['coordinate out of range',edit,x=>{x.comments[0].normalizedPoint.x=1.1;}],
 ['stale edit revision',edit,x=>{x.baseRevision='old';}],['bad hash',c,x=>{x.sourceArchiveHash='not-hash';}],
 ['release cross project',r,x=>{x.projectId='other';}],['release altered code',r,x=>{x.variants[0].sourceHash='a'.repeat(64);}],
 ['release unprepared target',r,x=>{x.variants.pop();}],['release bad manifest identity',r,x=>{x.compositionHash='b'.repeat(64);}],
 ['unapproved frame count',c,x=>{x.totalFrames=899;}]
];
for (const [name,base,mutate] of mutateCases) test(name,()=>{const x=clone(base);mutate(x);assert.ok(invalid(x));});
test('custom style is not a closed enum',()=>{const x=clone(c);x.styleLabel='自定义云墨 Shader';assert.deepEqual(semanticErrors(x),[]);});
test('mixed languages, metadata optional',()=>{const x=clone(c);delete x.textMetadata;assert.deepEqual(semanticErrors(x),[]);});
test('unprepared candidate allowed, release forbidden',()=>{const x=clone(c);x.releaseEligible=false;x.variants=x.variants.slice(0,1);assert.deepEqual(semanticErrors(x),[]);x.releaseEligible=true;assert.ok(invalid(x));});
test('fixtures rejected by production gate',()=>assert.ok(semanticErrors(c,{production:true}).includes('FIXTURE_IN_PRODUCTION')));
test('canonical keys stable but text not normalized',()=>{assert.equal(digest({b:1,a:2}),digest({a:2,b:1}));assert.notEqual(digest('é'),digest('e\u0301'));assert.throws(()=>canonical({x:NaN}));});
test('revision IDs and QA do not create new content identity',()=>{const x=clone(c);x.revisionId='rev_new';x.variants[0].qaReportHash='d'.repeat(64);assert.equal(digest(contentIdentity(x)),digest(contentIdentity(c)));});
test('7 legal targets, square restricted to feed',()=>{assert.equal(targets().length,7);assert.deepEqual(targets().filter(x=>x.aspectId==='square').map(x=>x.presetId),['instagram_feed']);});
for (const path of ['../x','x/../y','https://example.com','x\\y','%252e%252e/x','/tmp/x','x//y','x\u0000y']) test('reject path '+JSON.stringify(path),()=>assert.equal(safePath(path),false));
test('confirmed fact binding required',()=>{const f=load('contracts/fact-manifest.example.json');f.bindings[0].factIds=['unknown'];assert.ok(invalid(f));});
test('new commercial claim rejected',()=>{const f=load('contracts/fact-manifest.example.json');f.bindings[0].expectedText='Guaranteed 1000%';assert.ok(invalid(f));});
function qa(){return {schemaVersion:'2.5.0',kind:'quality_report',projectId:c.projectId,revisionId:c.revisionId,targetId:'tiktok:portrait',sourceHash:c.sourceArchiveHash,factManifestHash:c.factManifestHash,checkerVersion:'quality-engine-v1',qaProfileVersion:r.qaProfileVersion,qaInputHash:digest(qaInputIdentity(c,c.variants[0],r.qaProfileVersion)),coverage:'fixture_only',evidenceRefs:[],findings:[{code:'READING_HOLD',level:'REVIEW',frameStart:0,frameEndExclusive:30,message:'fixture',waiver:{actorId:'user',reason:'planned hold',revisionId:c.revisionId,targetId:'tiktok:portrait',expiresAt:'2026-10-21T00:00:00Z'}}]};}
test('BLOCK cannot be waived',()=>{const q=qa();q.findings[0].level='BLOCK';assert.ok(invalid(q));});
test('QA hashes bind inputs without referring to the report itself',()=>{
  const x=clone(c),before=digest(qaInputIdentity(x,x.variants[0],r.qaProfileVersion));
  x.variants[0].qaReportHash=digest('replacement report');
  assert.equal(digest(qaInputIdentity(x,x.variants[0],r.qaProfileVersion)),before);
  assert.equal(digest(contentIdentity(x)),digest(contentIdentity(c)));
});
for(const [name,change] of [
  ['cover',x=>{x.variants[0].coverFrame++;}],
  ['layout',x=>{x.layoutRulesHash=digest('new layout');}],
  ['dependency',x=>{x.dependencyManifestHash=digest('new dependencies');}],
  ['resource',x=>{x.variants[0].resourceManifestHash=digest('new resources');}],
  ['audio',x=>{x.variants[0].audioHash=digest('new audio');}],
  ['source',x=>{x.variants[0].sourceHash=digest('new source');}],
  ['override',x=>{x.variants[0].targetOverrideHash=digest('new override');}],
  ['runtime',x=>{x.runtimeVersion='changed-runtime';}],
  ['renderer',x=>{x.rendererImageDigest='sha256:'+digest('new renderer');}],
  ['sampling',x=>{x.renderProfile=clone(presets.renderProfiles.motion4);}],
  ['seed',x=>{x.seed='new-seed';}]
]) test('same revision still rejects stale QA after '+name,()=>{
  const x=clone(c);change(x);assert.ok(semanticErrors(qa(),{composition:x}).includes('STALE_QA_INPUT'));
});
test('new revision rejects old QA even when visual inputs match',()=>{
  const x=clone(c);x.revisionId='new_revision';
  assert.ok(semanticErrors(qa(),{composition:x}).includes('REVISION_MISMATCH'));
});
test('render profile changes output and QA identity without charging another version',()=>{
  const x=clone(c);x.renderProfile=clone(presets.renderProfiles.motion4);
  assert.deepEqual(semanticErrors(x),[]);
  assert.equal(digest(contentIdentity(x)),digest(contentIdentity(c)));
  assert.notEqual(digest(outputArtifactIdentity(x,x.variants[0],'video')),digest(outputArtifactIdentity(c,c.variants[0],'video')));
  assert.notEqual(digest(qaInputIdentity(x,x.variants[0],r.qaProfileVersion)),digest(qaInputIdentity(c,c.variants[0],r.qaProfileVersion)));
});
test('subframe samples use exact centered time and clamp both ends',()=>{
  const profile=presets.renderProfiles.motion4;
  assert.deepEqual(sampleTime(240,0,profile,900),{numerator:1279,denominator:160});
  assert.deepEqual(sampleTime(0,0,profile,900),{numerator:0,denominator:1});
  assert.deepEqual(sampleTime(0,2,profile,900),{numerator:1,denominator:480});
  assert.deepEqual(sampleTime(449,3,profile,450),{numerator:449,denominator:30});
  assert.deepEqual(sampleTime(240,0,c.renderProfile,900),{numerator:8,denominator:1});
});
for(const n of [undefined,NaN,Infinity,-1,0,449,900.5]) test('reject invalid sample frame count '+String(n),()=>assert.throws(()=>sampleTime(0,0,c.renderProfile,n),/INVALID_SAMPLE/));
test('sample bounds and shutter are validated before timing',()=>{
  assert.throws(()=>sampleTime(900,0,c.renderProfile,900));
  assert.throws(()=>sampleTime(0,1,c.renderProfile,900));
  assert.throws(()=>sampleTime(0,0,{...c.renderProfile,shutterAngle:180},900),/INVALID_SHUTTER/);
  assert.ok(semanticErrors({...clone(c),renderProfile:{...c.renderProfile,shutterAngle:180}}).includes('RENDER_PROFILE_UNAVAILABLE'));
});
test('sample replies require an internal renderer session and exact identity',()=>{
  const ctx={rendererSession:true,composition:c},cmd=protocol.render_sample,response=protocol.render_sample_ready,hash=protocol.render_init.manifestHash;
  assert.equal(matchesSampleReady(cmd,response,hash,ctx),true);
  assert.equal(matchesSampleReady(cmd,response,hash,{composition:c}),false);
  assert.equal(matchesSampleReady(cmd,response,hash,ctx,true),false);
  for(const key of ['sampleIndex','sequence','frameIndex','requestId','targetId','manifestHash']){
    const bad=clone(response);bad[key]=typeof bad[key]==='number'?bad[key]+1:'stale';
    assert.equal(matchesSampleReady(cmd,bad,hash,ctx),false);
  }
  assert.equal(matchesFrameReady(protocol.render_seek,response,hash),false);
  assert.equal(matchesSampleReady(cmd,protocol.render_ready,hash,ctx),false);
  assert.ok(validateSchema(cmd,load('contracts/production.schema.json').$defs.renderCommand).length);
  assert.ok(matchesProtocolFailure(cmd,protocol.render_error));
});
test('state happy path',()=>{let s=transition('queued','start');s=transition(s,'candidate');assert.equal(transition(s,'pass',{authorized:true,generationMatches:true,qaPassed:true}),'succeeded');});
for (const state of ['succeeded','failed','cancelled']) test('terminal state '+state,()=>assert.throws(()=>transition(state,'start')));
test('resume rechecks membership/base/budget/window',()=>{const g={authorized:true,baseMatches:true,withinWindow:true,remainingBudget:1};assert.equal(transition('paused_budget','resume',g),'queued');for(const k of Object.keys(g))assert.throws(()=>transition('paused_budget','resume',{...g,[k]:false}));});
test('two repairs maximum',()=>{assert.equal(transition('validating','repair',{repairs:1,remainingBudget:1}),'active');assert.throws(()=>transition('validating','repair',{repairs:2,remainingBudget:1}));});
test('late generation cannot publish',()=>assert.throws(()=>transition('validating','pass',{authorized:true,qaPassed:true,generationMatches:false})));
test('duplicate reservation and delivery consume once',()=>{const q=new QuotaReference(1);q.reserve('a','hash');q.reserve('a','hash');q.deliver('a',true);q.deliver('a',true);assert.equal(q.available,0);q.cancel('a');assert.equal(q.available,0);assert.throws(()=>q.reserve('a','other'));});
test('failure/cancel release once',()=>{const q=new QuotaReference(1);q.reserve('a','h');assert.throws(()=>q.deliver('a',false));q.cancel('a');q.cancel('a');assert.equal(q.available,1);});
test('concurrent last unit guards',()=>{const q=new QuotaReference(1);q.reserve('a','h');assert.throws(()=>q.reserve('b','h'));});
test('CAS accept, replay and competing patch',()=>{const x=new RevisionReference('base');assert.equal(x.apply('req','base','new',true),'new');assert.equal(x.apply('req','base','new',true),'new');assert.throws(()=>x.apply('other','base','newer',true));assert.throws(()=>x.apply('req','base','different',true));assert.equal(x.current,'new');});
test('revoked actor cannot apply a repeated request',()=>{const x=new RevisionReference('base');x.apply('r','base','new',true);assert.throws(()=>x.apply('r','base','new',false));});
test('exact ready accepted',()=>assert.ok(matchesFrameReady(protocol.render_seek,protocol.render_ready,protocol.render_init.manifestHash)));
for (const field of ['sequence','sessionId','requestId','revisionId','targetId','frameIndex','manifestHash']) test('stale ready '+field,()=>{const x=clone(protocol.render_ready);x[field]=typeof x[field]==='number'?999:'old';assert.equal(matchesFrameReady(protocol.render_seek,x,protocol.render_init.manifestHash),false);});
test('dispose invalidates ready',()=>assert.equal(matchesFrameReady(protocol.render_seek,protocol.render_ready,protocol.render_init.manifestHash,true),false));
test('preset controls renderer dimensions',()=>{const x=clone(protocol.render_init);assert.deepEqual(semanticErrors(x,{composition:c}),[]);x.width=1000;assert.ok(invalid(x));});
test('renderer manifest and frame identity',()=>{for(const k of ['manifestHash','frameCount','seed']){const x=clone(protocol.render_init);x[k]=k==='frameCount'?450:'a'.repeat(64);assert.ok(invalid(x));}});
test('fact manifest hash links exact source revision',()=>{const f=load('contracts/fact-manifest.example.json');assert.deepEqual(semanticErrors(c,{factManifest:f}),[]);f.facts[0].text='edited';assert.ok(semanticErrors(c,{factManifest:f}).includes('FACT_MANIFEST_HASH_MISMATCH'));});
test('API errors allow only safe params',()=>{const rule=load('contracts/production.schema.json').$defs.error;const e={code:'STALE_BASE',messageKey:'errors.staleBase',message:'Review changes',requestId:'req_error',retryable:false,params:{currentRevision:'revision'},fieldErrors:[{code:'INVALID',field:'baseRevision',messageKey:'errors.invalid',params:{min:1}}]};assert.deepEqual(validateSchema(e,rule),[]);e.params.secret={raw:'no nesting'};assert.ok(validateSchema(e,rule).length);});
test('export links exact composition bytes',()=>{const x=load('contracts/export-manifest.example.json');x.compositionHash='b'.repeat(64);assert.ok(invalid(x));});
test('export links snapshot, not current draft',()=>{const x=load('contracts/export-manifest.example.json');assert.deepEqual(semanticErrors(x,{composition:c,snapshot:r}),[]);x.snapshotHash='d'.repeat(64);assert.ok(semanticErrors(x,{composition:c,snapshot:r}).includes('EXPORT_SNAPSHOT_MISMATCH'));});
// Current contracts: identities, actual export outputs, pinned rules, and failure envelopes.
test('confirmation metadata does not charge new content',()=>{const f=load('contracts/fact-manifest.example.json'),x=clone(f);x.revisionId='another';x.facts[0].confirmedBy='another';x.facts[0].confirmedAt='2026-10-20T03:00:00Z';x.bindings[0].coverage='reviewed';assert.notEqual(digest(x),digest(f));assert.equal(digest(factContentIdentity(x)),digest(factContentIdentity(f)));});
test('labels and report hashes are not content edits',()=>{const x=clone(c);x.styleLabel='another label';x.factManifestHash='e'.repeat(64);x.projectId='other';x.releaseEligible=false;assert.equal(digest(contentIdentity(x)),digest(contentIdentity(c)));});
for(const key of ['seed','sourceArchiveHash','resourceManifestHash','dependencyManifestHash','layoutRulesHash','factContentHash','runtimeVersion','rendererImageDigest'])test('actual content change: '+key,()=>{const x=clone(c);x[key]=key+'-changed';assert.notEqual(digest(contentIdentity(x)),digest(contentIdentity(c)));});
test('cover frame changes cover not video cache',()=>{const v=clone(c.variants[0]);v.coverFrame++;assert.equal(digest(outputArtifactIdentity(c,v,'video')),digest(outputArtifactIdentity(c,c.variants[0],'video')));assert.notEqual(digest(outputArtifactIdentity(c,v,'cover')),digest(outputArtifactIdentity(c,c.variants[0],'cover')));assert.notEqual(digest(outputArtifactIdentity(c,v,'mapping')),digest(outputArtifactIdentity(c,c.variants[0],'mapping')));const x=clone(c);x.variants[0]=v;assert.notEqual(digest(contentIdentity(x)),digest(contentIdentity(c)));});
test('unsupported artifact kind rejected',()=>assert.throws(()=>outputArtifactIdentity(c,c.variants[0],'unknown')));
test('targets keep separate render caches even when layout and source match',()=>{const v=c.variants.find(v=>v.presetId==='tiktok'),w=c.variants.find(v=>v.presetId==='instagram_reels');assert.notEqual(digest(outputArtifactIdentity(c,v,'video')),digest(outputArtifactIdentity(c,w,'video')));assert.notEqual(digest(outputArtifactIdentity(c,v,'mapping')),digest(outputArtifactIdentity(c,w,'mapping')));});
test('export cache fingerprint must match frozen source',()=>{const x=load('contracts/export-manifest.example.json');x.artifacts[0].artifactFingerprint='f'.repeat(64);assert.ok(semanticErrors(x,{composition:c,snapshot:r}).includes('ARTIFACT_FINGERPRINT_MISMATCH'));});
for(const change of ['missing','no-hash','duplicate','wrong-target'])test('ready batch rejects '+change,()=>{const x=load('contracts/export-manifest.example.json');x.state='ready';for(const a of x.artifacts){a.state='ready';a.sha256=digest(a.id);}if(change==='missing')x.artifacts.pop();if(change==='no-hash')x.artifacts[0].sha256=null;if(change==='duplicate')x.artifacts.push(clone(x.artifacts[0]));if(change==='wrong-target')x.artifacts[0].targetId='tiktok:square';assert.ok(semanticErrors(x,{composition:c,snapshot:r}).length);});
test('complete ready batch passes',()=>{const x=load('contracts/export-manifest.example.json');x.state='ready';for(const a of x.artifacts){a.state='ready';a.sha256=digest(a.id);}assert.deepEqual(semanticErrors(x,{composition:c,snapshot:r}),[]);});
test('purchased pinned rules resolve independently of current defaults',()=>{const rules=clone(presets),x=clone(c);rules.rulesVersion='fixed-fixture-rules';x.presetRulesVersion=rules.rulesVersion;for(const p of rules.presets)p.version='fixture-version';for(const v of x.variants){v.presetVersion='fixture-version';v.variantHash=digest(variantIdentity(x,v,rules));}assert.ok(semanticErrors(x).length);assert.deepEqual(semanticErrors(x,{presetConfig:rules}),[]);});
test('unknown pinned rule never silently uses latest',()=>{const x=clone(c);x.presetRulesVersion='unavailable';assert.ok(semanticErrors(x).includes('PRESET_VERSION_UNAVAILABLE'));});
for(const change of ['source','facts','range','waiver','expiry'])test('QA provenance/interval '+change,()=>{const q=qa();if(change==='source')q.sourceHash='a'.repeat(64);if(change==='facts')q.factManifestHash='a'.repeat(64);if(change==='range')q.findings[0].frameEndExclusive=901;if(change==='waiver')q.findings[0].waiver.revisionId='other';if(change==='expiry')q.findings[0].waiver.expiresAt='2026-01-01T00:00:00Z';assert.ok(semanticErrors(q,{composition:c,now:Date.parse('2026-10-20T00:00:00Z')}).length);});
test('scoped future REVIEW waiver passes',()=>assert.deepEqual(semanticErrors(qa(),{composition:c,now:Date.parse('2026-10-20T00:00:00Z')}),[]));
test('format validation rejects impossible dates and unbounded labels',()=>{
  const q=qa();q.findings[0].waiver.expiresAt='2026-02-30T00:00:00Z';assert.ok(validateSchema(q).length);
  const rule=load('contracts/production.schema.json').$defs.direction.properties.label;
  assert.ok(validateSchema('x'.repeat(129),rule).length);
});
test('exact protocol failure accepted',()=>assert.ok(matchesProtocolFailure(protocol.render_seek,protocol.render_error)));
for(const key of ['sequence','sessionId','requestId','revisionId','targetId','protocolVersion'])test('stale failure '+key,()=>{const x=clone(protocol.render_error);x[key]=typeof x[key]==='number'?999:'other';assert.equal(matchesProtocolFailure(protocol.render_seek,x),false);});
test('disposed failure ignored',()=>assert.equal(matchesProtocolFailure(protocol.render_seek,protocol.render_error,true),false));
test('unknown failure code rejected',()=>{const x=clone(protocol.render_error);x.code='ARBITRARY';assert.equal(matchesProtocolFailure(protocol.render_seek,x),false);});

test('creative plan: optional direction fields and bounded events', () => {
  const x={
    schemaVersion:'2.5.0',kind:'run_result',runId:'run1',operationId:'op1',
    baseRevision:c.revisionId,state:'succeeded',phase:'final',generation:1,
    candidateRevisionId:c.revisionId,
    usage:{inputTokens:0,cachedInputTokens:0,outputTokens:0,activeSeconds:0,costMicros:0,internalRepairs:0},
    directions:[{id:'dir1',label:'Fit',logline:'Explain product',keyframeIds:['kf1'],look:'clear UI',palette:[{color:'#336699',usage:'accent'}],whyItFits:'real footage'}],
    treatment:{totalFrames:900,beats:[{frameStart:0,frameEndExclusive:450,event:'introduce'},{frameStart:450,frameEndExclusive:900,event:'show CTA'}]},
    audioPlan:{totalFrames:900,events:[{kind:'music',frameStart:0,frameEndExclusive:900,licenseRef:'CC0-cleared'}]}
  };
  assert.deepEqual(semanticErrors(x,{composition:c}),[]);
  x.usage.inputTokens=100000;x.usage.cachedInputTokens=80000;
  assert.deepEqual(semanticErrors(x,{composition:c}),[]);
  x.usage.cachedInputTokens=100001;
  assert.ok(semanticErrors(x,{composition:c}).includes('CACHED_TOKENS_EXCEED_INPUT'));
  x.usage.cachedInputTokens=80000;
  x.treatment.beats[1].frameEndExclusive=901;
  assert.ok(semanticErrors(x,{composition:c}).includes('TREATMENT_INTERVAL_INVALID'));
  x.treatment.beats[1].frameEndExclusive=900;
  x.audioPlan.events[0].frameEndExclusive=901;
  assert.ok(semanticErrors(x,{composition:c}).includes('AUDIO_EVENT_INTERVAL_INVALID'));
  x.audioPlan.events[0].frameEndExclusive=900;
  x.audioPlan.totalFrames=450;
  assert.ok(semanticErrors(x,{composition:c}).includes('CREATIVE_PLAN_DURATION_MISMATCH'));
});

// In-memory trusted-store inputs exercise fail-closed gates; no licenses, media or legal findings are verified here.
function provenanceCase() {
  const stripFixture = value => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(stripFixture);
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'exampleOnly').map(([key,v]) => [key,stripFixture(v)]));
  };
  const resource = stripFixture(load('contracts/resource-manifest.example.json'));
  const fact = stripFixture(load('contracts/fact-manifest.example.json'));
  const source = stripFixture(c), snapshot = stripFixture(r);
  const trusted = stripFixture(load('tests/contracts/provenance-fixtures.json').context);
  trusted.qualityReports = {};
  source.resourceManifestHash = digest(resource);
  source.factManifestHash = digest(fact); source.factContentHash = digest(factContentIdentity(fact));
  for (const variant of source.variants) {
    variant.resourceManifestHash = digest(resource);
    variant.audioHash = digest(audioIdentity(resource));
    variant.variantHash = digest(variantIdentity(source,variant));
    const report = {schemaVersion:'2.5.0',kind:'quality_report',projectId:source.projectId,revisionId:source.revisionId,
      targetId:variant.targetId,sourceHash:source.sourceArchiveHash,factManifestHash:source.factManifestHash,
      qaProfileVersion:trusted.qaProfileVersion,qaInputHash:digest(qaInputIdentity(source,variant,trusted.qaProfileVersion)),
      checkerVersion:trusted.qaProfiles[trusted.qaProfileVersion].checkerVersion,coverage:'sampled',evidenceRefs:['synthetic_qa_evidence'],findings:[]};
    variant.qaReportHash = digest(report); trusted.qualityReports[variant.qaReportHash] = report;
  }
  Object.assign(snapshot,{compositionHash:digest(source),contentHash:digest(contentIdentity(source)),variants:clone(source.variants),factManifestHash:source.factManifestHash});
  const context = {...trusted,production:true,composition:source,snapshot,factManifest:fact,
    resourceManifests:{[digest(resource)]:resource},resourceObservations:{[digest(resource)]:{resources:resource.resources.map(({path,sha256})=>({path,sha256})),audioEvents:clone(resource.audioEvents),mixedAudio:clone(resource.mixedAudio)}},markingEvidence:{},qualityEvidence:{}};
  const output = stripFixture(load('contracts/export-manifest.example.json'));
  Object.assign(output,{snapshotHash:digest(snapshot),compositionHash:digest(source),state:'ready'});
  for (const artifact of output.artifacts) {
    artifact.artifactFingerprint = digest(markedArtifactIdentity(source,source.variants[0],artifact.kind,output.markingProfileVersion));
    artifact.state = 'ready'; artifact.sha256 = digest('finished-'+artifact.id);
    if (artifact.kind === 'mapping') continue;
    artifact.qualityEvidenceRef = 'quality_'+artifact.id;
    context.qualityEvidence[artifact.qualityEvidenceRef] = {outputId:artifact.id,sha256:artifact.sha256,artifactFingerprint:artifact.artifactFingerprint,
      qaProfileVersion:output.qaProfileVersion,checkerVersion:trusted.qaProfiles[output.qaProfileVersion].checkerVersion,
      workspaceId:context.workspaceId,projectId:source.projectId,revisionId:source.revisionId,targetId:artifact.targetId,
      result:'passed',mixedAudioSha256:artifact.kind==='video'?resource.mixedAudio.sha256:null};
    artifact.markingEvidenceRef = 'marking_'+artifact.id;
    context.markingEvidence[artifact.markingEvidenceRef] = {outputId:artifact.id,sha256:artifact.sha256,artifactFingerprint:artifact.artifactFingerprint,
      profileVersion:output.markingProfileVersion,workspaceId:context.workspaceId,projectId:source.projectId,revisionId:source.revisionId,
      machineMarking:'verified',audienceDisclosure:'not_applicable'};
  }
  return {source,snapshot,resource,fact,output,context};
}
test('trusted provenance permits scoped preview and commercial publication',()=>{
  const x=provenanceCase();
  assert.deepEqual(resourceRightsErrors(x.resource.resources[0],x.context),[]);
  assert.deepEqual(semanticErrors(x.snapshot,x.context),[]);
  assert.deepEqual(semanticErrors(x.output,x.context),[]);
});
test('publication rejects missing, substituted and failing source QA',()=>{
  for(const mode of ['missing','substitute','block','review']){
    const x=provenanceCase(),variant=x.source.variants[0],report=x.context.qualityReports[variant.qaReportHash];
    if(mode==='missing')delete x.context.qualityReports[variant.qaReportHash];
    else if(mode==='substitute')report.qaInputHash=digest('unrelated inputs');
    else report.findings.push({code:'TEST_FAILURE',level:mode==='block'?'BLOCK':'REVIEW',frameStart:0,frameEndExclusive:1,message:'Synthetic failure'});
    const errors=semanticErrors(x.snapshot,x.context);
    assert.ok(errors.includes(mode==='missing'?'QA_REPORT_UNAVAILABLE':mode==='substitute'?'QA_REPORT_BINDING_MISMATCH':'QA_NOT_PASSED'));
  }
});
test('production QA requires current trusted policy and time',()=>{
  const x=provenanceCase(),q=x.context.qualityReports[x.source.variants[0].qaReportHash];
  assert.deepEqual(semanticErrors(q,x.context),[]);
  assert.ok(semanticErrors(q,{...x.context,now:undefined}).includes('TRUSTED_QA_TIME_REQUIRED'));
  assert.ok(semanticErrors(q,{...x.context,qaProfileVersion:'qa-next'}).includes('STALE_QA_PROFILE'));
  x.context.qaProfiles[q.qaProfileVersion].exampleOnly=true;
  assert.ok(semanticErrors(q,x.context).includes('FIXTURE_QA_IN_PRODUCTION'));
  assert.ok(semanticErrors(x.output,x.context).includes('FIXTURE_QA_IN_PRODUCTION'));
});
for(const [field,value,code] of [
  ['sha256',digest('other bytes'),'OUTPUT_QA_BYTES_MISMATCH'],
  ['artifactFingerprint',digest('other inputs'),'OUTPUT_QA_BYTES_MISMATCH'],
  ['targetId','youtube:landscape','OUTPUT_QA_SCOPE_MISMATCH'],
  ['mixedAudioSha256',digest('other mix'),'OUTPUT_QA_AUDIO_MISMATCH']
]) test('final output QA rejects changed '+field,()=>{
  const x=provenanceCase();x.context.qualityEvidence[x.output.artifacts[0].qualityEvidenceRef][field]=value;
  assert.ok(semanticErrors(x.output,x.context).includes(code));
});
test('a source QA report cannot replace evidence about finished output bytes',()=>{
  const x=provenanceCase();delete x.output.artifacts[0].qualityEvidenceRef;
  assert.ok(semanticErrors(x.output,x.context).includes('OUTPUT_QA_REQUIRED'));
});
test('audio identity includes volume, automation and exact mixed WAV',()=>{
  const resource=load('contracts/resource-manifest.example.json'),original=digest(audioIdentity(resource));
  for(const change of [x=>{x.audioEvents[0].gainDb=-6;},x=>{x.audioEvents[0].gainAutomation=[{frameOffset:0,gainDb:0},{frameOffset:900,gainDb:-6}];},x=>{x.mixedAudio.sha256=digest('another mix');}]){
    const x=clone(resource);change(x);assert.notEqual(digest(audioIdentity(x)),original);
  }
});
test('frozen audio requires explicit mix settings and a declared final WAV',()=>{
  const x=load('contracts/resource-manifest.example.json');
  delete x.audioEvents[0].gainDb;assert.ok(validateSchema(x).length);
  x.audioEvents[0].gainDb=0;x.mixedAudio=null;assert.ok(invalid(x));
  x.audioEvents=[];assert.deepEqual(semanticErrors(x,{composition:c}),[]);
});
test('automation is ordered, covers its event and has non-overlapping fades',()=>{
  const x=load('contracts/resource-manifest.example.json'),event=x.audioEvents[0];
  event.gainAutomation=[{frameOffset:0,gainDb:0},{frameOffset:900,gainDb:-6}];
  assert.deepEqual(semanticErrors(x,{composition:c}),[]);
  for(const keys of [[{frameOffset:1,gainDb:0},{frameOffset:900,gainDb:0}],[{frameOffset:0,gainDb:0},{frameOffset:899,gainDb:0}],[{frameOffset:0,gainDb:0},{frameOffset:0,gainDb:0},{frameOffset:900,gainDb:0}]]){
    event.gainAutomation=keys;assert.ok(semanticErrors(x,{composition:c}).includes('AUDIO_AUTOMATION_INVALID'));
  }
  delete event.gainAutomation;event.fadeInFrames=500;event.fadeOutFrames=500;
  assert.ok(semanticErrors(x,{composition:c}).includes('AUDIO_FADE_OVERLAP'));
});
test('trusted audio observations enforce source bounds and the finished duration',()=>{
  const x=provenanceCase(),event=x.resource.audioEvents[0];
  assert.deepEqual(semanticErrors(x.resource,x.context),[]);
  event.sourceOffsetFrames=1;
  assert.ok(semanticErrors(x.resource,x.context).includes('AUDIO_SOURCE_RANGE_INVALID'));event.sourceOffsetFrames=0;
  x.context.audioMetadata[x.resource.mixedAudio.sha256].sampleFrames--;
  assert.ok(semanticErrors(x.resource,x.context).includes('MIXED_AUDIO_FORMAT_INVALID'));
  assert.ok(semanticErrors(x.resource,{...x.context,audioMetadata:{}}).includes('AUDIO_METADATA_REQUIRED'));
  assert.ok(semanticErrors(x.resource,{...x.context,observedMixedAudio:null}).includes('MIXED_AUDIO_NOT_CONSUMED'));
  x.resource.resources.find(asset=>asset.sha256===event.sourceHash).mediaType='image/png';
  assert.ok(semanticErrors(x.resource,x.context).includes('AUDIO_SOURCE_TYPE_INVALID'));
});
test('first-use gate rejects a license name, foreign customer, wrong bytes or changed binding',()=>{
  const x=provenanceCase(),asset=x.resource.resources[0];
  assert.ok(resourceRightsErrors({...asset,licenseRef:'CC0'},x.context).includes('LICENSE_RECORD_UNAVAILABLE'));
  assert.ok(resourceRightsErrors(asset,{...x.context,workspaceId:'another'}).includes('LICENSE_SCOPE_MISMATCH'));
  assert.ok(resourceRightsErrors(asset,{...x.context,projectId:'another'}).includes('LICENSE_SCOPE_MISMATCH'));
  assert.ok(resourceRightsErrors({...asset,sha256:digest('other bytes')},x.context).includes('LICENSE_ASSET_MISMATCH'));
  assert.ok(resourceRightsErrors(asset,{...x.context,assetBindings:{}}).includes('RESOURCE_LICENSE_BINDING_MISMATCH'));
  assert.ok(resourceRightsErrors({...asset,authorized:true},x.context).length);
});
test('preview permission does not authorize a commercial freeze',()=>{
  const x=provenanceCase(),ref=x.resource.resources[0].licenseRef;
  x.context.licenseRegistry[ref]['1'].allowedUses=['preview'];
  assert.deepEqual(resourceRightsErrors(x.resource.resources[0],x.context),[]);
  assert.ok(semanticErrors(x.snapshot,x.context).includes('LICENSE_USE_NOT_ALLOWED'));
});
test('actual resource and audio observations reject omitted or substituted dependencies',()=>{
  const x=provenanceCase(),missing=clone(x.resource);
  missing.resources=missing.resources.filter(asset=>asset.mediaType!=='audio/wav');
  assert.ok(semanticErrors(missing,x.context).includes('AUDIO_RESOURCE_NOT_COVERED'));
  assert.ok(semanticErrors(x.resource,{...x.context,observedResources:[{path:'hidden/font.woff2',sha256:digest('unlisted font')}]}).includes('RESOURCE_NOT_DECLARED'));
  assert.ok(semanticErrors(x.resource,{...x.context,observedAudioEvents:[]}).includes('AUDIO_INVENTORY_MISMATCH'));
  assert.ok(semanticErrors(x.snapshot,{...x.context,resourceObservations:{}}).includes('RESOURCE_OBSERVATION_REQUIRED'));
  x.source.variants[0].audioHash=digest('unrelated audio timeline');
  assert.ok(semanticErrors(x.snapshot,x.context).includes('AUDIO_MANIFEST_HASH_MISMATCH'));
});
test('frozen licensing versions must exist and cannot authorize unrelated assets',()=>{
  const x=provenanceCase();
  x.snapshot.usagePolicy.licenseVersions[0].recordVersion='missing';
  assert.ok(semanticErrors(x.snapshot,x.context).includes('LICENSE_RECORD_UNAVAILABLE'));
  x.snapshot.usagePolicy.licenseVersions=[];
  assert.ok(semanticErrors(x.snapshot,x.context).includes('FROZEN_LICENSE_SET_MISMATCH'));
});
test('evidence amendments preserve content identity while freezing a new receipt',()=>{
  const x=provenanceCase(),before=digest(x.snapshot),ref=x.resource.resources[0].licenseRef,resourceHash=digest(x.resource);
  x.context.licenseRegistry[ref]['2']={...x.context.licenseRegistry[ref]['1'],evidenceHash:digest('additional permission evidence')};
  x.snapshot.usagePolicy.licenseVersions.find(value=>value.licenseRef===ref).recordVersion='2';
  assert.deepEqual(semanticErrors(x.snapshot,x.context),[]);
  assert.notEqual(digest(x.snapshot),before);
  assert.equal(x.source.resourceManifestHash,resourceHash);
  assert.equal(x.snapshot.contentHash,digest(contentIdentity(x.source)));
  const changed=clone(x.fact);changed.facts[0].evidenceRefs=['replacement_evidence'];
  assert.notEqual(digest(changed),digest(x.fact));
  assert.equal(digest(factContentIdentity(changed)),digest(factContentIdentity(x.fact)));
});
test('source evidence is scoped to the customer and exact approved claim',()=>{
  const x=provenanceCase(),e=x.context.evidenceRegistry.evidence_product_name;
  e.workspaceId='foreign';assert.ok(semanticErrors(x.fact,x.context).includes('FACT_EVIDENCE_SCOPE_MISMATCH'));
  e.workspaceId=x.context.workspaceId;e.factTextHash=digest('another promise');
  assert.ok(semanticErrors(x.fact,x.context).includes('FACT_EVIDENCE_TEXT_MISMATCH'));
  delete x.context.evidenceRegistry.evidence_product_name;
  assert.ok(semanticErrors(x.fact,x.context).includes('FACT_EVIDENCE_UNAVAILABLE'));
});
test('a saved customer statement alone cannot support a testimonial or earnings claim',()=>{
  const x=provenanceCase();x.context.evidenceRegistry.evidence_product_name.kind='customer_declaration';
  assert.deepEqual(semanticErrors(x.fact,x.context),[]);
  for(const kind of ['testimonial','outcome','promotion']){
    x.context.claimKinds.fact_name=kind;
    assert.ok(semanticErrors(x.fact,x.context).includes('FACT_SOURCE_EVIDENCE_REQUIRED'));
  }
});
test('usage policy and terms are resolved from an immutable trusted version',()=>{
  const x=provenanceCase();x.snapshot.usagePolicy.termsVersion='unagreed-terms';
  assert.ok(semanticErrors(x.snapshot,x.context).includes('USAGE_POLICY_UNAVAILABLE'));
  x.snapshot.usagePolicy.termsVersion='terms-fixture-1';x.snapshot.markingProfileVersion='unassessed';
  assert.ok(semanticErrors(x.snapshot,x.context).includes('MARKING_PROFILE_UNAVAILABLE'));
});
test('marking evidence binds actual bytes and identity rather than a claimed tag',()=>{
  const x=provenanceCase(),ref=x.output.artifacts[0].markingEvidenceRef;
  x.context.markingEvidence[ref].sha256=digest('old output');
  assert.ok(semanticErrors(x.output,x.context).includes('MARKING_BYTES_MISMATCH'));
  x.context.markingEvidence[ref].sha256=x.output.artifacts[0].sha256;
  x.context.markingEvidence[ref].workspaceId='foreign';
  assert.ok(semanticErrors(x.output,x.context).includes('MARKING_SCOPE_MISMATCH'));
  delete x.output.artifacts[0].markingEvidenceRef;
  assert.ok(semanticErrors(x.output,x.context).includes('MARKING_EVIDENCE_REQUIRED'));
});
test('machine marks cannot substitute for required audience disclosure',()=>{
  const x=provenanceCase();x.context.markingProfiles[x.output.markingProfileVersion].audienceDisclosure='required';
  assert.ok(semanticErrors(x.output,x.context).includes('MARKING_CHECK_INCOMPLETE'));
});
test('assessed not-applicable decisions are supported and profile updates do not bill new content',()=>{
  const x=provenanceCase(),oldContent=x.snapshot.contentHash,oldFingerprint=x.output.artifacts[0].artifactFingerprint;
  const profile='assessed-no-marking';
  x.context.markingProfiles[profile]={machineMarking:'not_applicable',audienceDisclosure:'not_applicable',decisionRef:'scoped-assessment'};
  x.snapshot.markingProfileVersion=profile;x.output.markingProfileVersion=profile;x.output.snapshotHash=digest(x.snapshot);
  for(const artifact of x.output.artifacts){
    artifact.artifactFingerprint=digest(markedArtifactIdentity(x.source,x.source.variants[0],artifact.kind,profile));
    if(artifact.kind==='mapping')continue;
    x.context.qualityEvidence[artifact.qualityEvidenceRef].artifactFingerprint=artifact.artifactFingerprint;
    const evidence=x.context.markingEvidence[artifact.markingEvidenceRef];
    Object.assign(evidence,{artifactFingerprint:artifact.artifactFingerprint,profileVersion:profile,machineMarking:'not_applicable'});
  }
  assert.deepEqual(semanticErrors(x.output,x.context),[]);
  assert.notEqual(x.output.artifacts[0].artifactFingerprint,oldFingerprint);
  assert.equal(digest(contentIdentity(x.source)),oldContent);
});
function previewProvenanceCase() {
  const x=provenanceCase(),preview={schemaVersion:'2.5.0',kind:'preview_result',previewId:'preview1',projectId:x.source.projectId,
    revisionId:x.source.revisionId,targetId:'tiktok:portrait',frameStart:0,frameEndExclusive:30,state:'ready',screenshotAssetId:'preview_asset',
    markingProfileVersion:x.snapshot.markingProfileVersion,sha256:digest('preview bytes'),markingEvidenceRef:'preview_check'};
  x.context.markingEvidence.preview_check={outputId:preview.previewId,assetId:preview.screenshotAssetId,sha256:preview.sha256,profileVersion:preview.markingProfileVersion,
    workspaceId:x.context.workspaceId,projectId:preview.projectId,revisionId:preview.revisionId,targetId:preview.targetId,
    frameStart:preview.frameStart,frameEndExclusive:preview.frameEndExclusive,machineMarking:'verified',audienceDisclosure:'not_applicable'};
  return {...x,preview};
}
for (const [assetId,code] of [[null,'READY_PREVIEW_WITHOUT_ASSET'],['another_output_asset','MARKING_ASSET_MISMATCH']]) {
  test('ready preview rejects unbound output asset: '+JSON.stringify(assetId),()=>{
    const x=previewProvenanceCase();
    assert.deepEqual(semanticErrors(x.preview,x.context),[]);
    x.preview.screenshotAssetId=assetId;
    assert.ok(semanticErrors(x.preview,x.context).includes(code));
  });
}
test('free ready previews require rights and marking evidence for their own bytes',()=>{
  const x=previewProvenanceCase(),preview=x.preview;
  assert.deepEqual(semanticErrors(preview,x.context),[]);
  preview.frameStart=1;assert.ok(semanticErrors(preview,x.context).includes('MARKING_PREVIEW_IDENTITY_MISMATCH'));preview.frameStart=0;
  preview.sha256=digest('changed preview');assert.ok(semanticErrors(preview,x.context).includes('MARKING_BYTES_MISMATCH'));
  preview.sha256=x.context.markingEvidence.preview_check.sha256;x.context.licenseRegistry={};
  assert.ok(semanticErrors(preview,x.context).includes('LICENSE_RECORD_UNAVAILABLE'));
});

// Current edit round: one request/operation may contain several precisely located comments.
test('five comments and 4000 Unicode code points form one valid round', () => {
  const x=clone(edit); x.comments=Array.from({length:5},(_,i)=>({...clone(edit.comments[0]),frameIndex:i,comment:'😀'.repeat(800)}));
  assert.deepEqual(semanticErrors(x,{composition:c}),[]);
  x.comments[4].comment+='a'; assert.ok(semanticErrors(x,{composition:c}).includes('COMMENTS_TOO_LONG'));
});
test('comment count is bounded before queueing',()=>{
  const x=clone(edit);x.comments=[];assert.ok(invalid(x));
  x.comments=Array.from({length:6},()=>clone(edit.comments[0]));assert.ok(invalid(x));
});
test('one round validates each target and excludes empty instructions',()=>{
  const x=clone(edit);x.comments.push({...clone(edit.comments[0]),targetId:'tiktok:square'});assert.ok(invalid(x));
  x.comments.pop();x.comments[0].comment='   ';assert.ok(invalid(x));
});
test('point and selection metadata remain optional',()=>{
  const x=clone(edit);delete x.comments[0].normalizedPoint;assert.deepEqual(semanticErrors(x,{composition:c}),[]);
});
test('current edit schema rejects a different wire shape',()=>{
  const x=clone(edit);Object.assign(x,x.comments[0]);delete x.comments;assert.ok(validateSchema(x).length);
});
test('object prototype names are still rejected as unknown schema fields',()=>{
  for(const key of ['constructor','toString','__proto__']){
    const x=JSON.parse(JSON.stringify(edit));Object.defineProperty(x,key,{value:'not a declared field',enumerable:true});
    assert.ok(validateSchema(x).length);
  }
});
test('only current structural protocol is accepted',()=>{
  const x=clone(c);x.schemaVersion='0.0.0';assert.ok(validateSchema(x).length);
  const command=clone(protocol.render_seek);command.protocolVersion='0.0.0';assert.ok(validateSchema(command).length);
});
test('layout rules and per-target overrides participate in rendering identity',()=>{
  const x=clone(c),original=digest(outputArtifactIdentity(c,c.variants[0],'video'));
  x.layoutRulesHash=digest('changed layout');assert.notEqual(digest(outputArtifactIdentity(x,x.variants[0],'video')),original);
  const v=clone(c.variants[0]);v.targetOverrideHash=digest('repaired target shot');assert.notEqual(digest(outputArtifactIdentity(c,v,'video')),original);
});
test('target repair cannot mutate a purchased frozen variant',()=>{
  const x=clone(r);x.variants[0].targetOverrideHash=digest('new target repair');
  assert.ok(semanticErrors(x,{composition:c}).includes('FROZEN_VARIANT_CHANGED'));
});

const owner={authorized:true,role:'owner',userId:'user_trial'},editor={authorized:true,role:'editor',userId:'user_editor'};
const projectRequest=(requestId,workspaceId='workspace_a',changes={})=>({schemaVersion:'2.5.0',kind:'create_project_request',requestId,workspaceId,audience:'software',task:'Product launch',durationSeconds:30,targetIds:['tiktok:portrait'],requestTrial:true,...changes});
test('trial claim is lifetime user scoped across workspaces and deletion',()=>{
  const t=new TrialReference(),first=t.create(projectRequest('one'),owner);
  assert.equal(first.trialStatus,'granted');
  assert.deepEqual([t.projects.get(first.projectId).creative_generate,t.projects.get(first.projectId).agent_patch],[1,2]);
  assert.equal(t.create(projectRequest('two','workspace_b'),owner).trialStatus,'unavailable');
  t.deleteProject(first.projectId);assert.equal(t.hasTrialCloudAccess(first.projectId),false);
  assert.equal(t.create(projectRequest('three','workspace_c'),owner).trialStatus,'unavailable');
});
test('competing trial claims produce two drafts and exactly one funded project',()=>{
  const t=new TrialReference(),results=['a','b'].map(id=>t.create(projectRequest(id),owner));
  assert.equal(new Set(results.map(x=>x.projectId)).size,2);
  assert.deepEqual(results.map(x=>x.trialStatus),['granted','unavailable']);
  assert.equal(t.hasTrialCloudAccess(results[1].projectId),false);
});
test('trial request replay preserves the same project and checks authorization',()=>{
  const t=new TrialReference(),request=projectRequest('same'),first=t.create(request,owner);
  assert.deepEqual(t.create(request,owner),first);assert.equal(t.projects.size,1);
  assert.throws(()=>t.create({...request,task:'changed'},owner),/IDEMPOTENCY_CONFLICT/);
  assert.throws(()=>t.create(request,{...owner,authorized:false}),/FORBIDDEN/);
});
test('only Owner can request own trial; user ID cannot be supplied in body',()=>{
  const t=new TrialReference();assert.throws(()=>t.create(projectRequest('a'),editor),/TRIAL_OWNER_REQUIRED/);
  assert.throws(()=>t.create({...projectRequest('b'),userId:'another'},owner));
  assert.equal(t.projects.size,0);
  assert.equal(t.create(projectRequest('c'),{...owner,userId:'another_owner'}).trialStatus,'granted');
});
test('omitted requestTrial creates a draft with no free cloud work',()=>{
  const request=projectRequest('plain');delete request.requestTrial;
  const t=new TrialReference(),result=t.create(request,editor);
  assert.equal(result.trialStatus,'not_requested');assert.equal(t.hasTrialCloudAccess(result.projectId),false);
  assert.equal(t.claims.size,0);
});

const checkout=(requestId,sku,purchaseIntent='top_up_only',changes={})=>({schemaVersion:'2.5.0',kind:'checkout_request',requestId,projectId:c.projectId,sku,purchaseIntent,...changes});
const open=(book,request)=>book.open(request,{ownerAuthorized:true});
const buy=(book,request)=>{const order=open(book,request);book.grantVerifiedPayment(order.orderId);return order;};
test('checkout intent is explicit and snapshot is exclusive to export intent',()=>{
  const topup=checkout('one','project_pack');assert.deepEqual(semanticErrors(topup),[]);
  assert.ok(semanticErrors({...topup,snapshotId:r.snapshotId}).length > 0);
  assert.ok(semanticErrors({...topup,purchaseIntent:'purchase_and_export'}).length > 0);
  const missing=clone(topup);delete missing.purchaseIntent;assert.ok(validateSchema(missing).length);
});
test('single export cannot top up or inject prices or other SKU names',()=>{
  assert.ok(semanticErrors(checkout('one','single_export')).length > 0);
  for(const changes of [{priceMinor:1},{currency:'USD'},{sku:'unlisted_product'}])assert.ok(validateSchema({...checkout('x','project_pack'),...changes}).length);
});
test('production checkout validation rejects example-only requests without changing reference defaults',()=>{
  const request={...checkout('fixture_checkout','project_pack'),exampleOnly:true};
  assert.deepEqual(semanticErrors(request),[]);
  assert.ok(semanticErrors(request,{production:true}).includes('FIXTURE_IN_PRODUCTION'));
});
test('upgrade source required only for project upgrade',()=>{
  assert.ok(semanticErrors(checkout('upgrade','project_upgrade')).length > 0);
  assert.ok(semanticErrors(checkout('pack','project_pack','top_up_only',{upgradeFromOrderId:'other'})).length > 0);
});
test('project pack can fund creation before any snapshot exists',()=>{
  const book=new CheckoutReference(c.projectId);buy(book,checkout('pack','project_pack'));
  assert.deepEqual([book.available('creative_generate'),book.available('agent_patch'),book.available('versionUnits')],[5,15,3]);
  assert.equal(book.exportIntents.size,0);
});
test('single export adds no AI rights and is restricted to its frozen content',()=>{
  const book=new CheckoutReference(c.projectId,[r]);buy(book,checkout('single','single_export','purchase_and_export',{snapshotId:r.snapshotId}));
  assert.deepEqual([book.available('creative_generate'),book.available('agent_patch'),book.available('versionUnits')],[0,0,1]);
  assert.throws(()=>book.publish('different',digest('different content')),/NO_VERSION_RIGHT/);
  const first=book.publish('first',r.contentHash);assert.equal(book.available('versionUnits'),0);
  assert.deepEqual(book.publish('repeat',r.contentHash),first);assert.equal(book.releases.size,1);
});
test('one initial-purchase slot is shared across single and project package',()=>{
  const book=new CheckoutReference(c.projectId,[r]);open(book,checkout('single','single_export','purchase_and_export',{snapshotId:r.snapshotId}));
  assert.throws(()=>open(book,checkout('pack','project_pack')),/CHECKOUT_IN_PROGRESS/);
});
test('checkout retry and payment redelivery cannot duplicate entitlements',()=>{
  const book=new CheckoutReference(c.projectId),request=checkout('pack','project_pack'),order=open(book,request);
  assert.equal(open(book,request).orderId,order.orderId);
  assert.throws(()=>open(book,{...request,purchaseIntent:'purchase_and_export',snapshotId:r.snapshotId}),/IDEMPOTENCY_CONFLICT/);
  book.grantVerifiedPayment(order.orderId);book.grantVerifiedPayment(order.orderId);
  assert.equal(book.grants.size,1);assert.equal(book.available('versionUnits'),3);
  assert.throws(()=>book.open(request,{ownerAuthorized:false}),/FORBIDDEN/);
});
test('paid single plus upgrade grants only remaining two versions after first delivery',()=>{
  const book=new CheckoutReference(c.projectId,[r]);const single=buy(book,checkout('single','single_export','purchase_and_export',{snapshotId:r.snapshotId}));
  book.publish('first',r.contentHash);
  const upgrade=buy(book,checkout('upgrade','project_upgrade','top_up_only',{upgradeFromOrderId:single.orderId}));
  book.grantVerifiedPayment(upgrade.orderId);
  assert.equal(single.priceMinor+upgrade.priceMinor,3900);
  assert.deepEqual([book.available('creative_generate'),book.available('agent_patch'),book.available('versionUnits')],[5,15,2]);
  assert.equal(book.exportIntents.size,1);
  assert.throws(()=>open(book,checkout('upgrade_again','project_upgrade','top_up_only',{upgradeFromOrderId:single.orderId})),/ALREADY_UPGRADED/);
});
test('extra pack requires a paid creative project, not an entry export or pending upgrade',()=>{
  const book=new CheckoutReference(c.projectId,[r]);const single=buy(book,checkout('single','single_export','purchase_and_export',{snapshotId:r.snapshotId}));
  assert.throws(()=>open(book,checkout('extra','extra_pack')),/CREATIVE_PROJECT_REQUIRED/);
  const upgrade=open(book,checkout('upgrade','project_upgrade','top_up_only',{upgradeFromOrderId:single.orderId}));
  assert.throws(()=>open(book,checkout('extra_pending','extra_pack')),/CREATIVE_PROJECT_REQUIRED/);
  book.grantVerifiedPayment(upgrade.orderId);buy(book,checkout('extra_paid','extra_pack'));
  assert.deepEqual([book.available('creative_generate'),book.available('agent_patch'),book.available('versionUnits')],[7,25,6]);
});
test('upgrade and add-on rights depend on effective source purchases',()=>{
  const book=new CheckoutReference(c.projectId,[r]);const single=buy(book,checkout('single','single_export','purchase_and_export',{snapshotId:r.snapshotId}));
  buy(book,checkout('upgrade','project_upgrade','top_up_only',{upgradeFromOrderId:single.orderId}));buy(book,checkout('extra','extra_pack'));
  book.revokeGrant(single.orderId);assert.equal(book.hasCreativePurchase(),false);assert.equal(book.available('versionUnits'),0);
  assert.throws(()=>open(book,checkout('extra_again','extra_pack')),/CREATIVE_PROJECT_REQUIRED/);
});
test('late verified upgrade keeps payment fact but grants nothing after source revocation',()=>{
  const book=new CheckoutReference(c.projectId,[r]);const single=buy(book,checkout('single','single_export','purchase_and_export',{snapshotId:r.snapshotId}));
  const upgrade=open(book,checkout('upgrade','project_upgrade','top_up_only',{upgradeFromOrderId:single.orderId}));
  book.revokeGrant(single.orderId);assert.equal(book.grantVerifiedPayment(upgrade.orderId),null);
  assert.equal(book.orders.get(upgrade.orderId).paymentVerified,true);assert.equal(book.orders.get(upgrade.orderId).state,'review_required');
});
test('settled upgrade refunds allow a new order without replaying old entitlements',()=>{
  const book=new CheckoutReference(c.projectId,[r]);const single=buy(book,checkout('single','single_export','purchase_and_export',{snapshotId:r.snapshotId}));
  const upgrade=buy(book,checkout('upgrade','project_upgrade','top_up_only',{upgradeFromOrderId:single.orderId}));
  const extra=buy(book,checkout('extra','extra_pack'));
  book.revokeGrant(upgrade.orderId);
  assert.throws(()=>open(book,checkout('too_soon','project_upgrade','top_up_only',{upgradeFromOrderId:single.orderId})),/CHECKOUT_IN_PROGRESS/);
  book.revokeGrant(extra.orderId);
  buy(book,checkout('renewed_upgrade','project_upgrade','top_up_only',{upgradeFromOrderId:single.orderId}));
  const before=book.available('versionUnits');assert.equal(book.grantVerifiedPayment(upgrade.orderId).active,false);
  assert.equal(book.available('versionUnits'),before);assert.equal(book.available('creative_generate'),5);
});
test('initial purchase is available again only after its dependent chain is settled',()=>{
  const book=new CheckoutReference(c.projectId,[r]);const single=buy(book,checkout('single','single_export','purchase_and_export',{snapshotId:r.snapshotId}));
  const pending=open(book,checkout('upgrade','project_upgrade','top_up_only',{upgradeFromOrderId:single.orderId}));
  book.revokeGrant(single.orderId);assert.throws(()=>open(book,checkout('pack','project_pack')),/CHECKOUT_IN_PROGRESS/);
  assert.throws(()=>book.closeUnpaid(pending.orderId,false),/PAYMENT_STATUS_UNRESOLVED/);
  book.closeUnpaid(pending.orderId,true);buy(book,checkout('new_pack','project_pack'));
  assert.equal(book.available('versionUnits'),3);assert.equal(book.grantVerifiedPayment(single.orderId).active,false);
  assert.equal(book.available('versionUnits'),3);
});
test('a late payment after a released checkout preserves the payment fact without reviving its slot',()=>{
  const book=new CheckoutReference(c.projectId),first=open(book,checkout('old_request','project_pack'));
  book.closeUnpaid(first.orderId,true);buy(book,checkout('current_request','project_pack'));
  assert.equal(book.grantVerifiedPayment(first.orderId),null);assert.equal(book.orders.get(first.orderId).paymentVerified,true);
  assert.equal(book.orders.get(first.orderId).state,'review_required');assert.equal(book.available('versionUnits'),3);
});
test('revoked delivered release requires explicit restoration review instead of silent reuse',()=>{
  const book=new CheckoutReference(c.projectId,[r]);const single=buy(book,checkout('single','single_export','purchase_and_export',{snapshotId:r.snapshotId}));
  book.publish('published',r.contentHash);book.revokeGrant(single.orderId);
  assert.throws(()=>open(book,checkout('restore_delivered','single_export','purchase_and_export',{snapshotId:r.snapshotId})),/RELEASE_RESTORATION_REVIEW_REQUIRED/);
  assert.equal(book.orders.size,1);
  buy(book,checkout('new_project_purchase','project_pack'));
  assert.throws(()=>book.publish('replayed',r.contentHash),/RELEASE_RESTORATION_REVIEW_REQUIRED/);
  assert.equal(book.releases.size,1);assert.equal(book.available('versionUnits'),3);
});
test('export checkout requires a complete frozen target set',()=>{
  const partial=clone(r);partial.variants.pop();const book=new CheckoutReference(c.projectId,[partial]);
  assert.throws(()=>open(book,checkout('single','single_export','purchase_and_export',{snapshotId:r.snapshotId})),/VARIANTS_NOT_READY/);
});

const costCall=(callId,maximumCostMicros,changes={})=>({operationId:'op',callId,attemptId:'attempt1',targetId:'tiktok:portrait',maximumCostMicros,requestHash:digest(callId),...changes});
test('all targets and retries share one operation cost ceiling',()=>{
  const b=new OperationBudgetReference('op',100);b.reserve(costCall('a',60));
  assert.throws(()=>b.reserve(costCall('b',50,{targetId:'youtube:landscape',attemptId:'attempt2'})),/BUDGET_EXHAUSTED/);
  b.reserve(costCall('b',40,{targetId:'youtube:landscape',attemptId:'attempt2'}));assert.equal(b.remainingMicros,0);
  assert.throws(()=>b.reserve(costCall('c',1,{operationId:'other'})),/OPERATION_BUDGET_MISMATCH/);
});
test('unknown usage keeps worst-case reservation until reconciled',()=>{
  const b=new OperationBudgetReference('op',100);b.reserve(costCall('a',80));b.settle('a',null);
  assert.equal(b.reservedMicros,80);assert.equal(b.remainingMicros,20);
  assert.throws(()=>b.reserve(costCall('retry',30,{attemptId:'attempt2'})),/BUDGET_EXHAUSTED/);
  b.settle('a',30);assert.equal(b.reservedMicros,0);assert.equal(b.remainingMicros,70);
});
test('budget reservation and usage reconciliation are idempotent',()=>{
  const b=new OperationBudgetReference('op',100);b.reserve(costCall('a',60));b.reserve(costCall('a',60));assert.equal(b.reservedMicros,60);
  assert.throws(()=>b.reserve(costCall('a',70)),/IDEMPOTENCY_CONFLICT/);
  b.settle('a',40);b.settle('a',40);assert.equal(b.spentMicros,40);
  assert.throws(()=>b.settle('a',20),/USAGE_RECONCILIATION_CONFLICT/);
});
test('user quota release does not erase actual provider spending',()=>{
  const q=new QuotaReference(1),b=new OperationBudgetReference('op',100);q.reserve('op','h');b.reserve(costCall('a',80));b.settle('a',70);q.cancel('op');
  assert.equal(q.available,1);assert.equal(b.spentMicros,70);assert.equal(b.remainingMicros,30);
  assert.deepEqual(b.events.map(event=>event.type),['reserve','settle']);
});
test('provider overrun remains in the ledger and blocks another call',()=>{
  const b=new OperationBudgetReference('op',100);b.reserve(costCall('a',40));assert.equal(b.settle('a',60).exceededReservation,true);
  assert.equal(b.spentMicros,60);assert.throws(()=>b.reserve(costCall('b',1)),/USAGE_OVERRUN/);
});
test('uncalibrated or noninteger cost boundaries never authorize execution',()=>{
  for(const cap of [null,0,-1,1.5])assert.throws(()=>new OperationBudgetReference('op',cap));
  const b=new OperationBudgetReference('op',100);for(const amount of [null,0,-1,1.5])assert.throws(()=>b.reserve(costCall('a',amount)));
});
test('enabling requires calibrated successful-and-failed cost windows even when other budgets are ready',()=>{
  const policy=load('config/agent-policy.json');
  for(const key of Object.keys(policy.cost))if(key.startsWith('maxMicros')||['dailySoftAlertMicros','maxDailyFreeMicros'].includes(key))policy.cost[key]=100;
  policy.cost.priceVersion='fixture-calibrated';policy.patch.maxInputTokensPerRound=1000;policy.patch.maxOutputTokensPerRound=1000;
  assert.equal(hasCalibratedCostLimits(policy),true);
  for(const key of ['maxMicrosPerUserWindow','maxMicrosPerProjectWindow']){
    const unmeasured=clone(policy);unmeasured.cost[key]=null;assert.equal(hasCalibratedCostLimits(unmeasured),false);
    const missing=clone(policy);delete missing.cost[key];assert.equal(hasCalibratedCostLimits(missing),false);
  }
});
