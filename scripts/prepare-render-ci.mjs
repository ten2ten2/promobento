#!/usr/bin/env node
import {appendFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {environmentLock} from '../apps/renderer/src/environment.mjs';
import {browserCacheDirectory} from '../apps/renderer/src/browser-bundle.mjs';

const [mode,...extra]=process.argv.slice(2);
const {GITHUB_SHA:commitSha,GITHUB_RUN_ID:runId,GITHUB_RUN_ATTEMPT:attempt,GITHUB_OUTPUT:output}=process.env;
if(!['regression','output'].includes(mode)||extra.length||!output||!/^[a-f0-9]{40}$/.test(commitSha??'')
  ||!/^\d+$/.test(runId??'')||!/^[1-9]\d*$/.test(attempt??'')) throw Error('RENDER_CI_CONTEXT_INVALID');
const actualSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',timeout:10000}).trim();
if(actualSha!==commitSha) throw Error('RENDER_CI_COMMIT_MISMATCH');
const {archiveSha256}=environmentLock.browser;
if(!/^[a-f0-9]{64}$/.test(archiveSha256)) throw Error('RENDER_CI_ARCHIVE_HASH_INVALID');

// Cache only the zip. install:renderer verifies it and extracts a private bundle on every run.
const directory=browserCacheDirectory(environmentLock.browser);
mkdirSync(directory,{recursive:true,mode:0o700});
appendFileSync(output,'archive-path='+join(directory,'browser.zip')+'\narchive-sha256='+archiveSha256+'\n');

const artifactDirectory='artifacts/m0a';
mkdirSync(artifactDirectory,{recursive:true});
writeFileSync(join(artifactDirectory,'ci-context.json'),JSON.stringify({
  kind:'m0a_ci_context',commitSha,runId,attempt,mode,fixture:mode==='output'?'media':'all',
  repository:process.env.GITHUB_REPOSITORY,job:process.env.GITHUB_JOB,
  runner:{os:process.env.RUNNER_OS,architecture:process.env.RUNNER_ARCH},
  browserArchiveSha256:archiveSha256,
  resourceMeasurements:'Each render report records its actual execution resources.'
},null,2)+'\n');
