import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiGateway, forwardedHeaders, handleApiRequest } from '../src/gateway.ts';
import { createWebWorker } from '../src/worker.ts';

test('gateway strips spoofed identity/proxy metadata and preserves opaque proofs and edge IP', () => {
  const request = new Request('https://promobento.test/api/projects', { headers: {
    cookie: '__Host-promobento-session=opaque', origin: 'https://promobento.test',
    'x-csrf-token': 'csrf', 'idempotency-key': 'mutation-1',
    'cf-connecting-ip': '198.51.100.20', 'cf-access-jwt-assertion': 'unverified-jwt',
    'x-waffo-signature': 'signature', 'x-promobento-actor': 'owner',
    'x-user-id': 'other-user', 'x-workspace-id': 'other-workspace', 'x-role': 'owner',
    'x-internal-secret': 'secret', 'x-actor-permissions': 'all',
    'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1', forwarded: 'for=127.0.0.1',
    connection: 'keep-alive', 'x-request-id': 'incoming',
  } });
  const headers = forwardedHeaders(request, 'request-1');
  for (const name of ['x-promobento-actor', 'x-user-id', 'x-workspace-id', 'x-role', 'x-internal-secret', 'x-actor-permissions', 'x-forwarded-for', 'x-real-ip', 'forwarded', 'connection']) {
    assert.equal(headers.has(name), false, name);
  }
  for (const name of ['cookie', 'origin', 'x-csrf-token', 'idempotency-key', 'cf-connecting-ip', 'cf-access-jwt-assertion', 'x-waffo-signature']) {
    assert.equal(headers.get(name), request.headers.get(name), name);
  }
  assert.equal(headers.get('x-request-id'), 'request-1');
});

test('only enabled API routes can cross the binding; unsupported methods carry Allow', async () => {
  const gateway = createApiGateway(new Set(['uploads.put_content']));
  let calls = 0;
  const env = { CORE_API: { async fetch() { calls++; throw new Error('must not dispatch'); } } };
  for (const path of ['/internal/health', '/app/projects', '/api/unknown', '/api/auth/session']) {
    const response = await gateway(new Request(`https://promobento.test${path}`), env);
    assert.equal(response.status, 404, path);
    assert.equal((await response.json()).code, 'NOT_FOUND');
  }
  const wrongMethod = await gateway(new Request('https://promobento.test/api/uploads/upload-1/content'), env);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'PUT');
  assert.equal((await wrongMethod.json()).code, 'METHOD_NOT_ALLOWED');
  // The real PR1 registry remains empty even though later routes exist in the PRD.
  assert.equal((await handleApiRequest(new Request('https://promobento.test/api/auth/session'), env)).status, 404);
  assert.equal(calls, 0);
});

test('gateway preserves exact webhook bytes, query, redirects and multiple Set-Cookie headers', async () => {
  const gateway = createApiGateway(new Set(['billing.waffo.webhook']));
  const bytes = new TextEncoder().encode('{  "amount" : 1, "note": "✓" }\n');
  let calls = 0;
  const response = await gateway(new Request('https://promobento.test/api/payments/waffo/webhook?opaque=a%2Fb', {
    method: 'POST', body: bytes, headers: { 'content-type': 'application/json', 'x-request-id': 'hook-1' },
  }), { CORE_API: { async fetch(request) {
    calls++;
    assert.equal(request.url, 'https://promobento.test/api/payments/waffo/webhook?opaque=a%2Fb');
    assert.equal(request.redirect, 'manual');
    assert.deepEqual(new Uint8Array(await request.arrayBuffer()), bytes);
    const headers = new Headers({ location: '/help' });
    headers.append('set-cookie', 'first=1; Path=/; Secure; HttpOnly');
    headers.append('set-cookie', 'second=2; Path=/; Secure; HttpOnly');
    return new Response('redirect body', { status: 307, headers });
  } } });
  assert.equal(calls, 1);
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), '/help');
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-request-id'), 'hook-1');
  assert.equal(await response.text(), 'redirect body');
});

test('RPC failure is sanitized without retrying a potentially committed mutation', async () => {
  const gateway = createApiGateway(new Set(['uploads.put_content']));
  let calls = 0;
  const response = await gateway(new Request('https://promobento.test/api/uploads/upload-1/content', {
    method: 'PUT', body: 'bytes', headers: { 'x-request-id': 'upload-1' },
  }), { CORE_API: { async fetch() { calls++; throw new Error('private-provider-token'); } } });
  assert.equal(calls, 1);
  assert.equal(response.status, 503);
  const error = await response.json();
  assert.equal(error.code, 'SERVICE_UNAVAILABLE');
  assert.equal(error.requestId, 'upload-1');
  assert.equal(error.retryable, true);
  assert.equal(JSON.stringify(error).includes('private-provider-token'), false);
});

test('HEAD responses have no body for unknown routes, method errors and SSR failures', async () => {
  const gateway = createApiGateway(new Set(['auth.session']));
  const env = { CORE_API: { async fetch() { throw new Error('unavailable'); } } };
  for (const [path, status] of [['/api/unknown', 404], ['/api/auth/session', 405]]) {
    const response = await gateway(new Request(`https://promobento.test${path}`, { method: 'HEAD' }), env);
    assert.equal(response.status, status);
    assert.equal(response.body, null);
    assert.equal(await response.text(), '');
    assert.ok(response.headers.get('x-request-id'));
  }
  const worker = createWebWorker(async () => { throw new Error('private SSR detail'); });
  const response = await worker.fetch(new Request('https://promobento.test/', { method: 'HEAD' }), env);
  assert.equal(response.status, 500);
  assert.equal(response.body, null);
  assert.equal(await response.text(), '');
});

test('public resources reflect implemented pages and assets cannot shadow private/API paths', async () => {
  let assetCalls = 0;
  let coreCalls = 0;
  const worker = createWebWorker(async () => new Response('Page not found', { status: 404 }));
  const env = {
    CORE_API: { async fetch() { coreCalls++; throw new Error('must not dispatch'); } },
    ASSETS: { async fetch() { assetCalls++; return new Response('asset'); } },
  };
  const robots = await worker.fetch(new Request('https://promobento.test/robots.txt'), env);
  assert.equal(await robots.text(), 'User-agent: *\nDisallow: /\n');
  const sitemap = await worker.fetch(new Request('https://promobento.test/sitemap.xml'), env);
  const xml = await sitemap.text();
  assert.equal((xml.match(/<loc>/g) ?? []).length, 3);
  assert.ok(xml.includes('https://promobento.com/formats'));
  assert.ok(xml.includes('https://promobento.com/help'));
  assert.equal(xml.includes('/app'), false);
  assert.equal((await worker.fetch(new Request('https://promobento.test/sitemap.xml', { method: 'HEAD' }), env)).body, null);
  for (const path of ['/api/projects', '/internal/health', '/app/projects', '/login']) {
    assert.equal((await worker.fetch(new Request(`https://promobento.test${path}`), env)).status, 404);
  }
  assert.equal(assetCalls, 0);
  assert.equal(coreCalls, 0);
  assert.equal((await worker.fetch(new Request('https://promobento.test/icon.svg'), env)).status, 200);
  assert.equal((await worker.fetch(new Request('https://promobento.test/brand/mark.svg'), env)).status, 200);
  assert.equal(assetCalls, 2);
  for (const path of ['/brand/README.md', '/brand/private.svg', '/brand/', '/assets/', '/brand/.env']) {
    assert.equal((await worker.fetch(new Request('https://promobento.test' + path), env)).status, 404, path);
  }
  assert.equal(assetCalls, 2);
});
