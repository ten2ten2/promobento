// Measures what an OpenAI-compatible gateway actually supports for each model the plan binds
// (docs/plans/cloud-motion-v3.md §6.11/§6.12): tools, vision, JSON Schema, reasoning effort,
// streaming usage, prompt caching, latency. Writes results/model-probe.json.
// Usage: MODEL_COMPAT_API_KEY=... node probe.mjs [baseUrl] [outDir]
import {deflateSync} from 'node:zlib';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const KEY = process.env.MODEL_COMPAT_API_KEY;
const BASE = process.argv[2] ?? 'https://api.modelswitch.org/v1';
const OUT = process.argv[3] ?? 'results';
const MODELS = (process.env.PROBE_MODELS ?? 'deepseek-v4.1-flash-1017,gemini-3.8-flash,claude-sonnet-5-5,claude-opus-5-5').split(',');
const TIMEOUT_MS = 240000;
if (!KEY) throw Error('MODEL_COMPAT_API_KEY is not set');
mkdirSync(OUT, {recursive: true});

// A 96x96 PNG: left half red, right half blue. Vision models must name both colours in order.
function png() {
  const w = 96, h = 96, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 3 + 1) + 1 + x * 3;
    if (x < w / 2) raw[o] = 230; else raw[o + 2] = 230;
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    let c = ~0; for (const b of body) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    const crc = Buffer.alloc(4); crc.writeUInt32BE((~c) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const IMAGE = `data:image/png;base64,${png().toString('base64')}`;

async function call(body, {stream = false} = {}) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: {authorization: `Bearer ${KEY}`, 'content-type': 'application/json'},
      body: JSON.stringify({...body, stream})
    });
    if (!stream) {
      const text = await response.text();
      let json; try { json = JSON.parse(text); } catch {}
      return {status: response.status, ms: Math.round(performance.now() - started), json, error: json?.error ?? (response.ok ? undefined : text.slice(0, 400))};
    }
    let firstTokenMs = null, content = '', usage = null, buffer = '', chunks = 0;
    const decoder = new TextDecoder();
    for await (const part of response.body) {
      buffer += decoder.decode(part, {stream: true});
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
        if (!line.startsWith('data:') || line === 'data: [DONE]') continue;
        let event; try { event = JSON.parse(line.slice(5)); } catch { continue; }
        chunks++;
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) { if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - started); content += delta; }
        if (event.usage) usage = event.usage;
      }
    }
    return {status: response.status, ms: Math.round(performance.now() - started), firstTokenMs, chunks, content: content.slice(0, 200), usage};
  } catch (error) {
    return {status: 0, ms: Math.round(performance.now() - started), error: String(error.message)};
  } finally { clearTimeout(timer); }
}
const text = result => result.json?.choices?.[0]?.message?.content ?? '';
const brief = result => ({status: result.status, ms: result.ms, error: result.error, usage: result.json?.usage ?? result.usage, finish: result.json?.choices?.[0]?.finish_reason});

// ~6k tokens of stable prefix for the cache test (repeated method-pack-like prose).
const PREFIX = Array.from({length: 120}, (_, i) =>
  `Rule ${i + 1}: keep the opening under three seconds, land the hero shot on the strongest beat, and never put a price on screen unless it is bound to a confirmed fact.`).join('\n');

async function probe(model) {
  const r = {model};
  const basic = await call({model, max_tokens: 64, messages: [{role: 'user', content: 'Reply with exactly: pong'}]});
  r.basic = {...brief(basic), reply: text(basic).slice(0, 80)};
  if (basic.status !== 200) return r;

  const streamed = await call({model, max_tokens: 64, stream_options: {include_usage: true}, messages: [{role: 'user', content: 'Count from 1 to 10.'}]}, {stream: true});
  r.stream = {status: streamed.status, ms: streamed.ms, firstTokenMs: streamed.firstTokenMs, chunks: streamed.chunks, usageInStream: Boolean(streamed.usage), usage: streamed.usage, error: streamed.error};

  const tools = await call({model, max_tokens: 256, tool_choice: 'auto', messages: [{role: 'user', content: 'Use the set_scene tool to create a scene with id "hook" lasting 90 frames.'}],
    tools: [{type: 'function', function: {name: 'set_scene', description: 'Create a scene', parameters: {type: 'object', additionalProperties: false, required: ['id', 'frames'],
      properties: {id: {type: 'string'}, frames: {type: 'integer'}}}}}]});
  const toolCall = tools.json?.choices?.[0]?.message?.tool_calls?.[0];
  let toolArgs = null; try { toolArgs = JSON.parse(toolCall?.function?.arguments ?? 'null'); } catch {}
  r.tools = {...brief(tools), called: toolCall?.function?.name ?? null, args: toolArgs, ok: toolCall?.function?.name === 'set_scene' && toolArgs?.id === 'hook' && toolArgs?.frames === 90};

  const vision = await call({model, max_tokens: 64, messages: [{role: 'user', content: [
    {type: 'text', text: 'The image has two halves. Name the colour of the left half, then the right half, as two lowercase words separated by a space.'},
    {type: 'image_url', image_url: {url: IMAGE}}]}]});
  const seen = text(vision).toLowerCase();
  r.vision = {...brief(vision), reply: seen.slice(0, 80), ok: vision.status === 200 && seen.indexOf('red') >= 0 && seen.indexOf('blue') > seen.indexOf('red')};

  const schema = {type: 'object', additionalProperties: false, required: ['durationSeconds', 'scenes'], properties: {
    durationSeconds: {type: 'integer', enum: [15, 30]},
    scenes: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['id', 'start', 'end'],
      properties: {id: {type: 'string'}, start: {type: 'integer'}, end: {type: 'integer'}}}}}};
  const structured = await call({model, max_tokens: 400, messages: [{role: 'user', content: 'Plan a 15 second film with three scenes covering frames 0 to 450.'}],
    response_format: {type: 'json_schema', json_schema: {name: 'film', strict: true, schema}}});
  let parsed = null; try { parsed = JSON.parse(text(structured)); } catch {}
  r.jsonSchema = {...brief(structured), parsed: Boolean(parsed), ok: parsed?.durationSeconds === 15 && Array.isArray(parsed?.scenes) && parsed.scenes.length > 0,
    sample: text(structured).slice(0, 160)};

  const effort = await call({model, max_tokens: 64, reasoning_effort: 'low', messages: [{role: 'user', content: 'Reply with exactly: ok'}]});
  r.reasoningEffort = {...brief(effort), accepted: effort.status === 200};

  const cacheRun = async extra => {
    const messages = [{role: 'system', content: [{type: 'text', text: PREFIX, ...extra}]}, {role: 'user', content: 'Which rule mentions prices? Answer with the number only.'}];
    const first = await call({model, max_tokens: 16, messages});
    const second = await call({model, max_tokens: 16, messages});
    return {first: brief(first), second: brief(second),
      cachedTokensSecond: second.json?.usage?.prompt_tokens_details?.cached_tokens ?? second.json?.usage?.cache_read_input_tokens ?? null};
  };
  r.cacheAutomatic = await cacheRun({});
  if (model.startsWith('claude')) r.cacheControl = await cacheRun({cache_control: {type: 'ephemeral'}});
  return r;
}

const report = {at: new Date().toISOString(), baseUrl: BASE, models: {}};
for (const model of MODELS) {
  console.log(`probing ${model}`);
  report.models[model] = await probe(model);
  writeFileSync(join(OUT, 'model-probe.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
