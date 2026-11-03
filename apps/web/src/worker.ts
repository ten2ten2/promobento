import { apiError, correlationIdFor } from '@promobento/contracts/http-routes';
import { handleApiRequest, type GatewayEnv } from './gateway.ts';
import { publicPages } from './public-routes.ts';
import { resourceHandlerFor } from './resources.ts';
import { responseForMethod } from './responses.ts';

interface AssetsBinding { fetch(request: Request): Promise<Response>; }
export interface WebEnv extends GatewayEnv { ASSETS: AssetsBinding; }
export type PageHandler = (request: Request) => Promise<Response>;

const publicBrandAssets = new Set(['mark.svg', 'mark-dark.svg', 'mark-white.svg',
  'app-icon.svg', 'icon-maskable.svg', 'og-image.svg']);
const publicRootAssets = new Set(['icon.svg', 'icon-192.png', 'icon-512.png',
  'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon.ico', 'og-image.png', 'manifest.webmanifest']);

function isPublicAsset(path: string): boolean {
  return path.startsWith('/assets/') && !path.endsWith('/')
    || path.startsWith('/brand/') && publicBrandAssets.has(path.slice('/brand/'.length))
    || publicRootAssets.has(path.slice(1));
}

export function createWebWorker(renderPage: PageHandler) {
  async function dispatch(request: Request, env: WebEnv): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (path === '/api' || path.startsWith('/api/')) return handleApiRequest(request, env);
      const correlationId = correlationIdFor(request);
      const isPage = publicPages.some((page) => page.path === path);
      const resourceHandler = resourceHandlerFor(path);
      if ((isPage || resourceHandler) && request.method !== 'GET' && request.method !== 'HEAD') {
        return apiError('METHOD_NOT_ALLOWED', 405, correlationId, { allow: 'GET, HEAD' });
      }
      if (resourceHandler) return resourceHandler(request);
      // Only these build-controlled asset namespaces are served. A future static
      // file must never shadow /api, auth, admin, private projects or internal APIs.
      if (isPublicAsset(path)) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return apiError('METHOD_NOT_ALLOWED', 405, correlationId, { allow: 'GET, HEAD' });
        }
        if (!env.ASSETS) return apiError('SERVICE_UNAVAILABLE', 503, correlationId);
        return env.ASSETS.fetch(request);
      }
      // React Router's catch-all supplies the document 404. It cannot forward to
      // Core, and no login, application or internal route is registered here.
      if (!isPage && request.method !== 'GET' && request.method !== 'HEAD') {
        return apiError('NOT_FOUND', 404, correlationId);
      }
      try {
        const response = await renderPage(request);
        const headers = new Headers(response.headers);
        headers.set('cache-control', 'private, no-store');
        headers.set('x-request-id', correlationId);
        headers.set('x-content-type-options', 'nosniff');
        headers.set('x-robots-tag', 'noindex, nofollow');
        headers.set('referrer-policy', 'strict-origin-when-cross-origin');
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch {
        return apiError('INTERNAL_ERROR', 500, correlationId);
      }
  }
  return {
    async fetch(request: Request, env: WebEnv): Promise<Response> {
      return responseForMethod(request, await dispatch(request, env));
    },
  };
}
