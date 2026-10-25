import test from 'node:test';
import assert from 'node:assert/strict';
import {panelProjection,panelUnprojection,blendPyramids} from '../src/projected-media.ts';

test('CPU panel projection preserves the original centered 1800px camera and translated depth',()=>{
  const box={x:100,y:50,width:200,height:100},flat=panelProjection(box,0,0,0);
  assert.deepEqual(flat(0,0),{x:100,y:50});assert.deepEqual(flat(200,100),{x:300,y:150});
  // At a depth equal to the focal distance, the panel is half-size around its center.
  // A 100px world translation therefore moves its projected center by only 50px.
  const distant=panelProjection(box,100,-1800,0);
  assert.deepEqual(distant(0,0),{x:200,y:75});assert.deepEqual(distant(100,50),{x:250,y:100});
  assert.deepEqual(distant(200,100),{x:300,y:125});
  for(const [x,z,angle,zoom,y]of [[0,0,0,1,0],[320,-80,-.2,1,0],[-540,-150,.3,1,0],[0,0,-.15,.92,40]]){
    const project=panelProjection(box,x,z,angle,zoom,y),unproject=panelUnprojection(box,x,z,angle,zoom,y);
    for(const point of [[0,0],[100,50],[200,100]]){
      const screen=project(...point),actual=unproject(screen.x,screen.y);
      assert.ok(Math.abs(actual.x-point[0])<1e-10&&Math.abs(actual.y-point[1])<1e-10);
    }
  }
});

test('static panel fades blend premultiplied pixels and replay without touching source levels',()=>{
  const a=[{width:2,height:1,data:new Uint8ClampedArray([200,0,0,128,10,20,30,255])}],
    b=[{width:2,height:1,data:new Uint8ClampedArray([0,0,200,192,10,20,30,255])}],blend=blendPyramids(a,b);
  assert.deepEqual([...blend.render(.5)[0].data],[80,0,120,160,10,20,30,255]);
  const first=[...blend.render(.25)[0].data];blend.render(1);blend.render(0);
  assert.deepEqual([...blend.render(.25)[0].data],first);
  assert.deepEqual([...blend.render(1)[0].data],[...b[0].data]);assert.deepEqual([...blend.render(0)[0].data],[...a[0].data]);
  assert.deepEqual([...a[0].data],[200,0,0,128,10,20,30,255]);assert.deepEqual([...b[0].data],[0,0,200,192,10,20,30,255]);
});
