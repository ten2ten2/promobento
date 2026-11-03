import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSchemaValidator, parseCanonicalJson, modelConfigErrors, modelCallCostMicros, modelUsageQuote } from '../index.mjs';

const read = path => parseCanonicalJson(readFileSync(new URL('../../../' + path, import.meta.url)));
const providers = () => read('config/model-providers.json');
const authorization = () => read('config/model-authorization.json');
const policy = read('config/agent-policy.json');

test('gateway bindings use the existing shared key and keep unbound official models unverified', () => {
  const validate = createSchemaValidator(read('contracts/model-config.schema.json'));
  assert.deepEqual(validate(providers()), []);
  assert.deepEqual(validate(authorization()), []);
  assert.deepEqual(modelConfigErrors(providers(), authorization(), policy,{requireVerified:false}), []);
  assert.deepEqual(modelConfigErrors(providers(), authorization(), policy),[]);
  assert.deepEqual(modelConfigErrors(providers(), authorization(), {...policy,enabled:true},{requireVerified:false}),[]);
  const config=providers();assert.equal(config.steps.treatment,'modelswitch/claude-opus-5-5');assert.equal(config.steps.coldReview,'modelswitch/deepseek-v4.1-flash-1017');
  assert.ok(Object.values(config.steps).every(ref=>config.providers[ref.split('/')[0]].secret==='MODEL_COMPAT_API_KEY'));
  assert.equal(config.models['anthropic/claude-opus-5-5'].capabilities.verified,false);assert.equal(config.models['anthropic/claude-sonnet-5-5'].capabilities.verified,false);
  config.steps.coldReview='anthropic/claude-sonnet-5-5';assert.deepEqual(modelConfigErrors(config,authorization(),policy),['Bound model anthropic/claude-sonnet-5-5 is not verified']);
});

test('a vision step cannot bind gateway Claude after the image-loss probe', () => {
  const config = providers(); config.steps.author = 'modelswitch/claude-sonnet-5-5';
  const imagePolicy=structuredClone(policy);delete imagePolicy.director.steps.author.inputMode;
  assert.deepEqual(modelConfigErrors(config, authorization(), imagePolicy,{requireVerified:false}), ['Step author needs vision, which modelswitch/claude-sonnet-5-5 lacks']);
  assert.deepEqual(modelConfigErrors(config,authorization(),policy),[]);
  config.steps.assets='modelswitch/claude-sonnet-5-5';assert.ok(modelConfigErrors(config,authorization(),policy).some(error=>error.startsWith('Step assets needs vision')));
  config.steps.reference='modelswitch/claude-sonnet-5-5';
  assert.ok(modelConfigErrors(config,authorization(),policy).includes('Step reference needs vision, which modelswitch/claude-sonnet-5-5 lacks'));
  const invalid=structuredClone(policy);invalid.director.steps.author.inputMode='automatic-fallback';assert.ok(modelConfigErrors(providers(),authorization(),invalid).includes('Unknown author inputMode'));
});

test('unverified, unauthorized or unpriced models are refused', () => {
  const unverified = providers(); unverified.models['modelswitch/deepseek-v4.1-flash-1017'].capabilities.verified = false;
  assert.ok(modelConfigErrors(unverified, authorization(), policy).includes('Bound model modelswitch/deepseek-v4.1-flash-1017 is not verified'));
  const auth = authorization(); auth.models = auth.models.filter(ref => ref !== 'modelswitch/claude-opus-5-5');
  assert.deepEqual(modelConfigErrors(providers(), auth, policy,{requireVerified:false}), ['Step treatment binds unauthorized model modelswitch/claude-opus-5-5','Step script binds unauthorized model modelswitch/claude-opus-5-5','Step author binds unauthorized model modelswitch/claude-opus-5-5']);
  const unknown = providers(); unknown.steps.facts = 'modelswitch/unknown-model';
  assert.deepEqual(modelConfigErrors(unknown, authorization(), policy,{requireVerified:false}), ['Step facts binds unregistered model modelswitch/unknown-model']);
  const drift = authorization(); drift.catalogVersion = 'models-2026-01-01';
  assert.ok(modelConfigErrors(providers(), drift, policy).includes('Authorization catalogVersion differs from model-providers.json'));
});

