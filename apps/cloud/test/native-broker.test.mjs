import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {sha256Bytes} from '@promobento/contracts/digest';
import {fixedLengthOf} from './fixtures/fixed-length.mjs';

const bundle = await build({
  stdin: {contents: 'export {Broker} from "./apps/cloud/src/compute.ts";', resolveDir: process.cwd()},
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node26',
  plugins: [{name: 'cloudflare-worker-fixture', setup(builder) {
    builder.onResolve({filter: /^cloudflare:workers$/}, () => ({path: 'workers', namespace: 'fixture'}));
    builder.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: 'export class DurableObject {} export class WorkerEntrypoint {}', loader: 'js'}));
  }}],
});
const {Broker} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function fixture() {
  const objects = new Map();
  let enabled = true, rightsValid = true, puts = 0, largestChunk = 0;
  const scope = {token: 'broker-secret', operationId: 'scope-op', generation: 0,
    reads: ['inputs/verified.dat'], resources:[{resourceId:'res_broker',sha256:'a'.repeat(64)}],
    prefix: 'renders/render-one/attempts/attempt-one/out', attemptId: 'attempt-one'};
  const storage = {
    async head(key) {return key === 'rights/broker-evidence' ? {size: 2} : objects.get(key) ?? null;},
    async get(key) {return objects.get(key) ?? null;},
    async put(key, stream, options) {
      puts++;
      assert.ok(stream instanceof ReadableStream, 'R2 receives a backpressured stream, not a whole-file buffer');
      assert.ok(Number.isSafeInteger(fixedLengthOf(stream)),
        'R2 must receive a runtime-known length, not an ordinary TransformStream');
      assert.equal(typeof options.sha256, 'string');
      assert.equal(options.onlyIf.get('If-None-Match'), '*');
      let length = 0;
      const chunks = [];
      for await (const chunk of stream) {
        largestChunk = Math.max(largestChunk, chunk.length);
        length += chunk.length; chunks.push(chunk);
      }
      assert.equal(length, fixedLengthOf(stream));
      const bytes = Buffer.concat(chunks, length), hash = sha256Bytes(bytes);
      if (hash !== options.sha256) throw Error('R2_CHECKSUM_MISMATCH');
      if (objects.has(key)) return null;
      const object = {size: bytes.length, customMetadata: options.customMetadata,
        checksums: {sha256: Buffer.from(hash, 'hex')},
        body: new ReadableStream({start(controller) {controller.enqueue(bytes); controller.close();}})};
      objects.set(key, object);
      return object;
    },
  };
  const broker = Object.create(Broker.prototype);
  broker.ctx = {props: scope};
  broker.env = {MEDIA: storage, DB: {prepare(sql) {return {bind() {return this;}, async first() {
    if (sql.includes('FROM pipeline_rights')) return rightsValid ? {evidence_key:'rights/broker-evidence',license_ref:'fixture'} : null;
    return enabled ? {id: scope.operationId, status: 'active', generation: scope.generation} : null;
  }};}}};
  const key = scope.prefix + '/film.mp4';
  const request = (data, length = data.length, sha256 = sha256Bytes(data)) => new Request('http://broker.internal/w/' + key, {
    method: 'PUT', duplex: 'half', headers: {
      authorization: 'Bearer ' + scope.token, 'content-length': String(length),
      'x-content-sha256': sha256, 'content-type': 'video/mp4',
    }, body: new ReadableStream({start(controller) {
      for (let offset = 0; offset < data.length; offset += 4096) controller.enqueue(data.subarray(offset, offset + 4096));
      controller.close();
    }}),
  });
  return {broker, objects, key, request, scope, setEnabled(value) {enabled = value;},setRightsValid(value) {rightsValid = value;},
    get puts() {return puts;}, get largestChunk() {return largestChunk;}};
}

