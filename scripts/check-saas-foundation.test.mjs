import test from 'node:test';
import assert from 'node:assert/strict';
import {implementationErrors, bindingErrors} from './check-saas-foundation.mjs';
import {readFileSync} from 'node:fs';

const route = {id: 'auth.session', kind: 'api', path: '/api/auth/session'};
test('route checks reject exposing a page as an API, omitted schemas and mismatched executable registries', () => {
  const impl = {api: ['auth.session'], pages: [], resources: []};
  const registrations = {api: ['auth.session'], pages: [], resources: [], pageRoutes: [], publicPages: []};
  assert.deepEqual(implementationErrors([route], impl, registrations, ['auth.session']), []);
  assert.ok(implementationErrors([{...route, kind: 'page'}], impl, registrations, ['auth.session']).length);
  assert.ok(implementationErrors([route], impl, registrations, []).length);
  assert.ok(implementationErrors([route], impl, {...registrations, api: []}, ['auth.session']).length);
  assert.ok(implementationErrors([route], {...impl, api: ['auth.session', 'auth.session']}, registrations, ['auth.session']).length);
  const implementedPage = {id: 'public.home', path: '/', kind: 'page', auth: 'public'};
  const pageImpl = {api: [], pages: ['public.home'], resources: []};
  const pageRegistrations = {api: [], pages: ['public.home'], resources: [],
    pageRoutes: [{...implementedPage, index: true}], publicPages: [implementedPage]};
  assert.deepEqual(implementationErrors([implementedPage], pageImpl, pageRegistrations, []), []);
  assert.ok(implementationErrors([implementedPage], pageImpl, {...pageRegistrations, publicPages: []}, []).length);
});

test('binding checks reject a privileged edge, a default Core binding or accidental production public access', () => {
  const load = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\/\/[^\n]*\n/, ''));
  const core = load('apps/cloud/wrangler.jsonc'), web = load('apps/web/wrangler.jsonc'), preview = load('apps/preview/wrangler.jsonc');
  assert.deepEqual(bindingErrors(core, web, preview), []);
  assert.ok(bindingErrors(core, {...web, d1_databases: [{binding: 'DB'}]}, preview).length);
  for (const key of ['hyperdrive', 'browser', 'vectorize', 'analytics_engine_datasets', 'mtls_certificates']) {
    assert.ok(bindingErrors(core, {...web, [key]: []}, preview).length, key);
    const nested = structuredClone(preview); nested.env.staging[key] = [];
    assert.ok(bindingErrors(core, web, nested).length, key);
  }
  assert.ok(bindingErrors(core, web, {...preview, services: [{binding: 'PREVIEW_GATEWAY', service: core.name}]}).length);
  const publicCore = structuredClone(core); publicCore.env.production.workers_dev = true;
  assert.ok(bindingErrors(publicCore, web, preview).length);
  assert.ok(bindingErrors({...core, routes: ['core.example/*']}, web, preview).length);
  const versionUrl = structuredClone(core); versionUrl.env.production.preview_urls = true;
  assert.ok(bindingErrors(versionUrl, web, preview).length);
  const bypass = structuredClone(web); bypass.env.production.assets = {...web.assets, run_worker_first: false};
  assert.ok(bindingErrors(core, bypass, preview).length);
  const previewAssets = structuredClone(preview); previewAssets.env.production.assets = {directory: 'public', binding: 'ASSETS'};
  assert.ok(bindingErrors(core, web, previewAssets).length);
  const shortDelay = structuredClone(core); shortDelay.env.staging.durable_objects.code_update_strategy.max_delay = 600;
  assert.ok(bindingErrors(shortDelay, web, preview).some(error => error.includes('attempt')));
  const productionDO = structuredClone(core);
  productionDO.env.production.durable_objects = {bindings: [{name: 'SHARDS', class_name: 'ShardDO'}]};
  assert.ok(bindingErrors(productionDO, web, preview).some(error => error.includes('production')));
  productionDO.env.production.durable_objects.code_update_strategy = {mode: 'deferred', max_delay: 900};
  assert.deepEqual(bindingErrors(productionDO, web, preview), []);
});
