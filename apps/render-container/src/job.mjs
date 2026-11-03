import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {canonical, parseCanonicalJson} from '../../../packages/contracts/src/canonical.mjs';
import {nativeProjectHash} from '../../../packages/contracts/src/native-project.mjs';
import {fileIdentity} from '../../../packages/native-motion/src/files.mjs';
import {NATIVE_COMMIT, prepareNativeProject, previewNativeProject, renderNativeProject, projectFiles} from '../../../packages/native-motion/src/index.mjs';
import {normalizeNativeVideo, extractEncodedFrames,extractMotionReviewSheet} from './media.mjs';
import {analyzeEncodedQuality} from './quality.mjs';

// Only this trusted module executes in Node. Project source is loaded solely inside native Chromium.
if (process.platform !== 'linux' || process.getuid() !== 10002) throw Error('NATIVE_JOB_UID_REQUIRED');
process.umask(0o007);
const requestPath = resolve(process.argv[2]);
if (!/^\/jobs\/[a-zA-Z0-9_-]{1,128}\/request\.json$/.test(requestPath)) throw Error('NATIVE_JOB_PATH_INVALID');
const task = parseCanonicalJson(readFileSync(requestPath));
const base = resolve(requestPath, '..'), projectDir = join(base, 'project'), outputDir = join(base, 'out');
mkdirSync(outputDir, {recursive: true, mode: 0o2770});
const started = performance.now();
const log = line => process.stderr.write(String(line).slice(0, 1000) + '\n');
let qualityFailure = null;
try {
const prepared = await prepareNativeProject(projectDir, task.project);
const captured = await previewNativeProject(prepared, task.project.composition, task.mode === 'preview' ? task.frames : undefined);
const localOutputs = [];
const report = {nativeCommit: NATIVE_COMMIT, projectHash: await nativeProjectHash(task.project), inputSourceSha256: prepared.inputSourceSha256,
  renderedSourceSha256: prepared.inputSourceSha256, composition: task.project.composition, frames: 0,
  timelineDurationSeconds: captured.info.timelineDurations[captured.info.id], timelinePaused: captured.info.timelinePaused[captured.info.id],
  previewFrameTimes: captured.times, pageErrors: [], sourceFindings: prepared.findings, elapsedMs: 0};
for (const [index, shot] of captured.shots.entries()) {
  const name = `frames/${String(index).padStart(3, '0')}.png`, full = join(outputDir, name);
  mkdirSync(join(outputDir, 'frames'), {recursive: true, mode: 0o2770});
  writeFileSync(full, shot.png);
  localOutputs.push({name, path: full, mediaType: 'image/png'});
}
if (task.mode === 'export') {
  const nativePath = join(base, 'native.mp4'), finalPath = join(outputDir, 'film.mp4');
  const rendered = await renderNativeProject(prepared, task.project.composition, nativePath, log);
  report.renderedSourceSha256 = rendered.renderedSourceSha256;
  report.media = await normalizeNativeVideo(nativePath, finalPath, task.project.composition);
  report.dynamicQuality = await analyzeEncodedQuality(finalPath,task.project.composition,Boolean(report.media.audioCodec));
  if(report.dynamicQuality.status==='blocked') {
    qualityFailure = {kind:'encoded_quality_failure',projectHash:report.projectHash,
      film:{name:'film.mp4',...fileIdentity(finalPath)},composition:task.project.composition,
      renderedSourceSha256:report.renderedSourceSha256,media:report.media,dynamicQuality:report.dynamicQuality};
    throw Error('NATIVE_DYNAMIC_QA_BLOCKED');
  }
  report.frames = report.media.frameCount;
  localOutputs.push({name: 'film.mp4', path: finalPath, mediaType: 'video/mp4'});
  const review = await extractEncodedFrames(finalPath, join(outputDir, 'review-frames'), task.project.composition);
  report.reviewFrameTimes = review.times; report.reviewFramesSource = 'film.mp4';
  for (const [index, frame] of review.files.entries()) localOutputs.push({name: `review-frames/${String(index).padStart(3, '0')}.png`, path: frame.file, mediaType: 'image/png'});
  localOutputs.push({name: 'review-sheet.jpg', path: review.sheet, mediaType: 'image/jpeg'});
  report.reviewSheet = {name: 'review-sheet.jpg', columns: 2, rows: 2, frames: review.files.map(frame => frame.frame), times: review.times, source: 'film.mp4'};
  const motionReview=await extractMotionReviewSheet(finalPath,join(outputDir,'motion-review'),task.project.composition);
  localOutputs.push({name:'motion-sheet.jpg',path:motionReview.sheet,mediaType:'image/jpeg'});
  report.motionReview={name:'motion-sheet.jpg',columns:4,rows:3,frames:motionReview.frames,times:motionReview.times,source:'film.mp4'};
  // Capture refreshed source/audio and all native libraries for deterministic replay of this render.
  for (const file of projectFiles(projectDir)) localOutputs.push({name: 'project/' + file.path, path: file.file, projectPath: file.path, mediaType: file.mediaType});
} else if (task.mode !== 'preview') throw Error('NATIVE_MODE_INVALID');
report.elapsedMs = Math.round(performance.now() - started);
for (const output of localOutputs) {
  const {sha256, byteLength} = fileIdentity(output.path);
  output.sha256 = sha256; output.byteLength = byteLength;
}
writeFileSync(join(base, 'result.json'), canonical({report, localOutputs}) + '\n');
} catch (error) {
  const code = /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message || '') ? error.message : 'NATIVE_JOB_FAILED';
  writeFileSync(join(base, 'failure.json'), canonical({code, ...(qualityFailure ? {qualityFailure} : {}),
    ...(error.findings ? {findings: error.findings} : {}), ...(error.pageErrors ? {pageErrors: error.pageErrors} : {})}) + '\n');
  log(error.stack || error.message);
  process.exitCode = 1;
}
