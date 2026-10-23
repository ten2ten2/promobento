#!/usr/bin/env node
// Pre-S1 account probes, run from CI only: Workers AI speech recognition (synthetic zh/en/ja
// voiceover, clean and under a music-like bed) and Browser Run on public product pages.
// Writes <out>/report.json. Needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and ffmpeg.
// Never prints the account ID. Spend is a few cents of Workers AI and Browser Run time.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) throw Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required');
const out = process.argv[2] ?? 'results';
mkdirSync(out, {recursive: true});
const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const report = {startedAt: new Date().toISOString()};
const save = () => writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args);
const scrub = text => String(text).replaceAll(account, '<account>');

async function api(method, path, body, {raw = false} = {}) {
  const t0 = performance.now();
  const response = await fetch(base + path, {
    method, headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: body && JSON.stringify(body)
  });
  const ms = Math.round(performance.now() - t0);
  const headers = Object.fromEntries([...response.headers].filter(([k]) => /^x-browser|^cf-ai|neuron/i.test(k)));
  if (raw) return {status: response.status, ms, headers, bytes: Buffer.from(await response.arrayBuffer())};
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { json = {raw: text.slice(0, 400)}; }
  const ok = response.ok && json.success !== false;
  return {ok, status: response.status, ms, headers, result: json.result, errors: ok ? undefined : scrub(JSON.stringify(json.errors ?? json.raw ?? '')).slice(0, 600)};
}

// ---------- speech recognition ----------
const SCRIPTS = {
  en: 'Meet LeetCode Sprint: 42 days, 300 problems, and weekly mock interviews. Start free today.',
  zh: '用 DeepSeek 写代码，只要 30 秒。新版支持 128K 上下文，现在免费试用。',
  ja: '日本語能力試験N2に、90日で合格を目指しましょう。毎日15分の練習で十分です。'
};

const norm = (text, lang) => {
  // Scores words and characters, not formatting: punctuation, case and spacing are ignored.
  let t = text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]/gu, '');
  return lang === 'en' ? t.replace(/\s+/g, ' ').trim() : t.replace(/\s+/g, '');
};
function editDistance(a, b) {
  const x = [...a], y = [...b];
  let prev = Array.from({length: y.length + 1}, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[y.length];
}
// Character error rate for zh/ja, word error rate for en.
function errorRate(reference, hypothesis, lang) {
  const r = norm(reference, lang), h = norm(hypothesis ?? '', lang);
  if (lang === 'en') { const rw = r.split(' '), hw = h ? h.split(' ') : []; return +(editDistance(rw, hw) / rw.length).toFixed(3); }
  return +(editDistance(r, h) / [...r].length).toFixed(3);
}

const ffmpeg = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const ffprobeSeconds = file => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();

async function models(task) {
  const r = await api('GET', `/ai/models/search?task=${encodeURIComponent(task)}&per_page=100`);
  return r.ok ? r.result.map(m => ({name: m.name, description: m.description?.slice(0, 120), price: m.properties?.find(p => p.property_id === 'price')?.value ?? null})) : {error: r.errors, status: r.status};
}

async function synthesize(lang, text) {
  // MeloTTS covers en/zh/ja; the response carries base64 MP3.
  const r = await api('POST', '/ai/run/@cf/myshell-ai/melotts', {prompt: text, lang: lang === 'ja' ? 'jp' : lang});
  if (!r.ok || !r.result?.audio) return {error: r.errors ?? 'no audio', status: r.status};
  const file = join(out, `voice-${lang}.mp3`);
  writeFileSync(file, Buffer.from(r.result.audio, 'base64'));
  return {file, ms: r.ms, seconds: ffprobeSeconds(file)};
}

function withBed(voice, lang) {
  // A music-like bed: two sustained tones plus pink noise, about 12 dB under the voice.
  const file = join(out, `voice-${lang}-bed.mp3`);
  ffmpeg(['-i', voice, '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100',
    '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.08:sample_rate=44100',
    '-filter_complex', '[1][2][3]amix=inputs=3:duration=longest,volume=0.25[bed];[0][bed]amix=inputs=2:duration=first:normalize=0[out]',
    '-map', '[out]', '-ac', '1', '-ar', '16000', file]);
  return file;
}

// Product names the owner would confirm in the brief; passed as Whisper's initial prompt.
const VOCABULARY = 'LeetCode, DeepSeek, MiniMax, Duolingo, JLPT N2, IELTS, 128K';
const ASR = {
  '@cf/openai/whisper-large-v3-turbo': (audio, lang) => ({audio: audio.toString('base64'), language: lang}),
  '@cf/openai/whisper-large-v3-turbo+vocabulary': (audio, lang) => ({audio: audio.toString('base64'), language: lang, initial_prompt: VOCABULARY}),
  '@cf/openai/whisper': audio => ({audio: [...audio]}),
  '@cf/deepgram/nova-3': null // listed only if present; called with raw audio below
};

async function transcribe(model, audio, lang) {
  if (model === '@cf/deepgram/nova-3') {
    const t0 = performance.now();
    const response = await fetch(`${base}/ai/run/${model}?language=${lang === 'zh' ? 'zh' : lang}&smart_format=true`, {
      method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'audio/mpeg'}, body: audio
    });
    const json = await response.json().catch(() => ({}));
    const ms = Math.round(performance.now() - t0);
    const alt = json.result?.results?.channels?.[0]?.alternatives?.[0];
    return response.ok ? {ms, text: alt?.transcript ?? '', words: alt?.words?.length ?? 0} : {ms, error: scrub(JSON.stringify(json.errors ?? json)).slice(0, 400)};
  }
  const r = await api('POST', `/ai/run/${model.split('+')[0]}`, ASR[model](audio, lang));
  if (!r.ok) return {ms: r.ms, error: r.errors};
  const words = r.result.words?.length ?? r.result.segments?.reduce((n, s) => n + (s.words?.length ?? 0), 0) ?? 0;
  return {ms: r.ms, text: r.result.text ?? '', words, detectedLanguage: r.result.transcription_info?.language};
}

