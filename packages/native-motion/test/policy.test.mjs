import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PROJECT_ORIGIN, safeMediaFile, mediaReadOptions, installProjectFetch, assertNativeTimeline} from '../src/policy.mjs';

test('media must be a real file in the project; a filename cannot turn an HLS playlist into allowed media', () => {
  const directory = mkdtempSync(join(tmpdir(), 'native-policy-')), root = join(directory, 'project');
  mkdirSync(join(root, 'assets'), {recursive: true});
  try {
    const wav = Buffer.alloc(44); wav.write('RIFF', 0); wav.write('WAVE', 8);
    const file = join(root, 'assets/tone.wav'); writeFileSync(file, wav);
    assert.equal(safeMediaFile('assets/tone.wav', root), file);
    assert.equal(safeMediaFile(pathToFileURL(file).href, root), file);
    assert.equal(safeMediaFile(PROJECT_ORIGIN + '/assets/tone.wav', root), file);
    assert.deepEqual(mediaReadOptions(file), ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'wav']);
    const outside = join(directory, 'outside.wav'); writeFileSync(outside, wav);
    for (const path of [outside, pathToFileURL(outside).href, '../outside.wav', '/etc/passwd']) assert.throws(() => safeMediaFile(path, root), /OUTSIDE_PROJECT/);
    assert.throws(() => safeMediaFile('https://example.com/a.wav', root), /URL_FORBIDDEN/);
    symlinkSync(outside, join(root, 'assets/link.wav'));
    assert.throws(() => safeMediaFile('assets/link.wav', root), /SYMLINK/);
    writeFileSync(join(root, 'assets/playlist.mp4'), '#EXTM3U\nfile:///etc/passwd\n');
    assert.throws(() => mediaReadOptions(join(root, 'assets/playlist.mp4')), /FORMAT_FORBIDDEN/);
    const mov = Buffer.alloc(32); mov.write('ftyp', 4); writeFileSync(join(root, 'assets/m.mp4'), mov);
    assert.deepEqual(mediaReadOptions(join(root, 'assets/m.mp4')).slice(-4), ['-enable_drefs', '0', '-use_absolute_path', '0']);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('virtual HTTP responses carry the header CSP, handle ranges, and cannot serve outside files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'native-fetch-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<html></html>');
  writeFileSync(join(root, 'assets/data.bin'), '0123456789');
  symlinkSync('/etc/passwd', join(root, 'assets/leak.txt'));
  const listeners = new Map(), calls = [], errors = [];
  const page = {on: (name, handler) => listeners.set(name, handler), send: async (method, params) => {calls.push({method, params}); return {};}};
  try {
    assert.equal(await installProjectFetch(page, {root, html: '<html>native</html>', errors}), PROJECT_ORIGIN + '/index.html');
    const request = async (url, headers = {}) => {
      calls.length = 0;
      await listeners.get('Fetch.requestPaused')({requestId: 'test', request: {url, headers, method: 'GET'}});
      return calls.at(-1);
    };
    let response = await request(PROJECT_ORIGIN + '/index.html');
    assert.equal(response.method, 'Fetch.fulfillRequest');
    assert.equal(Buffer.from(response.params.body, 'base64').toString(), '<html>native</html>');
    const csp = response.params.responseHeaders.find(header => header.name === 'Content-Security-Policy').value;
    assert.match(csp, /frame-src 'none'/); assert.match(csp, /worker-src 'none'/); assert.match(csp, /base-uri 'none'/);
    response = await request(PROJECT_ORIGIN + '/assets/data.bin', {Range: 'bytes=3-5'});
    assert.equal(response.params.responseCode, 206);
    assert.equal(Buffer.from(response.params.body, 'base64').toString(), '345');
    response = await request('data:text/plain,inline'); assert.equal(response.method, 'Fetch.continueRequest');
    response = await request('blob:' + PROJECT_ORIGIN + '/local-object'); assert.equal(response.method, 'Fetch.continueRequest');
    for (const url of ['file:///etc/passwd', 'http://127.0.0.1:8080/result', 'https://example.com/', PROJECT_ORIGIN + '/assets/leak.txt', PROJECT_ORIGIN + '/%2e%2e%2fetc/passwd']) {
      response = await request(url);
      assert.equal(response.method, 'Fetch.failRequest', url);
    }
    assert.equal(errors.length, 5);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('the actual registered timeline must be paused and exactly as long as the root, not silently cropped', () => {
  const info = {id: 'film', duration: 15, timelineDurations: {film: 15}, timelinePaused: {film: true}};
  assertNativeTimeline(info);
  assert.throws(() => assertNativeTimeline({...info, timelineDurations: {film: 30}}), /TIMELINE_DURATION_MISMATCH/);
  assert.throws(() => assertNativeTimeline({...info, timelinePaused: {film: false}}), /TIMELINE_DURATION_MISMATCH/);
});
