import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {planShards} from '@promobento/contracts/render';
import {compareSeam} from '@promobento/contracts/seams';
import {validate as validateReceipt} from '@promobento/contracts/validators/render-job';
import {validate as validateObservation} from '@promobento/contracts/validators/frame-observation';
import {galleryFixture} from '../../../packages/film-runtime/test/gallery.mjs';
import {pageOptions} from '../../../packages/film-runtime/test/fixture.mjs';
import {filmBlockEvents} from '../../../packages/blocks/src/events.mjs';
import {deriveAudioPlan, audioPlanHash} from '../../../packages/audio/src/plan.mjs';
import {renderShard} from '../src/shard.mjs';
import {renderAudio} from '../src/audio.mjs';
import {assemble} from '../src/media.mjs';
import {filmSession} from '../src/browser.mjs';

export async function mediaFixture(output, rules, lock) {
  const directory = join(output, 'media'); mkdirSync(directory, {recursive: true});
  const spec = galleryFixture(), raw = canonical(spec), imageDigest = process.env.PROMOBENTO_TEST_IMAGE_DIGEST;
  assert.match(imageDigest ?? '', /^sha256:[0-9a-f]{64}$/);
  const installed = parseCanonicalJson(readFileSync('/opt/fonts/catalog.json')).fonts.find(face => face.fontId === 'geist-sans' && face.weight === 600);
  const resourceBytes = readFileSync(new URL('./product.svg', import.meta.url)), resource = async () => resourceBytes;
  const font = async () => readFileSync('/opt/fonts/' + installed.file);
  const optionsFor = aspect => {
    const options = pageOptions(aspect, rules.aspectLayouts[aspect]);
    options.resources[0].kind = 'svg'; options.fonts[0].codePoints = installed.codePoints;
    options.confirmedFactIds.push('fixture-capture-rate', 'fixture-caption'); return options;
  };
  const options = optionsFor('landscape'), plan = deriveAudioPlan(spec, filmBlockEvents(spec));
  const job = {schemaVersion: '3.0.0', kind: 'render_job', renderId: 'ci-media-fixture', operationId: 'ci-operation', candidateId: 'ci-candidate',
    sourceHash: filmSourceHash(raw), runtimeVersion: 'film-runtime-v1', rendererRelease: 'ci-image-not-production', aspectId: 'landscape',
    durationSeconds: 15, totalFrames: 450, quality: 'final', renderProfile: {sampleCount: 1, shutterAngle: 0, sampling: 'centered-box-v1', edgePolicy: 'clamp-v1'},
    audioPlanHash: audioPlanHash(plan,{seed:options.seed}), resources: [{resourceId: 'res_fixture_dashboard', kind: 'svg', sha256: sha256Bytes(resourceBytes)}]};
  const shards = planShards(job, spec, {seed: options.seed}).shards, receipts = [], seams = [], paths = [];
  for (const shard of shards) {
    const path = join(directory, 'shard-' + shard.index); mkdirSync(path);
    const receipt = await renderShard({job, shard, raw, options, resource, font, directory: path, browserVersion: lock.browser.version,
      imageDigest, encoding: rules.encodingProfiles.mp4_h264_1080_v1, threads: 2});
    assert.ok(validateReceipt(receipt), canonical(validateReceipt.errors)); receipts.push(receipt); paths.push(join(path, 'shard.h264'));
    const observations = parseCanonicalJson(readFileSync(join(path, 'observations.json')));
    assert.ok(observations.length);
    for (const observation of observations) {
      assert.ok(validateObservation(observation), canonical(validateObservation.errors));
      assert.ok(observation.texts.length, 'a reading hold must expose real CDP text');
      assert.deepEqual(observation.findings.filter(finding => finding.severity === 'BLOCK'), [], canonical(observation));
    }
    if (shard.index) {
      const seam = {frame: shard.start - 1, ...compareSeam(readFileSync(join(directory, 'shard-' + (shard.index - 1), 'seam-frames', (shard.start - 1) + '-last.png')),
        readFileSync(join(path, 'seam-frames', (shard.start - 1) + '-cold.png')))};
      seams.push(seam); assert.notEqual(seam.verdict, 'RENDER_SEAM_BLOCK', canonical(seam));
    }
  }
  const audio = await renderAudio({plan, inputs: {seed: options.seed, clearedSources: new Map(plan.sources.map(source => [source.sourceId,
    {...source, rightsCleared: true}]))}, directory, signal: undefined});
  const movie = await assemble({shards: paths, audioPath: join(directory, 'mixed.wav'), outputPath: join(directory, 'film.mp4'),
    posterPath: join(directory, 'poster.png'), coverFrame: 225, config: {width: 1920, height: 1080, encoding: rules.encodingProfiles.mp4_h264_1080_v1, threads: 2},
    totalFrames: 450, maxBytes: rules.productLimits.maxOutputFileBytes});
  const goldenFrames = [];
  for (const aspect of Object.keys(rules.aspectLayouts)) {
    const session = await filmSession({raw, options: optionsFor(aspect), resource, font, browserVersion: lock.browser.version});
    try {
      for (const scene of spec.scenes) for (const localFrame of [0, 12, 45]) {
        const frame = scene.start + localFrame, png = await session.frame(frame, {format: 'png'});
        const file = `${aspect}-${scene.id}-${localFrame}.png`; writeFileSync(join(directory, file), png); goldenFrames.push(file);
      }
    } finally { await session.close(); }
  }
  const report = {scope: 'CI original engineering fixture; not G1 or product aesthetic acceptance', status: 'passed', receipts, seams, audio, movie, goldenFrames};
  writeFileSync(join(directory, 'report.json'), canonical(report)); return {status: 'passed', movie, seams, goldenFrames: goldenFrames.length};
}
