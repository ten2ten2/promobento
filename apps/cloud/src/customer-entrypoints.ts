import {WorkerEntrypoint} from 'cloudflare:workers';
import {apiError, correlationIdFor} from '@promobento/contracts/http-routes';
import {createCoreApiHandler} from './api-dispatch.ts';
import {apiHandlers} from './api-registry.ts';
import type {PipelineEnv} from './pipeline-types.ts';

const customerApi = createCoreApiHandler(apiHandlers);

/** Only apps/web binds this entrypoint; it never delegates to the S1 handler. */
export class CoreApi extends WorkerEntrypoint<PipelineEnv> {
  fetch(request: Request): Promise<Response> {
    return customerApi(request, this.env, this.ctx);
  }
}

/** No preview is authorized until capabilities and manifest checks are built. */
export class PreviewGateway extends WorkerEntrypoint<PipelineEnv> {
  fetch(request: Request): Response {
    const correlationId = correlationIdFor(request);
    const response = request.method === 'GET' || request.method === 'HEAD'
      ? apiError('NOT_FOUND', 404, correlationId)
      : apiError('METHOD_NOT_ALLOWED', 405, correlationId, {allow: 'GET, HEAD'});
    return request.method === 'HEAD' ? new Response(null, response) : response;
  }
}
