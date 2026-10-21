import test from 'node:test';
import assert from 'node:assert/strict';
import {frameTime,randomAt} from '../src/index.mjs';

test('frame addressing preserves exact time and rejects a missing or fractional frame',()=>{
  assert.deepEqual(frameTime(449,450),{numerator:449,denominator:30});
  for(const frame of [-1,450,0.5,NaN,Infinity]) assert.throws(()=>frameTime(frame,450),/FRAME_OUT_OF_RANGE/);
});

test('keyed random values do not depend on call order',()=>{
  const before=randomAt('scene','particle-2');
  for(let index=0;index<10;index++) randomAt('scene','particle-'+index);
  assert.equal(randomAt('scene','particle-2'),before);
  assert.notEqual(randomAt('other-scene','particle-2'),before);
  assert(before>=0&&before<1);
});
