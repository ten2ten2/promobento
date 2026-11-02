import {mkdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {parseCanonicalJson} from '../../../packages/contracts/src/canonical.mjs';
import {motionReviewFrames} from '../../../packages/contracts/src/video-frames.mjs';
import {run} from './process.mjs';

const MAX_BYTES = 50_000_000;
const FPS = 30;
const MAX_WINDOW_BITRATE = 10_000_000;

async function probe(path, frames = false) {
  const args = ['-v', 'error', '-show_streams', '-show_format'];
  if (frames) args.push('-select_streams', 'v:0', '-show_frames', '-show_entries', 'stream:format:frame=key_frame,best_effort_timestamp_time');
  const {stdout} = await run('ffprobe', [...args, '-of', 'json', path]);
  return parseCanonicalJson(stdout);
}

async function peakWindowBitrate(path) {
  const {stdout} = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_packets', '-show_entries', 'packet=pts_time,size', '-of', 'json', path]);
  const packets = parseCanonicalJson(stdout).packets;
  let left = 0, bytes = 0, max = 0;
  for (let right = 0; right < packets.length; right++) {
    if (!Number.isFinite(Number(packets[right].pts_time)) || !Number.isSafeInteger(Number(packets[right].size)) || Number(packets[right].size) < 0) throw Error('OUTPUT_PACKET_INVALID');
    bytes += Number(packets[right].size);
    while (Number(packets[right].pts_time) - Number(packets[left].pts_time) >= 1 - 1e-6) bytes -= Number(packets[left++].size);
    max = Math.max(max, bytes * 8);
  }
  return max;
}

function assertVideoMetadata(video, composition) {
  if (!video || video.codec_name !== 'h264' || video.profile !== 'High' || video.width !== composition.width || video.height !== composition.height
    || video.pix_fmt !== 'yuv420p' || video.r_frame_rate !== '30/1' || video.avg_frame_rate !== '30/1'
    || video.field_order !== 'progressive'
    || video.color_space !== 'bt709' || video.color_transfer !== 'bt709' || video.color_primaries !== 'bt709'
    || video.has_b_frames !== 0) throw Error('OUTPUT_VIDEO_INVALID');
}

async function validateVideoTrack(path, composition) {
  const data = await probe(path, true), video = data.streams.find(stream => stream.codec_type === 'video');
  const totalFrames = composition.durationSeconds * FPS;
  assertVideoMetadata(video, composition);
  if (data.frames?.length !== totalFrames) throw Error('OUTPUT_VIDEO_INVALID');
  data.frames.forEach((frame, index) => {
    if (!Number.isFinite(Number(frame.best_effort_timestamp_time)) || Math.abs(Number(frame.best_effort_timestamp_time) - index / FPS) > 1e-4 || Boolean(frame.key_frame) !== (index % 15 === 0)) throw Error('OUTPUT_FRAME_TIMING_INVALID');
  });
  const maxWindowBitrate = await peakWindowBitrate(path);
  if (maxWindowBitrate > MAX_WINDOW_BITRATE) throw Error('OUTPUT_BITRATE_EXCEEDED');
  return {video, data, totalFrames, maxWindowBitrate};
}

/** End-of-pipeline validation is identical for copied and re-encoded video. */
export async function validateVideo(path, composition, hasAudio) {
  const {video, data, totalFrames, maxWindowBitrate} = await validateVideoTrack(path, composition);
  const durationSeconds = Number(data.format.duration), byteLength = statSync(path).size;
  if (!Number.isFinite(durationSeconds) || Math.abs(durationSeconds - composition.durationSeconds) > 2 / FPS || byteLength < 1 || byteLength > MAX_BYTES) throw Error('OUTPUT_DURATION_OR_SIZE_INVALID');
  const all = await probe(path), audios = all.streams.filter(stream => stream.codec_type === 'audio');
  if (hasAudio ? audios.length !== 1 || audios[0].codec_name !== 'aac' || audios[0].profile !== 'LC' || Number(audios[0].sample_rate) !== 48000
    || audios[0].channels !== 2 || !Number.isFinite(Number(audios[0].duration)) || Math.abs(Number(audios[0].duration) - composition.durationSeconds) > .1 : audios.length !== 0) throw Error('OUTPUT_AUDIO_INVALID');
  return {width: video.width, height: video.height, durationSeconds, fps: FPS, frameCount: totalFrames, videoCodec: 'h264', pixelFormat: 'yuv420p',
    colorSpace: 'bt709', byteLength, maxWindowBitrate, ...(hasAudio ? {audioCodec: 'aac', audioSampleRate: 48000, audioChannels: 2} : {})};
}

/** Stream-copy compliant H.264 while normalizing audio; fall back to the original trusted full encode. */
export async function normalizeNativeVideo(nativePath, outputPath, composition) {
  const started = performance.now();
  const native = await probe(nativePath), video = native.streams.find(stream => stream.codec_type === 'video');
  // Container format duration is the *longest* track. A music bed can extend
  // beyond the film, so validate picture duration independently of the audio.
  if (!video || video.width !== composition.width || video.height !== composition.height || !Number.isFinite(Number(video.duration)) || Math.abs(Number(video.duration) - composition.durationSeconds) > 2 / FPS) throw Error('NATIVE_OUTPUT_MISMATCH');
  const audioStreams = native.streams.filter(stream => stream.codec_type === 'audio');
  if (audioStreams.length > 1) throw Error('NATIVE_AUDIO_TRACKS_INVALID');
  const hasAudio = audioStreams.length === 1;
  const needsDeinterlace = video.field_order !== 'progressive';
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', nativePath, '-map', '0:v:0', '-map', '0:a:0?'];
  // A voice-over or effect can end before the picture; keep one full-length AAC
  // track by padding silence after loudness normalization, then trim with -t.
  const audioArgs = hasAudio ? ['-c:a', 'aac', '-profile:a', 'aac_low', '-ar', '48000', '-ac', '2', '-b:a', '128000', '-af', 'loudnorm=I=-14:TP=-1:LRA=11,apad'] : ['-an'];
  const outputArgs = ['-t', String(composition.durationSeconds), '-movflags', '+faststart', outputPath];
  let copyRejection = null;
  try {
    // Reject visibly incompatible codec metadata before the expensive full-frame probe.
    // Metadata alone never grants stream copy; candidates still need decoded PTS/GOP validation.
    assertVideoMetadata(video, composition);
    await validateVideoTrack(nativePath, composition);
    await run('ffmpeg', [...args, '-c:v', 'copy', ...audioArgs, ...outputArgs], {timeoutMs: 300_000});
    return {...await validateVideo(outputPath, composition, hasAudio), videoEncoding: 'stream_copy', processingElapsedMs: Math.round(performance.now() - started)};
  } catch (error) {
    // An out-of-spec input or remuxed output is recoverable via a full encode.
    if (!/^OUTPUT_|^MEDIA_PROCESS_FAILED$/.test(error?.message ?? '')) throw error;
    copyRejection = error.message;
  }
  await run('ffmpeg', [...args, '-c:v', 'libx264', '-preset', 'fast', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30', '-fps_mode', 'cfr',
    '-g', '15', '-keyint_min', '15', '-sc_threshold', '0', '-bf', '0', '-flags', '+cgop', '-threads', '2',
    '-b:v', '7000000', '-maxrate', '7000000', '-bufsize', '2000000', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    ...(needsDeinterlace ? ['-vf', 'bwdif=mode=send_frame:parity=auto:deint=all', '-field_order', 'progressive'] : []),
    ...audioArgs, ...outputArgs], {timeoutMs: 300_000});
  return {...await validateVideo(outputPath, composition, hasAudio), videoEncoding: 'transcoded', copyRejection,
    processingElapsedMs: Math.round(performance.now() - started)};
}

/** Final review evidence comes from decoded delivered MP4 bytes, never another page preview. */
export async function extractEncodedFrames(path, directory, composition) {
  const times = [0, composition.durationSeconds / 3, composition.durationSeconds * 2 / 3, composition.durationSeconds - 1 / FPS];
  const frames = times.map(time => Math.round(time * FPS));
  mkdirSync(directory, {recursive: true, mode: 0o2770});
  const select = frames.map(frame => `eq(n\\,${frame})`).join('+');
  await run('ffmpeg', ['-v', 'error', '-y', '-i', path, '-vf', 'select=' + select, '-fps_mode', 'vfr', '-frames:v', '4', '-an', '-c:v', 'png', '-threads', '1', '-start_number', '0', join(directory, '%03d.png')]);
  const files = frames.map((frame, index) => {
    const file = join(directory, String(index).padStart(3, '0') + '.png');
    if (statSync(file).size < 8) throw Error('ENCODED_REVIEW_FRAME_MISSING');
    return {file, frame, time: times[index]};
  });
  const sheet = join(directory, 'review-sheet.jpg');
  await run('ffmpeg', ['-v', 'error', '-y', '-framerate', '1', '-start_number', '0', '-i', join(directory, '%03d.png'),
    '-vf', 'scale=960:960:force_original_aspect_ratio=decrease:flags=lanczos,pad=960:960:(ow-iw)/2:(oh-ih)/2:color=black,tile=2x2',
    '-frames:v', '1', '-q:v', '2', '-pix_fmt', 'yuvj420p', '-threads', '1', sheet]);
  if (statSync(sheet).size < 8) throw Error('ENCODED_REVIEW_SHEET_MISSING');
  return {times, files, sheet};
}

/** Twelve spread-out actual MP4 frames complement the original four high-resolution review frames. */
export async function extractMotionReviewSheet(path, directory, composition) {
  const frames=motionReviewFrames(composition.durationSeconds);
  mkdirSync(directory,{recursive:true,mode:0o2770});
  const sheet=join(directory,'motion-sheet.jpg');
  const select=frames.map(frame=>'eq(n\\,'+frame+')').join('+');
  await run('ffmpeg',['-v','error','-y','-i',path,'-vf','select='+select+
    ',scale=480:360:force_original_aspect_ratio=decrease:flags=lanczos,pad=480:360:(ow-iw)/2:(oh-ih)/2:color=black,tile=4x3',
    '-fps_mode','vfr','-frames:v','1','-q:v','3','-pix_fmt','yuvj420p','-threads','1',sheet],{timeoutMs:120_000});
  if(statSync(sheet).size<8)throw Error('ENCODED_MOTION_REVIEW_MISSING');
  return {sheet,frames,times:frames.map(frame=>frame/30)};
}
