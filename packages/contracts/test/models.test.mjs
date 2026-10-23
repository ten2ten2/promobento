import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSchemaValidator, parseCanonicalJson, modelConfigErrors, modelCallCostMicros } from '../index.mjs';

const read = path => parseCanonicalJson(readFileSync(new URL('../../../' + path, import.meta.url)));
const providers = () => read('config/model-providers.json');
const authorization = () => read('config/model-authorization.json');
const policy = read('config/agent-policy.json');

test('the committed model configuration is valid and every bound model can do its step', () => {
  const validate = createSchemaValidator(read('contracts/model-config.schema.json'));
  assert.deepEqual(validate(providers()), []);
  assert.deepEqual(validate(authorization()), []);
  assert.deepEqual(modelConfigErrors(providers(), authorization(), policy), []);
});

test('a step that needs tools cannot bind a model whose tool calls failed the probe', () => {
  const config = providers(); config.steps.scenes = 'modelswitch/claude-sonnet-5-5';
  assert.deepEqual(modelConfigErrors(config, authorization(), policy), ['Step scenes needs tools, which modelswitch/claude-sonnet-5-5 lacks']);
});

test('unverified, unauthorized or unpriced models are refused', () => {
  const unverified = providers(); unverified.models['modelswitch/deepseek-v4.1-flash-1017'].capabilities.verified = false;
  assert.ok(modelConfigErrors(unverified, authorization(), policy).some(error => error.includes('is not verified')));
  const auth = authorization(); auth.models = auth.models.filter(ref => ref !== 'modelswitch/claude-opus-5-5');
  assert.deepEqual(modelConfigErrors(providers(), auth, policy), ['Step spec binds unauthorized model modelswitch/claude-opus-5-5']);
  const unknown = providers(); unknown.steps.triage = 'modelswitch/unknown-model';
  assert.deepEqual(modelConfigErrors(unknown, authorization(), policy), ['Step triage binds unregistered model modelswitch/unknown-model']);
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
