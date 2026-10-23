import {renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {synthesizePlan} from '../../../packages/audio/src/index.mjs';
import {run} from './process.mjs';

const loudnessStats = stderr => {
  const start = stderr.lastIndexOf('{'), end = stderr.lastIndexOf('}');
  if (start < 0 || end < start) throw Error('AUDIO_LOUDNESS_UNAVAILABLE');
  return parseCanonicalJson(stderr.slice(start, end + 1));
};

export async function renderAudio({plan, inputs, directory, signal}) {
  const generated = synthesizePlan(plan, inputs), raw = join(directory, 'pre-master.wav'), output = join(directory, 'mixed.wav');
  writeFileSync(raw, generated.wav);
  if (generated.silent) {
    if (!plan.mute && plan.events.length) throw Error('AUDIO_UNEXPECTED_SILENCE');
    writeFileSync(output, generated.wav); return {path: output, sampleFrames: generated.sampleFrames, silent: true, lufs: null, truePeak: null};
  }
  const filter = `loudnorm=I=${plan.loudnessTarget}:TP=${plan.truePeakMax}:LRA=11:print_format=json`;
  const measure = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', raw, '-af', filter, '-f', 'null', '-'], {signal});
  const stats = loudnessStats(measure.stderr);
  const settings = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'];
  if (settings.some(key => !Number.isFinite(Number(stats[key])))) throw Error('AUDIO_LOUDNESS_UNAVAILABLE');
  const measured = `:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true`;
  await run('ffmpeg', ['-hide_banner', '-nostats', '-y', '-i', raw, '-af', filter + measured, '-ar', '48000', '-ac', '2',
    '-c:a', 'pcm_s16le', '-t', String(plan.totalFrames / 30), output], {signal});
  const measurements = [];
  const measureOutput = async () => {
    const measured = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', output, '-af', filter, '-f', 'null', '-'], {signal});
    const values = loudnessStats(measured.stderr); measurements.push(values);
    return {lufs: Number(values.input_i), truePeak: Number(values.input_tp)};
  };
  let actual = await measureOutput(), correction = null;
  const inRange = ({lufs, truePeak}) => Number.isFinite(lufs) && Math.abs(lufs - plan.loudnessTarget) <= .5
    && Number.isFinite(truePeak) && truePeak <= plan.truePeakMax + .05;
  // The final 48 kHz conversion can change inter-sample peaks. Correct only a measured failure;
  // already-passing masters retain their exact bytes. One bounded corrective pass, then the same gate.
  if (!inRange(actual) && Number.isFinite(actual.lufs) && Number.isFinite(actual.truePeak)) {
    correction = {gainDb: plan.loudnessTarget - actual.lufs, ceilingDb: plan.truePeakMax - .4};
    const corrected = join(directory, 'corrected.wav');
    await run('ffmpeg', ['-hide_banner', '-nostats', '-y', '-i', output,
      '-af', `volume=${correction.gainDb}dB,aresample=192000,alimiter=limit=${10 ** (correction.ceilingDb / 20)}:level=false:latency=true,aresample=48000`,
      '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', '-t', String(plan.totalFrames / 30), corrected], {signal});
    renameSync(corrected, output); actual = await measureOutput();
  }
  writeFileSync(join(directory, 'loudness.json'), canonical({initial: stats, measurements, correction}));
  if (!inRange(actual)) throw Error('AUDIO_MASTER_OUT_OF_RANGE');
  const {lufs, truePeak} = actual;
  // RIFF can contain metadata chunks: ffprobe, not a hard-coded 44-byte offset, establishes duration.
  const probe = await run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output], {signal});
  const stream = parseCanonicalJson(probe.stdout).streams[0];
  if (stream.codec_name !== 'pcm_s16le' || stream.sample_rate !== '48000' || stream.channels !== 2
    || Math.abs(Number(stream.duration_ts) - generated.sampleFrames) > 0) throw Error('AUDIO_SAMPLE_LENGTH_INVALID');
  return {path: output, sampleFrames: generated.sampleFrames, silent: false, lufs, truePeak, correction};
}
