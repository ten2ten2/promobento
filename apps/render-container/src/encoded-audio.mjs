import {renameSync} from 'node:fs';
import {parseCanonicalJson} from '@promobento/contracts/canonical';
import {run} from './process.mjs';

// Read the decoded signal, not loudnorm's proposed output. Silence is represented without Infinity.
export async function measureEncodedAudio(path, signal) {
  const {stderr} = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-map', '0:a:0',
    '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'], {signal});
  const start = stderr.lastIndexOf('{'), end = stderr.lastIndexOf('}');
  if (start < 0 || end < start) throw Error('OUTPUT_AUDIO_MEASUREMENT_UNAVAILABLE');
  const data = parseCanonicalJson(stderr.slice(start, end + 1));
  if (data.input_i === '-inf' && data.input_tp === '-inf') return {silent: true, lufs: null, truePeak: null};
  const lufs = Number(data.input_i), truePeak = Number(data.input_tp);
  if (!Number.isFinite(lufs) || !Number.isFinite(truePeak)) throw Error('OUTPUT_AUDIO_MEASUREMENT_UNAVAILABLE');
  return {silent: false, lufs, truePeak};
}

/** One correction from the frozen WAV, never from decoded lossy audio. Passing files stay untouched. */
export async function finalizeEncodedAudio({path, audioPath, encoding, durationSeconds, limits, signal}) {
  // Legacy direct assemble callers used the fixed platform mix. New cloud tasks pass the frozen targets.
  const {loudnessTarget = -14, truePeakMax = -1, silent} = limits ?? {};
  if (!Number.isFinite(loudnessTarget) || !Number.isFinite(truePeakMax) || truePeakMax > -1
    || silent !== undefined && typeof silent !== 'boolean') throw Error('OUTPUT_AUDIO_LIMITS_INVALID');
  const initial = await measureEncodedAudio(path, signal);
  const fail = (code, final, correction = null) => {
    throw Object.assign(Error(code), {audioValidation: {loudnessTarget, truePeakMax, initial, final, correction}});
  };
  if (initial.silent) {
    if (silent === false || silent === undefined && !(await measureEncodedAudio(audioPath, signal)).silent)
      fail('OUTPUT_AUDIO_UNEXPECTED_SILENCE', initial);
    return {...initial, loudnessTarget, truePeakMax, correction: null};
  }
  if (silent === true) fail('OUTPUT_AUDIO_UNEXPECTED_SOUND', initial);
  const inRange = value => !value.silent && Math.abs(value.lufs - loudnessTarget) <= .5 && value.truePeak <= truePeakMax;
  if (inRange(initial)) return {...initial, loudnessTarget, truePeakMax, correction: null};
  const source = await measureEncodedAudio(audioPath, signal);
  if (source.silent) fail('OUTPUT_AUDIO_UNEXPECTED_SOUND', initial);
  const codecOvershootDb = Math.max(0, initial.truePeak - source.truePeak);
  const correction = {gainDb: loudnessTarget - initial.lufs, ceilingDb: truePeakMax - codecOvershootDb - .4, codecOvershootDb};
  const destination = path + '.audio.mp4';
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-i', audioPath,
    '-map', '0:v:0', '-c:v', 'copy', '-map', '1:a:0', '-af',
    `volume=${correction.gainDb}dB,aresample=192000,alimiter=limit=${10 ** (correction.ceilingDb / 20)}:level=false:latency=true,aresample=48000`,
    '-c:a', 'aac', '-profile:a', 'aac_low', '-ar', '48000', '-ac', '2', '-b:a', String(encoding.audio.bitrate),
    '-threads', '1', '-t', String(durationSeconds), '-movflags', '+faststart', destination], {signal});
  const final = await measureEncodedAudio(destination, signal);
  if (!inRange(final)) fail('OUTPUT_AUDIO_OUT_OF_RANGE', final, correction);
  renameSync(destination, path);
  return {...final, loudnessTarget, truePeakMax, initial, correction};
}
