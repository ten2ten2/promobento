// PID 1, root only long enough to start two unprivileged services:
// the controller as uid 10001 and the Chromium launcher as uid 10002.
// It forwards SIGTERM and exits with the controller's status.
import {spawn} from 'node:child_process';
import {mkdirSync, chownSync} from 'node:fs';

for (const [dir, uid] of [['/work', 10001], ['/chrome', 10002]]) {
  mkdirSync(dir, {recursive: true});
  chownSync(dir, uid, uid);
}

const drop = uid => ['--reuid', String(uid), '--regid', String(uid), '--clear-groups', '--inh-caps=-all', '--bounding-set=-all'];
const PATH = '/usr/local/bin:/usr/bin:/bin';

const launcher = spawn('setpriv', [...drop(10002), 'node', '/app/launcher.mjs'], {
  stdio: 'inherit', env: {PATH, HOME: '/chrome'}
});
// The env token is a deliberate leak target for the isolation probe: the controller deletes it on start.
const controller = spawn('setpriv', [...drop(10001), 'node', '/app/controller.mjs'], {
  stdio: 'inherit', env: {PATH, HOME: '/work', DUMMY_ENV_TOKEN: process.env.DUMMY_ENV_TOKEN ?? ''}
});

const forward = signal => () => {
  console.log(`init: forwarding ${signal}`);
  controller.kill(signal);
  launcher.kill(signal);
};
process.on('SIGTERM', forward('SIGTERM'));
process.on('SIGINT', forward('SIGINT'));

controller.on('exit', (code, signal) => {
  console.log(`init: controller exited code=${code} signal=${signal}`);
  launcher.kill('SIGKILL');
  process.exit(code ?? 143);
});
launcher.on('exit', (code, signal) => console.log(`init: launcher exited code=${code} signal=${signal}`));
