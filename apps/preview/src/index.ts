import {apiError} from '@promobento/contracts/api-errors';

type PreviewEnv = { PREVIEW_GATEWAY: Pick<Fetcher, 'fetch'> };

function isolated(response: Response, head: boolean): Response {
  const headers = new Headers(response.headers);
  headers.delete('set-cookie');
  headers.set('cache-control', 'private, no-store');
  headers.set('content-security-policy', "default-src 'none'; sandbox; frame-ancestors 'none'");
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  return new Response(head ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Only the narrow Core entrypoint is reachable; no preview files are enabled in PR1. */
export default {
  async fetch(request: Request, env: PreviewEnv): Promise<Response> {
    const requestId = crypto.randomUUID();
    const head = request.method === 'HEAD';
    if (request.method !== 'GET' && !head)
      return isolated(apiError('METHOD_NOT_ALLOWED', 405, requestId, {'allow': 'GET, HEAD'}), false);

    // Preview capabilities are separate from the app's sessions and review links.
    // Until those capabilities are implemented, the Core gateway rejects every URL.
    const headers = new Headers();
    for (const name of ['accept', 'authorization', 'range', 'if-none-match', 'if-modified-since']) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    headers.set('x-request-id', requestId);
    try {
      const response = await env.PREVIEW_GATEWAY.fetch(new Request(request, {headers, redirect: 'manual'}));
      return isolated(response, head);
    } catch {
      return isolated(apiError('SERVICE_UNAVAILABLE', 503, requestId), head);
    }
  },
};
