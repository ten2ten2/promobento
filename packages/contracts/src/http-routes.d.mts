export interface ApiRoute {
  readonly id: string;
  readonly path: string;
  readonly kind: 'api';
  readonly method: string;
  readonly auth: string;
  readonly indexing: 'noindex';
}
export type ApiRouteMatch = {kind: 'match'; route: ApiRoute; params: Record<string, string>}
  | {kind: 'method-not-allowed'; allow: string[]} | {kind: 'not-found'};
export const customerApiRoutes: readonly ApiRoute[];
export const implementedApiRouteIds: ReadonlySet<string>;
export const implementedPageRouteIds: ReadonlySet<string>;
export const implementedResourceRouteIds: ReadonlySet<string>;
export function matchApiRoute(path: string, method: string, implementedIds?: ReadonlySet<string>): ApiRouteMatch;
export function correlationIdFor(request: Request): string;
export {apiError} from './api-errors.mjs';
export type {PublicApiErrorCode} from './api-errors.mjs';
