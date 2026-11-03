import test from 'node:test';
import assert from 'node:assert/strict';
import {createSha256, sha256Bytes, sha256Stream} from '../src/digest.mjs';
import {assertNativeProject, assertNativePath, nativeProjectHash, NATIVE_RUNTIME_COMMIT} from '../src/native-project.mjs';
import {validate} from '@promobento/contracts/validators/native-project';

const file = (path, text) => ({path, key: 'operations/op/native/source/' + path, sha256: sha256Bytes(text), byteLength: Buffer.byteLength(text), mediaType: path.endsWith('.html') ? 'text/html' : 'text/javascript'});
const project = () => ({schemaVersion: '1.0.0', kind: 'native_project', entry: 'index.html', runtime: {name: 'huashu-motion', commit: NATIVE_RUNTIME_COMMIT}, composition: {durationSeconds: 15, fps: 30, width: 1920, height: 1080}, files: [file('index.html', '<div data-composition-id="film"></div>'), file('src/main.js', 'window.ready=true;')], resources: []});

test('shared incremental SHA-256 gives identical file, byte and streaming identities across chunk boundaries', async () => {
  const bytes = Buffer.alloc(3 * 65536 + 17, 0x7f);
  bytes[0] = 0; bytes[bytes.length - 1] = 255;
  const chunks = [bytes.subarray(0, 1), bytes.subarray(1, 65534), bytes.subarray(65534, 131077), bytes.subarray(131077)];
  const hash = createSha256();
  for (const chunk of chunks) hash.update(chunk);
  assert.equal(hash.hex(), sha256Bytes(bytes));
  assert.equal(await sha256Stream((async function* () {yield* chunks;})()), sha256Bytes(bytes));
});

test('project identity binds immutable source bytes and storage references, independent of file ordering', async () => {
  const value = project(), before = structuredClone(value);
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
  assert.deepEqual(assertNativeProject(value), before);
  const original = await nativeProjectHash(value);
  assert.equal(await nativeProjectHash({...value, files: [...value.files].reverse()}), original);
  for (const key of ['sha256', 'key', 'byteLength']) {
    const changed = structuredClone(value);
    changed.files[0][key] = key === 'sha256' ? 'b'.repeat(64) : key === 'key' ? 'operations/other/index.html' : 100;
    assert.notEqual(await nativeProjectHash(changed), original);
  }
  assert.deepEqual(value, before);
  const withEvidence={...value,timingEvidenceRef:{key:'operations/op/timing-evidence.json',sha256:'c'.repeat(64),byteLength:123}};
  assert.equal(validate(withEvidence),true);
  assert.equal(assertNativeProject(withEvidence),withEvidence);
  assert.notEqual(await nativeProjectHash(withEvidence),original,'restoring alignment evidence changes the immutable project identity');
  assert.throws(()=>assertNativeProject({...value,timingEvidenceRef:{...withEvidence.timingEvidenceRef,sha256:'invalid'}}),/NATIVE_TIMING_EVIDENCE_REF_INVALID/);
});

test('path traversal, Unicode/case collisions, files as parents and engine control directories are rejected', () => {
  for (const path of ['/etc/passwd', '../file', 'a/../b', 'a//b', 'a\\b', 'file:///tmp/x', 'a%2fb', '.om/project.json', 'out/film.mp4', 'node_modules/a.js', 'a\u0000b']) assert.throws(() => assertNativePath(path), /NATIVE_PATH/);
  for (const path of ['vendor/THREE-LICENSE', 'vendor/clip/LICENSE', 'assets/产品图.png', 'src']) assert.equal(assertNativePath(path), path);
  for (const path of ['INDEX.HTML', 'index.html/child.js']) {
    const value = project(); value.files.push(file(path, 'x'));
    assert.throws(() => assertNativeProject(value), /PATH_COLLISION/);
  }
  const missing = project(); missing.files.shift(); assert.throws(() => assertNativeProject(missing), /ENTRY_REQUIRED/);
});

test('whole-film envelope admits only pinned runtime, fixed platform dimensions and 15/30 seconds at 30 fps', () => {
  for (const composition of [{durationSeconds: 20}, {fps: 60}, {width: 1280, height: 720}]) {
    const value = project(); Object.assign(value.composition, composition);
    assert.equal(validate(value), false);
    assert.throws(() => assertNativeProject(value), /COMPOSITION_INVALID/);
  }
  const wrong = project(); wrong.runtime.commit = 'a'.repeat(40);
  assert.equal(validate(wrong), false); assert.throws(() => assertNativeProject(wrong), /RUNTIME_MISMATCH/);
  const oversize = project(); oversize.files[0].byteLength = (40 << 20) + 1;
  assert.equal(validate(oversize), false); assert.throws(() => assertNativeProject(oversize), /FILE_INVALID/);
  assert.throws(() => assertNativeProject({...project(), scenes: []}), /PROJECT_INVALID/);
});