log('== speech');
report.speech = {models: {asr: await models('Automatic Speech Recognition'), tts: await models('Text-to-Speech')}, runs: []};
save();
const available = new Set((Array.isArray(report.speech.models.asr) ? report.speech.models.asr : []).map(m => m.name));
const asrModels = Object.keys(ASR).filter(m => available.has(m.split('+')[0]));
report.speech.asrModelsTried = asrModels;
for (const [lang, text] of Object.entries(SCRIPTS)) {
  const voice = await synthesize(lang, text);
  if (voice.error) { report.speech.runs.push({lang, tts: voice}); save(); continue; }
  const clean = join(out, `voice-${lang}-clean.mp3`);
  ffmpeg(['-i', voice.file, '-ac', '1', '-ar', '16000', clean]);
  const variants = {clean, musicBed: withBed(voice.file, lang)};
  for (const [variant, file] of Object.entries(variants)) {
    const audio = readFileSync(file);
    for (const model of asrModels) {
      log(`asr ${lang} ${variant} ${model}`);
      const result = await transcribe(model, audio, lang);
      report.speech.runs.push({lang, variant, model, audioSeconds: voice.seconds, reference: text, ...result,
        errorRate: result.error ? null : errorRate(text, result.text, lang), metric: lang === 'en' ? 'WER' : 'CER'});
      save();
    }
  }
}

// ---------- Browser Run ----------
const PAGES = ['https://example.com/', 'https://www.duolingo.com/', 'https://www.deepseek.com/', 'https://www.minimax.io/', 'https://leetcode.com/'];
log('== browser');
report.browser = {runs: []};
for (const prefix of ['/browser-rendering', '/browser-run']) {
  const probe = await api('POST', `${prefix}/markdown`, {url: PAGES[0]});
  report.browser[`path ${prefix}`] = {ok: probe.ok, status: probe.status, errors: probe.errors};
  if (probe.ok) { report.browser.prefix = prefix; break; }
}
save();
if (report.browser.prefix) {
  for (const url of PAGES) {
    log(`browser ${url}`);
    const md = await api('POST', `${report.browser.prefix}/markdown`, {url, gotoOptions: {waitUntil: 'networkidle2', timeout: 45000}});
    const shot = await api('POST', `${report.browser.prefix}/screenshot`, {url, viewport: {width: 1280, height: 800}, gotoOptions: {waitUntil: 'networkidle2', timeout: 45000}}, {raw: true});
    const isImage = shot.bytes[0] === 0x89 || shot.bytes[0] === 0xff;
    if (isImage) writeFileSync(join(out, `shot-${new URL(url).hostname}.${shot.bytes[0] === 0x89 ? 'png' : 'jpg'}`), shot.bytes);
    const text = typeof md.result === 'string' ? md.result : '';
    report.browser.runs.push({url,
      markdown: {ok: md.ok, status: md.status, ms: md.ms, chars: text.length, head: text.slice(0, 160), errors: md.errors, headers: md.headers},
      screenshot: {status: shot.status, ms: shot.ms, bytes: shot.bytes.length, isImage, headers: shot.headers,
        error: isImage ? undefined : scrub(shot.bytes.toString('utf8', 0, 300))}});
    save();
  }
}

report.finishedAt = new Date().toISOString();
save();
log('done');
