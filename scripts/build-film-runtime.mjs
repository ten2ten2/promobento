import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import {buildValidators} from '../packages/contracts/scripts/build-validators.mjs';

buildValidators();
mkdirSync('packages/film-runtime/dist', {recursive: true});
await build({entryPoints: {
  shim: 'packages/film-runtime/src/shim.ts', engine: 'packages/film-runtime/src/engine.ts',
  boot: 'packages/film-runtime/src/boot.ts', blocks: 'packages/blocks/src/browser.ts'
}, outdir: 'packages/film-runtime/dist/browser', bundle: true, format: 'iife', platform: 'browser', target: 'chrome151'});
await build({entryPoints: ['packages/film-runtime/src/page.ts'], outfile: 'packages/film-runtime/dist/page.mjs',
  bundle: true, format: 'esm', platform: 'node', target: 'node26', packages: 'external'});
console.log('Built the FilmSpec page generator and trusted browser runtime (three blocks, standard sampling).');
