import { apiError, correlationIdFor, implementedApiRouteIds, matchApiRoute } from '@promobento/contracts/http-routes';
import { responseForMethod } from './responses.ts';

export interface CoreApiBinding {
  fetch(request: Request): Promise<Response>;
}

export interface GatewayEnv {
  CORE_API: CoreApiBinding;
}

// Core derives identity and workspace membership itself. Client-supplied identity
// hints and proxy headers must not acquire trust at the service boundary.
export function forwardedHeaders(request: Request, correlationId: string): Headers {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (/^(?:x-(?:promobento|internal|actor|user|workspace|tenant|role|roles|permissions|session)(?:-|$)|x-forwarded-|x-real-ip$|forwarded$)/i.test(name)) {
      headers.delete(name);
    }
  }
  // Hop-by-hop headers have no meaning across a Worker service binding.
  for (const name of ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host']) {
    headers.delete(name);
  }
  headers.set('x-request-id', correlationId);
  return headers;
}

export function createApiGateway(implementedIds: ReadonlySet<string> = implementedApiRouteIds) {
  async function dispatch(request: Request, env: GatewayEnv): Promise<Response> {
    const correlationId = correlationIdFor(request);
    const match = matchApiRoute(new URL(request.url).pathname, request.method, implementedIds);
    if (match.kind === 'not-found') return apiError('NOT_FOUND', 404, correlationId);
    if (match.kind === 'method-not-allowed') {
      return apiError('METHOD_NOT_ALLOWED', 405, correlationId, { allow: match.allow.join(', ') });
    }
    if (!env.CORE_API) return apiError('SERVICE_UNAVAILABLE', 503, correlationId);

    try {
      // Forward the original bytes once. In particular, do not parse webhook JSON,
      // buffer uploads, follow redirects, or retry a mutation after an RPC error.
      const response = await env.CORE_API.fetch(new Request(request, {
        headers: forwardedHeaders(request, correlationId),
        redirect: 'manual',
      }));
      const headers = new Headers(response.headers);
      headers.set('cache-control', 'private, no-store');
      headers.set('x-request-id', correlationId);
      headers.set('x-content-type-options', 'nosniff');
      headers.set('x-robots-tag', 'noindex');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch {
      return apiError('SERVICE_UNAVAILABLE', 503, correlationId);
    }
  }
  return async (request: Request, env: GatewayEnv): Promise<Response> => responseForMethod(request, await dispatch(request, env));
}

export const handleApiRequest = createApiGateway();
