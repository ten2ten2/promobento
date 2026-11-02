import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {canonical} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {motionReviewFrames} from '@promobento/contracts/video-frames';
import {nativeProjectHash} from '@promobento/contracts/native-project';
import {verifyNativeResult} from '../src/render-verification.ts';
import {NATIVE_COMMIT, previewFrames, checkedNativeBytes} from '../src/native-project.ts';
import {immutableBytes, immutableJson} from '../src/store.ts';
import {memoryMedia} from './fixtures/media.mjs';

function png(width, height) {
  const crc = bytes => {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, bytes) => {
    const name = Buffer.from(type), head = Buffer.alloc(4), tail = Buffer.alloc(4);
    head.writeUInt32BE(bytes.length); tail.writeUInt32BE(crc(Buffer.concat([name, bytes])));
    return Buffer.concat([head, name, bytes, tail]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}

async function fixture(mode) {
  const {MEDIA, objects} = memoryMedia(), env = {MEDIA};
  const composition = {durationSeconds: 15, fps: 30, width: 1920, height: 1080};
  const index = await immutableBytes(env, 'evals/native/index.html', Buffer.from('<html>Native fixture</html>'), 'text/html');
  const project = {schemaVersion: '1.0.0', kind: 'native_project', entry: 'index.html',
    runtime: {name: 'huashu-motion', commit: NATIVE_COMMIT}, composition,
    files: [{path: 'index.html', key: index.key, sha256: index.sha256, byteLength: index.byteLength, mediaType: index.mediaType}], resources: []};
  const input = {renderId: 'native-render', project, revisionId: await nativeProjectHash(project), mode, ...(mode === 'preview' ? {frames: [0, 5]} : {})};
  const prefix = 'renders/native-render/attempts/native-attempt/out/', outputs = [];
  const put = async (name, bytes, mediaType) => {const blob = {...await immutableBytes(env, prefix + name, bytes, mediaType), name}; outputs.push(blob); return blob;};
  const report = {nativeCommit: NATIVE_COMMIT, projectHash: input.revisionId, inputSourceSha256: index.sha256,
    renderedSourceSha256: index.sha256, composition, frames: mode === 'preview' ? 0 : 450,
    timelineDurationSeconds: composition.durationSeconds, timelinePaused: true, pageErrors: [], elapsedMs: 1000};
  if (mode === 'preview') {
    report.previewFrameTimes = input.frames;
    const bytes = png(composition.width, composition.height);
    await put('frames/000.png', bytes, 'image/png'); await put('frames/001.png', bytes, 'image/png');
  } else {
    report.media = {width: 1920, height: 1080, durationSeconds: 15, fps: 30, frameCount: 450,
      videoCodec: 'h264', pixelFormat: 'yuv420p', audioCodec: 'aac', audioSampleRate: 48000};
    // Controller/ffprobe output is mocked here; actual MP4 validation belongs to the native container tests.
    await put('film.mp4', Buffer.from('synthetic measured-container artifact'), 'video/mp4');
    report.reviewFramesSource = 'film.mp4'; report.reviewFrameTimes = previewFrames(composition.durationSeconds);
    const frames = png(composition.width, composition.height);
    for (let index = 0; index < report.reviewFrameTimes.length; index++)
      await put('review-frames/' + String(index).padStart(3, '0') + '.png', frames, 'image/png');
    report.reviewSheet = {name: 'review-sheet.jpg', columns: 2, rows: 2, source: 'film.mp4',
      times: report.reviewFrameTimes, frames: report.reviewFrameTimes.map(time => Math.round(time * composition.fps))};
    await put('review-sheet.jpg', Buffer.from('synthetic ffmpeg-verified contact sheet'), 'image/jpeg');
    const motionFrames=motionReviewFrames(composition.durationSeconds);
    report.motionReview={name:'motion-sheet.jpg',columns:4,rows:3,source:'film.mp4',
      frames:motionFrames,times:motionFrames.map(frame=>frame/composition.fps)};
    await put('motion-sheet.jpg',Buffer.from('synthetic MP4-backed 12-frame contact sheet'),'image/jpeg');
    report.dynamicQuality={kind:'encoded_dynamic_qa',source:'film.mp4',coverage:'full_video_and_audio_decode',
      status:'clear',signals:{black:[],freeze:[],silence:[],integratedLufs:-14,truePeakDbtp:-1.1},
      findings:[],ownerNormalSpeedReview:'pending'};
    const actualIndex = await put('project/index.html', Buffer.from('<html>Rendered fixture</html>'), 'text/html');
    const emptyStyle = await put('project/empty.css', Buffer.alloc(0), 'text/css');
    report.renderedSourceSha256 = actualIndex.sha256;
    const rendered = {...project, files: [{path: 'index.html', key: actualIndex.key, sha256: actualIndex.sha256,
      byteLength: actualIndex.byteLength, mediaType: actualIndex.mediaType},
      {path: 'empty.css', key: emptyStyle.key, sha256: emptyStyle.sha256, byteLength: 0, mediaType: 'text/css'}]};
    report.renderedProjectHash = await nativeProjectHash(rendered);
    await put('rendered-project.json', Buffer.from(canonical(rendered)), 'application/json');
  }
  await put('report.json', Buffer.from(canonical(report)), 'application/json');
  return {env, objects, input, result: {status: 'succeeded', attemptId: 'native-attempt', outputs, report}};
}

test('native previews require every requested frame, matching dimensions and immutable stored evidence', async () => {
  const {env, objects, input, result} = await fixture('preview');
  await verifyNativeResult(env, input, result);
  const missing = structuredClone(result); missing.outputs = missing.outputs.filter(value => value.name !== 'frames/001.png');
  await assert.rejects(verifyNativeResult(env, input, missing), /RENDER_OUTPUT_MISSING/);
  const wrongScope = structuredClone(result); wrongScope.attemptId = 'other-attempt';
  await assert.rejects(verifyNativeResult(env, input, wrongScope), /RENDER_OUTPUT_SCOPE_INVALID/);
  const malformedOutput = structuredClone(result); malformedOutput.outputs[0].sha256 = {toString:null};
  await assert.rejects(verifyNativeResult(env, input, malformedOutput), /RENDER_OUTPUT_SCOPE_INVALID/);
  await assert.rejects(checkedNativeBytes(env,{key:{toString:null},sha256:'a'.repeat(64),byteLength:1}),/RENDER_OUTPUT_INVALID/);
  const report = result.outputs.find(value => value.name === 'report.json');
  objects.get(report.key).bytes = Buffer.from('{}');
  await assert.rejects(verifyNativeResult(env, input, result), /SOURCE_IDENTITY_MISMATCH/);
});

test('native export requires measured frame count and a matching, locally scoped rendered project snapshot', async () => {
  const {env, input, result} = await fixture('export');
  await verifyNativeResult(env, input, result);
  const wrongCommit = structuredClone(result); wrongCommit.report.nativeCommit = 'b'.repeat(40);
  await assert.rejects(verifyNativeResult(env, input, wrongCommit), /NATIVE_RENDER_EVIDENCE_INVALID/);
  const badHashType = structuredClone(result); badHashType.report.renderedSourceSha256 = {toString:null};
  await assert.rejects(verifyNativeResult(env, input, badHashType), /NATIVE_RENDER_EVIDENCE_INVALID/);
  const wrongTimeline = structuredClone(result); wrongTimeline.report.timelineDurationSeconds = 30;
  await assert.rejects(verifyNativeResult(env, input, wrongTimeline), /NATIVE_RENDER_EVIDENCE_INVALID/);
  const liveTimeline = structuredClone(result); liveTimeline.report.timelinePaused = false;
  await assert.rejects(verifyNativeResult(env, input, liveTimeline), /NATIVE_RENDER_EVIDENCE_INVALID/);
  const missing = structuredClone(result); missing.outputs = missing.outputs.filter(value => value.name !== 'rendered-project.json');
  await assert.rejects(verifyNativeResult(env, input, missing), /RENDER_OUTPUT_MISSING/);
  const noMotion = structuredClone(result); noMotion.outputs=noMotion.outputs.filter(output=>output.name!=='motion-sheet.jpg');
  await assert.rejects(verifyNativeResult(env,input,noMotion),/RENDER_OUTPUT_MISSING/);
  const fakeQuality = structuredClone(result); fakeQuality.report.dynamicQuality.coverage='page_snapshot_only';
  await assert.rejects(verifyNativeResult(env,input,fakeQuality),/NATIVE_RENDER_EVIDENCE_INVALID/);
  const movie = result.outputs.find(value => value.name === 'film.mp4');
  const bad = structuredClone(result); bad.outputs.find(value => value.name === 'film.mp4').sha256 = sha256Bytes(Buffer.from('different'));
  await assert.rejects(verifyNativeResult(env, input, bad), /SOURCE_IDENTITY_MISMATCH/);
  assert.equal(movie.mediaType, 'video/mp4');
});
