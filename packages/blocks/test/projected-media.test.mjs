import test from 'node:test';
import assert from 'node:assert/strict';
import {panelProjection} from '../src/projected-media.ts';

test('CPU panel projection preserves the original centered 1800px camera and translated depth',()=>{
  const box={x:100,y:50,width:200,height:100},flat=panelProjection(box,0,0,0);
  assert.deepEqual(flat(0,0),{x:100,y:50});assert.deepEqual(flat(200,100),{x:300,y:150});
  // At a depth equal to the focal distance, the panel is half-size around its center.
  // A 100px world translation therefore moves its projected center by only 50px.
  const distant=panelProjection(box,100,-1800,0);
  assert.deepEqual(distant(0,0),{x:200,y:75});assert.deepEqual(distant(100,50),{x:250,y:100});
  assert.deepEqual(distant(200,100),{x:300,y:125});
});
