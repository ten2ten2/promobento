import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import {customerApiRoutes} from '@promobento/contracts/http-routes';
import {createMultiWorkerHarness, executeSql} from './fixtures/multi-worker.mjs';

function assertPrivate(response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
}

test('production Web, Core and Preview entrypoints run together in workerd', async t => {
  const h = await createMultiWorkerHarness();
  t.after(() => h.dispose());

  await t.test('Web renders public pages and serves the built client assets', async () => {
    const page = await h.web.fetch('https://web.example/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    const html = await page.text();
    assert.match(html, /<html[^>]*lang="en"/);
    assert.match(html, /PromoBento/);
    assert.match(html, /<h1[ >]/);
    const head = await h.web.fetch('https://web.example/', {method: 'HEAD'});
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    const asset = (await readdir('apps/web/build/client/assets')).find(file => file.endsWith('.js'));
    assert.ok(asset, 'the SSR build must include a real hydration bundle');
    const script = await h.web.fetch('https://web.example/assets/' + asset);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    assert.ok((await script.text()).length > 0);
  });

  await t.test('only the two narrow named entrypoints are bound at the edges', async () => {
    assert.deepEqual(Object.keys(h.webBindings).sort(), ['ASSETS', 'CORE_API']);
    assert.deepEqual(Object.keys(h.previewBindings), ['PREVIEW_GATEWAY']);
    const internal = await h.core.fetch('https://core.example/healthz');
    assert.equal(internal.status, 200, 'the actual S1 Core worker was loaded');
    await internal.text();
    for (const path of ['/healthz', '/internal/s1/capacity', '/admin', '/api/internal/s1/capacity']) {
      const response = await h.webBindings.CORE_API.fetch('https://core.example' + path);
      assert.equal(response.status, 404, path);
      assertPrivate(response);
      assert.equal((await response.json()).code, 'NOT_FOUND');
    }
    for (const path of ['/internal/s1/capacity', '/app/projects', '/api/unknown']) {
      const response = await h.web.fetch('https://web.example' + path);
      assert.equal(response.status, 404, path);
      await response.text();
    }
  });

  await t.test('planned APIs remain closed until explicitly implemented', async () => {
    for (const route of customerApiRoutes) {
      const path = route.path.replace(/:[A-Za-z]+/g, 'fixture-id');
      const response = await h.web.fetch('https://web.example' + path, {method: route.method});
      assert.equal(response.status, 404, route.id);
      assertPrivate(response);
      const error = await response.json();
      assert.equal(error.code, 'NOT_FOUND');
      assert.equal(error.messageKey, 'apiErrors.notFound');
      assert.ok(error.requestId);
    }
  });

  await t.test('Preview cannot access the Core API or serve unapproved files', async () => {
    for (const path of ['/index.html', '/api/auth/session', '/internal/s1/artifacts/example']) {
      const response = await h.preview.fetch('https://preview.example' + path, {
        headers: {cookie: 'session=untrusted', authorization: 'Bearer not-a-capability'},
      });
      assert.equal(response.status, 404, path);
      assertPrivate(response);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.match(response.headers.get('content-security-policy'), /(?:^|;\s*)sandbox(?:;|$)/);
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.equal((await response.json()).code, 'NOT_FOUND');
    }
    const head = await h.preview.fetch('https://preview.example/index.html', {method: 'HEAD'});
    assert.equal(head.status, 404);
    assert.equal(await head.text(), '');
    const mutation = await h.preview.fetch('https://preview.example/index.html', {method: 'POST'});
    assert.equal(mutation.status, 405);
    assert.equal(mutation.headers.get('allow'), 'GET, HEAD');
    await mutation.text();
  });
});

// These handlers exist only in the test worker. The production registry stays empty.
const fixtureIds = ['uploads.put_content', 'billing.waffo.webhook', 'auth.session'];
const coreFixture = `
  import {WorkerEntrypoint} from 'cloudflare:workers';
  import {createCoreApiHandler} from './apps/cloud/src/api-dispatch.ts';
  const echo = async (request, {env, params}) => {
    await env.DB.prepare('INSERT INTO binding_probe_calls(method) VALUES (?)').bind(request.method).run();
    if (new URL(request.url).searchParams.has('fail-after-write')) throw new Error('private-post-write-failure');
    const headers = new Headers({'content-type': 'application/octet-stream'});
    for (const name of ['cookie', 'origin', 'x-csrf-token', 'x-request-id', 'x-user-id',
      'x-workspace-id', 'x-promobento-actor', 'x-internal-actor', 'x-forwarded-for', 'forwarded'])
      headers.set('x-seen-' + name, request.headers.get(name) || '');
    headers.set('x-seen-url', request.url);
    headers.set('x-seen-upload', params.uploadId || '');
    headers.append('set-cookie', 'session=opaque; HttpOnly; Secure; SameSite=Lax; Path=/');
    headers.append('set-cookie', 'csrf=opaque; Secure; SameSite=Lax; Path=/');
    return new Response(request.body, {headers});
  };
  const dispatch = createCoreApiHandler({
    'uploads.put_content': echo,
    'billing.waffo.webhook': echo,
    'auth.session': () => {throw new Error('private-database-credential-must-not-leak');},
  }, new Set(${JSON.stringify(fixtureIds)}));
  export class CoreApi extends WorkerEntrypoint {
    fetch(request) {return dispatch(request, this.env, this.ctx);}
  }
  export class PreviewGateway extends WorkerEntrypoint {
    fetch(request) {
      return Response.json({cookie: request.headers.get('cookie'),
        actor: request.headers.get('x-user-id'), authorization: request.headers.get('authorization')},
        {headers: {'set-cookie': 'must-not-reach-browser=1', 'cache-control': 'public, max-age=86400'}});
    }
  }
  export default {fetch() {return new Response('Wrong default Core entrypoint', {status: 418});}};
`;
const webFixture = `
  import {createApiGateway} from './apps/web/src/gateway.ts';
  export default {fetch: createApiGateway(new Set(${JSON.stringify(fixtureIds)}))};
`;

test('real named service bindings preserve streams and isolate identity and errors', async t => {
  const h = await createMultiWorkerHarness({coreSource: coreFixture, webSource: webFixture});
  t.after(() => h.dispose());
  await executeSql(h.db, 'CREATE TABLE binding_probe_calls (id INTEGER PRIMARY KEY, method TEXT NOT NULL);');

  await t.test('binary upload bytes, cookies, origin, CSRF and query survive one forwarding hop', async () => {
    const bytes = Uint8Array.from({length: 2 * 1024 * 1024 + 31}, (_, i) => i % 256);
    let offset = 0;
    const body = new ReadableStream({pull(controller) {
      if (offset >= bytes.byteLength) { controller.close(); return; }
      const end = Math.min(offset + 32768, bytes.byteLength);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    }});
    // Browser-origin requests enter the public HTTP handler. getWorker().fetch()
    // uses Miniflare's private RPC bridge, which intentionally rejects Origin.
    const response = await h.mf.dispatchFetch('https://web.example/api/uploads/upload-1/content?part=raw%2Bbytes', {
      method: 'PUT', body, duplex: 'half',
      headers: {
        'content-type': 'application/octet-stream', cookie: 'session=opaque', origin: 'https://web.example',
        'x-csrf-token': 'csrf-value', 'x-request-id': 'binding-probe-1', 'x-user-id': 'admin',
        'x-workspace-id': 'other-tenant', 'x-promobento-actor': 'admin', 'x-internal-actor': 'admin',
        'x-forwarded-for': 'spoofed', forwarded: 'for=spoofed',
      },
    });
    assert.equal(response.status, 200);
    assertPrivate(response);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    assert.equal(response.headers.get('x-seen-upload'), 'upload-1');
    assert.equal(response.headers.get('x-seen-url'), 'https://web.example/api/uploads/upload-1/content?part=raw%2Bbytes');
    assert.equal(response.headers.get('x-seen-cookie'), 'session=opaque');
    assert.equal(response.headers.get('x-seen-origin'), 'https://web.example');
    assert.equal(response.headers.get('x-seen-x-csrf-token'), 'csrf-value');
    assert.equal(response.headers.get('x-seen-x-request-id'), 'binding-probe-1');
    for (const name of ['x-user-id', 'x-workspace-id', 'x-promobento-actor', 'x-internal-actor', 'x-forwarded-for', 'forwarded'])
      assert.equal(response.headers.get('x-seen-' + name), '', name);
    assert.equal(response.headers.getSetCookie().length, 2);
    assert.equal((await h.db.prepare('SELECT count(*) AS count FROM binding_probe_calls').first()).count, 1);
  });

  await t.test('webhook payloads preserve their exact signed bytes', async () => {
    const bytes = new Uint8Array([32, 123, 34, 97, 34, 58, 49, 125, 13, 10, 0, 255, 254]);
    const response = await h.web.fetch('https://web.example/api/payments/waffo/webhook?environment=test', {
      method: 'POST', body: bytes, headers: {'content-type': 'application/json'},
    });
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    assert.equal((await h.db.prepare('SELECT count(*) AS count FROM binding_probe_calls').first()).count, 2);
  });

  await t.test('registered paths enforce methods and errors never expose exception details', async () => {
    const wrongMethod = await h.web.fetch('https://web.example/api/uploads/upload-1/content');
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'PUT');
    assert.equal((await wrongMethod.json()).code, 'METHOD_NOT_ALLOWED');
    const failure = await h.web.fetch('https://web.example/api/auth/session');
    assert.equal(failure.status, 500);
    assertPrivate(failure);
    const error = await failure.json();
    assert.equal(error.code, 'INTERNAL_ERROR');
    assert.doesNotMatch(JSON.stringify(error), /private-database-credential/);
    for (const path of ['/healthz', '/internal/s1/capacity', '/api/uploads/a%2Fb/content']) {
      const response = await h.web.fetch('https://web.example' + path);
      assert.equal(response.status, 404, path);
      await response.text();
    }
    assert.equal((await h.db.prepare('SELECT count(*) AS count FROM binding_probe_calls').first()).count, 2);
  });

  await t.test('the Web gateway does not replay a mutation after Core fails', async () => {
    const response = await h.web.fetch('https://web.example/api/payments/waffo/webhook?fail-after-write=1', {
      method: 'POST', body: 'opaque signed payload',
    });
    assert.equal(response.status, 500);
    const error = await response.json();
    assert.equal(error.code, 'INTERNAL_ERROR');
    assert.doesNotMatch(JSON.stringify(error), /private-post-write-failure/);
    assert.equal((await h.db.prepare('SELECT count(*) AS count FROM binding_probe_calls').first()).count, 3);
  });

  await t.test('Preview drops app identity and cannot set cookies even if upstream does', async () => {
    const response = await h.preview.fetch('https://preview.example/manifest/file.html', {
      headers: {cookie: 'session=app-secret', 'x-user-id': 'owner', authorization: 'Bearer fixture-capability'},
    });
    assert.equal(response.status, 200);
    assertPrivate(response);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), {cookie: null, actor: null, authorization: 'Bearer fixture-capability'});
    assert.match(response.headers.get('content-security-policy'), /sandbox/);
  });
});
