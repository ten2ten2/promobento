import routes from '../../../config/routes.json' with { type: 'json' };
import { implementedPageRouteIds } from '@promobento/contracts/http-routes';

export const publicPages = routes.routes.filter((route) => implementedPageRouteIds.has(route.id));

export function publicPath(id: string): string {
  const route = publicPages.find((candidate) => candidate.id === id);
  if (!route || route.kind !== 'page' || route.auth !== 'public' || route.path.includes(':')) {
    throw new Error(`Unimplemented public page: ${id}`);
  }
  return route.path;
}
