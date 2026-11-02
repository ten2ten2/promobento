#!/usr/bin/env node
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {repositoryFiles} from './repo-documentation.mjs';

// Native Node unit tests. Browser and media integration suites have separate commands.
const researchBrowserTests = new Set([
  'research/evals/approved-artwork.test.mjs',
  'research/evals/approved-video.test.mjs',
  'research/evals/product-observation.test.mjs',
]);
export function discoverTests(root,{suite='unit'}={}) {
  if (!['unit','render'].includes(suite)) throw Error('Unknown test suite: '+suite);
  return repositoryFiles(root).filter(path=>{
    const name=relative(root,path).split(sep).join('/');
    if (!/^(?:scripts|tests|packages|apps|research\/evals)\/.*\.test\.[^/]+$/.test(name)) return false;
    if (!/\.test\.(?:mjs|js|cjs|ts|mts|cts)$/.test(name)) throw Error('Unsupported test extension: '+name);
    const browser = name.includes('.render.test.') || researchBrowserTests.has(name);
    return suite==='render'?browser:!browser;
  });
}

if (process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const suite=process.argv.includes('--render')?'render':'unit';
  const files=discoverTests(root,{suite});
  if (!files.length) throw Error('No '+suite+' tests found');
  // The private material fixtures intentionally live under an ignored directory.
  // A fresh CI checkout does not contain it until the test runner creates it.
  mkdirSync(join(root,'artifacts'),{recursive:true});
  const result=spawnSync(process.execPath,['--test',...files],{cwd:root,stdio:'inherit'});
  if (result.error) throw result.error;
  process.exitCode=result.status??1;
}
