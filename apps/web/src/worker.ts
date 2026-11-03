import { apiError, requestIdFor } from '@promobento/contracts/http-routes';
import { handleApiRequest, type GatewayEnv } from './gateway.ts';
import { publicPages } from './public-routes.ts';
import { resourceHandlerFor } from './resources.ts';
import { responseForMethod } from './responses.ts';

interface AssetsBinding { fetch(request: Request): Promise<Response>; }
export interface WebEnv extends GatewayEnv { ASSETS: AssetsBinding; }
export type PageHandler = (request: Request) => Promise<Response>;

export function createWebWorker(renderPage: PageHandler) {
  async function dispatch(request: Request, env: WebEnv): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (path === '/api' || path.startsWith('/api/')) return handleApiRequest(request, env);
      const requestId = requestIdFor(request);
      const isPage = publicPages.some((page) => page.path === path);
      const resourceHandler = resourceHandlerFor(path);
      if ((isPage || resourceHandler) && request.method !== 'GET' && request.method !== 'HEAD') {
        return apiError('METHOD_NOT_ALLOWED', 405, requestId, { allow: 'GET, HEAD' });
      }
      if (resourceHandler) return resourceHandler(request);
      // Only these build-controlled asset namespaces are served. A future static
      // file must never shadow /api, auth, admin, private projects or internal APIs.
      if (/^\/(?:assets\/|brand\/|(?:icon(?:-192|-512|-maskable-512)?\.(?:svg|png)|apple-touch-icon\.png|favicon\.ico|og-image\.png|manifest\.webmanifest)$)/.test(path)) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return apiError('METHOD_NOT_ALLOWED', 405, requestId, { allow: 'GET, HEAD' });
        }
        if (!env.ASSETS) return apiError('SERVICE_UNAVAILABLE', 503, requestId);
        return env.ASSETS.fetch(request);
      }
      // React Router's catch-all supplies the document 404. It cannot forward to
      // Core, and no login, application or internal route is registered here.
      if (!isPage && request.method !== 'GET' && request.method !== 'HEAD') {
        return apiError('NOT_FOUND', 404, requestId);
      }
      try {
        const response = await renderPage(request);
        const headers = new Headers(response.headers);
        headers.set('cache-control', 'private, no-store');
        headers.set('x-request-id', requestId);
        headers.set('x-content-type-options', 'nosniff');
        headers.set('x-robots-tag', 'noindex, nofollow');
        headers.set('referrer-policy', 'strict-origin-when-cross-origin');
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch {
        return apiError('INTERNAL_ERROR', 500, requestId);
      }
  }
  return {
    async fetch(request: Request, env: WebEnv): Promise<Response> {
      return responseForMethod(request, await dispatch(request, env));
    },
  };
}
