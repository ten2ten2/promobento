// Model configuration rules and per-call cost. Pricing is per provider (USD or CNY credits) and every
// cost lands in the ledger as USD micros, rounded up, together with the catalog version.

/** Default image-input requirements; modelConfigErrors resolves an explicit native-author input mode. */
export const STEP_REQUIREMENTS = Object.freeze({
  facts: [], assets: ['vision'], reference: ['vision'], directions: [], treatment: ['tools'],
  author: ['vision', 'tools'], review: ['vision', 'tools'], coldReview: ['vision','tools']
});

/** Cross-file checks for config/model-providers.json, config/model-authorization.json and agent-policy cost. */
export function modelConfigErrors(providers, authorization, policy, {requireVerified = true} = {}) {
  const errors = [];
  const authorInputMode=policy?.director?.steps?.author?.inputMode??'images';
  if(!['images','asset-insights'].includes(authorInputMode))errors.push('Unknown author inputMode');
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
    for (const need of STEP_REQUIREMENTS[step] ?? []) {
      // Text-only coding is an explicit mode fed by the image-analysis stage, not a vision claim.
      if(step==='author'&&need==='vision'&&authorInputMode==='asset-insights')continue;
      if(model.capabilities[need]!==true)errors.push(`Step ${step} needs ${need}, which ${ref} lacks`);
    }
    if (!authorized.has(ref)) errors.push(`Step ${step} binds unauthorized model ${ref}`);
  }
  if (Date.parse(authorization.expiresAt) <= Date.parse(authorization.approvedAt)) errors.push('Authorization expires before it was approved');
  return errors;
}

const ceilDiv = (a, b) => (a + b - 1n) / b;
const tokenCount = value => Number.isSafeInteger(value) && value >= 0;
const optionalToken = (record, key) => record === undefined || !Object.hasOwn(record, key) || tokenCount(record[key]);
const breakdown = value => value === undefined || (value !== null && typeof value === 'object' && !Array.isArray(value));

/**
 * Cost of one call in USD micros. usage uses the provider's field names; missing fields fall back to
 * the worst case (all input at the highest input/cache-write price, output at maxOutputTokens).
 * An ambiguous cache-write price or inconsistent breakdown is never a settled quote.
 */
export function modelCallCostMicros(ref, usage, providers, {maxOutputTokens = 0} = {}) {
  const model = providers.models[ref], provider = providers.providers[ref.split('/')[0]];
  if (!model || !provider) throw Error('MODEL_UNKNOWN: ' + ref);
  const p = model.prices, n = value => BigInt(tokenCount(value) ? value : 0);
  const unspecifiedWritePrice = p.cacheWrite ?? (p.cacheWrite5m !== undefined && p.cacheWrite5m === p.cacheWrite1h ? p.cacheWrite5m : null);
  let units;
  if (provider.kind === 'anthropic') {
    const cache = usage?.cache_creation;
    const aggregate = usage?.cache_creation_input_tokens;
    const hasTtlBreakdown = cache?.ephemeral_5m_input_tokens !== undefined || cache?.ephemeral_1h_input_tokens !== undefined;
    const write1h = cache?.ephemeral_1h_input_tokens ?? (aggregate !== undefined && cache?.ephemeral_5m_input_tokens !== undefined
      ? aggregate - cache.ephemeral_5m_input_tokens : 0);
    const write5m = cache?.ephemeral_5m_input_tokens ?? (aggregate !== undefined ? aggregate - write1h : 0);
    const known = tokenCount(usage?.input_tokens) && tokenCount(usage?.output_tokens)
      && breakdown(cache) && optionalToken(cache, 'ephemeral_5m_input_tokens')
      && optionalToken(cache, 'ephemeral_1h_input_tokens')
      && optionalToken(usage, 'cache_creation_input_tokens') && optionalToken(usage, 'cache_read_input_tokens')
      && tokenCount(write5m) && tokenCount(write1h) && Number.isSafeInteger(write5m + write1h)
      && (aggregate === undefined || aggregate === write5m + write1h)
      && (!aggregate || hasTtlBreakdown || unspecifiedWritePrice !== null);
    units = known
      ? n(usage.input_tokens) * BigInt(p.input)
        + n(write5m) * BigInt(hasTtlBreakdown ? p.cacheWrite5m ?? p.cacheWrite ?? p.input : unspecifiedWritePrice ?? p.input)
        + n(write1h) * BigInt(p.cacheWrite1h ?? p.cacheWrite ?? p.input)
        + n(usage.cache_read_input_tokens) * BigInt(p.cacheRead ?? p.input) + n(usage.output_tokens) * BigInt(p.output)
      : null;
  } else {
    const details = usage?.prompt_tokens_details;
    const cached = details?.cached_tokens ?? 0, created = details?.cache_creation_tokens ?? 0;
    // Compatible gateways may report cache writes without a TTL. Only a single,
    // unambiguous catalog price can settle those tokens; otherwise keep the reservation.
    const writePrice = unspecifiedWritePrice;
    const known = tokenCount(usage?.prompt_tokens) && tokenCount(usage?.completion_tokens)
      && breakdown(details) && optionalToken(details, 'cached_tokens') && optionalToken(details, 'cache_creation_tokens')
      && tokenCount(cached + created) && cached + created <= usage.prompt_tokens && (!created || writePrice !== null);
    units = known
      ? n(usage.prompt_tokens - cached - created) * BigInt(p.input) + n(cached) * BigInt(p.cacheRead ?? p.input)
        + n(created) * BigInt(writePrice ?? p.input) + n(usage.completion_tokens) * BigInt(p.output)
      : null;
  }
  const estimated = units === null;
  if (estimated) {
    const max = (left, right) => left > right ? left : right;
    const input = provider.kind === 'anthropic'
      ? n(usage?.input_tokens) + max(n(usage?.cache_creation_input_tokens), n(usage?.cache_creation?.ephemeral_5m_input_tokens) + n(usage?.cache_creation?.ephemeral_1h_input_tokens)) + n(usage?.cache_read_input_tokens)
      : max(n(usage?.prompt_tokens), n(usage?.prompt_tokens_details?.cached_tokens) + n(usage?.prompt_tokens_details?.cache_creation_tokens));
    const output = max(n(maxOutputTokens), n(provider.kind === 'anthropic' ? usage?.output_tokens : usage?.completion_tokens));
    const inputPrice = Math.max(p.input, p.cacheRead ?? 0, p.cacheWrite ?? 0, p.cacheWrite5m ?? 0, p.cacheWrite1h ?? 0);
    units = input * BigInt(inputPrice) + output * BigInt(p.output);
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
