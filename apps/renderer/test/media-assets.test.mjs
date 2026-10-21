import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewedFixtureFonts,woffGlyphCoverage} from '../src/media-assets.mjs';
import {selectVideoFrame} from '../../../packages/composition-runtime/src/media.mjs';

const time=(numerator,denominator=30)=>({numerator,denominator});
const video={assetPath:'screen',duration:time(31),frames:[0,10,30].map((n,index)=>({index,pts:time(n)}))};
const use={assetPath:'screen',sourceStart:time(0),sourceEndExclusive:time(30),timelineStart:time(0),playbackRate:time(1,1)};

test('exact PTS containment uses the current VFR interval, including rational subframes',()=>{
  for(const [at,index] of [[time(0),0],[time(19,60),0],[time(10),1],[time(59,60),1]])
    assert.equal(selectVideoFrame(use,video,at).index,index);
  for(const at of [time(30),time(31),time(-1),time(1,0),time(0.5)])
    assert.throws(()=>selectVideoFrame(use,video,at),/VIDEO_TIME_(OUT_OF_RANGE|INVALID)/);
  assert.throws(()=>selectVideoFrame({...use,assetPath:'different'},video,time(0)),/VIDEO_USE_UNDECLARED/);
  assert.throws(()=>selectVideoFrame({...use,playbackRate:time(0)},video,time(0)),/VIDEO_USE_INVALID/);
});

test('trim, timeline offset and playback rate use exact integer arithmetic',()=>{
  const shifted={...use,sourceStart:time(5),timelineStart:time(30),playbackRate:time(3,2)};
  assert.equal(selectVideoFrame(shifted,video,time(30)).index,0);
  assert.equal(selectVideoFrame(shifted,video,time(100,90)).index,1);
  assert.throws(()=>selectVideoFrame(shifted,video,time(29)),/VIDEO_TIME_OUT_OF_RANGE/);
  assert.throws(()=>selectVideoFrame(shifted,video,time(50)),/VIDEO_TIME_OUT_OF_RANGE/);
});

test('reviewed font files retain exact OFL bytes and real cmap coverage including fallback-only glyphs',()=>{
  const {fonts,resources,routes,sourcePaths}=reviewedFixtureFonts();
  assert.equal(fonts.length,2);assert.equal(resources.length,2);
  const covers=(font,point)=>font.coverage.some(([first,last])=>first<=point&&last>=point);
  for(const font of fonts) {
    assert(covers(font,65));assert(covers(font,0xe9));assert(!covers(font,0x4e2d));
    assert(sourcePaths.some(path=>path.endsWith('OFL.txt')));
    assert.deepEqual(woffGlyphCoverage(routes.get(resources.find(resource=>resource.path===font.path).url).bytes),font.coverage);
  }
  assert.equal(covers(fonts[0],0x25fc),false);assert.equal(covers(fonts[1],0x25fc),true);
  assert.throws(()=>woffGlyphCoverage(Buffer.from('not a font')),/FONT_WOFF_INVALID/);
  const corrupted=Buffer.from(routes.values().next().value.bytes);corrupted.writeUInt32BE(corrupted.length-1,8);
  assert.throws(()=>woffGlyphCoverage(corrupted),/FONT_WOFF_INVALID/);
});
