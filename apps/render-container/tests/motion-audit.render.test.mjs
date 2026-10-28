// Run in the isolated Linux renderer image: this exercises the real FFmpeg assembly path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {parseCanonicalJson} from '@promobento/contracts/canonical';
import {assemble, videoArgs} from '../src/media.mjs';
import {motionAuditReport} from '../src/motion-audit.mjs';
import {run} from '../src/process.mjs';

if (process.platform !== 'linux' || process.env.PROMOBENTO_MEDIA_TEST_CONTAINER !== '1') throw Error('MEDIA_TEST_REQUIRES_ISOLATED_CONTAINER');

test('assembly preserves the old default, returns review cues, and exposes diagnostic failures', async () => {
  const directory = mkdtempSync('/tmp/motion-audit-');
  try {
    const rules = parseCanonicalJson(readFileSync('/app/config/platform-presets.json'));
    const encoding = {...rules.encodingProfiles.mp4_h264_1080_v1, fps: 15, targetVideoBitrate: 2000000, maxVideoBitrate: 2500000};
    const config = {width: 320, height: 180, threads: 1, encoding}, shard = join(directory, 'shard.h264');
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:size=320x180:rate=15',
      '-frames:v', '30', ...videoArgs(config), '-an', '-f', 'h264', shard]);
    const make = (name, motionAudit) => assemble({shards: [shard], outputPath: join(directory, name + '.mp4'),
      posterPath: join(directory, name + '.png'), coverFrame: 15, config, totalFrames: 30, maxBytes: 10 << 20, ...motionAudit});
    const original = await make('original', {});
    assert.equal(Object.hasOwn(original, 'motionAudit'), false);
    const measured = await make('measured', {motionAudit: true});
    assert.equal(measured.motionAudit.status, 'measured');
    assert.equal(measured.motionAudit.frames, 30);
    assert.equal(measured.motionAudit.firstFrame.empty, true);
    assert.ok(measured.motionAudit.dead.length);
    assert.equal(measured.motionAudit.inspection.status,'available');
    assert.deepEqual(measured.motionAudit.inspection.sheets[0].frames,[0,2,4,6,8,10]);
    assert.equal(readFileSync(join(directory,measured.motionAudit.inspection.sheets[0].path)).subarray(0,2).toString('hex'),'ffd8');

    const unavailable = await motionAuditReport(join(directory, 'missing.mp4'), {fps: 15, totalFrames: 30});
    assert.deepEqual(unavailable, {status: 'unavailable', source: 'huashu-motion@52467f9/cli/lib/qa', reason: 'MEDIA_PROCESS_FAILED'});
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(motionAuditReport(join(directory, 'measured.mp4'), {fps: 15, totalFrames: 30, signal: cancelled.signal}),
      error => error.name === 'AbortError');
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});