test('broker writes only checked streaming bytes with R2-enforced SHA-256 and immutable keys', async () => {
  const observed = fixture();
  const {broker, objects, key, request, scope} = observed;
  const data = Buffer.alloc(3 << 20, 0x5a), hash = sha256Bytes(data);
  assert.equal((await broker.fetch(request(data))).status, 201);
  assert.equal(observed.puts, 1);
  assert.ok(observed.largestChunk <= 4096);
  assert.equal(objects.get(key).size, data.length);
  assert.equal(objects.get(key).customMetadata.sha256, hash);
  assert.equal((await broker.fetch(request(data))).status, 201, 'an identical key may be safely acknowledged');
  assert.equal(observed.puts, 1, 'duplicate ACK must not rewrite R2');
  const changed = Buffer.from(data); changed[0] ^= 0xff;
  assert.equal((await broker.fetch(request(changed, changed.length, hash))).status, 422,
    'a matching header cannot ACK different incoming bytes');
  assert.equal((await broker.fetch(request(Buffer.alloc(data.length, 1)))).status, 409);
  assert.equal((await broker.fetch(new Request('http://broker.internal/r/inputs/verified.dat', {
    headers: {authorization: 'Bearer ' + scope.token}}))).status, 404);
});

test('broker rejects short, excess and wrong-checksum uploads before ACK', async () => {
  for (const kind of ['short', 'excess', 'checksum']) {
    const {broker, objects, key, request} = fixture();
    const data = Buffer.alloc(8192, 7);
    const response = kind === 'short' ? await broker.fetch(request(data, data.length + 1))
      : kind === 'excess' ? await broker.fetch(request(data, data.length - 1))
      : await broker.fetch(request(data, data.length, 'a'.repeat(64)));
    assert.equal(response.status, 422, kind);
    assert.equal(objects.has(key), false, 'a failed upload must never leave an apparently valid object');
  }
});

test('a conditional-write race is not ACKed before the incoming bytes are proven', async () => {
  const {broker, objects, key, request} = fixture();
  const bytes = Buffer.alloc(8192, 4);
  assert.equal((await broker.fetch(request(bytes))).status, 201);
  const head = broker.env.MEDIA.head.bind(broker.env.MEDIA);
  let first = true;
  broker.env.MEDIA.head = async path => {
    if (first) {first = false; return null;}
    return head(path);
  };
  assert.equal((await broker.fetch(request(bytes))).status, 409,
    'the losing upload must retry with an authenticated body');
  assert.equal(objects.get(key).size, bytes.length);
  assert.equal((await broker.fetch(request(bytes))).status, 201);
  objects.get(key).checksums.sha256 = Buffer.alloc(32);
  assert.equal((await broker.fetch(request(bytes))).status, 409, 'a mismatching persisted checksum cannot be ACKed');
});

test('broker fences authorization and requires a verified attempt-scoped prefix', async () => {
  const {broker, request, objects, scope, setEnabled} = fixture();
  const bytes = Buffer.from('video');
  setEnabled(false);
  assert.equal((await broker.fetch(request(bytes))).status, 403);
  assert.equal(objects.size, 0);
  setEnabled(true);
  assert.equal((await broker.fetch(new Request('http://broker.internal/w/renders/other/out/film.mp4', {
    method: 'PUT', body: bytes, headers: {authorization: 'Bearer ' + scope.token}}))).status, 403);
  assert.equal((await broker.fetch(new Request('http://broker.internal/w/' + scope.prefix + '/film.mp4', {
    method: 'PUT', body: bytes, headers: {authorization: 'Bearer wrong'}}))).status, 403);
});

test('broker refuses source downloads after rights revocation during an admitted attempt',async()=>{
  const {broker,objects,scope,setRightsValid}=fixture();
  const original=Buffer.from('licensed source');
  objects.set('inputs/verified.dat',{size:original.length,body:new ReadableStream({start(controller){controller.enqueue(original);controller.close();}})});
  const request=()=>new Request('http://broker.internal/r/inputs/verified.dat',{headers:{authorization:'Bearer '+scope.token}});
  assert.equal((await broker.fetch(request())).status,200);
  setRightsValid(false);
  assert.equal((await broker.fetch(request())).status,403,'a queued source read must not bypass a new revoke');
});
