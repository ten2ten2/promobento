import test from 'node:test';
import assert from 'node:assert/strict';
import {pngPixels} from '@promobento/contracts/seams';
import {pngRgba,reviewContactSheet} from '../src/director-sheets.mjs';

test('review sheets retain every actual frame in time order with undistorted pixels and exact source metadata',async()=>{
 const frames=Array.from({length:20},(_,index)=>({key:'renders/fixture/observation-frames/'+(index*30)+'.png',sha256:'a'.repeat(64),byteLength:74}));
 const bytes=pngRgba(2,1,Uint8Array.from([255,0,0,255,0,0,255,255]));
 const loaded=[],sheet=await reviewContactSheet({aspect:'landscape',frames:[...frames].reverse(),load:async blob=>{loaded.push(blob.key);return bytes;}});
 assert.deepEqual(sheet.tiles.map(tile=>tile.frame),frames.map((_,index)=>index*30));assert.equal(loaded.length,20);assert.deepEqual(sheet.tiles.map(tile=>tile.source),frames);
 const pixels=pngPixels(sheet.bytes);assert.equal(pixels.width,sheet.width);assert.equal(pixels.height,sheet.height);
 for(const tile of sheet.tiles){
  assert.equal(tile.width,tile.height*2);
  assert.deepEqual([...pixels.pixels.slice((tile.top*sheet.width+tile.left)*4,(tile.top*sheet.width+tile.left)*4+4)],[255,0,0,255]);
  const right=(tile.top*sheet.width+tile.left+tile.width-1)*4;assert.deepEqual([...pixels.pixels.slice(right,right+4)],[0,0,255,255]);
 }
 assert.ok(sheet.bytes.length<1<<20);assert.match(sheet.scope,/reading_hold/);
 await assert.rejects(reviewContactSheet({aspect:'landscape',frames:[],load:async()=>bytes}),/REVIEW_FRAME_COVERAGE_MISSING/);
 await assert.rejects(reviewContactSheet({aspect:'portrait',frames:[frames[0],frames[0]],load:async()=>bytes}),/REVIEW_FRAME_REFERENCE_INVALID/);
 let calls=0;await assert.rejects(reviewContactSheet({aspect:'landscape',frames:frames.slice(0,2),load:async()=>++calls===1?bytes:pngRgba(1,1,Uint8Array.from([0,0,0,255]))}),/REVIEW_FRAME_DIMENSIONS_MIXED/);
});
