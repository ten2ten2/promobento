import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sha256Bytes} from '../../../packages/contracts/src/digest.mjs';
import {fileIdentity} from '../../../packages/native-motion/src/files.mjs';
import {brokerClient} from '../src/broker.mjs';
import {monitorResources} from '../src/resources.mjs';
import {mapIO} from '../src/process.mjs';

test('authorized I/O stays bounded, preserves file order and drains already-started work before cleanup',async()=>{
 let active=0,max=0;
 const result=await mapIO([0,1,2,3,4,5],async value=>{active++;max=Math.max(max,active);await setImmediate();active--;return value*2;});
 assert.deepEqual(result,[0,2,4,6,8,10]);assert.equal(max,4);assert.equal(active,0);
 let release,finished=false;const waiting=new Promise(resolve=>release=resolve),started=[];
 const failed=mapIO([0,1,2,3,4,5],async value=>{
  started.push(value);active++;
  try{if(value===0)throw Error('BROKER_WRITE_DENIED');await waiting;return value;}
  finally{active--;}
 });
 failed.finally(()=>{finished=true;}).catch(()=>{});await setImmediate();
 assert.deepEqual(started,[0,1,2,3]);assert.equal(active,3);assert.equal(finished,false);
 release();await assert.rejects(failed,/BROKER_WRITE_DENIED/);assert.equal(active,0);assert.deepEqual(started,[0,1,2,3]);
 active=0;max=0;
 await mapIO([0,1,2,3,4],async()=>{active++;max=Math.max(max,active);await setImmediate();active--;},2);
 assert.equal(max,2);
});

test('streamed broker downloads authenticate length and hash before the file can be used', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'promobento-io-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const originalFetch = globalThis.fetch;
  t.after(() => {globalThis.fetch = originalFetch;});
  const bytes = Buffer.alloc(5 << 20, 17);
  bytes[0] = 99; bytes[bytes.length - 1] = 42;
  const valid = {key: 'inputs/asset.bin', sha256: sha256Bytes(bytes), byteLength: bytes.length};
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.authorization, 'Bearer allowed-token');
    let at = 0;
    return new Response(new ReadableStream({pull(controller) {
      if (at === bytes.length) {controller.close(); return;}
      controller.enqueue(bytes.subarray(at, at + 16384)); at += 16384;
    }}));
  };
  const broker = brokerClient('allowed-token', new AbortController().signal);
  await broker.readToFile(valid, join(dir, 'valid.bin'));
  assert.deepEqual(fileIdentity(join(dir, 'valid.bin')), {sha256: valid.sha256, byteLength: valid.byteLength});
  await assert.rejects(broker.readToFile({...valid, sha256: '0'.repeat(64)}, join(dir, 'bad-hash.bin')),
    /BROKER_INPUT_IDENTITY_MISMATCH/);
  await assert.rejects(broker.readToFile({...valid, byteLength: valid.byteLength - 1}, join(dir, 'oversize.bin')),
    /BROKER_INPUT_TOO_LARGE/);
  assert.deepEqual(readFileSync(join(dir, 'valid.bin')), bytes);
});

test('streamed broker uploads send fixed-sized chunks and declared SHA-256; file identity rejects symlinks', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'promobento-io-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const originalFetch = globalThis.fetch;
  t.after(() => {globalThis.fetch = originalFetch;});
  const path = join(dir, 'film.mp4'), bytes = Buffer.alloc(6 << 20, 29);
  writeFileSync(path, bytes);
  const identity = fileIdentity(path);
  const link = join(dir, 'symlink.mp4'); symlinkSync(path, link);
  assert.throws(() => fileIdentity(link), /ELOOP/);
  let maxChunk = 0, totalBytes = 0;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.duplex, 'half');
    assert.ok(options.body instanceof ReadableStream);
    assert.equal(options.headers['content-length'], String(identity.byteLength));
    assert.equal(options.headers['x-content-sha256'], identity.sha256);
    for await (const chunk of options.body) {totalBytes += chunk.length; maxChunk = Math.max(maxChunk, chunk.length);}
    return new Response(null, {status: 201});
  };
  const broker = brokerClient('allowed-token', new AbortController().signal);
  assert.deepEqual(await broker.writeFile('renders/one/out/film.mp4', path, identity, 'video/mp4'),
    {key: 'renders/one/out/film.mp4', ...identity, mediaType: 'video/mp4'});
  assert.equal(totalBytes, bytes.length);
  assert.ok(maxChunk <= 64 << 10);
  await assert.rejects(broker.writeFile('renders/one/out/film.mp4', link, identity, 'video/mp4'), /ELOOP/);
});

test('resource telemetry is marked by origin and never substitutes controller RSS for container peak', () => {
  const monitor = monitorResources(50);
  const observed = monitor.stop();
  assert.equal(monitor.stop(), observed);
  assert.equal(observed.source, 'container_cgroup_v2_and_controller_samples');
  assert.ok(observed.controllerRssSamplePeakBytes > 0);
  assert.ok(!Object.hasOwn(observed,'diskUsedSamplePeakBytes'),'statfs is not a task-directory usage measurement');
  assert.equal(observed.filesystemUsedSamplePeakBytes===null,observed.filesystemUsedIncreaseSamplePeakBytes===null);
  if(observed.filesystemUsedSamplePeakBytes!==null)
    assert.ok(observed.filesystemUsedIncreaseSamplePeakBytes<=observed.filesystemUsedSamplePeakBytes);
  for (const [key,value] of Object.entries(observed)) {
    if (key.endsWith('Bytes') || key.endsWith('Delta') || key.endsWith('Peak'))
      assert.ok(value === null || Number.isFinite(value) && value >= 0, key);
  }
});
