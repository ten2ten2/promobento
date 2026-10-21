import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  digest, parseCanonicalJson, sourceFileDigests, targetSourceIdentity, sourceBuildErrors,
  inheritRevisionEnvironment, revisionEnvironmentErrors, contentIdentity, variantIdentity, qaInputIdentity
} from '../index.mjs';

const read = path => parseCanonicalJson(readFileSync(new URL('../../../'+path,import.meta.url)));
const composition=read('contracts/composition.example.json'), rules=read('config/platform-presets.json');
const clone=value=>structuredClone(value);
const files=()=>[
  {path:'src/main.mjs',bytes:Buffer.from('import "./shared.mjs";')},
  {path:'src/shared.mjs',bytes:Buffer.from('export const color = "blue";')},
  {path:'values.json',bytes:Buffer.from('{"headline":"Original"}')}
];
const graph=(input=files(),entrypoint='src/main.mjs')=>({entrypoint,files:sourceFileDigests(input)});
const sourceHash=input=>digest(targetSourceIdentity(input));

test('target source identity binds the entrypoint, dependency paths and actual file bytes',()=>{
  const original=graph(),initial=sourceHash(original);
  assert.equal(initial,sourceHash({...original,files:[...original.files].reverse()}));
  assert.equal(initial,sourceHash({...original,sourceArchiveHash:digest('unrelated archive metadata')}));
  for (const path of ['src/main.mjs','src/shared.mjs','values.json']) {
    const next=files();next.find(file=>file.path===path).bytes=Buffer.from('changed bytes');
    assert.notEqual(initial,sourceHash(graph(next)),path);
  }
  const renamed=clone(original);renamed.files[1].path='src/moved.mjs';
  assert.notEqual(initial,sourceHash(renamed));
  const extra={path:'src/other.mjs',bytes:files()[0].bytes};
  const alternatives=sourceFileDigests([...files(),extra]);
  assert.notEqual(sourceHash({entrypoint:'src/main.mjs',files:alternatives}),
    sourceHash({entrypoint:'src/other.mjs',files:alternatives}));
  assert.equal(original.files[0].sha256,'b079a46fc8f6c1aba7709ff7751b795e0c4c3dcb158400607bc1c36b9727d6c7');
});

test('target graphs require values, entrypoint and unique safe file paths',()=>{
  const original=graph();
  for (const path of ['values.json','src/main.mjs']) assert.throws(()=>targetSourceIdentity({
    ...original,files:original.files.filter(file=>file.path!==path)
  }),/SOURCE_GRAPH_INCOMPLETE/);
  assert.throws(()=>targetSourceIdentity({...original,files:[...original.files,original.files[0]]}),/SOURCE_FILE_INVALID/);
  for (const path of ['../bad','src/../bad','/absolute','src\\bad','https://bad','src/%2e/bad']) {
    assert.throws(()=>sourceFileDigests([{path,bytes:Buffer.from('x')}]),/SOURCE_FILE_INVALID/);
  }
  assert.throws(()=>sourceFileDigests([{path:'src/main.mjs',bytes:'unhashed text'}]),/SOURCE_FILE_INVALID/);
});

test('trusted build receipts reject stale archives, wrong entrypoints and caller-forged source hashes',()=>{
  const original=graph(),archive=digest('archive'),targetId='tiktok:portrait';
  const source={sourceArchiveHash:archive,variants:[{targetId,entrypoint:original.entrypoint,sourceHash:sourceHash(original)}]};
  const build={...original,sourceArchiveHash:archive};
  assert.deepEqual(sourceBuildErrors(source,{[targetId]:build}),[]);
  assert.deepEqual(sourceBuildErrors(source,{}),['SOURCE_BUILD_REQUIRED']);
  assert.ok(sourceBuildErrors(source,{[targetId]:{...build,sourceArchiveHash:digest('older archive')}}).includes('SOURCE_BUILD_SCOPE_MISMATCH'));
  const swapped=clone(source);swapped.variants[0].entrypoint='src/shared.mjs';
  assert.ok(sourceBuildErrors(swapped,{[targetId]:build}).includes('SOURCE_BUILD_SCOPE_MISMATCH'));
  const forged=clone(source);forged.variants[0].sourceHash=digest('invented');
  assert.ok(sourceBuildErrors(forged,{[targetId]:build}).includes('SOURCE_HASH_MISMATCH'));
});

test('another target changing its source does not invalidate the untouched target QA',()=>{
  const next=clone(composition),current=composition.variants[0],other=next.variants.find(variant=>variant.targetId!==current.targetId);
  next.sourceArchiveHash=digest('archive after another target edit');
  other.sourceHash=digest('other target changed');other.variantHash=digest(variantIdentity(next,other,rules));
  assert.equal(digest(qaInputIdentity(next,next.variants[0],'qa-test',rules)),
    digest(qaInputIdentity(composition,current,'qa-test',rules)));
  assert.notEqual(digest(contentIdentity(next)),digest(contentIdentity(composition)));
});

test('ordinary revisions inherit their base environment when application defaults change',()=>{
  const candidate={...clone(composition),revisionId:'revision_after_upgrade',identityVersion:99,
    runtimeVersion:'new-default',dependencyManifestHash:digest('new-default-deps'),presetRulesVersion:'new-default-rules',
    layoutRulesHash:digest('new-default-layout'),rendererImageDigest:'sha256:'+digest('new-default-image'),renderProfile:rules.renderProfiles.motion4};
  assert.ok(revisionEnvironmentErrors(composition,candidate).length>0);
  const inherited=inheritRevisionEnvironment(composition,candidate);
  assert.deepEqual(revisionEnvironmentErrors(composition,inherited),[]);
  assert.equal(inherited.revisionId,candidate.revisionId);
  assert.equal(digest(contentIdentity(inherited)),digest(contentIdentity(composition)));
  assert.equal(candidate.runtimeVersion,'new-default');
  assert.throws(()=>inheritRevisionEnvironment(composition,{...candidate,projectId:'other'}),/REVISION_PROJECT_MISMATCH/);
  const missing=clone(composition);delete missing.runtimeVersion;
  assert.throws(()=>inheritRevisionEnvironment(missing,candidate),/REVISION_ENVIRONMENT_INCOMPLETE/);
});

test('A to B to A still restores the original identity after a platform default upgrade',()=>{
  const changed=clone(composition);changed.revisionId='revision_b';changed.variants[0].sourceHash=digest('changed source');
  changed.sourceArchiveHash=digest('changed archive');
  changed.variants[0].variantHash=digest(variantIdentity(changed,changed.variants[0],rules));
  assert.notEqual(digest(contentIdentity(changed)),digest(contentIdentity(composition)));
  const restored={...clone(composition),revisionId:'revision_restored',runtimeVersion:'new-default',rendererImageDigest:'sha256:'+digest('new-image')};
  assert.equal(digest(contentIdentity(inheritRevisionEnvironment(changed,restored))),digest(contentIdentity(composition)));
});
