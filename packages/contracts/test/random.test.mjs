import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCanonicalJson} from '../index.mjs';
import {randomSequence} from '../src/random.mjs';

test('random-seq-v1 has fixed UTF-8 vectors and resets its call index at every seek',()=>{
  const vectors=parseCanonicalJson(readFileSync(new URL('./random-vectors.json',import.meta.url)));
  for(const {seed,expected}of vectors){
    const random=randomSequence(seed);
    assert.deepEqual(expected.map(()=>random.next()),expected);
    random.next();random.reset();assert.deepEqual(expected.map(()=>random.next()),expected);
    assert.ok(expected.every(x=>x>=0&&x<1));
  }
  assert.throws(()=>randomSequence(null),/RANDOM_SEED_REQUIRED/);
  assert.throws(()=>randomSequence('\ud800'),/INVALID_UNICODE/);
});
