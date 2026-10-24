import test from 'node:test';
import assert from 'node:assert/strict';
import {pngPixels,pngRgba} from '@promobento/contracts/seams';
import {reviewPng} from '../src/review-pixels.mjs';

test('review downsamples exact full-size pixels with integer rounding and premultiplied transparency',()=>{
  const opaque=pngRgba(2,2,Uint8Array.from([10,20,30,255,11,21,31,255,12,22,32,255,13,23,33,255]));
  const result=pngPixels(reviewPng(opaque));assert.equal(result.width,1);assert.equal(result.height,1);
  assert.deepEqual([...result.pixels],[12,22,32,255]);
  const alpha=pngRgba(2,2,Uint8Array.from([255,0,0,255,0,0,255,0,0,0,255,0,0,0,255,0]));
  assert.deepEqual([...pngPixels(reviewPng(alpha)).pixels],[255,0,0,64]);
  assert.throws(()=>reviewPng(pngRgba(3,2,new Uint8Array(24))),/REVIEW_PNG_DIMENSIONS_INVALID/);
});
