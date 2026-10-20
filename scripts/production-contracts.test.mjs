import test from 'node:test';
import assert from 'node:assert/strict';
import {load, validateSchema, semanticErrors, canonical, digest, contentIdentity, factContentIdentity, variantIdentity, outputArtifactIdentity, targets, presets, safePath, transition, QuotaReference, RevisionReference, matchesFrameReady, matchesProtocolFailure} from './contract-validation.mjs';
const c = load('contracts/composition.example.json'), r = load('contracts/release-snapshot.example.json'), edit = load('contracts/edit-request.example.json');
const clone = x => structuredClone(x), invalid = v => semanticErrors(v, {composition:c}).length > 0;
for (const name of ['composition','release-snapshot','edit-request','fact-manifest','export-manifest']) test('positive contract: '+name, () => assert.deepEqual(semanticErrors(load('contracts/'+name+'.example.json'), {composition:c}), []));
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
 ['edit last frame overflow',edit,x=>{x.frameIndex=900;}],['edit negative frame',edit,x=>{x.frameIndex=-1;}],
 ['edit noninteger frame',edit,x=>{x.frameIndex=1.5;}],['coordinate out of range',edit,x=>{x.normalizedPoint.x=1.1;}],
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
function qa(){return {schemaVersion:'2.2.1',kind:'quality_report',projectId:c.projectId,revisionId:c.revisionId,targetId:'tiktok:portrait',sourceHash:c.sourceArchiveHash,factManifestHash:c.factManifestHash,checkerVersion:'fixture',coverage:'fixture_only',evidenceRefs:[],findings:[{code:'READING_HOLD',level:'REVIEW',frameStart:0,frameEndExclusive:30,message:'fixture',waiver:{actorId:'user',reason:'planned hold',revisionId:c.revisionId,targetId:'tiktok:portrait',expiresAt:'2026-10-21T00:00:00Z'}}]};}
test('BLOCK cannot be waived',()=>{const q=qa();q.findings[0].level='BLOCK';assert.ok(invalid(q));});
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
for(const key of ['seed','sourceArchiveHash','resourceManifestHash','dependencyManifestHash','factContentHash','runtimeVersion','rendererImageDigest'])test('actual content change: '+key,()=>{const x=clone(c);x[key]=key+'-changed';assert.notEqual(digest(contentIdentity(x)),digest(contentIdentity(c)));});
test('cover frame changes cover not video cache',()=>{const v=clone(c.variants[0]);v.coverFrame++;assert.equal(digest(outputArtifactIdentity(c,v,'video')),digest(outputArtifactIdentity(c,c.variants[0],'video')));assert.notEqual(digest(outputArtifactIdentity(c,v,'cover')),digest(outputArtifactIdentity(c,c.variants[0],'cover')));assert.notEqual(digest(outputArtifactIdentity(c,v,'mapping')),digest(outputArtifactIdentity(c,c.variants[0],'mapping')));const x=clone(c);x.variants[0]=v;assert.notEqual(digest(contentIdentity(x)),digest(contentIdentity(c)));});
test('unsupported artifact kind rejected',()=>assert.throws(()=>outputArtifactIdentity(c,c.variants[0],'unknown')));
test('identical portrait pixels can share video while mappings differ',()=>{const v=c.variants.find(v=>v.presetId==='tiktok'),w=c.variants.find(v=>v.presetId==='instagram_reels');assert.equal(digest(outputArtifactIdentity(c,v,'video')),digest(outputArtifactIdentity(c,w,'video')));assert.notEqual(digest(outputArtifactIdentity(c,v,'mapping')),digest(outputArtifactIdentity(c,w,'mapping')));});
test('export cache fingerprint must match frozen source',()=>{const x=load('contracts/export-manifest.example.json');x.artifacts[0].artifactFingerprint='f'.repeat(64);assert.ok(semanticErrors(x,{composition:c,snapshot:r}).includes('ARTIFACT_FINGERPRINT_MISMATCH'));});
for(const change of ['missing','no-hash','duplicate','wrong-target'])test('ready batch rejects '+change,()=>{const x=load('contracts/export-manifest.example.json');x.state='ready';for(const a of x.artifacts){a.state='ready';a.sha256=digest(a.id);}if(change==='missing')x.artifacts.pop();if(change==='no-hash')x.artifacts[0].sha256=null;if(change==='duplicate')x.artifacts.push(clone(x.artifacts[0]));if(change==='wrong-target')x.artifacts[0].targetId='tiktok:square';assert.ok(semanticErrors(x,{composition:c,snapshot:r}).length);});
test('complete ready batch passes',()=>{const x=load('contracts/export-manifest.example.json');x.state='ready';for(const a of x.artifacts){a.state='ready';a.sha256=digest(a.id);}assert.deepEqual(semanticErrors(x,{composition:c,snapshot:r}),[]);});
test('older pinned rules resolve without current-default rejection',()=>{const rules=clone(presets),x=clone(c);rules.rulesVersion='fixed-fixture-rules';x.presetRulesVersion=rules.rulesVersion;for(const p of rules.presets)p.version='fixture-version';for(const v of x.variants){v.presetVersion='fixture-version';v.variantHash=digest(variantIdentity(x,v,rules));}assert.ok(semanticErrors(x).length);assert.deepEqual(semanticErrors(x,{presetConfig:rules}),[]);});
test('unknown pinned rule never silently uses latest',()=>{const x=clone(c);x.presetRulesVersion='unavailable';assert.ok(semanticErrors(x).includes('PRESET_VERSION_UNAVAILABLE'));});
for(const change of ['source','facts','range','waiver','expiry'])test('QA provenance/interval '+change,()=>{const q=qa();if(change==='source')q.sourceHash='a'.repeat(64);if(change==='facts')q.factManifestHash='a'.repeat(64);if(change==='range')q.findings[0].frameEndExclusive=901;if(change==='waiver')q.findings[0].waiver.revisionId='other';if(change==='expiry')q.findings[0].waiver.expiresAt='2026-01-01T00:00:00Z';assert.ok(semanticErrors(q,{composition:c,now:Date.parse('2026-10-20T00:00:00Z')}).length);});
test('scoped future REVIEW waiver passes',()=>assert.deepEqual(semanticErrors(qa(),{composition:c,now:Date.parse('2026-10-20T00:00:00Z')}),[]));
test('exact protocol failure accepted',()=>assert.ok(matchesProtocolFailure(protocol.render_seek,protocol.render_error)));
for(const key of ['sequence','sessionId','requestId','revisionId','targetId','protocolVersion'])test('stale failure '+key,()=>{const x=clone(protocol.render_error);x[key]=typeof x[key]==='number'?999:'other';assert.equal(matchesProtocolFailure(protocol.render_seek,x),false);});
test('disposed failure ignored',()=>assert.equal(matchesProtocolFailure(protocol.render_seek,protocol.render_error,true),false));
test('unknown failure code rejected',()=>{const x=clone(protocol.render_error);x.code='ARBITRARY';assert.equal(matchesProtocolFailure(protocol.render_seek,x),false);});

