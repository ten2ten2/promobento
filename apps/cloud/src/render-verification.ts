import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {assertNativePath, nativeProjectHash} from '@promobento/contracts/native-project';
import {checkedNativeBytes, NATIVE_COMMIT, validateFrameTimes, previewFrames, assertCloudNativeProject} from './native-project.ts';
import type {PipelineEnv, Json} from './pipeline-types.ts';

/** Artifacts, native revision and measured media metadata must agree before a result is published. */
export async function verifyNativeResult(env: PipelineEnv, input: Json, result: Json) {
  const report = result.report, composition = input.project.composition;
  const inputIndex = input.project.files.find((file: Json) => file.path === input.project.entry);
  if (result.status !== 'succeeded' || !report || report.nativeCommit !== NATIVE_COMMIT
    || report.projectHash !== input.revisionId || report.inputSourceSha256 !== inputIndex?.sha256
    || !/^[a-f0-9]{64}$/.test(report.renderedSourceSha256)
    || canonical(report.composition) !== canonical(composition)
    || report.timelineDurationSeconds !== composition.durationSeconds || report.timelinePaused !== true
    || !Array.isArray(report.pageErrors) || report.pageErrors.length
    || !Number.isFinite(report.elapsedMs) || report.elapsedMs < 0
    || !Array.isArray(result.outputs) || result.outputs.length < 2 || result.outputs.length > 530)
    throw Error('NATIVE_RENDER_EVIDENCE_INVALID');
  const prefix = 'renders/' + input.renderId + '/attempts/' + result.attemptId + '/out/';
  const names = new Set<string>(), artifacts = new Map<string, Json>();
  for (const blob of result.outputs) {
    assertNativePath(blob.name);
    if (names.has(blob.name) || blob.key !== prefix + blob.name
      || !/^[a-f0-9]{64}$/.test(blob.sha256) || !Number.isSafeInteger(blob.byteLength)
      || blob.byteLength < 0 || blob.byteLength > 50 << 20) throw Error('RENDER_OUTPUT_SCOPE_INVALID');
    names.add(blob.name);
    artifacts.set(blob.key, blob);
    const object = await env.MEDIA.head(blob.key);
    if (!object || object.customMetadata?.sha256 !== blob.sha256 || object.size !== blob.byteLength) throw Error('SOURCE_IDENTITY_MISMATCH');
  }
  const output = (name: string): Json => {
    const value = result.outputs.find((blob: Json) => blob.name === name);
    if (!value) throw Error('RENDER_OUTPUT_MISSING');
    return value;
  };
  const savedReport = parseCanonicalJson(await checkedNativeBytes(env, output('report.json'), 1 << 20));
  if (canonical(savedReport) !== canonical(report)) throw Error('NATIVE_RENDER_EVIDENCE_INVALID');
  const verifyPng = async (name: string) => {
    const blob = output(name);
    if (blob.mediaType !== 'image/png') throw Error('NATIVE_PREVIEW_EVIDENCE_INVALID');
    const bytes = await checkedNativeBytes(env, blob, 12 << 20);
    const expected = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 24 || expected.some((value, offset) => bytes[offset] !== value)) throw Error('NATIVE_PREVIEW_EVIDENCE_INVALID');
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (header.getUint32(16) !== composition.width || header.getUint32(20) !== composition.height) throw Error('NATIVE_PREVIEW_EVIDENCE_INVALID');
  };
  if (input.mode === 'preview') {
    const times = validateFrameTimes(input.project, input.mode, input.frames)!;
    if (report.frames !== 0 || canonical(report.previewFrameTimes) !== canonical(times)) throw Error('NATIVE_PREVIEW_EVIDENCE_INVALID');
    for (let index = 0; index < times.length; index++) {
      await verifyPng('frames/' + String(index).padStart(3, '0') + '.png');
    }
    return;
  }
  const media = report.media, expectedFrames = composition.durationSeconds * composition.fps;
  if (!media || report.frames !== expectedFrames || media.frameCount !== expectedFrames
    || media.width !== composition.width || media.height !== composition.height || media.fps !== composition.fps
    || !Number.isFinite(media.durationSeconds) || Math.abs(media.durationSeconds - composition.durationSeconds) > 1 / composition.fps
    || media.videoCodec !== 'h264' || media.pixelFormat !== 'yuv420p'
    || media.audioCodec !== undefined && media.audioCodec !== null && media.audioCodec !== 'aac')
    throw Error('NATIVE_MEDIA_EVIDENCE_INVALID');
  if (output('film.mp4').mediaType !== 'video/mp4' || output('film.mp4').byteLength < 1) throw Error('NATIVE_MEDIA_EVIDENCE_INVALID');
  const reviewTimes = previewFrames(composition.durationSeconds);
  if (report.reviewFramesSource !== 'film.mp4' || canonical(report.reviewFrameTimes) !== canonical(reviewTimes)) throw Error('NATIVE_REVIEW_EVIDENCE_INVALID');
  for (let index = 0; index < reviewTimes.length; index++) await verifyPng('review-frames/' + String(index).padStart(3, '0') + '.png');
  const sheet = report.reviewSheet;
  if (!sheet || sheet.name !== 'review-sheet.jpg' || sheet.columns !== 2 || sheet.rows !== 2 || sheet.source !== 'film.mp4'
    || canonical(sheet.times) !== canonical(reviewTimes)
    || canonical(sheet.frames) !== canonical(reviewTimes.map(time => Math.round(time * composition.fps))))
    throw Error('NATIVE_REVIEW_EVIDENCE_INVALID');
  const sheetBlob = output('review-sheet.jpg');
  if (sheetBlob.mediaType !== 'image/jpeg') throw Error('NATIVE_REVIEW_EVIDENCE_INVALID');
  await checkedNativeBytes(env, sheetBlob, 12 << 20);
  const renderedProject = parseCanonicalJson(await checkedNativeBytes(env, output('rendered-project.json'), 4 << 20)) as Json;
  assertCloudNativeProject(renderedProject);
  if (canonical(renderedProject.composition) !== canonical(composition)
    || canonical(renderedProject.runtime) !== canonical(input.project.runtime)
    || await nativeProjectHash(renderedProject) !== report.renderedProjectHash
    || renderedProject.files.some((file: Json) => file.key !== prefix + 'project/' + file.path)
    || renderedProject.files.some((file: Json) => {
      const blob = artifacts.get(file.key);
      return !blob || blob.sha256 !== file.sha256 || blob.byteLength !== file.byteLength || blob.mediaType !== file.mediaType;
    })
    || renderedProject.files.find((file: Json) => file.path === renderedProject.entry)?.sha256 !== report.renderedSourceSha256)
    throw Error('NATIVE_RENDERED_PROJECT_INVALID');
}
