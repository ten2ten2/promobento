import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoreApiHandler} from '../src/api-dispatch.ts';
import {apiHandlers} from '../src/api-registry.ts';
import {IdempotencyConflict} from '../src/shared/idempotency.ts';
import {GuardedBatchOutcomeUnknown, GuardedBatchPreconditionFailed} from '../src/shared/guarded-batch.ts';

test('Core registry cannot enable non-API routes or omit an implemented handler', () => {
  assert.throws(() => createCoreApiHandler({'public.home': () => new Response()}, new Set(['public.home'])), /registry/);
  assert.throws(() => createCoreApiHandler({}, new Set(['auth.session'])), /registry/);
  assert.throws(() => createCoreApiHandler({'auth.session': () => new Response()}, new Set()), /registry/);
});

test('Core never delegates unknown customer requests to the default internal entrypoint', async () => {
  const fetch = createCoreApiHandler(apiHandlers);
  for (const path of ['/internal/s1/capacity', '/internal/s1/model-budget', '/healthz', '/admin', '/api/auth/session']) {
    const response = await fetch(new Request('https://core.example' + path, {headers: {authorization: 'Bearer internal-key'}}), {}, {});
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'NOT_FOUND');
  }
});

test('Core dispatches exact routes with raw request context and streams the response', async () => {
  let seen;
  const fetch = createCoreApiHandler({'projects.get': (request, context) => {
    seen = {url: request.url, cookie: request.headers.get('cookie'), context};
    return new Response('stream body', {headers: {'set-cookie': 'fixture=1; Secure; HttpOnly', 'cache-control': 'public'}});
  }}, new Set(['projects.get']));
  const request = new Request('https://app.example/api/projects/project_1?cursor=two',
    {headers: {cookie: 'opaque=token', 'x-request-id': 'request-1', 'x-user-id': 'untrusted'}});
  const env = {}, ctx = {};
  const response = await fetch(request, env, ctx);
  assert.equal(await response.text(), 'stream body');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.headers.get('set-cookie'), /fixture=1/);
  assert.equal(seen.url, request.url);
  assert.equal(seen.cookie, 'opaque=token');
  assert.equal(seen.context.env, env);
  assert.equal(seen.context.ctx, ctx);
  assert.equal(seen.context.params.projectId, 'project_1');
  assert.equal(seen.context.correlationId, 'request-1');
  assert.equal(Object.hasOwn(seen.context, 'requestId'), false);
  assert.equal(Object.hasOwn(seen.context, 'actorId'), false);
  const method = await fetch(new Request(request, {method: 'DELETE'}), env, ctx);
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'GET');
});

test('correlation IDs are never substituted for a missing business idempotency key', async () => {
  let context;
  const fetch = createCoreApiHandler({'projects.get': (_request, value) => {
    context = value;
    return Response.json({ok: true});
  }}, new Set(['projects.get']));
  const response = await fetch(new Request('https://app.example/api/projects/p1', {
    headers: {'idempotency-key': 'explicit-key'},
  }), {}, {});
  assert.equal(response.status, 200);
  assert.match(context.correlationId, /^[a-f0-9-]{36}$/u);
  assert.equal(Object.hasOwn(context, 'requestId'), false);
});

test('Core maps typed guarded-write failures and preserves the retry contract', async () => {
  for (const [error, code, status, retryable, reason] of [
    [new IdempotencyConflict(), 'IDEMPOTENCY_CONFLICT', 409, false],
    [new GuardedBatchOutcomeUnknown(Error('lost confirmation'), Error('read unavailable')), 'OUTCOME_UNKNOWN', 503, true],
    [new GuardedBatchPreconditionFailed('RESOURCE_NOT_FOUND', 404, Error('private SQL')), 'PRECONDITION_FAILED', 404, false, 'RESOURCE_NOT_FOUND'],
    [new GuardedBatchPreconditionFailed('PROJECT_DELETED', 404, Error('private SQL')), 'PRECONDITION_FAILED', 404, false, 'RESOURCE_NOT_FOUND'],
    [new GuardedBatchPreconditionFailed('PROJECT_NOT_FOUND', 404, Error('private SQL')), 'PRECONDITION_FAILED', 404, false, 'RESOURCE_NOT_FOUND'],
    [new GuardedBatchPreconditionFailed('VERSION_CONFLICT', 409, Error('private SQL')), 'PRECONDITION_FAILED', 409, false, 'VERSION_CONFLICT'],
    [new GuardedBatchPreconditionFailed('INVALID_STATE', 422, Error('private SQL')), 'PRECONDITION_FAILED', 422, false, 'INVALID_STATE'],
  ]) {
    const fetch = createCoreApiHandler({'auth.session': () => {throw error;}}, new Set(['auth.session']));
    const response = await fetch(new Request('https://app.example/api/auth/session', {
      headers: {'x-request-id': 'trace-123'},
    }), {}, {});
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.equal(body.retryable, retryable);
    assert.deepEqual(body.params, reason ? {reason} : {});
    assert.equal(body.requestId, 'trace-123');
    assert.doesNotMatch(JSON.stringify(body), /private SQL|lost confirmation|read unavailable/u);
  }
});

test('Core errors never disclose exceptions and HEAD never carries an error body', async () => {
  const fetch = createCoreApiHandler({'auth.session': () => {throw Error('database password and private query');}}, new Set(['auth.session']));
  const response = await fetch(new Request('https://app.example/api/auth/session'), {}, {});
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, 'INTERNAL_ERROR');
  const head = await fetch(new Request('https://app.example/api/auth/session', {method: 'HEAD'}), {}, {});
  assert.equal(head.status, 405);
  assert.equal(await head.text(), '');
});
