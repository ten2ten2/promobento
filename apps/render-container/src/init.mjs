import {spawn} from 'node:child_process';
if (process.getuid() !== 0) throw Error('INIT_REQUIRES_UID_0');
const drop = uid => ['--reuid', String(uid), '--regid', String(uid), '--clear-groups', '--inh-caps=-all', '--bounding-set=-all'];
const base = {PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', FONTCONFIG_FILE: '/app/apps/render-container/tests/fontconfig.conf'};
const launcher = spawn('setpriv', [...drop(10002), 'node', 'apps/render-container/src/launcher.mjs'],
  {stdio: ['pipe', 'inherit', 'inherit'], env: {...base, HOME: '/chrome'}});
const controller = spawn('setpriv', [...drop(10001), 'node', 'apps/render-container/src/controller.mjs'], {stdio: ['pipe', 'inherit', 'inherit'], env: {
  ...base, HOME: '/work', RENDER_IMAGE_DIGEST: process.env.RENDER_IMAGE_DIGEST ?? '', RENDERER_RELEASE: process.env.RENDERER_RELEASE ?? ''
}});
// After creating the two uid-separated children, drop PID 1 to a third uid. Lifecycle commands use
// inherited pipes: the supervisor needs no CAP_KILL or CAP_SETUID for the rest of its lifetime.
process.setgid(10003); process.setuid(10003);
const stop = child => { if (!child.stdin.destroyed) child.stdin.end('terminate\n'); };
for (const child of [controller, launcher]) child.stdin.on('error', () => {});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stop(controller); stop(launcher); });
let exiting = false;
for (const [child, other] of [[controller, launcher], [launcher, controller]]) child.on('exit', (code, signal) => {
  stop(other);
  if (!exiting) { exiting = true; process.exitCode = code ?? (signal ? 143 : 1); }
});
