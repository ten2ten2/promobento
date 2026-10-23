import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';

/** Normalized messages are trusted prompt data, never executable modules. */
export function providerRequest({provider, model, system, messages, schema, tools = [], effort, maxOutputTokens}) {
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 16384) throw Error('MODEL_OUTPUT_LIMIT_INVALID');
  if (provider.kind === 'openai-compatible') {
    const content = message => message.images?.length ? [{type: 'text', text: message.text}, ...message.images.map(image =>
      ({type: 'image_url', image_url: {url: `data:${image.mediaType};base64,${image.base64}`}}))] : message.text;
    return {path: '/chat/completions', body: {model, messages: [{role: 'system', content: system}, ...messages.map(message =>
      ({role: message.role, content: content(message)}))], max_tokens: maxOutputTokens, stream: true, stream_options: {include_usage: true},
      reasoning_effort: effort, ...(tools.length ? {tools: tools.map(tool => ({type: 'function', function: tool}))} : {response_format: {type: 'json_object'}})}};
  }
  if (provider.kind !== 'anthropic') throw Error('MODEL_PROVIDER_UNSUPPORTED');
  return {path: '/v1/messages', body: {model, system: [{type: 'text', text: system, cache_control: {type: 'ephemeral', ttl: '1h'}}],
    messages: messages.map(message => ({role: message.role, content: [{type: 'text', text: message.text}, ...(message.images ?? []).map(image =>
      ({type: 'image', source: {type: 'base64', media_type: image.mediaType, data: image.base64}}))]})),
    max_tokens: maxOutputTokens, stream: true, output_config: {effort, ...(!tools.length && schema ? {format: {type: 'json_schema', schema}} : {})},
    ...(tools.length ? {tools: tools.map(tool => ({name: tool.name, description: tool.description, input_schema: tool.parameters, strict: true}))} : {})}};
}

/** One streaming request; retries belong to the durable stage budget, never hidden in the adapter. */
export async function streamModel({provider, secret, ...input}, {fetchImpl = fetch, timeoutMs = 600000, onText = () => {}} = {}) {
  if (!secret) throw Error('MODEL_SECRET_MISSING');
  const request = providerRequest({provider, ...input}), started = performance.now();
  const response = await fetchImpl(provider.baseUrl.replace(/\/$/, '') + request.path, {method: 'POST', signal: AbortSignal.timeout(timeoutMs),
    headers: {'content-type': 'application/json', ...(provider.kind === 'anthropic'
      ? {'x-api-key': secret, 'anthropic-version': '2023-06-01'} : {authorization: 'Bearer ' + secret})}, body: canonical(request.body)});
  if (!response.ok || !response.body) throw Object.assign(Error('MODEL_REQUEST_FAILED'), {status: response.status});
  let buffer = '', received = 0, text = '', usage = null, firstTokenMs = null, finished = false;
  const toolCalls = new Map(), decoder = new TextDecoder('utf-8', {fatal: true});
  const emit = delta => { if (!delta) return; firstTokenMs ??= Math.round(performance.now() - started); text += delta; onText(delta); };
  const event = raw => {
    if (raw === '[DONE]') { finished = true; return; }
    const data = parseCanonicalJson(raw);
    if (provider.kind === 'openai-compatible') {
      if (data.usage) usage = data.usage;
      for (const choice of data.choices ?? []) {
        if (choice.finish_reason === 'length') throw Error('MODEL_OUTPUT_TRUNCATED');
        if (choice.finish_reason && !['stop', 'tool_calls'].includes(choice.finish_reason)) throw Error('MODEL_OUTPUT_REFUSED');
        emit(choice.delta?.content ?? '');
        for (const tool of choice.delta?.tool_calls ?? []) {
          const value = toolCalls.get(tool.index) ?? {id: tool.id, name: '', arguments: ''};
          value.name += tool.function?.name ?? ''; value.arguments += tool.function?.arguments ?? ''; toolCalls.set(tool.index, value);
          firstTokenMs ??= Math.round(performance.now() - started);
        }
      }
    } else {
      if (data.type === 'error') throw Error('MODEL_STREAM_FAILED');
      if (data.type === 'message_start') usage = {...data.message.usage};
      if (data.type === 'content_block_start' && data.content_block.type === 'tool_use') {
        toolCalls.set(data.index, {id: data.content_block.id, name: data.content_block.name, arguments: ''});
        firstTokenMs ??= Math.round(performance.now() - started);
      }
      if (data.type === 'content_block_delta') {
        if (data.delta.type === 'text_delta') emit(data.delta.text);
        if (data.delta.type === 'input_json_delta') { const tool = toolCalls.get(data.index); if (!tool) throw Error('MODEL_TOOL_STREAM_INVALID'); tool.arguments += data.delta.partial_json; }
      }
      if (data.type === 'message_delta') {
        usage = {...usage, ...data.usage};
        if (data.delta?.stop_reason === 'max_tokens') throw Error('MODEL_OUTPUT_TRUNCATED');
        if (data.delta?.stop_reason && !['end_turn', 'tool_use'].includes(data.delta.stop_reason)) throw Error('MODEL_OUTPUT_REFUSED');
      }
      if (data.type === 'message_stop') finished = true;
    }
  };
  const reader = response.body.getReader();
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      received += value.byteLength; if (received > 16 << 20) throw Error('MODEL_RESPONSE_TOO_LARGE');
      buffer += decoder.decode(value, {stream: true});
      for (;;) { const lineEnd = buffer.indexOf('\n'); if (lineEnd < 0) break;
        const line = buffer.slice(0, lineEnd).replace(/\r$/, ''); buffer = buffer.slice(lineEnd + 1);
        // These provider protocols emit one JSON data line per SSE event; other SSE fields are metadata.
        if (line.startsWith('data:')) event(line.slice(5).trimStart());
      }
    }
    buffer += decoder.decode();
    if (buffer.startsWith('data:')) event(buffer.slice(5).trim());
    if (!finished) throw Error('MODEL_STREAM_INCOMPLETE');
    return {text, toolCalls: [...toolCalls.values()].map(tool => ({...tool, input: parseCanonicalJson(tool.arguments || '{}')})),
      usage, firstTokenMs, totalMs: Math.round(performance.now() - started)};
  } finally { await reader.cancel(); }
}