test('creative plan: optional direction fields and bounded events', () => {
  const x={
    schemaVersion:'2.2.1',kind:'run_result',runId:'run1',operationId:'op1',
    baseRevision:c.revisionId,state:'succeeded',phase:'final',generation:1,
    candidateRevisionId:c.revisionId,
    usage:{inputTokens:0,outputTokens:0,activeSeconds:0,costMicros:0,internalRepairs:0},
    directions:[{id:'dir1',label:'Fit',logline:'Explain product',keyframeIds:['kf1'],look:'clear UI',palette:[{color:'#336699',usage:'accent'}],whyItFits:'real footage'}],
    treatment:{totalFrames:900,beats:[{frameStart:0,frameEndExclusive:450,event:'introduce'},{frameStart:450,frameEndExclusive:900,event:'show CTA'}]},
    audioPlan:{totalFrames:900,events:[{kind:'music',frameStart:0,frameEndExclusive:900,licenseRef:'CC0-cleared'}]}
  };
  assert.deepEqual(semanticErrors(x,{composition:c}),[]);
  x.treatment.beats[1].frameEndExclusive=901;
  assert.ok(semanticErrors(x,{composition:c}).includes('TREATMENT_INTERVAL_INVALID'));
  x.treatment.beats[1].frameEndExclusive=900;
  x.audioPlan.events[0].frameEndExclusive=901;
  assert.ok(semanticErrors(x,{composition:c}).includes('AUDIO_EVENT_INTERVAL_INVALID'));
  x.audioPlan.events[0].frameEndExclusive=900;
  x.audioPlan.totalFrames=450;
  assert.ok(semanticErrors(x,{composition:c}).includes('CREATIVE_PLAN_DURATION_MISMATCH'));
});
