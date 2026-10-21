import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixtureConfiguration,fixtureVerificationPlan,renderOptions,renderSample} from '../src/render-sample.mjs';
import {parseRenderArguments} from '../scripts/render-fixture.mjs';

test('both modes keep repeated, unordered and cold verification; only regression adds a full reverse pass',()=>{
  for (const count of [450,900]) {
    const output=fixtureVerificationPlan(count,'output'),regression=fixtureVerificationPlan(count,'regression');
    assert.equal(output.version,'fixture-determinism-v1');
    assert.equal(output.reverseFrameCount,0);
    assert.equal(regression.reverseFrameCount,count);
    assert.deepEqual(output.reducedMotion,[]);
    for (const key of ['repeated','unordered','cold']) {
      assert.deepEqual(output[key],regression[key]);
      assert(output[key].every(frame=>Number.isSafeInteger(frame)&&frame>=0&&frame<count));
    }
    assert.equal(output.cold[0],0);
    assert.equal(output.cold.at(-1),count-1);
    assert(output.cold.some(frame=>frame%30!==0),'Checks must include a frame between second boundaries');
    assert(new Set(output.repeated).size<output.repeated.length,'Repeat verification must really revisit frames');
    assert(output.unordered.some((frame,index)=>index&&frame<output.unordered[index-1]));
  }
  for (const count of [0,451,901,NaN]) assert.throws(()=>fixtureVerificationPlan(count,'output'),/RENDER_FRAME_COUNT_INVALID/);
  assert.throws(()=>fixtureVerificationPlan(450,'none'),/RENDER_MODE_INVALID/);
});

test('fixture runner rejects arbitrary paths, URLs, code and verification overrides before starting a browser',async()=>{
  for (const fixture of ['../square.mjs','https://example.test/source.mjs','toString','__proto__',{}]) {
    assert.throws(()=>fixtureConfiguration(fixture),/RENDER_FIXTURE_UNKNOWN/);
    await assert.rejects(renderSample({fixture}),/RENDER_FIXTURE_UNKNOWN/);
  }
  for (const key of ['sourcePath','url','code','definition','verify','verificationPolicy'])
    await assert.rejects(renderSample({[key]:false}),/RENDER_OPTIONS_INVALID/);
  for (const mode of ['none','production','',null]) await assert.rejects(renderSample({mode}),/RENDER_MODE_INVALID/);
  assert.equal(renderOptions().mode,'regression');
  assert.equal(fixtureConfiguration('inplace').frameCount,900);
});

test('the CLI defaults to 30-second output measurement and accepts no custom source or check bypass',()=>{
  assert.deepEqual(parseRenderArguments([]),{fixture:'inplace',mode:'output',outputDirectory:undefined});
  assert.deepEqual(parseRenderArguments(['--fixture','square','--mode','regression','--output-directory','artifacts/probe']),
    {fixture:'square',mode:'regression',outputDirectory:'artifacts/probe'});
  for (const args of [
    ['--url','https://example.test'],['--source','custom.mjs'],['custom.mjs'],['--skip-checks'],
    ['--mode'],['--mode','output','--mode','regression'],['--fixture','../custom.mjs'],['--mode','none']
  ]) assert.throws(()=>parseRenderArguments(args),/RENDER_/);
});

test('a missing pinned browser fails without removing an existing caller frames directory',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'promobento-render-failure-'));
  const frames=join(directory,'frames'),marker=join(frames,'keep.txt');
  mkdirSync(frames);writeFileSync(marker,'Unrelated existing file');
  const previous=process.env.PROMOBENTO_BROWSER_DIR;
  process.env.PROMOBENTO_BROWSER_DIR=join(directory,'empty-browser-cache');
  try {
    await assert.rejects(renderSample({outputDirectory:directory,mode:'output'}),/BROWSER_ARCHIVE_MISSING/);
    assert(existsSync(marker),'A failure before creating temporary frames cannot remove caller data');
  } finally {
    if (previous===undefined) delete process.env.PROMOBENTO_BROWSER_DIR;
    else process.env.PROMOBENTO_BROWSER_DIR=previous;
    rmSync(directory,{recursive:true,force:true});
  }
});
