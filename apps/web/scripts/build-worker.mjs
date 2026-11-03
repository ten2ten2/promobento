import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  outfile: 'build/worker/index.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  conditions: ['workerd', 'worker', 'browser'],
  target: 'es2024',
  external: ['cloudflare:*', 'node:*'],
  alias: { 'virtual:react-router/server-build': resolve(root, 'build/server/index.js') },
  define: { 'process.env.NODE_ENV': '"production"' },
  sourcemap: true,
  logLevel: 'info',
});