test('OpenAI-compatible usage is priced in CNY credits and converted to USD micros, rounding up', () => {
  // 10k prompt tokens (4k cached) + 2k completion on DeepSeek: 6000*0.5 + 4000*0.01 + 2000*2 = 7040 credit-micros.
  const cost = modelCallCostMicros('modelswitch/deepseek-v4.1-flash-1017',
    {prompt_tokens: 10000, completion_tokens: 2000, prompt_tokens_details: {cached_tokens: 4000}}, providers());
  assert.equal(cost.usdMicros, Math.ceil(7040 / 6.6863));
  assert.equal(cost.currency, 'CNY');
  assert.equal(cost.estimated, false);
});

test('Anthropic usage uses five price classes', () => {
  // 1000 input*4 + 2000 5m-write*5 + 3000 read*0.2 + 500 output*20 = 4000+10000+600+10000 = 24600 USD micros.
  const cost = modelCallCostMicros('anthropic/claude-opus-5-5',
    {input_tokens: 1000, cache_creation_input_tokens: 2000, cache_creation: {ephemeral_5m_input_tokens: 2000, ephemeral_1h_input_tokens: 0}, cache_read_input_tokens: 3000, output_tokens: 500}, providers());
  assert.equal(cost.usdMicros, 24600);
});

test('missing usage reserves the worst input/cache-write price and output at its cap', () => {
  const cost = modelCallCostMicros('modelswitch/claude-opus-5-5', {prompt_tokens: 1000}, providers(), {maxOutputTokens: 4000});
  assert.equal(cost.estimated, true);
  assert.equal(cost.usdMicros, Math.ceil((1000 * 5.2 + 4000 * 13) / 6.6863));
});

test('cost calculations refuse unrepresentable currency rates and unsafe integer estimates', () => {
  const config = providers(), ref = 'modelswitch/deepseek-v4.1-flash-1017';
  for (const rate of [0.0000001, 1e12]) {
    config.providers.modelswitch.usdRate = rate;
    assert.ok(modelConfigErrors(config, authorization(), policy).some(error => error.includes('representable usdRate')));
    assert.throws(() => modelCallCostMicros(ref, {prompt_tokens: 1, completion_tokens: 0}, config), /MODEL_RATE_INVALID/);
    assert.throws(() => modelUsageQuote(ref, {prompt_tokens: 1, completion_tokens: 0}, config), /MODEL_RATE_INVALID/);
  }
  const huge = structuredClone(config);
  huge.providers.modelswitch.usdRate = 1;
  huge.models[ref].prices.input = 10000000;
  assert.throws(() => modelCallCostMicros(ref, {prompt_tokens: Number.MAX_SAFE_INTEGER}, huge), /MODEL_COST_OVERFLOW/);
});

test('reported usage overflow in USD or the original currency remains an unknown quote', () => {
  const config = providers(), usage = {prompt_tokens: 9e15, completion_tokens: 9e15};
  const ref = 'modelswitch/deepseek-v4.1-flash-1017';
  assert.equal(Number.isSafeInteger(modelCallCostMicros(ref, usage, config).usdMicros), true, 'USD fits while the original CNY amount overflows');
  const inOriginalCurrency = structuredClone(config); inOriginalCurrency.providers.modelswitch.currency = 'USD';
  assert.throws(() => modelCallCostMicros(ref, usage, inOriginalCurrency), /MODEL_COST_OVERFLOW/);
  for (const model of ['modelswitch/claude-opus-5-5', 'modelswitch/claude-sonnet-5-5']) {
    assert.throws(() => modelCallCostMicros(model, usage, config), /MODEL_COST_OVERFLOW/);
  }
  for (const model of Object.keys(config.models)) {
    const anthropic = model.startsWith('anthropic/');
    assert.equal(modelUsageQuote(model, anthropic ? {input_tokens: 9e15, output_tokens: 9e15} : usage, config), null);
    assert.equal(modelUsageQuote(model, anthropic ? {input_tokens: 1e17, output_tokens: 1e17} : {prompt_tokens: 1e17, completion_tokens: 1e17}, config), null);
  }
  assert.throws(() => modelUsageQuote('modelswitch/unknown-model', usage, config), /MODEL_UNKNOWN/);
});

