// Adapted from huashu-motion@5f2608c (Copyright (c) 2026 Huashu), MIT. See LICENSE.huashu.
const r3 = (x) => Math.round(x * 1000) / 1000;
const sum = (xs) => xs.reduce((n, x) => n + x, 0);
const HAN = /\p{Script=Han}/u;
const SPEECH_CHAR = /[\p{L}\p{N}]/u;

// ---------- text ----------

const ENDERS = '。！？；!?;';
const CLAUSE = /^[，、,：:；;—…]+$/;
const CLOSERS = '”’」』）)】"\'';

// Sentences end at 。！？；!?; or a newline (English "." too, when a space or the end follows).
export function splitSentences(text) {
  const out = [];
  let buf = '';
  const chars = [...String(text)];
  const push = () => { const s = buf.trim(); if ([...s].some((c) => SPEECH_CHAR.test(c))) out.push(s); buf = ''; };
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === '\n' || c === '\r') { push(); continue; }
    buf += c;
    const dot = c === '.' && /[A-Za-z)]/.test(chars[i - 1] || '') && (i + 1 >= chars.length || /\s/.test(chars[i + 1]));
    if (ENDERS.includes(c) || dot) {
      while (i + 1 < chars.length && (ENDERS.includes(chars[i + 1]) || CLOSERS.includes(chars[i + 1]))) buf += chars[++i];
      push();
    }
  }
  push();
  return out;
}

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const LATIN = /[A-Za-z0-9](?:[A-Za-z0-9.'’+_-]*[A-Za-z0-9%+])?%?/g;

// Tokens of one sentence: words (Chinese by Intl.Segmenter, Latin/number runs kept whole, `keep`
// terms never split) and the punctuation/space between them.
export function tokenize(sentence, keep = []) {
  const terms = [...new Set(keep.filter(Boolean))].sort((a, b) => b.length - a.length);
  const tokens = [];
  const free = (s) => {
    let last = 0;
    for (const m of s.matchAll(LATIN)) {
      chinese(s.slice(last, m.index));
      tokens.push({ text: m[0], word: true });
      last = m.index + m[0].length;
    }
    chinese(s.slice(last));
  };
  const chinese = (s) => {
    for (const seg of segmenter.segment(s)) {
      const word = seg.isWordLike ?? [...seg.segment].some((c) => SPEECH_CHAR.test(c));
      tokens.push({ text: seg.segment, word: !!word });
    }
  };
  let i = 0, last = 0;
  outer: while (i < sentence.length) {
    for (const t of terms) {
      if (sentence.startsWith(t, i)) {
        free(sentence.slice(last, i));
        tokens.push({ text: t, word: true });
        i += t.length; last = i;
        continue outer;
      }
    }
    i++;
  }
  free(sentence.slice(last));
  return tokens.filter((t) => t.text.length);
}

// How long a token takes to say, in "Chinese syllables": one per Han character or digit, vowel groups
// for Latin words; punctuation gets a sliver (real pauses are measured from the audio instead).
export function weight(token) {
  if (!token.word) return /^\s*$/.test(token.text) ? 0 : 0.1;
  let w = 0;
  for (const part of token.text.match(/[A-Za-z]+|[0-9]|[^A-Za-z0-9]/gu) || []) {
    if (/^[A-Za-z]+$/.test(part)) w += Math.max(1, (part.match(/[aeiouy]+/gi) || []).length);
    else if (/[0-9]/.test(part) || SPEECH_CHAR.test(part)) w += 1;
  }
  return Math.max(w, 0.5);
}

// ---------- timing ----------

// Speech spans [[start, end], …] in real seconds. "Speech time" is the same audio with the silences
// cut out; words are spread over speech time so a pause never swallows part of a word.
function speechClock(spans) {
  const total = sum(spans.map(([s, e]) => e - s));
  const at = (x, edge) => {
    let acc = 0;
    for (let i = 0; i < spans.length; i++) {
      const [s, e] = spans[i], len = e - s;
      const inside = edge === 'end' ? x <= acc + len + 1e-9 : x < acc + len - 1e-9;
      if (inside || i === spans.length - 1) return s + Math.min(Math.max(x - acc, 0), len);
      acc += len;
    }
    return 0;
  };
  return { total, at };
}

// Give every token a start/end inside the spans, proportional to its weight. Returns the tokens with
// times attached to the words.
export function placeWords(tokens, spans) {
  if (!spans.length) throw new Error('no speech found to place words in');
  const { total, at } = speechClock(spans);
  // punctuation before the first / after the last word is the pause itself, already cut from spans
  const first = tokens.findIndex((t) => t.word), last = tokens.findLastIndex((t) => t.word);
  const w = tokens.map((t, i) => (i < first || i > last ? 0 : weight(t)));
  const W = sum(w) || 1;
  let cw = 0;
  return tokens.map((t, i) => {
    const a = (total * cw) / W;
    cw += w[i];
    const b = (total * cw) / W;
    return t.word ? { ...t, start: r3(at(a, 'start')), end: r3(at(b, 'end')) } : { ...t };
  });
}

// Split tokens at clause punctuation (，、：；…); punctuation stays with the clause it ends, and a
// clause without words joins its neighbour.
export function clausesOf(tokens) {
  const out = [[]];
  for (const t of tokens) {
    out.at(-1).push(t);
    if (!t.word && CLAUSE.test(t.text.trim())) out.push([]);
  }
  const merged = [];
  for (const c of out) {
    if (c.some((t) => t.word) || !merged.length) merged.push([...c]);
    else merged.at(-1).push(...c);
  }
  if (merged.length > 1 && !merged[0].some((t) => t.word)) merged[1].unshift(...merged.shift());
  return merged.filter((c) => c.length);
}

const speechLen = (text) => [...text].filter((c) => SPEECH_CHAR.test(c)).length;

// Lay clauses onto spans and spread words inside each; empty spans collapse onto the previous end.
function placeUnits(units, spans, start) {
  let lastEnd = start;
  return units.map((u, k) => {
    const own = spans[k] || [];
    const placed = placeWords(u, own.length ? own : [[lastEnd, lastEnd]]);
    if (own.length) lastEnd = own.at(-1)[1];
    return placed;
  });
}

// A sentence: first snap its clauses onto the pauses inside its speech, then spread words within each
// clause — so a word right after a comma starts when the voice resumes.
export function placeSentence(tokens, spans) {
  const units = clausesOf(tokens);
  if (units.length < 2 || spans.length < 2) return placeWords(tokens, spans);
  return placeUnits(units, sentenceSpans(units.map((c) => sum(c.map(weight))), spans), spans[0][0]).flat();
}

// A recording with per-character times from whisper (`times`, one per speech character of the
// script): whisper decides which pause each clause boundary belongs to, the pauses themselves give the
// exact edges, and words are spread inside. Whisper's own token times are too loose to use directly.
export function placeByAnchors(sentences, intervals, times) {
  const units = sentences.flatMap((s, si) => clausesOf(s.tokens).map((tokens) => ({ si, tokens })));
  let ci = 0;
  const first = units.map((u) => { const i = ci; ci += sum(u.tokens.filter((t) => t.word).map((t) => speechLen(t.text))); return i; });
  const at = first.slice(1).map((i) => times[i]?.start ?? null);
  const spans = sentenceSpans(units.map((u) => sum(u.tokens.map(weight))), intervals, at);
  const placed = placeUnits(units.map((u) => u.tokens), spans, intervals[0]?.[0] ?? 0);
  return sentences.map((s, si) => ({ text: s.text, tokens: placed.filter((_, k) => units[k].si === si).flat() }));
}

export const wordsOf = (sentences) => sentences.flatMap((s) => s.tokens.filter((t) => t.word).map((t) => ({ word: t.text, start: t.start, end: t.end })));

// ffmpeg silencedetect output → silences [[start, end], …]
export function parseSilences(stderr, duration) {
  const out = [];
  let open = null;
  for (const line of String(stderr).split('\n')) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    const e = /silence_end:\s*([\d.]+)/.exec(line);
    if (s) open = Math.max(0, Number(s[1]));
    if (e && open != null) { out.push([open, Number(e[1])]); open = null; }
  }
  if (open != null) out.push([open, duration]);
  return out;
}

// The complement of the silences inside [0, duration], dropping blips shorter than minSpeech.
export function speechIntervals(silences, duration, minSpeech = 0.04) {
  const out = [];
  let at = 0;
  for (const [s, e] of silences) {
    if (s - at >= minSpeech) out.push([r3(at), r3(s)]);
    at = Math.max(at, e);
  }
  if (duration - at >= minSpeech) out.push([r3(at), r3(duration)]);
  return out.length ? out : [[0, r3(duration)]];
}

// Real-time spans covering speech-time [x0, x1] of `intervals`.
function clipSpans(intervals, x0, x1) {
  const out = [];
  let acc = 0;
  for (const [s, e] of intervals) {
    const len = e - s, a = Math.max(x0 - acc, 0), b = Math.min(x1 - acc, len);
    if (b - a > 1e-6) out.push([s + a, s + b]);
    acc += len;
  }
  return out;
}

// Units (sentences or clauses) of a recording → their speech spans. Each boundary goes to the silence
// gap nearest its target (monotonic, least squares): the target is where the text weights put it, or
// — when `at` gives a real time for it (whisper heard the unit begin there) — that time. A gap farther
// than 0.4 s of speech from a whisper anchor is not trusted; the anchor itself is used.
export function sentenceSpans(weights, intervals, at = null) {
  const lens = intervals.map(([s, e]) => e - s);
  const S = sum(lens), W = sum(weights) || 1;
  const toSpeech = (t) => sum(intervals.map(([s, e]) => Math.max(0, Math.min(e, t) - s)));
  const targets = [], gaps = [];
  let acc = 0;
  for (let k = 0; k < weights.length - 1; k++) {
    acc += weights[k];
    targets.push(at?.[k] != null ? toSpeech(at[k]) : (S * acc) / W);
  }
  for (let k = 1; k < targets.length; k++) targets[k] = Math.max(targets[k], targets[k - 1]);
  acc = 0;
  for (let j = 0; j < lens.length - 1; j++) { acc += lens[j]; gaps.push(acc); }
  const pauses = intervals.slice(1).map(([s], j) => s - intervals[j][1]);
  let cuts = gaps.length >= targets.length ? bestCuts(targets, gaps, pauses) : targets;
  if (at) cuts = cuts.map((c, k) => (at[k] != null && Math.abs(c - targets[k]) > 0.4 ? targets[k] : c));
  for (let k = 1; k < cuts.length; k++) cuts[k] = Math.max(cuts[k], cuts[k - 1]);
  const bounds = [0, ...cuts, S];
  return weights.map((_, k) => clipSpans(intervals, bounds[k], bounds[k + 1]));
}

// Longer pauses are likelier boundaries, so the squared miss is divided by the pause length.
function bestCuts(targets, gaps, pauses) {
  const miss = (j, k) => (gaps[j] - targets[k]) ** 2 / (pauses[j] + 0.1);
  const K = targets.length, G = gaps.length;
  if (!K) return [];
  const cost = Array.from({ length: K }, () => new Float64Array(G).fill(Infinity));
  const from = Array.from({ length: K }, () => new Int32Array(G).fill(-1));
  for (let j = 0; j < G; j++) cost[0][j] = miss(j, 0);
  for (let k = 1; k < K; k++) {
    let best = Infinity, arg = -1;
    for (let j = 1; j < G; j++) {
      if (cost[k - 1][j - 1] < best) { best = cost[k - 1][j - 1]; arg = j - 1; }
      if (arg >= 0) { cost[k][j] = best + miss(j, k); from[k][j] = arg; }
    }
  }
  let j = 0;
  for (let i = 1; i < G; i++) if (cost[K - 1][i] < cost[K - 1][j]) j = i;
  const picked = [];
  for (let k = K - 1; k >= 0; k--) { picked.unshift(gaps[j]); j = from[k][j]; }
  return picked;
}

// Edit-distance alignment of two character arrays; returns, for each index of a, the matched index in
// b (-1 when that character was inserted or substituted — those get interpolated).
export function alignChars(a, b) {
  if(a.length>2000||b.length>2000)throw Error('CAPTION_ALIGNMENT_LIMIT');
  const n = a.length, m = b.length, W = m + 1;
  const dir = new Uint8Array((n + 1) * W); // 1 diag, 2 up (skip a), 3 left (skip b)
  let prev = new Uint32Array(W), cur = new Uint32Array(W);
  for (let j = 0; j <= m; j++) { prev[j] = j; dir[j] = 3; }
  for (let i = 1; i <= n; i++) {
    cur[0] = i; dir[i * W] = 2;
    for (let j = 1; j <= m; j++) {
      const same = a[i - 1].toLowerCase() === b[j - 1].toLowerCase();
      const d = prev[j - 1] + (same ? 0 : 1), u = prev[j] + 1, l = cur[j - 1] + 1;
      if (d <= u && d <= l) { cur[j] = d; dir[i * W + j] = same ? 1 : 4; }
      else if (u <= l) { cur[j] = u; dir[i * W + j] = 2; }
      else { cur[j] = l; dir[i * W + j] = 3; }
    }
    [prev, cur] = [cur, prev];
  }
  const match = new Array(n).fill(-1);
  for (let i = n, j = m; i > 0 || j > 0;) {
    const d = dir[i * W + j];
    if (d === 1) { match[i - 1] = j - 1; i--; j--; }
    else if (d === 4) { i--; j--; }
    else if (d === 2) i--;
    else j--;
  }
  return match;
}

// Times for script characters from timed ASR characters: matched ones copy, the rest are spread
// evenly between their timed neighbours.
export function charTimes(script, asr) {
  const match = alignChars(script, asr.map((c) => c.ch));
  const t = match.map((j) => (j >= 0 ? { start: asr[j].start, end: asr[j].end, timingBasis: 'observed_anchor' } : null));
  const known = t.filter(Boolean).length;
  for (let i = 0; i < t.length;) {
    if (t[i]) { i++; continue; }
    let j = i;
    while (j < t.length && !t[j]) j++;
    const a = i > 0 ? t[i - 1].end : (asr[0]?.start ?? 0);
    const b = j < t.length ? t[j].start : (asr.at(-1)?.end ?? a);
    const step = Math.max(b - a, 0) / (j - i);
    for (let k = i; k < j; k++) t[k] = { start: a + step * (k - i), end: a + step * (k - i + 1), timingBasis: 'interpolated' };
    i = j;
  }
  return { times: t, matched: script.length ? known / script.length : 0 };
}

// whisper.cpp --output-json-full → timed speech characters. With --dtw, a token's t_dtw (centiseconds)
// is far closer to when it was said than its decoder offsets, which drift by up to a second; tokens
// that cut a character in half (U+FFFD) fall back to spreading the segment's text over the segment.
export function asrChars(json) {
  const chars = [];
  const spread = (text, from, to) => {
    const cs = [...text].filter((c) => SPEECH_CHAR.test(c));
    cs.forEach((ch, i) => chars.push({ ch, start: from + ((to - from) * i) / cs.length, end: from + ((to - from) * (i + 1)) / cs.length }));
  };
  for (const seg of json.transcription || []) {
    const toks = (seg.tokens || []).filter((t) => t.text && !/^\s*\[.*\]\s*$/.test(t.text));
    if (toks.some((t) => t.text.includes('\ufffd'))) { spread(seg.text || '', seg.offsets.from / 1000, seg.offsets.to / 1000); continue; }
    const dtw = toks.length && toks.every((t) => t.t_dtw >= 0);
    toks.forEach((t, i) => {
      if (!dtw) return spread(t.text, t.offsets.from / 1000, t.offsets.to / 1000);
      const from = t.t_dtw / 100, next = toks[i + 1] ? toks[i + 1].t_dtw / 100 : Math.max(from, seg.offsets.to / 1000);
      spread(t.text, from, Math.max(from, next));
    });
  }
  return chars;
}

// ---------- captions ----------

const visible = (s) => sum([...s].map((c) => (/[\p{L}\p{N}]/u.test(c) ? (/[\x00-\x7f]/.test(c) ? 0.5 : 1) : 0)));

// One sentence → caption lines of at most `max` visible characters, cut at commas first, then at
// word boundaries. Lines never cross a sentence.
export function captionLines(sentence, max = 16) {
  const clauses = [[]];
  for (const t of sentence.tokens) {
    clauses.at(-1).push(t);
    if (!t.word && CLAUSE.test(t.text.trim())) clauses.push([]);
  }
  const width = (ts) => visible(ts.filter((t) => t.word).map((t) => t.text).join(''));
  const lines = [];
  let line = [];
  for (const clause of clauses.filter((c) => c.some((t) => t.word))) {
    if (width(line) + width(clause) <= max) { line.push(...clause); continue; }
    if (line.length) lines.push(line);
    line = [];
    if (width(clause) <= max) { line = [...clause]; continue; }
    for (const t of clause) {
      if (t.word && width(line) + width([t]) > max && line.length) { lines.push(line); line = []; }
      line.push(t);
    }
  }
  if (line.some((t) => t.word)) lines.push(line);
  return lines.map((ts) => {
    const words = ts.filter((t) => t.word);
    const text = ts.map((t) => t.text).join('').trim();
    return { text, start: words[0].start, end: words.at(-1).end };
  });
}

const stamp = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

export function toSrt(sentences, { max = 16, offset = 0 } = {}) {
  const lines = sentences.flatMap((s) => captionLines(s, max));
  return lines.map((l, i) => `${i + 1}\n${stamp(l.start + offset)} --> ${stamp(l.end + offset)}\n${l.text}\n`).join('\n');
}
