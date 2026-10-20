import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonical, digest, parseCanonicalJson, contentIdentity } from '../index.mjs';

// Expected UTF-8 strings are explicit; SHA-256 values were independently produced with Python hashlib.
const vectors = parseCanonicalJson(readFileSync(new URL('./canonical-vectors.json', import.meta.url)));
for (const vector of vectors) test('JCS vector: ' + vector.name, () => {
  const value = parseCanonicalJson(vector.input);
  assert.equal(canonical(value), vector.canonical);
  assert.equal(digest(value), vector.sha256);
});

test('content identity fixes target order and ignores descriptive metadata', () => {
  const value = parseCanonicalJson(readFileSync(new URL('../../../contracts/composition.example.json', import.meta.url)));
  const before = canonical(contentIdentity(value));
  value.variants.reverse(); value.textMetadata = [{label:'new description',language:'mul'}];
  assert.equal(canonical(contentIdentity(value)), before);
});

test('serialized input rejects duplicate decoded property names at every nesting level', () => {
  for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '[{"a":{"same":1,"same":2}}]', '{"__proto__":1,"__proto__":2}']) {
    assert.throws(() => parseCanonicalJson(text), /DUPLICATE_JSON_KEY/u);
  }
  const text = '{"a":{"same":1},"b":{"same":2},"s":"} , : [ \\\" \\\\"}';
  assert.deepEqual(parseCanonicalJson(text), JSON.parse(text));
});

test('invalid Unicode, malformed UTF-8 and numeric overflow cannot get a content identity', () => {
  for (const text of ['"\\ud800"', '"\\udc00"', '{"\\ud800":1}', '1e400']) assert.throws(() => parseCanonicalJson(text));
  assert.throws(() => parseCanonicalJson(new Uint8Array([0x22, 0xc0, 0xaf, 0x22])));
  for (const value of [NaN, Infinity, -Infinity, '\ud800', '\udc00', { '\ud800': 1 }]) assert.throws(() => canonical(value));
});

test('non-JSON objects, accessors, cycles and array holes are rejected without invoking code', () => {
  let reads = 0;
  const accessor = { get value() { reads++; return 1; } };
  const cycle = {}; cycle.self = cycle;
  for (const value of [undefined, 1n, new Date(0), accessor, cycle, new Array(1), [undefined], { value: undefined }]) {
    assert.throws(() => canonical(value));
  }
  assert.equal(reads, 0);
  let deep = 0;
  for (let i = 0; i < 66; i++) deep = [deep];
  assert.throws(() => canonical(deep), /MAX_DEPTH/u);
  assert.throws(() => parseCanonicalJson(JSON.stringify(deep)), /MAX_DEPTH/u);
});

test('normalization remains a content change and parsed prototype-named keys remain data', () => {
  assert.notEqual(digest('é'), digest('é'));
  const value = parseCanonicalJson('{"__proto__":{"polluted":true}}');
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(Object.hasOwn(value, '__proto__'), true);
  assert.equal(canonical(value), '{"__proto__":{"polluted":true}}');
  assert.equal({}.polluted, undefined);
});
