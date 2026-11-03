import {readFile, readdir, mkdtemp, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const cloudRequire = createRequire(join(root, 'apps/cloud/package.json'));
const {unstable_splitSqlQuery: splitSqlQuery} = cloudRequire('wrangler');
const compatibilityDate = '2026-10-20';
const noNetwork = () => new Response('External requests are disabled in local tests.', {status: 503});

export function executeSql(db, sql) {
  return db.batch(splitSqlQuery(sql).map(statement => db.prepare(statement)));
}

/** Uses Wrangler's SQL splitter so multi-line statements and triggers remain intact. */
export async function applyMigrations(db, directory = join(root, 'apps/cloud/migrations')) {
  for (const file of (await readdir(directory)).filter(file => file.endsWith('.sql')).sort()) {
    await executeSql(db, await readFile(join(directory, file), 'utf8'));
  }
}

async function bundle({entry, source}) {
  const result = await build({
    absWorkingDir: root,
    ...(source === undefined ? {entryPoints: [entry]} : {
      stdin: {contents: source, loader: 'ts', sourcefile: 'local-worker-fixture.ts', resolveDir: root},
    }),
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2024',
    conditions: ['workerd', 'worker', 'browser'],
    external: ['cloudflare:*', 'node:*'],
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

function worker(name, script, options = {}) {
  return {
    name,
    script,
    modules: true,
    compatibilityDate,
    compatibilityFlags: ['nodejs_compat'],
    outboundService: noNetwork,
    ...options,
  };
}

async function start(workers) {
  const directory = await mkdtemp(join(tmpdir(), 'promobento-workers-'));
  let mf;
  const dispose = async () => {
    try { await mf?.dispose(); }
    finally { await rm(directory, {recursive: true, force: true}); }
  };
  try {
    mf = new Miniflare(convertV4MiniflareOptions({
      workers,
      host: '127.0.0.1',
      cf: false,
      resourcePersistencePath: directory,
    }));
    const db = await mf.getD1Database('DB', 'core');
    await applyMigrations(db);
    return {mf, db, dispose};
  } catch (error) {
    await dispose();
    throw error;
  }
}

/** Fresh, real workerd D1 for the guarded-batch concurrency tests; no SSR build needed. */
export function createD1Harness() {
  return start([worker('core', 'export default {fetch() {return new Response(null, {status: 404});}}', {
    d1Databases: {DB: 'promobento-test-db'},
  })]);
}

/**
 * Real Web -> CoreApi and Preview -> PreviewGateway service bindings in one workerd.
 * The actual Core entrypoint is bundled; render containers, models and background
 * jobs are not executed by this fixture. coreSource is only for test-only handlers.
 */
export async function createMultiWorkerHarness({coreSource, webSource} = {}) {
  const [coreScript, webScript, previewScript] = await Promise.all([
    bundle({entry: 'apps/cloud/src/index.ts', source: coreSource}),
    webSource === undefined ? readFile(join(root, 'apps/web/build/worker/index.js'), 'utf8').catch(error => {
      if (error.code === 'ENOENT')
        throw new Error('Build the Web Worker before this test: pnpm --filter @promobento/web build', {cause: error});
      throw error;
    }) : bundle({source: webSource}),
    bundle({entry: 'apps/preview/src/index.ts'}),
  ]);
  const harness = await start([
    worker('web', webScript, {
      serviceBindings: {CORE_API: {name: 'core', entrypoint: 'CoreApi'}},
      assets: {
        directory: join(root, 'apps/web/build/client'),
        binding: 'ASSETS',
        run_worker_first: true,
        routerConfig: {has_user_worker: true},
      },
    }),
    worker('core', coreScript, {d1Databases: {DB: 'promobento-test-db'}}),
    worker('preview', previewScript, {
      serviceBindings: {PREVIEW_GATEWAY: {name: 'core', entrypoint: 'PreviewGateway'}},
    }),
  ]);
  try {
    const [web, core, preview, webBindings, previewBindings] = await Promise.all([
      harness.mf.getWorker('web'), harness.mf.getWorker('core'), harness.mf.getWorker('preview'),
      harness.mf.getBindings('web'), harness.mf.getBindings('preview'),
    ]);
    return {...harness, web, core, preview, webBindings, previewBindings};
  } catch (error) {
    await harness.dispose();
    throw error;
  }
}
