import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {sqliteD1} from './fixtures/sqlite.mjs';

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

test('a late alarm only stops physical attempts belonging to its original lease token', async () => {
  const observations = [];
  for (const scenario of ['never-started','started','regranted']) {
    const old = {id:'ticket',token:'old-token',deadline:Date.now() - 100};
    const coordinator = Object.create(CoordinatorDO.prototype);
    coordinator.ctx = {storage: {sql: {exec(query) {
      if (query.startsWith('SELECT * FROM leases')) return {toArray() {return [old];}};
      if (query.startsWith('SELECT id FROM leases')) return {toArray() {return [];}};
      throw Error('UNEXPECTED_QUERY: ' + query);
    }}}};
    coordinator.env = {
      DB: {prepare(query) {
        assert.match(query, /a\.lease_token=\?/);
        return {bind(id, token) {
          assert.equal(id, old.id); assert.equal(token, old.token);
          return {async first() {return scenario === 'started' ? {id} : null;}};
        }};
      }},
      SHARDS: {getByName(id) {assert.equal(id, old.id); return {async stopAndSettle() {observations.push(scenario + ':stop');}};}},
    };
    coordinator.release = async (id, token) => {
      assert.equal(id, old.id); assert.equal(token, old.token);
      observations.push(scenario + ':release');
      if (scenario === 'regranted') throw Error('RENDER_LEASE_FENCED');
    };
    await coordinator.alarm();
  }
  assert.deepEqual(observations, [
    'never-started:release',
    'started:stop', 'started:release',
    'regranted:release',
  ]);
});

test('an expired unknown-token lease still stops and settles an existing physical attempt without an admission', async t => {
  const {db, DB} = sqliteD1(); t.after(() => db.close());
  const started = Date.now() - 10_000;
  db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('legacy-op', 'workspace', 'project', 0, 'evaluation', 'active', 'request', 3000000, started, null, null);
  db.prepare('INSERT INTO pipeline_renders(id,operation_id,generation,request_hash,job_key,status,created_at) VALUES(?,?,?,?,?,?,?)')
    .run('legacy-render', 'legacy-op', 0, 'request', 'renders/legacy/input.json', 'rendering', started);
  db.prepare('INSERT INTO pipeline_attempts(id,render_id,operation_id,generation,mode,instance,status,started_at) VALUES(?,?,?,?,?,?,?,?)')
    .run('legacy-attempt', 'legacy-render', 'legacy-op', 0, 'native_export', 'standard-3', 'active', started);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_render_admissions').get().n, 0);
  const old = {id:'legacy-attempt',token:'',deadline:Date.now() - 100};
  let stopped = false, released = false;
  const coordinator = Object.create(CoordinatorDO.prototype);
  coordinator.ctx = {storage: {sql: {exec(query) {
    if (query.startsWith('SELECT * FROM leases')) return {toArray() {return [old];}};
    if (query.startsWith('SELECT id FROM leases')) return {toArray() {return [];}};
    throw Error('UNEXPECTED_QUERY: ' + query);
  }}}};
  coordinator.env = {DB, SHARDS: {getByName(id) {
    assert.equal(id, old.id);
    return {async stopAndSettle() {stopped = true;}, async isStopped() {return stopped;}};
  }}};
  coordinator.release = async (id, token) => {
    assert.equal(id, old.id); assert.equal(token, old.token);
    assert.equal(stopped, true, 'the physical stop must finish before freeing capacity');
    released = true;
  };
  await coordinator.alarm();
  assert.equal(stopped, true);
  assert.equal(released, true);
});
