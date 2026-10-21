#!/usr/bin/env node
import {dirname,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {repositoryFiles} from './repo-documentation.mjs';

// Native Node unit tests. Browser and media integration suites have separate commands.
export function discoverTests(root,{suite='unit'}={}) {
  if (!['unit','render'].includes(suite)) throw Error('Unknown test suite: '+suite);
  return repositoryFiles(root).filter(path=>{
    const name=relative(root,path).split(sep).join('/');
    if (!/^(?:scripts|tests|packages|apps)\/.*\.test\.[^/]+$/.test(name)) return false;
    if (!/\.test\.(?:mjs|js|cjs|ts|mts|cts)$/.test(name)) throw Error('Unsupported test extension: '+name);
    return suite==='render'?name.includes('.render.test.'):!name.includes('.render.test.');
  });
}

if (process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const suite=process.argv.includes('--render')?'render':'unit';
  const files=discoverTests(root,{suite});
  if (!files.length) throw Error('No '+suite+' tests found');
  const result=spawnSync(process.execPath,['--test',...files],{cwd:root,stdio:'inherit'});
  if (result.error) throw result.error;
  process.exitCode=result.status??1;
}
