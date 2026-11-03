import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {canonical} from '../../../packages/contracts/src/canonical.mjs';
import {sha256Bytes} from '../../../packages/contracts/src/digest.mjs';
import {NATIVE_COMMIT, prepareNativeProject, previewNativeProject, renderNativeProject, editNativeProject} from '../../../packages/native-motion/src/index.mjs';
import {normalizeNativeVideo, extractEncodedFrames} from '../src/media.mjs';
import {run} from '../src/process.mjs';

// Real Chromium + native 3D + FFmpeg, no model, no credentials, no network, no fake browser path.
assert.equal(process.getuid(), 10002);
const template = readFileSync(new URL('./fixtures/native-smoke.html', import.meta.url), 'utf8');
const root = mkdtempSync(join(tmpdir(), 'native-smoke-'));
const artifacts = process.env.NATIVE_SMOKE_OUTPUT || '/artifacts';
mkdirSync(artifacts, {recursive: true});
const cases = [
  {name: 'landscape-15', width: 1920, height: 1080, durationSeconds: 15, export: true},
  {name: 'portrait-30', width: 1080, height: 1920, durationSeconds: 30, export: true},
  {name: 'feed-15', width: 1080, height: 1350, durationSeconds: 15, export: false},
  {name: 'square-15', width: 1080, height: 1080, durationSeconds: 15, export: false},
];
// Keep the real native variable/DOM/layout state when an edit changes source but not rendered pixels.
// This synthetic fixture contains no customer data. Do not replace the preview API or pixel assertion.
async function writeEditDiagnostics(prepared, name) {
  writeFileSync(join(artifacts, name + '.html'), readFileSync(prepared.project.index));
  const film = await prepared.native.capture.openFilm(prepared.project.index, {video: 'seek', chromeArgs: ['--disable-gpu-compositing', '--use-angle=swiftshader']});
  try {
    await film.seek(5);
    const state = await film.evaluate(`(() => {
      const box = selector => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const style = getComputedStyle(element);
        return {rect: element.getBoundingClientRect().toJSON(), opacity: style.opacity, transform: style.transform,
          display: style.display, visibility: style.visibility, font: style.font, color: style.color,
          backgroundColor: style.backgroundColor, overflow: style.overflow};
      };
      return {time: 5, declared: JSON.parse(document.documentElement.getAttribute('data-composition-variables')),
        variables: OM.vars(), title: document.querySelector('h1')?.textContent,
        fontStatus: document.fonts.status, fontFaces: [...document.fonts].map(font => ({family: font.family, weight: font.weight, status: font.status})),
        html: box('html'), body: box('body'), root: box('#film'), card: box('#card'), headline: box('h1'),
        canvas: box('#cube'), progress: box('#bar'), timelineTime: window.__timelines.film.time()};
    })()`);
    await film.send('DOM.enable');
    await film.send('CSS.enable');
    const document = await film.send('DOM.getDocument');
    const {nodeId} = await film.send('DOM.querySelector', {nodeId: document.root.nodeId, selector: 'h1'});
    state.platformFonts = (await film.send('CSS.getPlatformFontsForNode', {nodeId})).fonts;
    writeFileSync(join(artifacts, name + '.json'), canonical({...state, pageErrors: film.errors}) + '\n');
    console.log(canonical({kind: 'native_edit_diagnostic', name, ...state, pageErrors: film.errors}));
    assert.ok(state.headline.rect.width > 0 && state.headline.rect.height > 0, 'Native variable text must have visible layout');
    assert.ok(state.platformFonts.length > 0 && state.platformFonts.every(font => font.familyName === 'Inter' && font.isCustomFont && font.glyphCount > 0), 'Native title must render with the pinned custom Inter font, not platform fallback');
  } finally { await film.close(); }
}
const results = [];
for (const item of cases) {
  const projectDir = join(root, item.name);
  mkdirSync(join(projectDir, 'assets'), {recursive: true});
  const composition = {width: item.width, height: item.height, durationSeconds: item.durationSeconds, fps: 30};
  const html = template.replaceAll('__WIDTH__', String(item.width)).replaceAll('__HEIGHT__', String(item.height)).replaceAll('__DURATION__', String(item.durationSeconds));
  writeFileSync(join(projectDir, 'index.html'), html);
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=48000:duration=${item.durationSeconds}`, '-ac', '2', join(projectDir, 'assets/tone.wav')]);
  const files = ['index.html', 'assets/tone.wav'].map(path => {
    const bytes = readFileSync(join(projectDir, path));
    return {path, key: `native-smoke/${item.name}/${path}`, sha256: sha256Bytes(bytes), byteLength: bytes.length, mediaType: path.endsWith('.html') ? 'text/html' : 'audio/wav'};
  });
  const manifest = {schemaVersion: '1.0.0', kind: 'native_project', entry: 'index.html', runtime: {name: 'huashu-motion', commit: NATIVE_COMMIT}, composition, files, resources: []};
  const prepared = await prepareNativeProject(projectDir, manifest);
  if (item.name === 'landscape-15') {
    await writeEditDiagnostics(prepared, item.name + '-initial');
    const canary = join(root, 'outside-project-canary.txt');
    writeFileSync(canary, 'NON_SECRET_NATIVE_ISOLATION_CANARY');
    let loopbackRequests = 0;
    const localServer = createServer((request, response) => {loopbackRequests++; response.end('NON_SECRET_LOOPBACK_CANARY');});
    await new Promise(resolve => localServer.listen(0, '127.0.0.1', resolve));
    let film;
    try {
      film = await prepared.native.capture.openFilm(prepared.project.index);
      // A helper registered first must not supply the soundtrack's duration or scene labels.
      await film.evaluate(`(() => { const main = window.__timelines.film; window.__timelines = {helper: gsap.timeline({paused: true}).to({}, {duration: 30}), film: main}; })()`);
      const soundPlan = await prepared.native.sound.probe(prepared.project, html, film);
      assert.equal(soundPlan.id, 'film');
      assert.equal(soundPlan.duration, composition.durationSeconds);
      assert.equal(soundPlan.labels['scene:opening'], 0);
      await film.evaluate('delete window.__timelines.helper');
      const targets = [pathToFileURL(canary).href, 'file:///etc/passwd', `http://127.0.0.1:${localServer.address().port}/canary`, 'http://broker.internal/r/not-authorized', 'https://example.com/'];
      const blocked = await film.evaluate(`Promise.all(${JSON.stringify(targets)}.map(async url => {try {const r=await fetch(url); await r.arrayBuffer(); return false;} catch {return true;}}))`);
      assert.deepEqual(blocked, [true, true, true, true, true]);
      assert.equal(loopbackRequests, 0);
      const workerBlocked = await film.evaluate(`new Promise(resolve => {let worker, timer;const done=value=>{clearTimeout(timer);worker?.terminate();resolve(value)};try {worker=new Worker(URL.createObjectURL(new Blob(['postMessage("started")'],{type:'text/javascript'})));worker.onmessage=()=>done(false);worker.onerror=()=>done(true);timer=setTimeout(()=>done(false),1000);}catch{done(true)}})`);
      assert.equal(workerBlocked, true);
      console.log(canonical({kind: 'native_browser_isolation', projectFileOrigin: 'virtual_http', outsideFileBlocked: true, systemFileBlocked: true, loopbackBlocked: true, brokerBlocked: true, internetBlocked: true, workerBlocked: true}));
    } finally { await film?.close(); await new Promise(resolve => localServer.close(resolve)); }
  }
  const preview = await previewNativeProject(prepared, composition);
  assert.equal(preview.shots.length, 4);
  assert.equal(new Set(preview.shots.map(shot => sha256Bytes(shot.png))).size, 4, 'Timeline seeks must produce different real frames');
  for (const [index, shot] of preview.shots.entries()) writeFileSync(join(artifacts, `${item.name}-${index}.png`), shot.png);
  const result = {name: item.name, nativeCommit: NATIVE_COMMIT, composition, previewFrameTimes: preview.times, pageErrors: preview.errors};
  if (item.export) {
    const nativePath = join(root, item.name + '-native.mp4'), filmPath = join(artifacts, item.name + '.mp4');
    await renderNativeProject(prepared, composition, nativePath, line => console.log(item.name + ': ' + line));
    result.media = await normalizeNativeVideo(nativePath, filmPath, composition);
    assert.equal(result.media.videoEncoding, 'stream_copy', 'the actual pinned native renderer must satisfy the final H.264 copy contract');
    assert.equal(result.media.frameCount, item.durationSeconds * 30);
    assert.equal(result.media.audioCodec, 'aac');
    const review = await extractEncodedFrames(filmPath, join(artifacts, item.name + '-encoded'), composition);
    assert.equal(review.files.length, 4);
    assert.equal(review.files.at(-1).frame, item.durationSeconds * 30 - 1);
    for (const frame of review.files) assert.equal(readFileSync(frame.file).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(readFileSync(review.sheet).subarray(0, 2).toString('hex'), 'ffd8');
    result.reviewFrameTimes = review.times;
  }
  if (item.name === 'landscape-15') {
    const before = sha256Bytes(readFileSync(join(projectDir, 'index.html')));
    const edited = await editNativeProject(projectDir, {values: {headline: 'Native direct edit verified'}, baseToken: before});
    assert.notEqual(edited.token, before);
    await assert.rejects(() => editNativeProject(projectDir, {values: {headline: 'stale edit'}, baseToken: before}), /changed since you read/);
    const changed = await previewNativeProject(prepared, composition, [5]);
    writeFileSync(join(artifacts, item.name + '-edited.png'), changed.shots[0].png);
    await writeEditDiagnostics(prepared, item.name + '-edited');
    assert.notEqual(sha256Bytes(changed.shots[0].png), sha256Bytes(preview.shots[1].png));
    result.nativeEdit = {optimisticToken: true, renderedChange: true};
    const currentSource = readFileSync(prepared.project.index, 'utf8');
    const tooLong = currentSource.replace('const duration = 15;', 'const duration = 30;');
    assert.notEqual(tooLong, currentSource);
    writeFileSync(prepared.project.index, tooLong);
    await assert.rejects(() => prepared.native.capture.openFilm(prepared.project.index), /NATIVE_TIMELINE_DURATION_MISMATCH/);
    writeFileSync(prepared.project.index, currentSource);
    result.timelineCroppingRejected = true;
  }
  results.push(result);
  console.log(canonical(result));
}
writeFileSync(join(artifacts, 'native-smoke-report.json'), canonical({kind: 'native_smoke', nativeCommit: NATIVE_COMMIT, results}) + '\n');
console.log('Native four-aspect preview, native edit and complete 15/30 second audio/video exports verified.');
