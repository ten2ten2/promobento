// Model configuration rules and per-call cost. Pricing is per provider (USD or CNY credits) and every
// cost lands in the ledger as USD micros, rounded up, together with the catalog version.

/** What each director step needs from its bound model (cloud motion plan §6.11). */
export const STEP_REQUIREMENTS = Object.freeze({
  facts: [], assets: ['vision'], directions: [], spec: [],
  scenes: ['vision', 'tools'], review: ['vision', 'tools'], coldReview: ['vision'], triage: []
});

/** Cross-file checks for config/model-providers.json, config/model-authorization.json and agent-policy cost. */
export function modelConfigErrors(providers, authorization, policy, {requireVerified = true} = {}) {
  const errors = [];
  const catalog = providers.catalogVersion;
  if (authorization.catalogVersion !== catalog) errors.push('Authorization catalogVersion differs from model-providers.json');
  if (policy?.cost?.catalogVersion !== catalog) errors.push('agent-policy cost.catalogVersion differs from model-providers.json');
  for (const [ref, model] of Object.entries(providers.models)) {
    const provider = providers.providers[ref.split('/')[0]];
    if (!provider) { errors.push(`Model ${ref} names an unknown provider`); continue; }
    if (provider.currency !== 'USD' && !(provider.usdRate > 0)) errors.push(`Provider of ${ref} needs usdRate for ${provider.currency}`);
    if ((requireVerified || policy?.enabled) && !model.capabilities.verified && Object.values(providers.steps).includes(ref)) errors.push(`Bound model ${ref} is not verified`);
  }
  const authorized = new Set(authorization.models);
  for (const [step, ref] of Object.entries(providers.steps)) {
    const model = providers.models[ref];
    if (!model) { errors.push(`Step ${step} binds unregistered model ${ref}`); continue; }
    for (const need of STEP_REQUIREMENTS[step] ?? []) if (model.capabilities[need] !== true) errors.push(`Step ${step} needs ${need}, which ${ref} lacks`);
    if (!authorized.has(ref)) errors.push(`Step ${step} binds unauthorized model ${ref}`);
  }
  if (Date.parse(authorization.expiresAt) <= Date.parse(authorization.approvedAt)) errors.push('Authorization expires before it was approved');
  return errors;
}

const ceilDiv = (a, b) => (a + b - 1n) / b;

/**
 * Cost of one call in USD micros. usage uses the provider's field names; missing fields fall back to
 * the worst case (all input uncached, output at maxOutputTokens) so unknown usage is never cheaper.
 */
export function modelCallCostMicros(ref, usage, providers, {maxOutputTokens = 0} = {}) {
  const model = providers.models[ref], provider = providers.providers[ref.split('/')[0]];
  if (!model || !provider) throw Error('MODEL_UNKNOWN: ' + ref);
  const p = model.prices, n = value => BigInt(Number.isSafeInteger(value) && value >= 0 ? value : 0);
  let units;
  if (provider.kind === 'anthropic') {
    const write5m = usage?.cache_creation?.ephemeral_5m_input_tokens ?? usage?.cache_creation_input_tokens;
    const write1h = usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const known = usage && Number.isSafeInteger(usage.input_tokens) && Number.isSafeInteger(usage.output_tokens);
    units = known
      ? n(usage.input_tokens) * BigInt(p.input) + n(write5m) * BigInt(p.cacheWrite5m ?? p.input) + n(write1h) * BigInt(p.cacheWrite1h ?? p.input)
        + n(usage.cache_read_input_tokens) * BigInt(p.cacheRead ?? p.input) + n(usage.output_tokens) * BigInt(p.output)
      : null;
  } else {
    const known = usage && Number.isSafeInteger(usage.prompt_tokens) && Number.isSafeInteger(usage.completion_tokens);
    const cached = Math.min(usage?.prompt_tokens_details?.cached_tokens ?? 0, usage?.prompt_tokens ?? 0);
    units = known
      ? n(usage.prompt_tokens - cached) * BigInt(p.input) + n(cached) * BigInt(p.cacheRead ?? p.input) + n(usage.completion_tokens) * BigInt(p.output)
      : null;
  }
  const estimated = units === null;
  if (estimated) {
    const input = usage?.input_tokens ?? usage?.prompt_tokens ?? 0;
    units = n(input) * BigInt(p.input) + n(maxOutputTokens) * BigInt(p.output);
  }
  // prices are micros per million tokens: units / 1e6 = micros in the provider currency
  let micros = ceilDiv(units, 1000000n);
  if (provider.currency !== 'USD') {
    const rate = BigInt(Math.round(provider.usdRate * 1e6));
    micros = ceilDiv(micros * 1000000n, rate);
  }
  return {usdMicros: Number(micros), catalogVersion: providers.catalogVersion, currency: provider.currency, estimated};
}

/** Preserve the original currency/rate/prices with a reported-usage quote; unknown usage stays null. */
export function modelUsageQuote(ref,usage,providers){
 const cost=modelCallCostMicros(ref,usage,providers);if(cost.estimated)return null;
 const name=ref.split('/')[0],provider=providers.providers[name];
 const original=modelCallCostMicros(ref,usage,{...providers,providers:{...providers.providers,[name]:{...provider,currency:'USD'}}});
 return{usdMicros:cost.usdMicros,currencyMicros:original.usdMicros,currency:provider.currency,usdRate:provider.currency==='USD'?1:provider.usdRate,
  catalogVersion:providers.catalogVersion,prices:{...providers.models[ref].prices}};
}
