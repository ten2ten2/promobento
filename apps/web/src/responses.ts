export function responseForMethod(request: Request, response: Response): Response {
  if (request.method !== 'HEAD') return response;
  void response.body?.cancel().catch(() => {});
  return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
}
