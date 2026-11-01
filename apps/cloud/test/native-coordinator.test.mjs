import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {nativeProjectHash} from '@promobento/contracts/native-project';
import {digest, sha256Bytes} from '@promobento/contracts/digest';
import {NATIVE_COMMIT} from '../src/native-project.ts';
import {nativeRenderPolicy} from '../src/native-task.ts';
import {reserve} from '../src/store.ts';
import {sqliteD1} from './fixtures/sqlite.mjs';

const built = await build({
  stdin: {contents: 'export {CoordinatorDO, ShardDO} from "./apps/cloud/src/compute.ts";', resolveDir: process.cwd()},
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node26',
  plugins: [{name: 'cloudflare-durable-object-fixture', setup(builder) {
    builder.onResolve({filter: /^cloudflare:workers$/}, () => ({path: 'workers', namespace: 'fixture'}));
    builder.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: 'export class DurableObject {} export class WorkerEntrypoint {}', loader: 'js'}));
  }}],
});
const {CoordinatorDO, ShardDO} = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

test('a D1 reservation committed before its response is lost can be stopped and settled without starting a container', async t => {
  const {db, DB} = sqliteD1(); t.after(() => db.close());
  const now = Date.now(), id='attempt-shard', renderId='render-shard', opId='operation-shard';
  const token='11111111-1111-4111-8111-111111111111', imageDigest='sha256:'+'a'.repeat(64);
  const file = new TextEncoder().encode('<html>Shard fixture</html>');
  const project = {schemaVersion:'1.0.0',kind:'native_project',entry:'index.html',
    runtime:{name:'huashu-motion',commit:NATIVE_COMMIT},
    composition:{durationSeconds:15,fps:30,width:1920,height:1080},
    files:[{path:'index.html',key:'evals/native/index.html',sha256:sha256Bytes(file),byteLength:file.length,mediaType:'text/html'}],resources:[]};
  const task = {schemaVersion:'1.0.0',kind:'native_render_task',taskId:id,renderId,operationId:opId,
    generation:0,deadlineAt:now+120_000,leaseToken:token,queuedAt:now-1000,imageDigest,
    instance:nativeRenderPolicy.instance,rendererRelease:'native-release',runtimeVersion:NATIVE_COMMIT,
    revisionId:await nativeProjectHash(project),mode:'preview',frames:[0,5],project};
  db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(opId,'workspace-one','project-one',0,'evaluation','active','request',3000000,now,null,null);
  db.prepare('INSERT INTO renderer_releases VALUES(?,?,?,?,?)').run('native-release',imageDigest,NATIVE_COMMIT,'release.json','active');
  db.prepare(`INSERT INTO pipeline_renders(id,operation_id,generation,request_hash,job_key,status,created_at,
    queue_deadline_at,operation_deadline_at,mode) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(renderId,opId,0,'request','renders/'+renderId+'/input.json','rendering',now,now+60_000,now+600_000,'preview');
  db.prepare(`INSERT INTO pipeline_render_admissions
    (id,render_id,operation_id,generation,workspace_id,attempt_index,status,requested_at,queue_deadline_at,
      lease_token,admitted_at,attempt_deadline_at) VALUES(?,?,?,?,?,?,'running',?,?,?,?,?)`)
    .run(id,renderId,opId,0,'workspace-one',0,now-1000,now+60_000,token,now,task.deadlineAt);
  db.prepare(`INSERT INTO pipeline_attempts(id,render_id,operation_id,generation,mode,instance,status,started_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(id,renderId,opId,0,'native_preview',task.instance,'active',now);

  // The SQL insert commits, but its reply vanishes. This used to leave the
  // Shard without taskId and the lease permanently occupied.
  let reserveLost = false, releases = 0, starts = 0;
  const env = {DB: {...DB, prepare(sql) {
    const prepared = DB.prepare(sql);
    if (!sql.startsWith('INSERT INTO cost_reservations')) return prepared;
    return {bind(...args) {
      const bound = prepared.bind(...args);
      return {async run() {const value=await bound.run(); reserveLost=true; throw Error('Network connection lost.');}};
    }};
  }}, COORDINATOR:{getByName() {return {
    async assertLease() {},
    async release(attemptId, leaseToken) {
      assert.equal(attemptId,id); assert.equal(leaseToken,token);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cost_settlements WHERE reservation_id=?').get(id).n, 1);
      releases++;
      await DB.prepare("UPDATE pipeline_render_admissions SET status='released' WHERE id=? AND lease_token=?")
        .bind(id,token).run();
    },
  };}}};
  const memory = new Map();
  const storage = {
    async get(key) {return memory.get(key);},
    async put(key, value) {if (typeof key === 'object') for (const [k,v] of Object.entries(key)) memory.set(k,v);
      else memory.set(key,value);},
    transactionSync(action) {return action();},
    async setAlarm() {}, async deleteAlarm() {},
    kv:{get(key) {return memory.get(key);}, put(key,value) {memory.set(key,value);}},
  };
  const shard = Object.create(ShardDO.prototype);
  shard.env=env;
  shard.ctx={storage,container:{running:false,images:{render:imageDigest},start() {starts++;}}};
  await assert.rejects(shard.execute(canonical(task)), /RENDER_STARTUP_CONNECTION_LOST/);
  assert.equal(reserveLost,true);
  assert.equal(memory.get('taskId'),id,'identity was durably bound before reservation');
  assert.equal(memory.get('workFinished'), true, 'the completed failed coroutine persists its outcome across restarts');
  assert.equal(memory.has('startedAt'),false);
  assert.equal(starts,0);
  assert.equal(releases,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cost_reservations').get().n,1);
  const settlement = db.prepare('SELECT actual_micros,usage_json FROM cost_settlements WHERE reservation_id=?').get(id);
  assert.equal(settlement.actual_micros,0,'no start evidence permits a confirmed zero compute duration');
  assert.equal(parseCanonicalJson(settlement.usage_json).runningMs,0);
  assert.equal(db.prepare('SELECT status FROM pipeline_render_admissions').get().status,'released');
  assert.equal(db.prepare('SELECT status FROM pipeline_attempts').get().status,'stopped');
});

test('Shard success recovery validates the durable task scope and never starts a container', async () => {
  const expected={attemptId:'attempt-one',renderId:'render-one',operationId:'operation-one',generation:0,
    leaseToken:'11111111-1111-4111-8111-111111111111'};
  const outcome={status:'succeeded',outputs:[],report:{fixture:'durable'}};
  let stops=0;
  const shard=Object.create(ShardDO.prototype);
  shard.ctx={storage:{async get(key) {return key==='result'?outcome:key==='taskScope'?expected:undefined;}}};
  shard.stopAndSettle=async()=>{stops++;};
  assert.equal(parseCanonicalJson(await shard.recoverCompletedResult(expected)).status,'succeeded');
  assert.equal(stops,1);
  await assert.rejects(shard.recoverCompletedResult({...expected,generation:1}), /RENDER_ATTEMPT_SCOPE_INVALID/);
  assert.equal(stops,1,'an incorrect generation cannot trigger physical cleanup or restore a result');
});

test('a still-running Shard coroutine cannot report an absent result as final', async () => {
  const expected={attemptId:'attempt-one',renderId:'render-one',operationId:'operation-one',generation:0,
    leaseToken:'11111111-1111-4111-8111-111111111111'};
  const outcome={status:'succeeded',outputs:[],report:{fixture:'delayed success'}};
  let saved=null, finish, stops=0;
  const running=new Promise(resolve=>{finish=resolve;});
  const shard=Object.create(ShardDO.prototype);
  shard.work=running.then(()=>{saved=outcome; return outcome;});
  shard.ctx={storage:{async get(key) {return key==='result'?saved:key==='taskScope'?expected:undefined;}}};
  shard.stopAndSettle=async()=>{stops++;};
  const recovery=shard.recoverCompletedResult(expected);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(stops,0,'the pending coroutine must not be mistaken for a failed attempt');
  finish();
  assert.deepEqual(parseCanonicalJson(await recovery).report,outcome.report);
  assert.equal(stops,1);
});

test('a restarted Shard with a bound unfinished request keeps the outcome unknown', async () => {
  const expected={attemptId:'attempt-one',renderId:'render-one',operationId:'operation-one',generation:0,
    leaseToken:'11111111-1111-4111-8111-111111111111'};
  const memory = new Map([['requestHash', 'a'.repeat(64)], ['taskScope', expected]]);
  const shard = Object.create(ShardDO.prototype);
  shard.ctx = {storage: {async get(key) {return memory.get(key);}}};
  await assert.rejects(shard.recoverCompletedResult(expected), /RENDER_ATTEMPT_OUTCOME_UNKNOWN/,
    'a DO restart erases the in-memory Promise, not the uncertainty of its outcome');
  memory.set('workFinished', true);
  assert.equal(await shard.recoverCompletedResult(expected), null, 'a durable completed failure may be reconciled');
});

test('an observed running container without start time remains unknown across Shard restarts', async t => {
  const {db, DB} = sqliteD1(); t.after(() => db.close());
  db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('operation-one','workspace','project',0,'evaluation','active','request',3000000,Date.now(),null,null);
  db.prepare('INSERT INTO cost_reservations VALUES(?,?,?,?,?,?,?,?)')
    .run('attempt-one','operation-one','hash','compute','render',100,'fixture',Date.now());
  const memory=new Map([['taskId','attempt-one'],['instance','standard-3'],['requestHash','hash']]);
  const container={running:true,async destroy() {this.running=false;}};
  const shard=Object.create(ShardDO.prototype);
  shard.ctx={container,storage:{kv:{put(key,value) {memory.set(key,value);}},
    async get(key) {return memory.get(key);}, async put(key,value) {memory.set(key,value);}}};
  shard.env={DB,COORDINATOR:{getByName() {return {async release() {assert.fail('unknown cost cannot release its lease');}};}}};
  await assert.rejects(shard.stopAndSettle(false), /COMPUTE_USAGE_UNKNOWN/);
  assert.equal(container.running,false);
  assert.equal(memory.get('usageUnknown'),true);
  const restarted=Object.create(ShardDO.prototype);
  restarted.ctx=shard.ctx; restarted.env=shard.env;
  await assert.rejects(restarted.stopAndSettle(), /COMPUTE_USAGE_UNKNOWN/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n,0);
});

test('a delayed reserve insert cannot commit after a restarted Shard stopped and released its attempt', async t => {
  const {db,DB}=sqliteD1();t.after(()=>db.close());
  const now=Date.now(), id='attempt-late', op={id:'operation-late',workspace_id:'workspace-one',project_id:'project-one',
    generation:0,purpose:'evaluation',status:'active',max_micros:3000000}, renderId='render-late';
  const token='11111111-1111-4111-8111-111111111111', request={taskId:id};
  db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(op.id,op.workspace_id,op.project_id,0,'evaluation','active','request',op.max_micros,now,null,null);
  db.prepare(`INSERT INTO pipeline_renders(id,operation_id,generation,request_hash,job_key,status,created_at)
    VALUES(?,?,?,?,?,?,?)`).run(renderId,op.id,0,'request','renders/late/input.json','rendering',now);
  db.prepare(`INSERT INTO pipeline_render_admissions
    (id,render_id,operation_id,generation,workspace_id,attempt_index,status,requested_at,queue_deadline_at,
      lease_token,admitted_at,attempt_deadline_at) VALUES(?,?,?,?,?,?,'running',?,?,?,?,?)`)
    .run(id,renderId,op.id,0,op.workspace_id,0,now,now+60_000,token,now,now+120_000);
  db.prepare(`INSERT INTO pipeline_attempts(id,render_id,operation_id,generation,mode,instance,status,started_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(id,renderId,op.id,0,'native_export',nativeRenderPolicy.instance,'active',now);
  let letInsertRun, sawInsert;
  const waiting=new Promise(resolve=>{letInsertRun=resolve;});
  const insertEntered=new Promise(resolve=>{sawInsert=resolve;});
  const delayedDB={...DB,prepare(sql) {
    const prepared=DB.prepare(sql);
    if (!sql.startsWith('INSERT INTO cost_reservations')) return prepared;
    return {bind(...args) {
      const bound=prepared.bind(...args);
      return {async run() {sawInsert();await waiting;return bound.run();}};
    }};
  }};
  const lateReservation=reserve({DB:delayedDB},op,id,'compute','render',500,request,'fixture',10000000);
  await insertEntered;

  // A new DO instance has no knowledge of the old instance's in-flight Promise.
  const memory=new Map([['taskId',id],['instance',nativeRenderPolicy.instance],['requestHash',digest(request)],['leaseToken',token]]);
  let released=0;
  const shard=Object.create(ShardDO.prototype);
  shard.ctx={container:{running:false},storage:{kv:{put(key,value) {memory.set(key,value);}},
    async get(key) {return memory.get(key);},async deleteAlarm() {}}};
  shard.env={DB,COORDINATOR:{getByName() {return {async release(attemptId,leaseToken) {
    assert.equal(attemptId,id);assert.equal(leaseToken,token);released++;
    await DB.prepare("UPDATE pipeline_render_admissions SET status='released' WHERE id=? AND lease_token=?")
      .bind(id,token).run();
  }};}}};
  await shard.stopAndSettle();
  assert.equal(released,1);
  assert.equal(db.prepare('SELECT status FROM pipeline_attempts').get().status,'stopped');
  letInsertRun();
  await assert.rejects(lateReservation,/COST_BUDGET_EXHAUSTED/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cost_reservations').get().n,0);
});

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

test('one hung Shard stop cannot prevent other expired leases from releasing and rearming', async t => {
  const leases = new Map([
    ['stuck', {id:'stuck',token:'stuck-token',deadline:Date.now()-100}],
    ['no-start', {id:'no-start',token:'free-token',deadline:Date.now()-100}],
  ]);
  const originalSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) =>
    originalSetTimeout(callback, Math.min(ms, 15), ...args));
  let rearmed = 0, stopCalls = 0;
  const coordinator = Object.create(CoordinatorDO.prototype);
  coordinator.ctx = {storage: {
    sql: {exec(query) {
      if (query.startsWith('SELECT * FROM leases')) return {toArray() {return [...leases.values()];}};
      if (query.startsWith('SELECT id FROM leases')) return {toArray() {return [...leases.values()].slice(0, 1);}};
      throw Error('UNEXPECTED_QUERY: ' + query);
    }},
    async getAlarm() {return null;}, async setAlarm() {rearmed++;},
  }};
  coordinator.env = {
    DB: {prepare() {return {bind(id) {return {async first() {return id === 'stuck' ? {id} : null;}};}};}},
    SHARDS: {getByName() {return {async stopAndSettle() {stopCalls++; return new Promise(() => {});}};}},
  };
  coordinator.release = async (id, token) => {
    assert.equal(token, leases.get(id)?.token);
    leases.delete(id);
  };
  await coordinator.alarm();
  assert.equal(stopCalls, 1);
  assert.deepEqual([...leases.keys()], ['stuck'], 'the unconfirmed stop remains counted against capacity');
  assert.equal(rearmed, 1, 'a failed cleanup never suppresses the next alarm');
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
