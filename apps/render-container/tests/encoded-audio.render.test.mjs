import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical} from '@promobento/contracts/canonical';
import rules from '../../../config/platform-presets.json' with {type: 'json'};
import {GENERATED_LICENSE} from '../../../packages/audio/src/plan.mjs';
import {renderAudio} from '../src/audio.mjs';
import {assemble, videoArgs} from '../src/media.mjs';
import {finalizeEncodedAudio} from '../src/encoded-audio.mjs';
import {run} from '../src/process.mjs';

export async function encodedAudioFixture(directory) {
  mkdirSync(directory, {recursive: true});
  // The original synthesized S1 signal that passed its WAV gate but overshot after AAC encoding.
  const plan = {schemaVersion: '3.0.0', kind: 'audio_plan', totalFrames: 450, sampleRate: 48000, channels: 2,
    loudnessTarget: -14, truePeakMax: -1, mute: false, music: {kind: 'procedural', style: 'funk', bpm: 100, sourceId: 'music'},
    events: [{eventId: 'music:bed', kind: 'music', sourceId: 'music', frameStart: 0, frameEndExclusive: 450, gainDb: 0, fadeInFrames: 1, fadeOutFrames: 15},
      {eventId: 'chime:celebrate:product-land', kind: 'sfx', sourceId: 'sfx_chime', frameStart: 306, frameEndExclusive: 366, gainDb: -6, fadeOutFrames: 3}],
    sources: ['music', 'sfx_chime'].map(sourceId => ({sourceId, origin: 'procedural', licenseRef: GENERATED_LICENSE}))};
  const master = await renderAudio({plan, directory, inputs: {seed: 's1-eval-minimax-15',
    clearedSources: new Map(plan.sources.map(source => [source.sourceId, {...source, rightsCleared: true}]))}});
  const config = {width: 64, height: 64, encoding: rules.encodingProfiles.mp4_h264_1080_v1, threads: 1};
  const shard = join(directory, 'fixture.h264');
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x102030:s=64x64:r=30:d=15',
    ...videoArgs(config), '-an', '-f', 'h264', shard]);
  const inputs = {shards: [shard], config, coverFrame: 30, totalFrames: 450, maxBytes: rules.productLimits.maxOutputFileBytes};
  const path = join(directory, 'film.mp4');
  const movie = await assemble({...inputs, audioPath: master.path, audioLimits: master,
    outputPath: path, posterPath: join(directory, 'poster.png')});
  assert.ok(movie.audio.initial.truePeak > -1, 'fixture must reproduce the actual AAC overshoot');
  assert.ok(movie.audio.truePeak <= -1 && Math.abs(movie.audio.lufs + 14) <= .5);
  assert.equal(movie.reencoded, false);
  assert.equal(movie.totalFrames, 450);

  const before = readFileSync(path);
  const passing = await finalizeEncodedAudio({path, audioPath: master.path, encoding: config.encoding, durationSeconds: 15});
  assert.equal(passing.correction, null);
  assert.ok(before.equals(readFileSync(path)), 'passing legacy/default path preserves the exact file');
  // An unachievable joint loudness/peak target must stop after one correction, keeping the prior file.
  await assert.rejects(finalizeEncodedAudio({path, audioPath: master.path, encoding: config.encoding, durationSeconds: 15,
    limits: {loudnessTarget: -14, truePeakMax: -20, silent: false}}), error => {
    assert.equal(error.message, 'OUTPUT_AUDIO_OUT_OF_RANGE');
    assert.ok(error.audioValidation.correction && Math.abs(error.audioValidation.final.lufs + 14) > .5);
    return true;
  });
  assert.ok(before.equals(readFileSync(path)));

  const silentPath = join(directory, 'silence.wav');
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '15', '-c:a', 'pcm_s16le', silentPath]);
  const silentMovie = await assemble({...inputs, audioPath: silentPath, audioLimits: {...master, silent: true},
    outputPath: join(directory, 'silent.mp4'), posterPath: join(directory, 'silent.png')});
  assert.deepEqual([silentMovie.audio.silent, silentMovie.audio.lufs, silentMovie.audio.truePeak], [true, null, null]);
  await assert.rejects(finalizeEncodedAudio({path: join(directory, 'silent.mp4'), audioPath: silentPath,
    encoding: config.encoding, durationSeconds: 15, limits: {...master, silent: false}}), /OUTPUT_AUDIO_UNEXPECTED_SILENCE/);
  const noAudio = await assemble({...inputs, outputPath: join(directory, 'no-audio.mp4'), posterPath: join(directory, 'no-audio.png')});
  assert.equal(noAudio.hasAudio, false); assert.equal(noAudio.audio, undefined);
  const report = {status: 'passed', scope: 'final_AAC_correction_no_op_fail_closed_silence_and_no_audio', master,
    corrected: movie.audio, passing: passing.correction, silent: silentMovie.audio, videoReencoded: movie.reencoded};
  writeFileSync(join(directory, 'report.json'), canonical(report));
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'linux' || process.getuid() !== 10001) throw Error('RENDER_CONTAINER_REQUIRED');
  console.log(canonical(await encodedAudioFixture('/work/encoded-audio')));
}
