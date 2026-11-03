import routeConfig from '../../../config/routes.json' with {type: 'json'};
import implemented from '../../../config/implemented-routes.json' with {type: 'json'};
export {apiError} from './api-errors.mjs';

// routes.json is the product plan. Only this explicit subset is reachable.
export const customerApiRoutes = Object.freeze(routeConfig.routes
  .filter(route => route.kind === 'api').map(route => Object.freeze({...route})));
export const implementedApiRouteIds = new Set(implemented.api);
export const implementedPageRouteIds = new Set(implemented.pages);
export const implementedResourceRouteIds = new Set(implemented.resources);

/** Exact path/method matching, with no wildcard or internal-service fallback. */
export function matchApiRoute(path, method, implementedIds = implementedApiRouteIds) {
  if (typeof path !== 'string' || !path.startsWith('/api/') || path.length > 4096
    || /[\\?#\u0000-\u0020\u007f]/.test(path)) return {kind: 'not-found'};
  const incoming = path.split('/');
  const matches = [];
  for (const route of customerApiRoutes) {
    if (!implementedIds.has(route.id)) continue;
    const parts = route.path.split('/');
    if (parts.length !== incoming.length) continue;
    const params = Object.create(null);
    let valid = true;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index], raw = incoming[index];
      if (!part.startsWith(':')) {
        if (part !== raw) {valid = false; break;}
        continue;
      }
      let value;
      try {value = decodeURIComponent(raw);} catch {valid = false; break;}
      // IDs are one opaque segment. Prevent a second decode or a downstream URL
      // parser from turning the matched segment into another route.
      if (!value || value.length > 256 || value === '.' || value === '..'
        || /[/\\%?#\u0000-\u0020\u007f]/.test(value)) {valid = false; break;}
      params[part.slice(1)] = value;
    }
    if (valid) matches.push({route, params});
  }
  if (!matches.length) return {kind: 'not-found'};
  // Literal paths win over a parameter path even if the literal only accepts
  // another method, so future /api/projects/search cannot become projectId.
  const specificity = route => route.path.split('/').filter(part => !part.startsWith(':')).length;
  const score = Math.max(...matches.map(match => specificity(match.route)));
  const candidates = matches.filter(match => specificity(match.route) === score);
  const match = candidates.find(match => match.route.method === method);
  return match ? {kind: 'match', ...match}
    : {kind: 'method-not-allowed', allow: [...new Set(candidates.map(match => match.route.method))].sort()};
}

/** Trace correlation only. Never use the generated value as a business idempotency key. */
export function correlationIdFor(request) {
  const value = request.headers.get('x-request-id');
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : crypto.randomUUID();
}
