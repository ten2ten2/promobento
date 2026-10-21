import test from 'node:test';
import assert from 'node:assert/strict';
import {selectSuccessfulAncestor} from './select-ci-baseline.mjs';
import {platformRuleErrors} from './repo-documentation.mjs';
const sha=n=>String(n).repeat(40);
const run=(n,extra={})=>({status:'completed',conclusion:'success',head_branch:'main',path:'.github/workflows/checks.yml',head_sha:sha(n),...extra});

test('cancelled rule edit followed by a documentation push is compared with the last verified rules',()=>{
  const baseline=selectSuccessfulAncestor([run(2,{conclusion:'cancelled'}),run(1)],sha(3),value=>value===sha(1)?2:1);
  assert.equal(baseline,sha(1));
  const green={rulesVersion:'r1',renderProfiles:{standard:{sampleCount:1}}};
  const edit={rulesVersion:'r1',renderProfiles:{standard:{sampleCount:4}}};
  assert.equal(platformRuleErrors(edit,edit).length,0,'event.before would miss this');
  assert.equal(platformRuleErrors(green,edit).length,1,'the successful base catches it');
  assert.deepEqual(platformRuleErrors(green,{...edit,rulesVersion:'r2'}),[],'a corrected final tree may pass without rewriting history');
});

test('baseline must be a successful ancestor from the same workflow and main branch',()=>{
  const runs=[run(1),run(2,{head_branch:'ci/media'}),run(3,{path:'.github/workflows/deploy.yml'}),run(4),run(5)];
  assert.equal(selectSuccessfulAncestor(runs,sha(5),value=>value===sha(4)?null:6-Number(value[0])),sha(1));
  assert.equal(selectSuccessfulAncestor([run(1,{conclusion:'failure'})],sha(2),()=>1),null);
});
