import brand from '../../../config/brand.json' with { type: 'json' };
import routes from '../../../config/routes.json' with { type: 'json' };
import { implementedResourceRouteIds } from '@promobento/contracts/http-routes';
import { publicPages } from './public-routes.ts';

function resource(body: string | null, contentType: string): Response {
  return new Response(body, { headers: {
    'content-type': contentType,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'x-robots-tag': 'noindex, nofollow',
  } });
}

export const resourceHandlers: Record<string, (request: Request) => Response> = {
  'seo.robots': (request) => resource(request.method === 'HEAD' ? null : 'User-agent: *\nDisallow: /\n', 'text/plain; charset=utf-8'),
  'seo.sitemap': (request) => {
    const urls = publicPages.map((page) => `<url><loc>${brand.appUrl}${page.path}</loc></url>`).join('');
    return resource(request.method === 'HEAD' ? null : `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, 'application/xml; charset=utf-8');
  },
};

export function resourceHandlerFor(path: string): ((request: Request) => Response) | undefined {
  const route = routes.routes.find((route) => route.path === path && route.kind === 'resource' && implementedResourceRouteIds.has(route.id));
  return route ? resourceHandlers[route.id] : undefined;
}
