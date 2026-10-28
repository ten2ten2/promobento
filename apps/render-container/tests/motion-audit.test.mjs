import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeMotion} from '../src/motion-audit.mjs';

test('whole-frame motion cues locate an empty opening, a flash and long holds without declaring a verdict', () => {
  const fps = 15, totalFrames = 120, size = 96 * 54, bytes = Buffer.alloc(totalFrames * size);
  bytes.fill(255, 30 * size, 31 * size);
  for (let frame = 45; frame < totalFrames; frame++)
    for (let p = 0; p < size; p++) bytes[frame * size + p] = p % 2 ? 255 : 0;
  const result = analyzeMotion(bytes, {fps, totalFrames});
  assert.equal(result.status, 'measured');
  assert.equal(result.frames, totalFrames);
  assert.equal(result.firstFrame.empty, true);
  assert.equal(result.firstFrame.contentAt, 3);
  assert.deepEqual(result.pops, [{at: 2, jump: 255}]);
  assert.ok(result.dead.some(interval => interval.from === 3 && interval.seconds > 4));
  assert.equal(result.opening.flat, true);
  assert.ok(!Object.hasOwn(result, 'verdict'));
});

test('partial frame data fails explicitly', () => {
  assert.throws(() => analyzeMotion(Buffer.alloc(96 * 54 * 2 - 1), {fps: 15, totalFrames: 2}), /MOTION_AUDIT_FRAME_COUNT_MISMATCH/);
});
