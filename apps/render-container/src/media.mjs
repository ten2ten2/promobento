import {statSync} from 'node:fs';
import {createReadStream} from 'node:fs';
import {parseCanonicalJson} from '@promobento/contracts/canonical';
import {childProcess, deadline, run, write} from './process.mjs';
import {finalizeEncodedAudio} from './encoded-audio.mjs';

export function videoArgs({width, height, encoding, threads, strictWindow = false}) {
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n % 2 === 0)
    || ![1, 2, 4].includes(threads) || encoding.videoCodec !== 'h264' || ![15, 30].includes(encoding.fps)
    || encoding.gopFrames !== 15 || encoding.pixelFormat !== 'yuv420p') throw Error('ENCODING_PROFILE_UNSUPPORTED');
  // VBV maxrate with a two-second reservoir is not a one-second packet-window ceiling.
  // Initial shards and the existing correction pass both request this bounded reservoir.
  const rate=strictWindow?Math.floor(encoding.maxVideoBitrate*.7):encoding.maxVideoBitrate;
  const buffer=strictWindow?Math.floor(encoding.maxVideoBitrate*.2):encoding.maxVideoBitrate*2;
  return ['-c:v', 'libx264', '-preset', 'fast', '-profile:v', encoding.profile, '-pix_fmt', 'yuv420p',
    '-vf', `scale=${width}:${height}:out_color_matrix=bt709:out_range=tv,setsar=1`, '-r', String(encoding.fps), '-fps_mode', 'cfr', '-g', '15', '-keyint_min', '15',
    '-sc_threshold', '0', '-bf', '0', '-flags', '+cgop', '-threads', String(threads),
    '-b:v', String(Math.min(encoding.targetVideoBitrate,rate)), '-maxrate', String(rate),
    '-bufsize', String(buffer), '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-colorspace', 'bt709', '-color_range', 'tv'];
}

/** CDP JPEG bytes go straight to FFmpeg: no RGBA allocation/PNG decoding on the hot path. */
export function shardEncoder(path, config, signal) {
  const process = childProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe',
    '-framerate', String(config.encoding.fps), '-c:v', 'mjpeg', '-i', 'pipe:0', ...videoArgs({...config,strictWindow:true}), '-an', '-f', 'h264', path], {signal});
  let count = 0;
  return {
    async frame(jpeg, timeoutMs) { await write(process, jpeg, timeoutMs); count++; },
    async finish(expected, timeoutMs) {
      if (count !== expected) { process.child.kill('SIGKILL'); throw Error('SHARD_FRAME_COUNT_MISMATCH'); }
      process.child.stdin.end();
      await deadline(process.done, timeoutMs, 'ENCODER_DRAIN_TIMEOUT', () => process.child.kill('SIGKILL'));
      if (!statSync(path).size) throw Error('SHARD_EMPTY');
    },
    abort() { process.child.kill('SIGKILL'); }
  };
}

async function probe(path, signal) {
  const {stdout} = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-show_frames',
    '-select_streams', 'v:0', '-show_entries', 'stream:format:frame=key_frame,best_effort_timestamp_time,pkt_duration_time',
    '-of', 'json', path], {signal});
  return parseCanonicalJson(stdout);
}

async function peakWindowBitrate(path, signal) {
  const {stdout} = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_packets',
    '-show_entries', 'packet=pts_time,size', '-of', 'json', path], {signal});
  const packets = parseCanonicalJson(stdout).packets;
  let left = 0, bytes = 0, max = 0;
  for (let right = 0; right < packets.length; right++) {
    bytes += Number(packets[right].size);
    while (Number(packets[right].pts_time) - Number(packets[left].pts_time) >= 1 - 1e-6) bytes -= Number(packets[left++].size);
    max = Math.max(max, bytes * 8);
  }
  return max;
}

