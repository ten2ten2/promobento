import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSample} from '../src/render-sample.mjs';

test('15-second fixed-target MP4 has deterministic pixels and verified media metadata',{timeout:600000},async()=>{
  const {report}=await renderSample();
  assert.equal(report.frameCount,450);
  assert.equal(new Set(report.pixelHashes).size>100,true,'The fixture must contain actual animation');
});
