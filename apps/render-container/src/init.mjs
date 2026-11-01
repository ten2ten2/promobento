import {spawn} from 'node:child_process';
if (process.getuid() !== 0) throw Error('INIT_REQUIRES_UID_0');
const drop = (uid, groups = []) => ['--reuid', String(uid), '--regid', String(uid), ...(groups.length ? ['--groups', groups.join(',')] : ['--clear-groups']), '--inh-caps=-all', '--bounding-set=-all'];
const base = {PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', FONTCONFIG_FILE: '/app/apps/render-container/tests/fontconfig.conf'};
const launcher = spawn('setpriv', [...drop(10002, [10001]), 'node', 'apps/render-container/src/launcher.mjs'], {stdio: ['pipe', 'inherit', 'inherit'], env: {...base, HOME: '/chrome'}});
const controller = spawn('setpriv', [...drop(10001), 'node', 'apps/render-container/src/controller.mjs'], {stdio: ['pipe', 'inherit', 'inherit'], env: {
  ...base, HOME: '/work', RENDER_IMAGE_DIGEST: process.env.RENDER_IMAGE_DIGEST ?? '', RENDERER_RELEASE: process.env.RENDERER_RELEASE ?? ''
}});
// PID 1 only coordinates termination; it does not keep capabilities or a broker bearer.
process.setgid(10003); process.setuid(10003);
const stop = child => { if (!child.stdin.destroyed) child.stdin.end('terminate\n'); };
for (const child of [controller, launcher]) child.stdin.on('error', () => {});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stop(controller); stop(launcher); });
for (const [child, other] of [[controller, launcher], [launcher, controller]]) child.on('exit', (code, signal) => {
  stop(other); process.exitCode = code ?? (signal ? 143 : 1);
});
