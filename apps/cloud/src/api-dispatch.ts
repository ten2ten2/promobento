import {apiError, correlationIdFor, customerApiRoutes, implementedApiRouteIds, matchApiRoute,
  type ApiRoute} from '@promobento/contracts/http-routes';
import type {PipelineEnv} from './pipeline-types.ts';
import {GuardedBatchOutcomeUnknown, GuardedBatchPreconditionFailed} from './shared/guarded-batch.ts';
import {IdempotencyConflict} from './shared/idempotency.ts';

export interface ApiContext {
  env: PipelineEnv;
  ctx: ExecutionContext;
  route: ApiRoute;
  params: Readonly<Record<string, string>>;
  /** x-request-id for tracing, NOT the business requestId/Idempotency-Key. */
  correlationId: string;
}
export type ApiHandler = (request: Request, context: ApiContext) => Promise<Response> | Response;

export function createCoreApiHandler(handlers: Readonly<Record<string, ApiHandler>>,
  implementedIds: ReadonlySet<string> = implementedApiRouteIds) {
  const planned = new Set(customerApiRoutes.map(route => route.id));
  if (Object.keys(handlers).length !== implementedIds.size || [...implementedIds].some(id => !planned.has(id)
    || !Object.hasOwn(handlers, id) || typeof handlers[id] !== 'function'))
    throw Error('Customer API registry differs from implemented routes');
  // Snapshot the registry; a request cannot register a route through input data.
  const registered = Object.freeze({...handlers}), enabled = new Set(implementedIds);
  return async (request: Request, env: PipelineEnv, ctx: ExecutionContext): Promise<Response> => {
    const correlationId = correlationIdFor(request);
    try {
      const match = matchApiRoute(new URL(request.url).pathname, request.method, enabled);
      let response: Response;
      if (match.kind === 'not-found') response = apiError('NOT_FOUND', 404, correlationId);
      else if (match.kind === 'method-not-allowed')
        response = apiError('METHOD_NOT_ALLOWED', 405, correlationId, {allow: match.allow.join(', ')});
      else response = await registered[match.route.id]!(request, {env, ctx, route: match.route,
        params: match.params, correlationId});
      const headers = new Headers(response.headers);
      headers.set('cache-control', 'private, no-store');
      headers.set('x-content-type-options', 'nosniff');
      headers.set('x-request-id', correlationId);
      headers.set('x-robots-tag', 'noindex');
      return new Response(request.method === 'HEAD' ? null : response.body,
        {status: response.status, statusText: response.statusText, headers});
    } catch (error) {
      const response = error instanceof IdempotencyConflict
        ? apiError('IDEMPOTENCY_CONFLICT', 409, correlationId)
        : error instanceof GuardedBatchOutcomeUnknown
          ? apiError('OUTCOME_UNKNOWN', 503, correlationId)
          : error instanceof GuardedBatchPreconditionFailed
            ? apiError('PRECONDITION_FAILED', error.status, correlationId, undefined,
              {reason: error.status === 404 ? 'RESOURCE_NOT_FOUND' : error.reason})
            : apiError('INTERNAL_ERROR', 500, correlationId);
      return request.method === 'HEAD' ? new Response(null, response) : response;
    }
  };
}
