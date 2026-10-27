import test from 'node:test';
import assert from 'node:assert/strict';
import {pngPixels} from '@promobento/contracts/seams';
import {pngRgba,reviewContactSheet,selectCustomMotionFrames} from '../src/director-sheets.mjs';

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
 assert.ok(sheet.width<=960&&sheet.height<=1920);assert.deepEqual([...pixels.pixels.slice(0,4)],[40,50,61,255]);
 for(const tile of sheet.tiles){assert.equal(tile.label,'FRAME '+tile.frame);assert.ok(tile.left>=12&&tile.top>=36);}
 await assert.rejects(reviewContactSheet({aspect:'landscape',frames:[],load:async()=>bytes}),/REVIEW_FRAME_COVERAGE_MISSING/);
 await assert.rejects(reviewContactSheet({aspect:'portrait',frames:[frames[0],frames[0]],load:async()=>bytes}),/REVIEW_FRAME_REFERENCE_INVALID/);
 let calls=0;await assert.rejects(reviewContactSheet({aspect:'landscape',frames:frames.slice(0,2),load:async()=>++calls===1?bytes:pngRgba(1,1,Uint8Array.from([0,0,0,255]))}),/REVIEW_FRAME_DIMENSIONS_MIXED/);
});

test('review reduction preserves thin strokes and separates labelled frames from unused cells',async()=>{
 const width=960,height=540,pixels=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels.set(x%2?[255,255,255,255]:[0,0,0,255],(y*width+x)*4);
 const bytes=pngRgba(width,height,pixels),frames=[44,117,261].map(frame=>({key:'renders/test/observation-frames/'+frame+'.png'}));
 const sheet=await reviewContactSheet({aspect:'landscape',frames,load:async()=>bytes}),decoded=pngPixels(sheet.bytes);
 assert.equal(sheet.columns,2);assert.equal(sheet.rows,2);assert.equal(sheet.tiles.length,3);
 const tile=sheet.tiles[0],at=((tile.top+20)*sheet.width+tile.left+20)*4;
 assert.ok(decoded.pixels[at]>110&&decoded.pixels[at]<145,'minified black/white strokes retain their average instead of disappearing');
 assert.equal(decoded.pixels[at+3],255);assert.match(sheet.padding,/review_chrome_not_film_pixels/);
 const unusedLeft=sheet.tiles[1].left,unusedTop=sheet.tiles[2].top;
 assert.deepEqual([...decoded.pixels.slice((unusedTop*sheet.width+unusedLeft)*4,(unusedTop*sheet.width+unusedLeft)*4+4)],[40,50,61,255]);
});

test('relay keypose sheets preserve their own source scope without relabelling them as text QA',async()=>{
 const frames=[90,99,108,117,126].map(frame=>({key:'renders/fixture/motion-frames/'+frame+'.png'})),bytes=pngRgba(1,1,Uint8Array.from([0,180,255,255]));
 const sheet=await reviewContactSheet({aspect:'landscape',frames,load:async()=>bytes,sampleKind:'brand_relay_keyposes'});
 assert.deepEqual(sheet.tiles.map(tile=>tile.frame),[90,99,108,117,126]);assert.match(sheet.scope,/mid_hops_not_full_motion_or_audio/);
 const journey=await reviewContactSheet({aspect:'landscape',frames,load:async()=>bytes,sampleKind:'beat_choreography_keyposes'});
 assert.deepEqual(journey.tiles,sheet.tiles);assert.match(journey.scope,/choreography_arrivals_and_transitions_not_full_motion_or_audio/);
 await assert.rejects(reviewContactSheet({aspect:'landscape',frames,load:async()=>bytes}),/REVIEW_FRAME_REFERENCE_INVALID/);
});

test('focused custom sheet selects actual event and handoff frames and reports missing frames',async()=>{
 const film={totalFrames:450,scenes:[{id:'other',kind:'custom',start:0,end:100,params:{events:[]}},{id:'hard',kind:'custom',start:100,end:200,params:{hardest:true,events:[{frame:80},{frame:60},{frame:30}]}}]};
 const frames=[98,100,106,124,130,136,154,160,166,194,198,200,170].map(frame=>({key:`renders/fixture/motion-frames/${frame}.png`}));
 const selected=selectCustomMotionFrames(frames,film,'review');assert.equal(selected.sceneId,'hard');assert.deepEqual(selected.missing,[]);
 assert.deepEqual(selected.frames.map(blob=>Number(/(\d+)\.png$/.exec(blob.key)[1])),[98,100,106,124,130,136,154,160,166,194,198,200]);
 const missing=selectCustomMotionFrames(frames.filter(blob=>!blob.key.endsWith('/130.png')),film,'review');assert.deepEqual(missing.missing,[130]);
 assert.throws(()=>selectCustomMotionFrames([...frames,frames[0]],film,'review'),/REVIEW_FRAME_REFERENCE_INVALID/);
 assert.equal(selectCustomMotionFrames(frames,{scenes:[]},'final'),null);
 const bytes=pngRgba(1,1,Uint8Array.from([0,180,255,255]));
 const sheet=await reviewContactSheet({aspect:'landscape',frames:selected.frames,load:async()=>bytes,sampleKind:'custom_event_keyposes'});
 assert.equal(sheet.tiles.length,12);assert.match(sheet.scope,/selected_custom_events_and_handoffs_not_full_motion_or_audio/);
});
