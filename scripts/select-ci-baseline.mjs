#!/usr/bin/env node
import {execFileSync,spawnSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

/** Newer failed/cancelled runs and successful unrelated branches never move the base. */
export function selectSuccessfulAncestor(runs,headSha,distance) {
  const eligible=runs.filter(run=>run.status==='completed'&&run.conclusion==='success'
    &&run.head_branch==='main'&&run.path?.split('@')[0]==='.github/workflows/checks.yml'
    &&run.head_sha!==headSha&&/^[a-f0-9]{40}$/.test(run.head_sha));
  const ancestors=eligible.map(run=>({sha:run.head_sha,distance:distance(run.head_sha)}))
    .filter(candidate=>Number.isSafeInteger(candidate.distance)&&candidate.distance>0);
  ancestors.sort((a,b)=>a.distance-b.distance);
  return ancestors[0]?.sha??null;
}

export async function resolveMainBaseline({repository,headSha,token,fetcher=fetch}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)||!/^[a-f0-9]{40}$/.test(headSha)||!token)
    throw Error('CI_BASELINE_CONTEXT_REQUIRED');
  const distance=sha=>{
    if (spawnSync('git',['merge-base','--is-ancestor',sha,headSha]).status!==0) return null;
    return Number(execFileSync('git',['rev-list','--count',sha+'..'+headSha],{encoding:'utf8'}).trim());
  };
  const candidates=[];
  for(let page=1;page<=10;page++) {
    const url='https://api.github.com/repos/'+repository+'/actions/workflows/checks.yml/runs?branch=main&status=success&per_page=100&page='+page;
    const response=await fetcher(url,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(30000)});
    if(!response.ok) throw Error('CI_BASELINE_LOOKUP_FAILED: HTTP '+response.status);
    const body=await response.json();
    if(!Array.isArray(body.workflow_runs)) throw Error('CI_BASELINE_RESPONSE_INVALID');
    candidates.push(...body.workflow_runs);
    if(body.workflow_runs.length<100) return selectSuccessfulAncestor(candidates,headSha,distance);
  }
  throw Error('CI_BASELINE_HISTORY_LIMIT: no silent fallback to event.before');
}

if (process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const sha=await resolveMainBaseline({repository:process.env.GITHUB_REPOSITORY,headSha:process.env.GITHUB_SHA,token:process.env.GITHUB_TOKEN});
  if(!sha) throw Error('CI_BASELINE_UNAVAILABLE: establish an explicitly reviewed successful main baseline first');
  if(!process.env.GITHUB_ENV) throw Error('GITHUB_ENV_REQUIRED');
  appendFileSync(process.env.GITHUB_ENV,'PROMOBENTO_BASE_REF='+sha+'\n');
  console.log('Platform rule baseline: successful main ancestor '+sha);
}
