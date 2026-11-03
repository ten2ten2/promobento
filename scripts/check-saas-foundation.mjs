import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {parseCanonicalJson} from '../packages/contracts/src/canonical.mjs';
import {nativeRenderPolicy} from '../apps/cloud/src/native-policy.ts';

/** Compare executable registrations with the product plan, not just two copies of config. */
export function implementationErrors(routes, implemented, registrations, schemas) {
  const errors = [], byId = new Map(routes.map(route => [route.id, route]));
  const check = (condition, message) => {if (!condition) errors.push(message);};
  for (const [key, kind] of [['api', 'api'], ['pages', 'page'], ['resources', 'resource']]) {
    const ids = implemented[key];
    check(Array.isArray(ids) && new Set(ids).size === ids.length, 'Duplicate or missing implemented ' + key);
    if (!Array.isArray(ids)) continue;
    for (const id of ids) check(byId.get(id)?.kind === kind, 'Implemented route has wrong kind: ' + id);
    const actual = registrations[key];
    check(actual.length === ids.length && actual.every(id => ids.includes(id)), 'Executable ' + key + ' registry differs from implemented routes');
  }
  check(schemas.length === implemented.api.length && schemas.every(id => implemented.api.includes(id)),
    'Every implemented API needs exactly one contracts/api/<routeId>.schema.json');
  for (const entry of registrations.pageRoutes) {
    if (entry.path === '*') continue; // React Router's document 404.
    const declared = byId.get(entry.id), path = entry.index ? '/' : '/' + entry.path;
    check(declared?.kind === 'page' && declared.path === path, 'Web path differs from routes.json: ' + entry.id);
  }
  check(registrations.publicPages?.length === implemented.pages.length
    && registrations.publicPages.every(page => byId.get(page.id)?.path === page.path
      && byId.get(page.id)?.auth === 'public' && page.kind === 'page'
      && implemented.pages.includes(page.id)), 'Client-visible public pages differ from implemented routes');
  return errors;
}

export function bindingErrors(core, web, preview) {
  const errors = [], check = (condition, message) => {if (!condition) errors.push(message);};
  // Edge Workers have an explicit, small set of allowed settings. A new
  // Wrangler binding type must be reviewed before it can reach an edge Worker.
  const allowedRoot = new Set(['name', 'main', 'compatibility_date', 'compatibility_flags',
    'workers_dev', 'preview_urls', 'observability', 'services', 'assets', 'env']);
  const allowedEnvironment = new Set(['name', 'workers_dev', 'preview_urls', 'services']);
  for (const [label, edge, binding, entrypoint] of [['Web', web, 'CORE_API', 'CoreApi'], ['Preview', preview, 'PREVIEW_GATEWAY', 'PreviewGateway']]) {
    for (const [environment, value] of [['default', edge], ...Object.entries(edge.env ?? {})]) {
      for (const key of Object.keys(value)) check((environment === 'default' ? allowedRoot : allowedEnvironment).has(key),
        label + ' has an unreviewed setting ' + key + ' (' + environment + ')');
      const target = environment === 'default' ? core.name : core.env?.[environment]?.name;
      const service = value.services;
      check(service?.length === 1 && service[0].binding === binding && service[0].entrypoint === entrypoint
        && service[0].service === target, label + ' has an invalid named service binding (' + environment + ')');
      check((value.workers_dev ?? edge.workers_dev) === false && (value.preview_urls ?? edge.preview_urls) === false,
        label + ' public hosting is not configured yet (' + environment + ')');
      const assets = value.assets ?? edge.assets;
      if (label === 'Web') check(assets?.binding === 'ASSETS' && assets.run_worker_first === true
        && assets.html_handling === 'none' && assets.not_found_handling === 'none',
        'Web assets must pass through the Worker routing boundary (' + environment + ')');
      else check(!assets, 'Preview must not serve a static asset directory (' + environment + ')');
    }
  }
  check(core.workers_dev === false && core.preview_urls === false && core.env?.production?.workers_dev !== true
    && core.env?.production?.preview_urls !== true && !core.routes?.length && !core.route
    && !core.env?.production?.routes?.length && !core.env?.production?.route, 'Production Core must have no public entrypoint');
  const minimumDelayMs = nativeRenderPolicy.exportDeadlineMs + nativeRenderPolicy.containerStartupMs;
  for (const [environment, config] of [['default', core], ...Object.entries(core.env ?? {})]) {
    const objects = config.durable_objects;
    if (!objects) continue;
    check(Array.isArray(objects.bindings) && objects.bindings.length > 0,
      'Core has a DO policy without bindings (' + environment + ')');
    if (!Array.isArray(objects.bindings) || objects.bindings.length === 0) continue;
    const strategy = objects.code_update_strategy;
    check(strategy?.mode === 'deferred' && typeof strategy.max_delay === 'number'
      && Number.isFinite(strategy.max_delay) && strategy.max_delay <= 86400
      && strategy.max_delay * 1000 >= minimumDelayMs,
    'Core DO update delay must cover one export attempt plus container startup (' + environment + ')');
  }
  return errors;
}

export async function checkSaasFoundation(root) {
  const json = path => parseCanonicalJson(readFileSync(join(root, path), 'utf8').replace(/^\/\/[^\n]*\n/, ''));
  // This bundles only trusted registration modules, not JSX or the application.
  const result = await build({absWorkingDir: root, stdin: {resolveDir: root, contents: `
    export {default as pageRoutes} from './apps/web/app/routes.ts';
    export {resourceHandlers} from './apps/web/src/resources.ts';
    export {apiHandlers} from './apps/cloud/src/api-registry.ts';
    export {publicPages} from './apps/web/src/public-routes.ts';
  `}, bundle: true, write: false, format: 'esm', platform: 'node', target: 'node26', logLevel: 'silent'});
  const {pageRoutes, resourceHandlers, apiHandlers, publicPages} = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  const directory = join(root, 'contracts/api');
  const schemas = existsSync(directory) ? readdirSync(directory).filter(name => name.endsWith('.schema.json')) : [];
  const errors = implementationErrors(json('config/routes.json').routes, json('config/implemented-routes.json'), {
    api: Object.keys(apiHandlers), pages: pageRoutes.filter(route => route.path !== '*').map(route => route.id),
    resources: Object.keys(resourceHandlers), pageRoutes, publicPages,
  }, schemas.map(name => name.slice(0, -'.schema.json'.length)));
  for (const file of schemas) {
    const schema = json('contracts/api/' + file);
    if (!schema.$defs?.request || !schema.$defs?.response) errors.push('API contract needs request and response definitions: ' + file);
  }
  errors.push(...bindingErrors(json('apps/cloud/wrangler.jsonc'), json('apps/web/wrangler.jsonc'), json('apps/preview/wrangler.jsonc')));
  const coreEntry = readFileSync(join(root, 'apps/cloud/src/index.ts'), 'utf8');
  if (!/export\s*\{CoreApi,\s*PreviewGateway\}\s*from\s*'\.\/customer-entrypoints\.ts'/.test(coreEntry))
    errors.push('Core must export its two named customer entrypoints');
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = await checkSaasFoundation(fileURLToPath(new URL('..', import.meta.url)));
  if (errors.length) {console.error(errors.join('\n')); process.exitCode = 1;}
  else console.log('SaaS routes, executable registrations, API schemas and Worker bindings agree.');
}
