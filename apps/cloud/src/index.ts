import { PROTOCOL_VERSION } from './version.ts';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return Response.json({ ok: true, protocol: PROTOCOL_VERSION });
    }
    return new Response('Not found', { status: 404 });
  }
} satisfies ExportedHandler;
