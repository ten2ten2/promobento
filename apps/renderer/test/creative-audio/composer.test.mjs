// Adapted from huashu-motion@5f2608c (c) 2026 Huashu, MIT. See ../../src/creative-audio/LICENSE.huashu.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GM_DRUMS,fit,parseAbc,perform} from '../../src/creative-audio/composer.mjs';
const CUE = `X:1
M:4/4
L:1/8
Q:1/4=96
K:F
V:P inst=piano
!mark:open! !mp! z2 cf g2 a2- | a2 gf d4 | !rise(! z2 cd f2 ed | c4- c2 z2 !rise)! |
!mark:reveal! !hit! !f! [FAc]8 | !mark:logo! !fermata![FAcf]8 |
V:D inst=drums kit=pop
Z4 | [C,,^C,]2 ^F,,2 D,,2 ^F,,2 | z8 |`;

test('parseAbc: drum voices read the General MIDI map and ignore the key; cue marks are collected', () => {
  const s = parseAbc(CUE);
  assert.equal(s.voices.D.role, 'drums');
  const drums = s.events.filter((e) => e.voice === 'D').map((e) => GM_DRUMS[e.midi]);
  assert.deepEqual([...new Set(drums)].sort(), ['crash', 'hat', 'kick', 'snare']);
  assert.deepEqual(s.cues.map((c) => c.type), ['mark', 'rise', 'mark', 'hit', 'mark']);
  assert.equal(s.cues.find((c) => c.type === 'rise').from, 8);
});

test('fit: every mark lands on its time, and the tempo bend per stretch is reported', () => {
  const s = parseAbc(CUE);
  const f = fit(s, { open: 0.5, reveal: 11, logo: 13.3 });
  for (const m of f.marks) assert.ok(Math.abs(m.at - m.target) < 0.001, `${m.name} ${m.at} vs ${m.target}`);
  assert.equal(f.stretches.length, 2);
  assert.ok(f.stretches[0].bend < 0, 'four bars in 10.5 s is slower than 96 bpm');
  const p = perform(s, { align: { open: 0.5, reveal: 11, logo: 13.3 } });
  assert.ok(Math.abs(p.cues.find((c) => c.type === 'hit').at - 11) < 0.001);
  assert.throws(() => fit(s, { open: 5, reveal: 3 }), /comes after/);
});

test('edits: !stop! sinks the band to silence, !stutter! repeats the first sixteenth, !filter! darkens then opens', async () => {
  const { renderComposed } = await import('../../src/creative-audio/composed.mjs');
  const base = 'X:1\nM:4/4\nL:1/8\nQ:1/4=120\nK:C\nV:S inst=saw\n';
  const bars = '[CEG]8 | [CEG]8 |';
  const run = (deco) => renderComposed(base + bars.replace('| [CEG]8 |', `| ${deco[0]} [CEG]8 ${deco[1]} |`), { duration: 4.5 }).music.L;
  const rms = (x, a, z) => { let e = 0; for (let i = Math.round(a * 48000); i < Math.round(z * 48000); i++) e += x[i] * x[i]; return Math.sqrt(e / ((z - a) * 48000)); };
  const plain = run(['', '']), stop = run(['!stop(!', '!stop)!']), filt = run(['!filter(!', '!filter)!']);
  const at = (x) => rms(x, 3.6, 4.0); // the last fifth of bar two
  assert.ok(at(stop) < at(plain) * 0.4, `stop ${at(stop)} vs ${at(plain)}`);
  assert.ok(rms(filt, 2.1, 2.5) < rms(plain, 2.1, 2.5) * 0.8, 'the filter starts closed');
  const st = run(['!stutter(!', '!stutter)!']);
  const q = Math.round(0.125 * 48000), a0 = Math.round(2.05 * 48000);
  let diff = 0; for (let i = 0; i < 2000; i++) diff += Math.abs(st[a0 + 300 + i] - st[a0 + 300 + q + i]);
  assert.ok(diff / 2000 < 0.02, `a stutter repeats every sixteenth (${diff / 2000})`);
});

test('stop: after the tape stop the band stays silent until the next note (no tails coming back)', async () => {
  const { renderComposed } = await import('../../src/creative-audio/composed.mjs');
  const { RATE } = await import('../../src/creative-audio/dsp.mjs');
  const text = `X:1
M:4/4
L:1/8
Q:1/4=120
K:C
V:P inst=warmpad
[CEG]8 | [CEG]6 !stop(! [CEG]2 !stop)! | z8 | [CEG]8 |`;
  const { music } = renderComposed(text, { duration: 9 });
  const rms = (a, b) => { let s = 0; for (let i = Math.floor(a * RATE); i < Math.floor(b * RATE); i++) s += music.L[i] ** 2 + music.R[i] ** 2; return Math.sqrt(s / ((b - a) * RATE * 2)); };
  // bar 2 ends (and the stop lands) at 4.05 s; the next chord starts at 6.05 s
  assert.ok(rms(4.1, 5.95) < 1e-4, `silence after the stop, got rms ${rms(4.1, 5.95)}`);
  assert.ok(rms(6.2, 7.5) > 1e-3, 'the band comes back on the next note');
});
