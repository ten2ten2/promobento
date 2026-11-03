import test from 'node:test';
import assert from 'node:assert/strict';
import {apiError, customerApiRoutes, implementedApiRouteIds, matchApiRoute, requestIdFor} from '../src/http-routes.mjs';
import {validate} from '../generated/api-error.mjs';

test('planned API routes are closed until explicitly implemented; pages and internal paths cannot be enabled', () => {
  assert.equal(implementedApiRouteIds.size, 0);
  for (const route of customerApiRoutes) {
    assert.equal(matchApiRoute(route.path.replace(/:[A-Za-z]+/g, 'resource'), route.method).kind, 'not-found', route.id);
  }
  const ids = new Set(['auth.session', 'public.home', 'admin.index', 'internal.s1.capacity']);
  for (const path of ['/', '/admin', '/internal/s1/capacity', '/api/internal/s1/capacity'])
    assert.equal(matchApiRoute(path, 'GET', ids).kind, 'not-found');
});

test('method mismatches expose only the implemented methods and exact parameter scope', () => {
  const ids = new Set(['projects.get', 'projects.delete', 'uploads.put_content']);
  assert.deepEqual(matchApiRoute('/api/projects/p_123', 'POST', ids), {kind: 'method-not-allowed', allow: ['DELETE', 'GET']});
  const match = matchApiRoute('/api/uploads/u_123/content', 'PUT', ids);
  assert.equal(match.kind, 'match');
  assert.equal(match.route.id, 'uploads.put_content');
  assert.deepEqual({...match.params}, {uploadId: 'u_123'});
  assert.equal(matchApiRoute('/api/projects/p_123', 'HEAD', ids).kind, 'method-not-allowed');
  assert.equal(matchApiRoute('/api/projects', 'POST', ids).kind, 'not-found');
});

test('encoded separators, invalid UTF-8, dot segments and path aliases cannot cross the route boundary', () => {
  const ids = new Set(customerApiRoutes.map(route => route.id));
  for (const id of ['', '.', '..', '%2e', '%2e%2e', '%2f', '%5c', '%252f', '%00', '%20', '%3f', '%23', '%FF', '%', 'a/b', 'a\\b'])
    assert.equal(matchApiRoute('/api/projects/' + id, 'GET', ids).kind, 'not-found', id);
  for (const path of ['/api/projects/x/', '//api/projects/x', '/api//projects/x', '/%61pi/projects/x',
    '/api/projects/x?fake=1', '/api/projects/x#fake', '/api/projects/' + 'a'.repeat(257)])
    assert.equal(matchApiRoute(path, 'GET', ids).kind, 'not-found', path);
});

test('public errors use a closed schema and bounded correlation IDs, with no caller/provider details', async () => {
  const request = new Request('https://app.example/api/missing', {headers: {'x-request-id': 'req-123:span'}});
  assert.equal(requestIdFor(request), 'req-123:span');
  for (const value of ['bad id', '<script>', 'x'.repeat(129)]) {
    const id = requestIdFor(new Request(request, {headers: {'x-request-id': value}}));
    assert.match(id, /^[a-f0-9-]{36}$/);
  }
  for (const [code, status] of [['NOT_FOUND', 404], ['METHOD_NOT_ALLOWED', 405], ['INTERNAL_ERROR', 500], ['SERVICE_UNAVAILABLE', 503]]) {
    const response = apiError(code, status, requestIdFor(request), status === 405 ? {allow: 'GET'} : undefined);
    const body = await response.json();
    assert.equal(validate(body), true, JSON.stringify(validate.errors));
    assert.equal(response.status, status);
    assert.equal(response.headers.get('x-request-id'), body.requestId);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(body.retryable, code === 'SERVICE_UNAVAILABLE');
    assert.deepEqual(body.fieldErrors, {});
  }
  assert.throws(() => apiError('private provider token', 500, 'req-123'), /Unknown public/);
  assert.throws(() => apiError('__proto__', 500, 'req-123'), /Unknown public/);
});