test('gateway cache writes with an unknown TTL retain unknown usage instead of an input-price settlement', () => {
  const config = providers(), ref = 'modelswitch/claude-opus-5-5';
  const report = read('docs/evidence/2026-10-23-model-probe/run4.json');
  const usage = report.models['claude-opus-5-5'].stream.usage;
  assert.equal(usage.prompt_tokens_details.cache_creation_tokens, 105256);
  assert.equal(modelUsageQuote(ref, usage, config), null);
  assert.equal(modelCallCostMicros(ref, usage, config).estimated, true);
  assert.equal(modelCallCostMicros(ref, usage, config).usdMicros,
    Math.ceil(Math.ceil(usage.prompt_tokens * 5.2 + usage.completion_tokens * 13) / 6.6863), 'unknown TTL does not discard reported output tokens');
  const reserved = modelCallCostMicros(ref, {prompt_tokens: usage.prompt_tokens}, config, {maxOutputTokens: 64});
  assert.equal(reserved.estimated, true);
  assert.equal(reserved.usdMicros, Math.ceil(Math.ceil(usage.prompt_tokens * 5.2 + 64 * 13) / 6.6863));
  const singlePrice = structuredClone(config);
  singlePrice.models[ref].prices.cacheWrite = 3250000;
  const quoted = modelUsageQuote(ref, usage, singlePrice);
  assert.equal(quoted.currencyMicros, Math.ceil((usage.prompt_tokens - 105256) * 2.6 + 105256 * 3.25 + usage.completion_tokens * 13));
  assert.ok(quoted.usdMicros > modelUsageQuote(ref, {...usage, prompt_tokens_details: {}}, config).usdMicros);
});

test('Anthropic aggregate cache writes and TTL breakdowns must describe the same tokens', () => {
  const config = providers(), ref = 'anthropic/claude-opus-5-5';
  const usage = {input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 70,
    cache_creation: {ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 40}};
  assert.equal(modelUsageQuote(ref, usage, config).usdMicros, 1270);
  for (const field of ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens']) {
    const partial = structuredClone(usage); delete partial.cache_creation[field];
    assert.equal(modelUsageQuote(ref, partial, config).usdMicros, 1270);
  }
  assert.equal(modelUsageQuote(ref, {...usage, cache_creation_input_tokens: 69}, config), null);
  assert.equal(modelUsageQuote(ref, {...usage, cache_creation_input_tokens: 29, cache_creation: {ephemeral_5m_input_tokens: 30}}, config), null);
  const withoutTtl = {...usage}; delete withoutTtl.cache_creation;
  assert.equal(modelUsageQuote(ref, withoutTtl, config), null, 'the adapter can request 1h caching; aggregate-only usage does not prove the cheaper 5m price');
  const reservation = modelCallCostMicros(ref, {input_tokens: 100}, config, {maxOutputTokens: 20});
  assert.equal(reservation.estimated, true); assert.equal(reservation.usdMicros, 1200);
});

test('malformed token counters and cache breakdowns cannot become a settled zero-cost receipt', () => {
  const config = providers(), compatible = 'modelswitch/deepseek-v4.1-flash-1017';
  const valid = {prompt_tokens: 10000, completion_tokens: 20, prompt_tokens_details: {cached_tokens: 4000}};
  assert.ok(modelUsageQuote(compatible, valid, config));
  for (const usage of [
    {...valid, prompt_tokens: -1},
    {...valid, completion_tokens: -1},
    {...valid, prompt_tokens_details: {cached_tokens: 0.5}},
    {...valid, prompt_tokens_details: {cached_tokens: '4000'}},
    {...valid, prompt_tokens_details: {cached_tokens: -1}},
    {...valid, prompt_tokens_details: {cached_tokens: 10001}},
    {...valid, prompt_tokens_details: {cache_creation_tokens: -1}},
    {...valid, prompt_tokens_details: {cache_creation_tokens: '1'}},
    {...valid, prompt_tokens_details: {cached_tokens: 9000, cache_creation_tokens: 2000}},
    {...valid, prompt_tokens_details: 'malformed'},
  ]) {
    assert.equal(modelCallCostMicros(compatible, usage, config).estimated, true);
    assert.equal(modelUsageQuote(compatible, usage, config), null);
  }
  const anthropic = 'anthropic/claude-opus-5-5';
  const reported = {input_tokens: 1000, output_tokens: 20, cache_creation: {ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 40}, cache_read_input_tokens: 50};
  assert.ok(modelUsageQuote(anthropic, reported, config));
  for (const usage of [
    {...reported, input_tokens: -1},
    {...reported, output_tokens: -1},
    {...reported, cache_creation: {ephemeral_5m_input_tokens: 0.5}},
    {...reported, cache_creation: {ephemeral_1h_input_tokens: '40'}},
    {...reported, cache_creation: []},
    {...reported, cache_read_input_tokens: '50'},
    {...reported, cache_creation_input_tokens: -1},
  ]) {
    assert.equal(modelCallCostMicros(anthropic, usage, config).estimated, true);
    assert.equal(modelUsageQuote(anthropic, usage, config), null);
  }
});
