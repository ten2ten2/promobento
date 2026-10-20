import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {repositoryFiles,conflictErrors,checkDocumentation,platformRuleErrors,platformBaseline} from './repo-documentation.mjs';
import {parseCanonicalJson} from '../packages/contracts/src/canonical.mjs';

function fixture(t,entries) {
  const root=mkdtempSync(join(tmpdir(),'promobento-repo-check-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
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
  assert.equal(platformBaseline(root,{CI:'true',PROMOBENTO_BASE_REF:'0'.repeat(40)}).reason,'initial push');
});
