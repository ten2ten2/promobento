import test from 'node:test';
import assert from 'node:assert/strict';
import {load, validateSchema, semanticErrors, canonical, digest, contentIdentity, targets, safePath, transition, QuotaReference, RevisionReference, matchesFrameReady} from './contract-validation.mjs';
const c = load('contracts/composition.example.json'), r = load('contracts/release-snapshot.example.json'), edit = load('contracts/edit-request.example.json');
const clone = x => structuredClone(x), invalid = v => semanticErrors(v, {composition: c}).length > 0;
for (const name of ['composition', 'release-snapshot', 'edit-request', 'fact-manifest', 'export-manifest']) test('positive contract: ' + name, () => assert.deepEqual(semanticErrors(load('contracts/' + name + '.example.json'), {composition: c}), []));
for (const [name,v] of Object.entries(load('tests/contracts/protocol-fixtures.json').valid)) test('protocol structure: '+name,()=>assert.deepEqual(validateSchema(v),[]));
const mutateCases = [
  ['45 seconds', c, x => {x.durationSeconds=45;}], ['fps 60', c, x=>{x.fps=60;}],
  ['frame arithmetic', c, x=>{x.totalFrames=450;}], ['clean/bold whitelist not imposed', c, null],
  ['illegal target pairing', c, x=>{x.variants[0].aspectId='square';x.variants[0].targetId='tiktok:square';}],
  ['missing frozen variants', c, x=>{x.variants.pop();}], ['duplicate variant',c,x=>{x.variants.push(x.variants[0]);}],
  ['unknown preset',c,x=>{x.variants[0].presetId='fake';}], ['future preset version',c,x=>{x.variants[0].presetVersion='99';}],
  ['path traversal',c,x=>{x.variants[0].entrypoint='../server.key';}], ['absolute source path',c,x=>{x.variants[0].entrypoint='/app/key';}],
  ['encoded path traversal',c,x=>{x.variants[0].entrypoint='%2e%2e/key';}], ['cover out of range',c,x=>{x.variants[0].coverFrame=900;}],
  ['website theme contamination',c,x=>{x.themePreference='dark';}], ['unknown manifest field',c,x=>{x.arbitrary=1;}],
  ['edit last frame overflow',edit,x=>{x.frameIndex=900;}], ['edit negative frame',edit,x=>{x.frameIndex=-1;}],
  ['edit noninteger frame',edit,x=>{x.frameIndex=1.5;}], ['coordinate out of range',edit,x=>{x.normalizedPoint.x=1.1;}],
  ['stale edit revision',edit,x=>{x.baseRevision='old';}], ['bad hash',c,x=>{x.sourceArchiveHash='not-hash';}],
  ['release cross project',r,x=>{x.projectId='other';}], ['release altered code',r,x=>{x.variants[0].sourceHash='a'.repeat(64);}],
  ['release unprepared target',r,x=>{x.variants.pop();}], ['release bad manifest identity',r,x=>{x.compositionHash='b'.repeat(64);}],
  ['unapproved frame count',c,x=>{x.totalFrames=899;}]
];
for(const [name,base,mutate] of mutateCases) test(name,()=>{const x=clone(base);if(mutate){mutate(x);assert.ok(invalid(x));}else{x.styleLabel='自定义云墨 Shader';assert.deepEqual(semanticErrors(x),[]);}});
test('mixed languages, metadata optional',()=>{const x=clone(c);delete x.textMetadata;assert.deepEqual(semanticErrors(x),[]);});
test('unprepared candidate allowed, release forbidden',()=>{const x=clone(c);x.releaseEligible=false;x.variants=x.variants.slice(0,1);assert.deepEqual(semanticErrors(x),[]);x.releaseEligible=true;assert.ok(invalid(x));});
test('fixtures rejected by production gate',()=>assert.ok(semanticErrors(c,{production:true}).includes('FIXTURE_IN_PRODUCTION')));
test('canonical keys stable but text not normalized',()=>{assert.equal(digest({b:1,a:2}),digest({a:2,b:1}));assert.notEqual(digest('é'),digest('e\u0301'));assert.throws(()=>canonical({x:NaN}));});
test('revision IDs and QA do not create new content identity',()=>{const x=clone(c);x.revisionId='rev_new';x.variants[0].qaReportHash='d'.repeat(64);assert.equal(digest(contentIdentity(x)),digest(contentIdentity(c)));});
test('7 legal targets, square restricted to feed',()=>{assert.equal(targets().length,7);assert.deepEqual(targets().filter(x=>x.aspectId==='square').map(x=>x.presetId),['instagram_feed']);});
for(const path of ['../x','x/../y','https://example.com','x\\y','%252e%252e/x','/tmp/x','x//y','x\u0000y'])test('reject path '+JSON.stringify(path),()=>assert.equal(safePath(path),false));
test('confirmed fact binding required',()=>{const f=load('contracts/fact-manifest.example.json');f.bindings[0].factIds=['unknown'];assert.ok(invalid(f));});
test('new commercial claim rejected',()=>{const f=load('contracts/fact-manifest.example.json');f.bindings[0].expectedText='Guaranteed 1000%';assert.ok(invalid(f));});
test('BLOCK cannot be waived',()=>{const q={schemaVersion:'2.2.1',kind:'quality_report',projectId:c.projectId,revisionId:c.revisionId,targetId:'tiktok:portrait',sourceHash:c.sourceArchiveHash,factManifestHash:c.factManifestHash,checkerVersion:'fixture',coverage:'fixture_only',evidenceRefs:[],findings:[{code:'FORBIDDEN_ASSET',level:'BLOCK',frameStart:0,frameEndExclusive:30,message:'fixture',waiver:{actorId:'user',reason:'allow',revisionId:c.revisionId,targetId:'tiktok:portrait',expiresAt:'2026-10-21T00:00:00Z'}}]};assert.ok(invalid(q));});
test('state happy path',()=>{let s=transition('queued','start');s=transition(s,'candidate');assert.equal(transition(s,'pass',{authorized:true,generationMatches:true,qaPassed:true}),'succeeded');});
for(const state of ['succeeded','failed','cancelled'])test('terminal state '+state,()=>assert.throws(()=>transition(state,'start')));
test('resume must recheck membership/base/budget/window',()=>{const g={authorized:true,baseMatches:true,withinWindow:true,remainingBudget:1};assert.equal(transition('paused_budget','resume',g),'queued');for(const k of Object.keys(g))assert.throws(()=>transition('paused_budget','resume',{...g,[k]:false}));});
test('two repairs maximum',()=>{assert.equal(transition('validating','repair',{repairs:1,remainingBudget:1}),'active');assert.throws(()=>transition('validating','repair',{repairs:2,remainingBudget:1}));});
test('late generation cannot publish',()=>assert.throws(()=>transition('validating','pass',{authorized:true,qaPassed:true,generationMatches:false})));
test('duplicate reservation and delivery only consume once',()=>{const q=new QuotaReference(1);q.reserve('a','hash');q.reserve('a','hash');q.deliver('a',true);q.deliver('a',true);assert.equal(q.available,0);q.cancel('a');assert.equal(q.available,0);assert.throws(()=>q.reserve('a','other'));});
test('failure/cancel release once',()=>{const q=new QuotaReference(1);q.reserve('a','h');assert.throws(()=>q.deliver('a',false));q.cancel('a');q.cancel('a');assert.equal(q.available,1);});
test('concurrent last unit guards',()=>{const q=new QuotaReference(1);q.reserve('a','h');assert.throws(()=>q.reserve('b','h'));});
test('CAS accept, duplicate request and rejected competing patch',()=>{const x=new RevisionReference('base');assert.equal(x.apply('req','base','new',true),'new');assert.equal(x.apply('req','base','new',true),'new');assert.throws(()=>x.apply('other','base','newer',true));assert.throws(()=>x.apply('req','base','different',true));assert.equal(x.current,'new');});
test('revoked actor cannot apply even a repeated request',()=>{const x=new RevisionReference('base');x.apply('r','base','new',true);assert.throws(()=>x.apply('r','base','new',false));});
const protocol=load('tests/contracts/protocol-fixtures.json').valid;
test('exact ready accepted',()=>assert.ok(matchesFrameReady(protocol.render_seek,protocol.render_ready,protocol.render_init.manifestHash)));
for(const field of ['sequence','sessionId','requestId','revisionId','targetId','frameIndex','manifestHash'])test('stale ready '+field,()=>{const x=clone(protocol.render_ready);x[field]=typeof x[field]==='number'?999:'old';assert.equal(matchesFrameReady(protocol.render_seek,x,protocol.render_init.manifestHash),false);});
test('dispose invalidates ready',()=>assert.equal(matchesFrameReady(protocol.render_seek,protocol.render_ready,protocol.render_init.manifestHash,true),false));
test('actual preset controls renderer dimensions',()=>{const x=clone(protocol.render_init);assert.deepEqual(semanticErrors(x,{composition:c}),[]);x.width=1000;assert.ok(invalid(x));});
test('renderer manifest and frame identity',()=>{for(const k of ['manifestHash','frameCount']){const x=clone(protocol.render_init);x[k]=k==='frameCount'?450:'a'.repeat(64);assert.ok(invalid(x));}});
test('fact manifest hash linked to source revision',()=>{const f=load('contracts/fact-manifest.example.json');assert.deepEqual(semanticErrors(c,{factManifest:f}),[]);f.facts[0].text='edited';assert.ok(semanticErrors(c,{factManifest:f}).includes('FACT_MANIFEST_HASH_MISMATCH'));});
test('full API error supports safe params',()=>{const e={code:'STALE_BASE',messageKey:'errors.staleBase',message:'Review changes',requestId:'req_error',retryable:false,params:{currentRevision:'revision'},fieldErrors:[{code:'INVALID',field:'baseRevision',messageKey:'errors.invalid',params:{min:1}}]};assert.deepEqual(validateSchema(e,schemaForError()),[]);e.params.secret={raw:'no nesting'};assert.ok(validateSchema(e,schemaForError()).length);});
function schemaForError(){return load('contracts/production.schema.json').$defs.error;}

test('export links actual composition bytes',()=>{const x=load('contracts/export-manifest.example.json');x.compositionHash='b'.repeat(64);assert.ok(invalid(x));});
test('export links frozen snapshot, not current draft',()=>{const x=load('contracts/export-manifest.example.json');assert.deepEqual(semanticErrors(x,{composition:c,snapshot:r}),[]);x.snapshotHash='d'.repeat(64);assert.ok(semanticErrors(x,{composition:c,snapshot:r}).includes('EXPORT_SNAPSHOT_MISMATCH'));});
