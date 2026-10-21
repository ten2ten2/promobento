import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {selectSuccessfulAncestor,resolveMainBaseline} from './select-ci-baseline.mjs';
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

function history(t) {
  const root=mkdtempSync(join(tmpdir(),'promobento-ci-baseline-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const git=args=>spawnSync('git',args,{cwd:root,encoding:'utf8'});
  const command=args=>{
    const result=git(args);assert.equal(result.status,0,result.stderr);return result.stdout.trim();
  };
  command(['init','-q']);
  const commits=Array.from({length:4},(_,n)=>{
    command(['-c','user.name=CI baseline tests','-c','user.email=ci@example.test','commit','--allow-empty','-qm','commit '+n]);
    return command(['rev-parse','HEAD']);
  });
  return {git,commits};
}
const response=(workflow_runs,total_count=workflow_runs.length)=>({ok:true,json:async()=>({workflow_runs,total_count})});
const successful=head_sha=>run(1,{head_sha});
const context={repository:'ten2ten2/promobento',token:'test-only'};

test('a nearby successful ancestor stops discovery even when filtered history exceeds 1,000 runs',async t=>{
  const {git,commits}=history(t),headSha=commits[3];
  for(const total of [999,1000,1500]) {
    const requests=[];
    const baseline=await resolveMainBaseline({...context,headSha,git,fetcher:async url=>{
      requests.push(new URL(url));
      return response(Array.from({length:100},()=>successful(commits[2])),total);
    }});
    assert.equal(baseline,commits[2]);
    assert.equal(requests.length,1,'do not exhaust historical pages before selecting a valid base');
  }
});

test('exact-commit lookup finds a nearer success hidden beyond the first 1,000 old reruns',async t=>{
  const {git,commits}=history(t),headSha=commits[3],requests=[];
  const baseline=await resolveMainBaseline({...context,headSha,git,fetcher:async url=>{
    const query=new URL(url).searchParams;requests.push(query);
    const target=query.get('head_sha');
    if(!target) return response(Array.from({length:100},()=>successful(commits[0])),1501);
    return response(target===commits[1]?[successful(target)]:[]);
  }});
  assert.equal(baseline,commits[1],'the old commit has newer run timestamps, but is farther from HEAD');
  assert.equal(requests.length,3);
  assert.ok(requests.every(query=>query.get('page')==='1'),'exact SHA queries avoid the global pagination limit');
  assert.deepEqual(requests.slice(1).map(query=>query.get('head_sha')).sort(),commits.slice(1,3).sort());
});

test('successful unrelated history is not mistaken for a first-run bootstrap',async t=>{
  const {git,commits}=history(t),headSha=commits[3];
  await assert.rejects(resolveMainBaseline({...context,headSha,git,fetcher:async url=>
    new URL(url).searchParams.has('head_sha')?response([]):response([successful(sha(9))])}),/CI_BASELINE_UNAVAILABLE/);
});

const bootstrapSha='a55939e4e080b4a0731b0b43315b22d0ad7ec902';
function bootstrapGit(headSha,{ancestor=true}={}) {
  return args=>{
    if(args[0]==='rev-parse') return {status:0,stdout:headSha};
    if(args[0]==='merge-base') return {status:ancestor&&args[2]===bootstrapSha?0:1,stdout:''};
    if(args[0]==='rev-list'&&args[1]==='--count') return {status:0,stdout:'1'};
    throw Error('Unexpected git command '+args.join(' '));
  };
}

test('only genuinely empty successful history may use the fixed reviewed ancestor',async()=>{
  const headSha=sha(4),options={...context,headSha,git:bootstrapGit(headSha),fetcher:async()=>response([])};
  assert.equal(await resolveMainBaseline(options),bootstrapSha);
  await assert.rejects(resolveMainBaseline({...options,repository:'someone/fork'}),/CI_BASELINE_UNAVAILABLE/);
  await assert.rejects(resolveMainBaseline({...options,headSha:bootstrapSha,git:bootstrapGit(bootstrapSha)}),/CI_BASELINE_UNAVAILABLE/);
  await assert.rejects(resolveMainBaseline({...options,git:bootstrapGit(headSha,{ancestor:false})}),/CI_BASELINE_UNAVAILABLE/);
});

test('network, permission and malformed responses cannot initialize a baseline',async()=>{
  const headSha=sha(4),options={...context,headSha,git:bootstrapGit(headSha)};
  await assert.rejects(resolveMainBaseline({...options,fetcher:async()=>({ok:false,status:403})}),/CI_BASELINE_LOOKUP_FAILED: HTTP 403/);
  await assert.rejects(resolveMainBaseline({...options,fetcher:async()=>{throw new TypeError('network unavailable');}}),/CI_BASELINE_LOOKUP_FAILED: TypeError/);
  await assert.rejects(resolveMainBaseline({...options,fetcher:async()=>response([],1)}),/CI_BASELINE_RESPONSE_INVALID/);
});
