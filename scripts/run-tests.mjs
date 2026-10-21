#!/usr/bin/env node
import {dirname,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {repositoryFiles} from './repo-documentation.mjs';

// Native Node unit tests. Browser and media integration suites have separate commands.
export function discoverTests(root) {
  return repositoryFiles(root).filter(path=>/^(?:scripts|tests|packages|apps)\/.*\.test\.mjs$/.test(relative(root,path).split(sep).join('/')));
}

if (process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const files=discoverTests(root);
  if (!files.length) throw Error('No Node unit tests found');
  const result=spawnSync(process.execPath,['--test',...files],{cwd:root,stdio:'inherit'});
  if (result.error) throw result.error;
  process.exitCode=result.status??1;
}
