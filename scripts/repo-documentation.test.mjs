import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,truncateSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {repositoryFiles,conflictErrors,checkDocumentation,platformRuleErrors,platformBaseline,rendererToolchainErrors,indexedPrdFiles,specificationVersions} from './repo-documentation.mjs';
import {discoverTests} from './run-tests.mjs';
import {parseCanonicalJson} from '../packages/contracts/src/canonical.mjs';

function fixture(t,entries) {
  const root=mkdtempSync(join(tmpdir(),'promobento-repo-check-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const initialized=spawnSync('git',['init','-q'],{cwd:root,encoding:'utf8'});
  assert.equal(initialized.status,0,initialized.stderr);
  writeFileSync(join(root,'.gitignore'),'node_modules/\nrenders/\nartifacts/\n');
  for (const [path,source] of Object.entries(entries)) {
    mkdirSync(dirname(join(root,path)),{recursive:true});
    writeFileSync(join(root,path),source);
  }
  return root;
}
const check=(root,options)=>checkDocumentation(root,repositoryFiles(root),options).errors;

test('Markdown links verify Chinese, formatted and duplicate GFM headings, ignoring code',t=>{
  const root=fixture(t,{
    'README.md':[
      '# Entry','[self](#entry)','[中文](guide.md#中文标题)',
      '[second](guide.md#repeat-1)','[collision](guide.md#repeat-1-1)',
      '[formatted](guide.md#inline-code--formatting)',
      '[literal underscore](guide.md#a-_key_-snake_case)',
      '\x60[literal](missing.md#missing)\x60',
      '\x60\x60[another literal](missing.md)\x60\x60',
      '\x60\x60\x60markdown','[fenced](missing.md)','\x60\x60\x60',
      '~~~md','[tilde fenced](missing.md)','~~~'
    ].join('\n'),
    'guide.md':['## 中文标题','## Repeat','## Repeat','## Repeat-1','## Inline \x60code\x60 & **formatting**','## _A_ \x60_key_\x60 snake_case'].join('\n')
  });
  assert.deepEqual(check(root),[]);
  writeFileSync(join(root,'README.md'),'[missing section](guide.md#不存在)');
  assert.match(check(root).join('\n'),/Missing Markdown anchor/);
});

test('policy templates allow registered null drafts; route aliases are not native Markdown IDs',t=>{
  const root=fixture(t,{
    'content/pages/en/terms.md':[
      '---','title: Terms','description: "{{brand.name}}"','status: draft','effectiveAt: null',
      'anchors:','  acceptable-use: "8. Acceptable use"','---',
      '## 8. Acceptable use','[policy]({{links.terms}}#acceptable-use)'
    ].join('\n'),
    'content/pages/README.md':'[native](en/terms.md#8-acceptable-use)'
  });
  const options={publicContext:{brand:{name:null},links:{terms:'/terms'},_meta:{private:'excluded'}},routes:[{path:'/terms',kind:'page',method:'GET'}]};
  assert.deepEqual(check(root,options),[]);
  writeFileSync(join(root,'content/pages/README.md'),'[not a native ID](en/terms.md#acceptable-use)\n{{brand.nmae}}\n{{_meta.private}}');
  const errors=check(root,options).join('\n');
  assert.match(errors,/Missing Markdown anchor/);
  assert.match(errors,/Unknown template variable \{\{brand\.nmae\}\}/);
  assert.match(errors,/Unknown template variable \{\{_meta\.private\}\}/);
  const badRoute=structuredClone(options);badRoute.publicContext.links.terms='/not-registered';
  assert.match(check(root,badRoute).join('\n'),/Unregistered public-context route/);
});

test('frontmatter registrations reject duplicate IDs, ambiguous headings and missing targets',t=>{
  const root=fixture(t,{
    'content/pages/en/terms.md':[
      '---','anchors:','  rules: "Rules"','  rules: "Rules"','  missing: "Old title"','---',
      '## Rules','## Rules'
    ].join('\n')
  });
  const errors=check(root).join('\n');
  assert.match(errors,/Duplicate frontmatter anchor: rules/);
  assert.match(errors,/rules must identify exactly one H2/);
  assert.match(errors,/missing must identify exactly one H2/);
});

test('execution changes require a rulesVersion bump; source prose and preset display order do not',()=>{
  const previous=parseCanonicalJson(readFileSync(new URL('../config/platform-presets.json',import.meta.url)));
  const changed=structuredClone(previous);
  changed.aspectLayouts.portrait.safeInsets.bottom+=0.01;
  assert.match(platformRuleErrors(previous,changed).join('\n'),/rulesVersion bump.*aspectLayouts/);
  changed.rulesVersion+='-next';
  assert.deepEqual(platformRuleErrors(previous,changed),[]);
  const prose=structuredClone(previous);
  prose.checkedAt='2099-01-01';prose.sources=['Rechecked official source'];
  prose.presets[0].userNoteKey='copy.updated';
  prose.presets.reverse();
  assert.deepEqual(platformRuleErrors(previous,prose),[]);
  const sampling=structuredClone(previous);
  sampling.defaultRenderProfile=previous.defaultRenderProfile==='standard'?'motion4':'standard';
  assert.match(platformRuleErrors(previous,sampling).join('\n'),/defaultRenderProfile/);
});

test('conflict scanning covers source/config text and excludes Git metadata and dependencies',t=>{
  const marker='<'.repeat(7)+' HEAD\n';
  const root=fixture(t,{
    'packages/runtime/code.mjs':marker,
    'config/settings.json':marker,
    '.git/ignored':marker,
    'node_modules/ignored/index.js':marker,
    'asset.bin':Buffer.from([0,1,2,3])
  });
  const errors=conflictErrors(root,repositoryFiles(root));
  assert.equal(errors.length,2);
  assert.ok(errors.some(error=>error.includes('packages/runtime/code.mjs')));
  assert.ok(errors.some(error=>error.includes('config/settings.json')));
});

test('Git file discovery includes tracked and new files, skips ignored output, deleted files and symlinks',t=>{
  const root=fixture(t,{
    'tracked.md':'Tracked',
    'removed.md':'Will be deleted',
    'renders/kept.md':'Explicitly tracked despite ignore',
    'renders/report.md':'[generated output](missing.mp4)',
    'artifacts/output.test.mjs':'Not a source test',
    'new file\nwith newline.md':'New file'
  });
  const added=spawnSync('git',['add','-f','tracked.md','removed.md','renders/kept.md'],{cwd:root,encoding:'utf8'});
  assert.equal(added.status,0,added.stderr);
  rmSync(join(root,'removed.md'));
  symlinkSync(join(root,'tracked.md'),join(root,'linked.md'));
  const paths=repositoryFiles(root);
  for (const path of ['tracked.md','renders/kept.md','new file\nwith newline.md']) assert.ok(paths.includes(join(root,path)),path);
  for (const path of ['removed.md','renders/report.md','artifacts/output.test.mjs','linked.md']) assert.ok(!paths.includes(join(root,path)),path);
  assert.deepEqual(check(root),[]);
});

test('conflict checks accept Markdown headings while finding orphaned and complete conflict markers',t=>{
  const start='<'.repeat(7)+' HEAD',end='>'.repeat(7)+' branch',base='|'.repeat(7)+' ancestor';
  const root=fixture(t,{
    'README.md':'Heading\n=======\n',
    'orphan.mjs':end+'\n',
    'separator.mjs':'='.repeat(7)+'\n',
    'orphan.md':'\n'+'='.repeat(7)+'\n',
    'conflict.mjs':[start,'old',base,'base','='.repeat(7),'new',end].join('\n'),
    'preview.mov':'',
    'large.txt':''
  });
  // Sparse files exercise the size check without allocating a multi-gigabyte buffer.
  truncateSync(join(root,'preview.mov'),3*1024*1024*1024);
  truncateSync(join(root,'large.txt'),16*1024*1024);
  const errors=conflictErrors(root,repositoryFiles(root));
  assert.equal(errors.length,7);
  assert.ok(errors.some(error=>error.includes('orphan.mjs')));
  assert.ok(errors.some(error=>error.includes('separator.mjs')));
  assert.ok(errors.some(error=>error.includes('orphan.md')));
  assert.ok(errors.every(error=>!error.includes('README.md')));
});

test('the PRD index owns its chapter list and version labels exclude toolchain numbers',()=>{
  assert.deepEqual(indexedPrdFiles('| [Product](01-product-prd.md) | Scope |\n| [Renderer](15-renderer.md) | Media |\n[Other](../README.md)'),['01-product-prd.md','15-renderer.md']);
  assert.deepEqual(specificationVersions('Requires Node 26.12.0 and pnpm 12.14.0.\n现行 PRD **v2.7**、结构协议 `2.7.0`。'),{prd:['v2.7'],protocol:['2.7.0']});
  assert.deepEqual(specificationVersions('产品规格 v2.7；协议为 2.7.0；PRD v9.9'),{prd:['v2.7','v9.9'],protocol:['2.7.0']});
});

test('renderer lock detects toolchain drift before browser installation',()=>{
  const mise='[tools]\nnode = "26.12.0"\n';
  const project={engines:{node:'26.12.0'}},renderer={dependencies:{'playwright-core':'1.62.1'}};
  const lock={nodeVersion:'26.12.0',playwrightCoreVersion:'1.62.1'};
  assert.deepEqual(rendererToolchainErrors(mise,project,renderer,lock),[]);
  assert.match(rendererToolchainErrors(mise,project,renderer,{...lock,nodeVersion:'26.11.0'}).join('\n'),/Node pin/);
  assert.match(rendererToolchainErrors(mise,{engines:{node:'26.11.0'}},renderer,lock).join('\n'),/Node pin/);
  assert.match(rendererToolchainErrors(mise,project,renderer,{...lock,playwrightCoreVersion:'1.61.0'}).join('\n'),/Playwright pin/);
  assert.match(rendererToolchainErrors(mise,project,{dependencies:{'playwright-core':'^1.62.1'}},lock).join('\n'),/Playwright pin/);
});

test('unit test discovery covers new packages and apps without collecting generated or browser suites',t=>{
  const root=fixture(t,{
    'scripts/check.test.mjs':'',
    'packages/runtime/test/nested/draw.test.mjs':'',
    'apps/web/test/editor.test.mjs':'',
    'apps/web/test/state.test.ts':'',
    'packages/runtime/test/seek.test.js':'',
    'packages/runtime/test/clock.test.mts':'',
    'apps/renderer/test/sample.render.test.mjs':'',
    'tests/integration/ledger.test.mjs':'',
    'apps/web/e2e/editor.spec.ts':'',
    'renders/output.test.mjs':'',
    'node_modules/dependency/test/unrelated.test.mjs':''
  });
  assert.deepEqual(discoverTests(root).map(path=>path.slice(root.length+1)),[
    'apps/web/test/editor.test.mjs','apps/web/test/state.test.ts','packages/runtime/test/clock.test.mts','packages/runtime/test/nested/draw.test.mjs','packages/runtime/test/seek.test.js','scripts/check.test.mjs','tests/integration/ledger.test.mjs'
  ]);
  assert.deepEqual(discoverTests(root,{suite:'render'}).map(path=>path.slice(root.length+1)),['apps/renderer/test/sample.render.test.mjs']);
  writeFileSync(join(root,'apps/web/test/unsupported.test.tsx'),'');
  assert.throws(()=>discoverTests(root),/Unsupported test extension/);
});

test('Git baseline uses explicit CI commits, HEAD for dirty work and HEAD^ for clean work',t=>{
  // These commits exist only in a disposable fixture, never in the application repository.
  const previous={rulesVersion:'test-v1',productLimits:{durationSeconds:[15,30]}};
  const root=fixture(t,{'config/platform-presets.json':JSON.stringify(previous)});
  const git=args=>{
    const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);return result.stdout.trim();
  };
  const commit=message=>{
    git(['add','.']);
    git(['-c','user.name=Repository checks','-c','user.email=checks@example.test','commit','-qm',message]);
    return git(['rev-parse','HEAD']);
  };
  git(['init','-q']);
  const first=commit('baseline');
  assert.equal(platformBaseline(root,{}).reason,'initial local commit');
  writeFileSync(join(root,'README.md'),'A separate documentation change');
  const second=commit('documentation');
  assert.equal(platformBaseline(root,{}).commit,first);
  writeFileSync(join(root,'README.md'),'Uncommitted documentation change');
  assert.equal(platformBaseline(root,{}).commit,second);
  assert.deepEqual(platformBaseline(root,{CI:'true',PROMOBENTO_BASE_REF:first}).config,previous);
  assert.throws(()=>platformBaseline(root,{CI:'true'}),/CI requires PROMOBENTO_BASE_REF/);
  assert.throws(()=>platformBaseline(root,{CI:'true',PROMOBENTO_BASE_REF:'missing-base'}),/Cannot read Git baseline/);
  assert.throws(()=>platformBaseline(root,{CI:'true',PROMOBENTO_BASE_REF:'0'.repeat(40)}),/empty Git baseline/);
  assert.throws(()=>platformBaseline(root,{CI:'true',PROMOBENTO_BASE_REF:second}),/strict ancestor/);
  assert.equal(platformBaseline(root,{PROMOBENTO_BASE_REF:second}).commit,second,'local dirty work can still compare with HEAD');
});
