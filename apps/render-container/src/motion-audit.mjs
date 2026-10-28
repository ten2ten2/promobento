// Adapted from huashu-motion@52467f99c602b76ba86d511d37acdfe93fa1e16e,
// cli/lib/qa.js, Copyright (c) 2026 Huashu, MIT. See ../../../packages/film-runtime/src/LICENSE.huashu.
// The original analysis is retained; decoding uses the renderer's bounded, cancellable process helper.
import {run} from './process.mjs';

const W = 96, H = 54, SIZE = W * H;
const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

/** Low-resolution whole-frame differences are inspection cues, not a motion or quality verdict. */
export function analyzeMotion(bytes, {fps, totalFrames}) {
  if (![fps, totalFrames].every(Number.isInteger) || fps <= 0 || totalFrames < 2 || bytes.length !== totalFrames * SIZE)
    throw Error('MOTION_AUDIT_FRAME_COUNT_MISMATCH');
  const f = Array.from({length: totalFrames}, (_, i) => bytes.subarray(i * SIZE, (i + 1) * SIZE));
  const d = f.slice(1).map((x, i) => diff(x, f[i]));
  const t = i => +(i / fps).toFixed(2), duration = totalFrames / fps;
  const pops = [];
  for (let i = 1; i < f.length - 1; i++) {
    const a = d[i - 1], b = d[i], around = diff(f[i - 1], f[i + 1]);
    if (a > 6 && b > 6 && around < Math.min(a, b) / 3) pops.push({at: t(i), jump: +Math.min(a, b).toFixed(1)});
  }
  const cuts = [];
  for (let i = 0; i < d.length; i++) {
    const local = median(d.slice(Math.max(0, i - 6), i).concat(d.slice(i + 1, i + 7)));
    if (d[i] > 14 && d[i] > 4 * (local + 1) && !pops.some(p => Math.abs(p.at - t(i + 1)) < 0.05)) cuts.push(t(i + 1));
  }
  const dead = [];
  let runLength = 0;
  for (let i = 0; i <= d.length; i++) {
    if (i < d.length && d[i] < 0.25) runLength++;
    else { if (runLength / fps >= 1) dead.push({from: t(i - runLength), to: t(i), seconds: +(runLength / fps).toFixed(2)}); runLength = 0; }
  }
  const perSecond = [];
  for (let s = 0; s * fps < d.length; s++) {
    const seg = d.slice(Math.round(s * fps), Math.round((s + 1) * fps));
    perSecond.push(+(seg.reduce((a, b) => a + b, 0) / seg.length).toFixed(1));
  }
  const mean = perSecond.reduce((a, b) => a + b, 0) / (perSecond.length || 1);
  const sd = Math.sqrt(perSecond.reduce((a, b) => a + (b - mean) ** 2, 0) / (perSecond.length || 1));
  const head = perSecond.slice(0, 5), still = dead.filter(x => x.from < 5 && x.seconds >= 1.5);
  const opening = {peak: head.length ? Math.max(...head) : 0, still, flat: duration >= 6 && ((head.length ? Math.max(...head) : 0) < 1.5 || still.length > 0)};
  const flatFilm = duration >= 6 && mean < 0.6 && cuts.length / duration * 60 < 3;
  const content = px => {
    const m = median(px); let far = 0, edges = 0;
    for (let i = 0; i < px.length; i++) {
      if (Math.abs(px[i] - m) > 16) far++;
      if (i % W < W - 1 && Math.abs(px[i] - px[i + 1]) > 20) edges++;
    }
    return {far: far / px.length, edges: edges / (H * (W - 1))};
  };
  const c0 = content(f[0]); let contentAt = null;
  for (let i = 0; i < f.length && i < fps * 10; i++) {
    const c = content(f[i]); if (c.far >= 0.05 && c.edges >= 0.015) { contentAt = t(i); break; }
  }
  return {status: 'measured', source: 'huashu-motion@52467f9/cli/lib/qa', sampleWidth: W, sampleHeight: H,
    frames: f.length, fps, pops, cuts, dead, motion: {perSecond, mean: +mean.toFixed(2), contrast: +(sd / (mean + 1e-6)).toFixed(2)},
    opening, flatFilm, firstFrame: {far: +c0.far.toFixed(3), edges: +c0.edges.toFixed(3), empty: c0.far < 0.03 && c0.edges < 0.012, contentAt}};
}

export async function auditMotion(path, {fps, totalFrames, signal}) {
  const {stdout} = await run('ffmpeg', ['-v', 'error', '-i', path, '-vf', `scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'],
    {signal, timeoutMs: 15000});
  return analyzeMotion(stdout, {fps, totalFrames});
}

/** This diagnostic is advisory: expose an expected execution failure without failing the movie. */
export async function motionAuditReport(path, options) {
  try { return await auditMotion(path, options); }
  catch (error) {
    if (options.signal?.aborted || !['MEDIA_PROCESS_FAILED', 'MEDIA_PROCESS_TIMEOUT', 'MOTION_AUDIT_FRAME_COUNT_MISMATCH'].includes(error.message)) throw error;
    return {status: 'unavailable', source: 'huashu-motion@52467f9/cli/lib/qa', reason: error.message};
  }
}
