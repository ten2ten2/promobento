import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {build} from 'esbuild';
import {NATIVE_RUNTIME_COMMIT} from '../../../packages/contracts/src/native-project.mjs';

test('overlapping task request bodies can claim the one-task container only once', async t => {
  let handler, downloads = 0;
  globalThis.__controllerRace = {
    process: {getuid: () => 10001, umask() {}, on() {}, stdin: {on() {}}},
    http: {createServer(callback) {handler = callback; return {listen() {}};}},
    fs: {mkdirSync() {}},
    broker: {readToFile() {downloads++; return new Promise(() => {});}},
  };
  t.after(() => {delete globalThis.__controllerRace;});
  const built = await build({
    entryPoints: ['apps/render-container/src/controller.mjs'], bundle: true, write: false,
    platform: 'node', format: 'esm', target: 'node26',
    define: {process: 'globalThis.__controllerRace.process'},
    plugins: [{name: 'controller-boundaries', setup(b) {
      b.onResolve({filter: /^(node:http|node:fs|\.\/broker\.mjs|\.\/resources\.mjs)$/}, args =>
        args.importer.endsWith('/controller.mjs') ? {path: args.path, namespace: 'fixture'} : undefined);
      b.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({loader: 'js', contents:
        args.path === 'node:http' ? 'export default globalThis.__controllerRace.http;' :
        args.path === 'node:fs' ? 'export const {existsSync,mkdirSync,readFileSync,realpathSync,rmSync,statSync,writeFileSync}=globalThis.__controllerRace.fs;' :
        args.path === './broker.mjs' ? 'export const brokerClient=()=>globalThis.__controllerRace.broker;' :
        'export const monitorResources=()=>({stop:()=>({})});'
      }));
    }}],
  });
  await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
  const project = {schemaVersion: '1.0.0', kind: 'native_project', entry: 'index.html',
    runtime: {name: 'huashu-motion', commit: NATIVE_RUNTIME_COMMIT},
    composition: {width: 1920, height: 1080, durationSeconds: 15, fps: 30}, resources: [],
    files: [{path: 'index.html', key: 'input/index.html', sha256: 'a'.repeat(64), byteLength: 10, mediaType: 'text/html'}]};
  const responses = [], release = [];
  const requests = [0, 1].map(index => {
    const bodyReady = new Promise(resolve => {release[index] = resolve;});
    const request = {method: 'POST', url: '/task', headers: {'content-type': 'application/json'},
      async *[Symbol.asyncIterator]() {
        await bodyReady;
        yield Buffer.from(JSON.stringify({taskId: 'task-' + index, renderId: 'render', mode: 'preview', project, brokerToken: 'test'}));
      }};
    const response = {writeHead(status) {responses[index] = {status}; return this;}, end(body) {responses[index].body = JSON.parse(body);}};
    return handler(request, response);
  });
  await setImmediate(); // Both handlers are waiting on their request bodies.
  release[0](); await requests[0];
  release[1](); await requests[1];
  assert.deepEqual(responses.map(response => response.status), [202, 409]);
  assert.equal(responses[1].body.error, 'CONTAINER_ALREADY_USED');
  assert.equal(downloads, 1, 'the rejected second request must never hydrate or launch another task');
});