export async function validateVideo(path, {width, height, totalFrames, encoding, hasAudio, maxBytes}, signal) {
  const data = await probe(path, signal), video = data.streams.find(stream => stream.codec_type === 'video');
  if (!video || video.codec_name !== 'h264' || video.profile !== 'High' || video.width !== width || video.height !== height
    || video.pix_fmt !== 'yuv420p' || video.r_frame_rate !== encoding.fps + '/1' || video.avg_frame_rate !== encoding.fps + '/1'
    || video.color_space !== 'bt709' || video.color_transfer !== 'bt709' || video.color_primaries !== 'bt709'
    || data.frames.length !== totalFrames) throw Error('OUTPUT_VIDEO_INVALID');
  data.frames.forEach((frame, i) => {
    if (Math.abs(Number(frame.best_effort_timestamp_time) - i / encoding.fps) > 1e-4 || Boolean(frame.key_frame) !== (i % 15 === 0))
      throw Error('OUTPUT_FRAME_TIMING_INVALID');
  });
  if (Math.abs(Number(data.format.duration) - totalFrames / encoding.fps) > 2 / 30 || statSync(path).size > maxBytes)
    throw Error('OUTPUT_DURATION_OR_SIZE_INVALID');
  const audioProbe = await run('ffprobe', ['-v', 'error', '-show_streams', '-select_streams', 'a', '-of', 'json', path], {signal});
  const audios = parseCanonicalJson(audioProbe.stdout).streams;
  if (hasAudio ? audios.length !== 1 || audios[0].codec_name !== 'aac' || audios[0].profile !== 'LC'
    || Number(audios[0].sample_rate) !== 48000 || audios[0].channels !== 2
    || Math.abs(Number(audios[0].duration) - totalFrames / encoding.fps) > .1 : audios.length !== 0) throw Error('OUTPUT_AUDIO_INVALID');
  return {totalFrames, width, height, fps: encoding.fps, durationSeconds: Number(data.format.duration),
    bytes: statSync(path).size, maxWindowBitrate: await peakWindowBitrate(path, signal), hasAudio};
}

/** Annex B shards use identical closed GOPs and no B frames; timestamps are assigned only here. */
export async function assemble({shards, audioPath, audioLimits, outputPath, posterPath, coverFrame, config, totalFrames, maxBytes, signal}) {
  if (!shards.length || !Number.isInteger(coverFrame) || coverFrame < 0 || coverFrame >= totalFrames) throw Error('ASSEMBLE_INPUT_INVALID');
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-r', String(config.encoding.fps), '-f', 'h264', '-i', 'pipe:0'];
  if (audioPath) args.push('-i', audioPath);
  args.push('-map', '0:v:0', '-c:v', 'copy');
  if (audioPath) args.push('-map', '1:a:0', '-c:a', 'aac', '-profile:a', 'aac_low', '-ar', '48000', '-ac', '2', '-b:a', String(config.encoding.audio.bitrate));
  else args.push('-an');
  args.push('-movflags', '+faststart', outputPath);
  const process = childProcess('ffmpeg', args, {signal});
  try {
    for (const path of shards) for await (const bytes of createReadStream(path)) await write(process, bytes, 10000);
    process.child.stdin.end();
    await deadline(process.done, 60000, 'ASSEMBLE_TIMEOUT', () => process.child.kill('SIGKILL'));
  } catch (error) { process.child.kill('SIGKILL'); throw error; }
  const audio = audioPath ? await finalizeEncodedAudio({path: outputPath, audioPath, encoding: config.encoding,
    durationSeconds: totalFrames / config.encoding.fps, limits: audioLimits, signal}) : null;
  let report = await validateVideo(outputPath, {...config, totalFrames, hasAudio: Boolean(audioPath), maxBytes}, signal);
  let reencoded = false,bitrateCorrection;
  if (report.maxWindowBitrate > config.encoding.maxVideoBitrate) {
    const destination = outputPath + '.vbv.mp4';
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', outputPath, '-map', '0:v:0',
      ...videoArgs({...config,strictWindow:true}), '-map', '0:a?', '-c:a', 'copy', '-movflags', '+faststart', destination],
    {timeoutMs: totalFrames * 200 + 60000, signal});
    const {renameSync} = await import('node:fs'); renameSync(destination, outputPath); reencoded = true;
    const initialMaxWindowBitrate=report.maxWindowBitrate;
    report = await validateVideo(outputPath, {...config, totalFrames, hasAudio: Boolean(audioPath), maxBytes}, signal);
    bitrateCorrection={initialMaxWindowBitrate,correctedMaxWindowBitrate:report.maxWindowBitrate,limit:config.encoding.maxVideoBitrate,
      vbvMaxRate:Math.floor(config.encoding.maxVideoBitrate*.7),vbvBufferBits:Math.floor(config.encoding.maxVideoBitrate*.2)};
    if (report.maxWindowBitrate > config.encoding.maxVideoBitrate) throw Object.assign(Error('OUTPUT_BITRATE_EXCEEDED'),{bitrateCorrection});
  }
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', outputPath, '-vf', `select=eq(n\\,${coverFrame})`,
    '-frames:v', '1', posterPath], {signal});
  return {...report, reencoded,...(audio?{audio}:{}),...(bitrateCorrection?{bitrateCorrection}:{})};
}
