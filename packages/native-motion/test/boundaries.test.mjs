import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sha256Bytes} from '../../contracts/src/digest.mjs';
import {frameTimes, assertSourceComposition, assertBrowserComposition, projectPath, verifyProjectFiles} from '../src/index.mjs';
import {seedBuiltinFiles} from '../src/files.mjs';

const composition = {durationSeconds: 15, fps: 30, width: 1920, height: 1080};
const html = '<div data-width="1920" data-composition-id="film" data-height="1080" data-duration="15" data-fps="30"></div>';

test('native metadata is explicit and matches the requested fixed product shape', () => {
  assertSourceComposition(html, composition);
  for (const wrong of [html.replace('1920', '1080'), html.replace('data-duration="15"', ''), html.replace('data-fps="30"', 'data-fps="60"')]) assert.throws(() => assertSourceComposition(wrong, composition), /COMPOSITION_MISMATCH/);
  assertBrowserComposition({id: 'film', width: 1920, height: 1080, duration: 15, fps: 30, timelines: ['film'], timelineDurations: {film: 15}, timelinePaused: {film: true}}, composition);
  assert.throws(() => assertBrowserComposition({width: 1920, height: 1080, duration: 30, fps: 30, timelines: ['film']}, composition), /BROWSER_COMPOSITION_MISMATCH/);
  assert.throws(() => assertBrowserComposition({id: 'film', width: 1920, height: 1080, duration: 15, fps: 30, timelines: ['film'], timelineDurations: {film: 30}, timelinePaused: {film: true}}, composition), /TIMELINE_DURATION_MISMATCH/);
});

test('preview samples preserve requested order and cannot seek beyond the last product frame', () => {
  assert.deepEqual(frameTimes(composition), [0, 5, 10, 15 - 1 / 30]);
  assert.deepEqual(frameTimes(composition, [10, 0, 5]), [10, 0, 5]);
  for (const times of [[15], [-1], [Infinity], [0, 0], [], Array.from({length: 13}, (_, i) => i)]) assert.throws(() => frameTimes(composition, times), /FRAME_TIMES_INVALID/);
});

test('hydrated files are confined, ordinary, declared and checked by raw byte identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'native-boundaries-'));
  try {
    writeFileSync(join(root, 'index.html'), html);
    const manifest = {files: [{path: 'index.html', byteLength: Buffer.byteLength(html), sha256: sha256Bytes(html)}]};
    verifyProjectFiles(root, manifest);
    for (const path of ['../outside', '/etc/passwd', 'assets/../../outside']) assert.throws(() => projectPath(root, path));
    writeFileSync(join(root, 'index.html'), html + ' ');
    assert.throws(() => verifyProjectFiles(root, manifest), /INPUT_IDENTITY_MISMATCH/);
    writeFileSync(join(root, 'index.html'), html);
    writeFileSync(join(root, 'undeclared.js'), '1');
    assert.throws(() => verifyProjectFiles(root, manifest), /UNDECLARED_FILE/);
    rmSync(join(root, 'undeclared.js'));
    symlinkSync('/etc', join(root, 'assets'));
    assert.throws(() => projectPath(root, 'assets/passwd'), /SYMLINK/);
    assert.throws(() => verifyProjectFiles(root, manifest), /SYMLINK/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('project files cannot shadow a pinned built-in runtime asset',() => {
 const root=mkdtempSync(join(tmpdir(),'native-builtin-project-'));
 const upstream=mkdtempSync(join(tmpdir(),'native-builtin-upstream-'));
 try{
  mkdirSync(join(root,'vendor'),{recursive:true});
  mkdirSync(join(upstream,'templates/blank/vendor'),{recursive:true});
  writeFileSync(join(root,'vendor/gsap.min.js'),'untrusted replacement');
  writeFileSync(join(upstream,'templates/blank/vendor/gsap.min.js'),'pinned library');
  assert.throws(()=>seedBuiltinFiles(root,upstream),/NATIVE_BUILTIN_CONFLICT/,
   'the native adapter must reject a different caller-supplied built-in before opening Chromium');
 }finally{rmSync(root,{recursive:true,force:true});rmSync(upstream,{recursive:true,force:true});}
});
