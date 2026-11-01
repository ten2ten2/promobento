import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const built = await build({
  stdin: {contents: 'export {CoordinatorDO} from "./apps/cloud/src/compute.ts";', resolveDir: process.cwd()},
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node26',
  plugins: [{name: 'cloudflare-durable-object-fixture', setup(builder) {
    builder.onResolve({filter: /^cloudflare:workers$/}, () => ({path: 'workers', namespace: 'fixture'}));
    builder.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: 'export class DurableObject {} export class WorkerEntrypoint {}', loader: 'js'}));
  }}],
});
const {CoordinatorDO} = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

test('repeated lease activity never postpones an existing earlier coordinator cleanup alarm', async () => {
  const alarms = [];
  let alarmAt = Date.now() + 4000;
  const coordinator = Object.create(CoordinatorDO.prototype);
  coordinator.ctx = {storage: {
    async getAlarm() {return alarmAt;},
    async setAlarm(next) {alarmAt = next; alarms.push(next);},
  }};
  for (let i = 0; i < 20; i++) await coordinator.arm();
  assert.equal(alarms.length, 0, 'an existing alarm is not pushed back');
  alarmAt = Date.now() + 60_000;
  await coordinator.arm();
  assert.equal(alarms.length, 1, 'a later alarm is shortened to the next cleanup scan');
  const earlier = alarmAt;
  for (let i = 0; i < 20; i++) await coordinator.arm();
  assert.equal(alarmAt, earlier);
  assert.equal(alarms.length, 1);
});
