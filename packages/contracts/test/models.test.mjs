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
    {input_tokens: 1000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 3000, output_tokens: 500}, providers());
  assert.equal(cost.usdMicros, 24600);
});

test('missing usage reserves the worst case: all input uncached, output at its cap', () => {
  const cost = modelCallCostMicros('modelswitch/claude-opus-5-5', {prompt_tokens: 1000}, providers(), {maxOutputTokens: 4000});
  assert.equal(cost.estimated, true);
  assert.equal(cost.usdMicros, Math.ceil((1000 * 2.6 + 4000 * 13) / 6.6863));
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
