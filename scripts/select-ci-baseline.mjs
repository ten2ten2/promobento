#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const workflow='.github/workflows/checks.yml';
const reviewedBootstrap={repository:'ten2ten2/promobento',sha:'a55939e4e080b4a0731b0b43315b22d0ad7ec902'};
export const baselineLookupLimits=Object.freeze({maxRequests:128,totalTimeoutMs:60000,requestTimeoutMs:30000});
const isSha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const isSuccessfulMainRun=run=>run?.status==='completed'&&run.conclusion==='success'
  &&run.head_branch==='main'&&run.path?.split('@')[0]===workflow&&isSha(run.head_sha);

/** Newer failed/cancelled runs and successful unrelated branches never move the base. */
export function selectSuccessfulAncestor(runs,headSha,distance) {
  const eligible=runs.filter(run=>isSuccessfulMainRun(run)&&run.head_sha!==headSha);
  const ancestors=eligible.map(run=>({sha:run.head_sha,distance:distance(run.head_sha)}))
    .filter(candidate=>Number.isSafeInteger(candidate.distance)&&candidate.distance>0);
  ancestors.sort((a,b)=>a.distance-b.distance||(a.sha<b.sha?-1:a.sha>b.sha?1:0));
  return ancestors[0]?.sha??null;
}

export async function resolveMainBaseline({repository,headSha,token,fetcher=fetch,now=()=>performance.now(),
  git=(args,options)=>spawnSync('git',args,{encoding:'utf8',maxBuffer:16*1024*1024,...options})}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)||!isSha(headSha)||!token)
    throw Error('CI_BASELINE_CONTEXT_REQUIRED');
  const deadline=now()+baselineLookupLimits.totalTimeoutMs;
  let requests=0;
  const remainingTime=()=>{
    const remaining=Math.floor(deadline-now());
    if(remaining<=0) throw Error('CI_BASELINE_TIME_BUDGET_EXCEEDED: lookup must finish within '+baselineLookupLimits.totalTimeoutMs+' ms');
    return remaining;
  };
  const requireQueryBudget=()=>{
    if(requests>=baselineLookupLimits.maxRequests)
      throw Error('CI_BASELINE_QUERY_BUDGET_EXCEEDED: nearest successful ancestor not established within '+baselineLookupLimits.maxRequests+' requests');
  };
  const runGit=args=>{
    const result=git(args,{timeout:remainingTime(),killSignal:'SIGKILL'});
    remainingTime();
    return result;
  };
  const gitOutput=args=>{
    const result=runGit(args);
    if(result.status!==0) throw Error('CI_BASELINE_GIT_FAILED: fetch complete commit history');
    return result.stdout.trim();
  };
  if(gitOutput(['rev-parse','--verify',headSha+'^{commit}'])!==headSha) throw Error('CI_BASELINE_HEAD_INVALID');
  const distances=new Map();
  const distance=sha=>{
    if(!distances.has(sha)) {
      const ancestor=runGit(['merge-base','--is-ancestor',sha,headSha]);
      distances.set(sha,ancestor.status===0?Number(gitOutput(['rev-list','--count',sha+'..'+headSha])):null);
    }
    return distances.get(sha);
  };
  const listRuns=async sha=>{
    requireQueryBudget();
    const timeoutMs=Math.min(baselineLookupLimits.requestTimeoutMs,remainingTime());
    requests++;
    const query=new URLSearchParams({branch:'main',status:'success',per_page:sha?'1':'100',page:'1'});
    if(sha) query.set('head_sha',sha);
    const url='https://api.github.com/repos/'+repository+'/actions/workflows/checks.yml/runs?'+query;
    let response,body;
    try {
      response=await fetcher(url,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(timeoutMs)});
      remainingTime();
      if(response.ok) body=await response.json();
    }catch(error){
      remainingTime();
      throw Error('CI_BASELINE_LOOKUP_FAILED: '+error.name,{cause:error});
    }
    remainingTime();
    if(!response.ok) throw Error('CI_BASELINE_LOOKUP_FAILED: HTTP '+response.status);
    if(!Array.isArray(body.workflow_runs)||!Number.isSafeInteger(body.total_count)||body.total_count<0
      ||body.workflow_runs.length>body.total_count||body.total_count>0&&!body.workflow_runs.length
      ||body.workflow_runs.some(run=>!isSuccessfulMainRun(run)||sha&&run.head_sha!==sha))
      throw Error('CI_BASELINE_RESPONSE_INVALID');
    return body;
  };
  // A bounded discovery page avoids GitHub's 1,000-result filtered-history limit.
  const first=await listRuns();
  if(first.total_count===0) {
    const initial=reviewedBootstrap.sha;
    if(repository!==reviewedBootstrap.repository||initial===headSha||!(distance(initial)>0))
      throw Error('CI_BASELINE_UNAVAILABLE: the reviewed bootstrap must be a strict ancestor in its registered repository');
    remainingTime();
    return initial;
  }
  const candidates=first.workflow_runs;
  let selected=selectSuccessfulAncestor(candidates,headSha,distance);
  // Any nearer ancestor lies in HEAD ^discovered. Query exact SHAs, rather than
  // trusting run timestamps: rerunning an old commit can put it on the first page.
  const checked=new Set([headSha,...candidates.map(run=>run.head_sha)]);
  const remaining=()=>{
    const shas=gitOutput(['rev-list',headSha,...selected?['^'+selected]:[]]).split('\n').filter(Boolean);
    if(shas.some(sha=>!isSha(sha))) throw Error('CI_BASELINE_GIT_FAILED: invalid ancestor list');
    return shas.filter(sha=>!checked.has(sha));
  };
  let pending=remaining();
  while(pending.length) {
    remainingTime();
    requireQueryBudget();
    const commits=pending.splice(0,Math.min(8,baselineLookupLimits.maxRequests-requests));
    const batch=await Promise.all(commits.map(sha=>listRuns(sha)));
    for(const sha of commits) checked.add(sha);
    candidates.push(...batch.flatMap(body=>body.workflow_runs));
    const nearer=selectSuccessfulAncestor(candidates,headSha,distance);
    if(nearer!==selected) {selected=nearer;pending=remaining();}
  }
  remainingTime();
  if(!selected) throw Error('CI_BASELINE_UNAVAILABLE: no successful main ancestor; no fallback to event.before');
  return selected;
}

if (process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const sha=await resolveMainBaseline({repository:process.env.GITHUB_REPOSITORY,headSha:process.env.GITHUB_SHA,token:process.env.GITHUB_TOKEN});
  if(!process.env.GITHUB_ENV) throw Error('GITHUB_ENV_REQUIRED');
  appendFileSync(process.env.GITHUB_ENV,'PROMOBENTO_BASE_REF='+sha+'\n');
  console.log('Platform rule baseline: '+sha);
}
