import test from 'node:test';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {motionDiagnostics,paletteDiagnostics} from '../src/creative-diagnostics.mjs';
import {orderedCapture} from '../src/ordered-capture.mjs';
import {editEvidencePlan} from '../src/edit-evidence.mjs';
const analyze=values=>motionDiagnostics(values.map(x=>new Uint8Array([x])),{width:1,height:1});
test('editorial QA separates one-frame pops, deliberate cuts, holds and motion',()=>{
  const pop=analyze(Array.from({length:90},(_,i)=>i===40?255:0));
  assert.deepEqual(pop.pops,[40]);assert.deepEqual(pop.cuts,[]);
  const cut=analyze(Array.from({length:90},(_,i)=>i<40?0:255));
  assert.deepEqual(cut.cuts,[40]);assert.deepEqual(cut.pops,[]);
  assert.deepEqual(cut.stillSpans,[{frameStart:0,frameEndExclusive:40},{frameStart:40,frameEndExclusive:90}]);
  const ramp=analyze(Array.from({length:90},(_,i)=>i));
  assert.deepEqual(ramp.stillSpans,[]);assert.deepEqual(ramp.cuts,[]);assert.equal(ramp.meanDifference,1);
  assert.equal(ramp.motionCurve.length,3);assert.equal(ramp.disposition,'editorial_review');
});
test('diagnostics bound shape and duration',()=>{
  assert.throws(()=>analyze([0]),/INPUT_INVALID/u);
  assert.throws(()=>analyze(Array(901).fill(0)),/INPUT_INVALID/u);
  assert.throws(()=>motionDiagnostics([[0],[1]],{width:1,height:1}),/INPUT_INVALID/u);
  assert.throws(()=>paletteDiagnostics([{id:'x',colors:['red']}]),/COLOUR_INVALID/u);
  assert.throws(()=>paletteDiagnostics([{id:'x',colors:['#000000']},{id:'x',colors:['#ffffff']}]),/INPUT_INVALID/u);
});
test('palette comparison warns on repetition without inventing colour roles',()=>{
  const result=paletteDiagnostics([{id:'a',colors:['#000000','#ffffff','#ff5500']},{id:'b',colors:['#000000','#ffffff','#ff5500']}]);
  assert.deepEqual(result.findings.map(x=>x.code),['SHARED_SWATCHES','WARM_ACCENT_REPEATED']);
  assert.equal(result.palettes[0].colors[1].luminance,1);
});
test('parallel capture consumes exact order with at most two frames retained',async()=>{
  let active=0,peak=0;const produced=[],consumed=[];
  await orderedCapture({count:12,workers:2,produce:async(i,slot)=>{
    produced.push(i);assert.equal(slot,i%2);peak=Math.max(peak,++active);
    await new Promise(resolve=>setTimeout(resolve,i%2?1:5));return i;
  },consume:async(value,i)=>{assert.equal(value,i);consumed.push(i);active--;}});
  assert.equal(peak,2);assert.deepEqual(produced,Array.from({length:12},(_,i)=>i));assert.deepEqual(consumed,produced);
});
test('parallel failure drains owned work and does not start later frames',async()=>{
  const finished=[];
  await assert.rejects(orderedCapture({count:5,workers:2,produce:async i=>{
    if(i===0)throw Error('capture failed');await new Promise(resolve=>setTimeout(resolve,5));finished.push(i);
  },consume:()=>{throw Error('unexpected');}}),/capture failed/u);
  assert.deepEqual(finished,[1]);
  await assert.rejects(orderedCapture({count:5,workers:3}),/CONCURRENCY_INVALID/u);
});
test('edit evidence crop is clamped to the actual saved frame',()=>{
  const input={frameIndex:449,width:1080,height:1920,totalFrames:450};
  assert.equal(editEvidencePlan(input).detail,null);
  assert.deepEqual(editEvidencePlan({...input,point:{x01:1,y01:0}}).detail,{crop:{x:540,y:0,width:540,height:960},scale:2});
  assert.throws(()=>editEvidencePlan({...input,frameIndex:450}),/FRAME_INVALID/u);
  assert.throws(()=>editEvidencePlan({...input,point:{x01:-1,y01:0}}),/POINT_INVALID/u);
});

test('palette CLI writes escaped visible swatches and refuses to overwrite a review',()=>{
  const dir=mkdtempSync(join(tmpdir(),'promobento-palette-test-'));
  try {
    const input=join(dir,'input.json'),out=join(dir,'out'),script=new URL('../scripts/creative-tools.mjs',import.meta.url).pathname;
    writeFileSync(input,JSON.stringify([{id:'<script>alert(1)</script>',colors:['#ffffff','#000000']}]));
    const args=[script,'palette','--input',input,'--output-directory',out];
    execFileSync(process.execPath,args);
    const svg=readFileSync(join(out,'swatches.svg'),'utf8');
    assert(svg.includes('&lt;script&gt;'));assert(!svg.includes('<script>'));
    assert.throws(()=>execFileSync(process.execPath,args,{stdio:'pipe'}),/OUTPUT_NOT_EMPTY/u);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
