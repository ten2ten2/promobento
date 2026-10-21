import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,statSync,rmSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {PNG} from 'pngjs';
import {parseCanonicalJson,parseSourceValues,sourceFileDigests,digest,createSchemaValidator,sourceValuesBytes} from '@promobento/contracts';
import {environmentLock,inspectEnvironment,sha256,sha256File} from './environment.mjs';
import {prepareBrowserBundle} from './browser-bundle.mjs';
import {captureFrame,launchFixtureBrowser,withDeadline} from './frame-capture.mjs';
import {prepareFixtureAudio,validateEncodedAudio} from './audio.mjs';
import {prepareFixtureMedia,reviewedFixtureFonts} from './media-assets.mjs';
import {assertTextLayout,observeFixtureText,observeOpticalPulse,observeEncodedOptical,assertOpticalMarkers,assertClipRange} from './fixture-qa.mjs';
import {fixtureDeclarationsPath,readFixtureDeclarations,parseFixtureDeclarations} from './fixture-declarations.mjs';
import {createRenderDiagnostics,inspectExecutionResources} from './render-diagnostics.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
// The harness loads only these reviewed implementations. A long-lived Node
// process must restart after edits, rather than pair cached code with new hashes.
const implementationPaths=[
  'apps/renderer/src/render-sample.mjs','apps/renderer/src/frame-capture.mjs','apps/renderer/src/browser-bundle.mjs',
  'apps/renderer/src/environment.mjs','apps/renderer/src/audio.mjs','apps/renderer/src/media-assets.mjs','apps/renderer/src/fixture-qa.mjs',
  'apps/renderer/src/fixture-declarations.mjs','apps/renderer/src/fixture-license.mjs',
  'apps/renderer/src/render-diagnostics.mjs','packages/composition-runtime/src/diagnostics.mjs',
  'tests/fixtures/render/audio-fixture.mjs','tests/fixtures/render/media-spec.mjs',
  'tests/fixtures/render/square.mjs','tests/fixtures/render/inplace.mjs','tests/fixtures/render/media.mjs',
  ...['square','inplace','media'].map(fixtureDeclarationsPath),
  'packages/contracts/index.mjs',...['canonical','digest','source','source-values','editable-values','identity','validation'].map(name=>'packages/contracts/src/'+name+'.mjs'),
  'config/platform-presets.json','contracts/production.schema.json','apps/renderer/environment.lock.json'
];
const loadedSourceHashes=new Map(implementationPaths.map(path=>[path,sha256File(join(root,path))]));
const presets=parseCanonicalJson(readFileSync(join(root,'config/platform-presets.json')));
const schema=parseCanonicalJson(readFileSync(join(root,'contracts/production.schema.json')));
const validateSchema=createSchemaValidator(schema);
const fixtures=Object.freeze({
  square:Object.freeze({targetId:'instagram_feed:square',durationSeconds:15,path:'tests/fixtures/render/square.mjs'}),
  inplace:Object.freeze({targetId:'tiktok:portrait',durationSeconds:30,path:'tests/fixtures/render/inplace.mjs'}),
  media:Object.freeze({targetId:'tiktok:portrait',durationSeconds:30,path:'tests/fixtures/render/media.mjs'})
});

/** Both modes execute only these repository fixtures, never caller-supplied code or URLs. */
export function renderOptions(options={}) {
  if (!options || typeof options!=='object' || Array.isArray(options)
    || Object.keys(options).some(key=>!['fixture','mode','outputDirectory'].includes(key)))
    throw new Error('RENDER_OPTIONS_INVALID: only fixture, mode and outputDirectory are accepted');
  const {fixture='square',mode='regression',outputDirectory}=options;
  if (typeof fixture!=='string' || !Object.hasOwn(fixtures,fixture)) throw new Error('RENDER_FIXTURE_UNKNOWN');
  if (!['output','regression'].includes(mode)) throw new Error('RENDER_MODE_INVALID');
  if (outputDirectory!==undefined && (typeof outputDirectory!=='string' || !outputDirectory.trim()))
    throw new Error('RENDER_OUTPUT_DIRECTORY_INVALID');
  return {fixture,mode,outputDirectory};
}

/** A bounded fixture check, not proof that arbitrary programs are deterministic or safe. */
export function fixtureVerificationPlan(frameCount,mode) {
  if (![450,900].includes(frameCount)) throw new Error('RENDER_FRAME_COUNT_INVALID');
  if (!['output','regression'].includes(mode)) throw new Error('RENDER_MODE_INVALID');
  const middle=Math.floor(frameCount/2);
  return {
    version:'fixture-determinism-v1',
    repeated:[middle,0,middle,frameCount-1,0],
    unordered:[17,frameCount-7,Math.floor(frameCount/3),3,Math.floor(frameCount*2/3),middle-11],
    cold:[0,59,Math.floor(frameCount/3),middle,Math.floor(frameCount*2/3),frameCount-1],
    reverseFrameCount:mode==='regression'?frameCount:0,
    reducedMotion:mode==='regression'?[0,middle,frameCount-1]:[]
  };
}

export function fixtureConfiguration(fixture) {
  if (typeof fixture!=='string' || !Object.hasOwn(fixtures,fixture)) throw new Error('RENDER_FIXTURE_UNKNOWN');
  const selected=fixtures[fixture];
  const [presetId,aspect]=selected.targetId.split(':');
  const preset=presets.presets.find(item=>item.id===presetId);
  assert(preset && [preset.defaultAspect,...preset.optionalAspects].includes(aspect),'Fixture must use a configured product target');
  const {width,height}=presets.aspectLayouts[aspect];
  const encoding=presets.encodingProfiles[preset.encodingProfile];
  const valuesPath=fixture==='media'?'tests/fixtures/render/media-values.json':'tests/fixtures/render/values.json';
  const input={targetId:selected.targetId,width,height,durationSeconds:selected.durationSeconds,seed:'m0a-fixture-1',
    values:parseSourceValues(readFileSync(join(root,valuesPath))).values};
  return {selected,input,encoding,valuesPath,frameCount:input.durationSeconds*encoding.fps};
}

export function encoderArguments(output,{encoding,frameCount,audioPath,audioStartSample=0}=fixtureConfiguration('square')) {
  const audio=encoding.audio;
  return ['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate',String(encoding.fps),'-vcodec','png','-i','pipe:0',
    ...(audioPath?['-i',audioPath,'-map','0:v:0','-map','1:a:0','-af',
      `atrim=start_sample=${audioStartSample}:end_sample=${audioStartSample+frameCount*1600},asetpts=PTS-STARTPTS`,
      '-c:a',audio.codec,'-profile:a',audio.profile,'-ar',String(audio.sampleRate),'-ac',String(audio.channels),'-b:a',String(audio.bitrate)]:['-an']),
    '-vf','format=gbrpf32le,zscale=matrixin=gbr:transferin=iec61966-2-1:primariesin=bt709:rangein=full:matrix=bt709:transfer=bt709:primaries=bt709:range=limited,format=yuv420p',
    '-c:v','libx264','-preset','fast','-profile:v',encoding.profile,'-b:v',String(encoding.targetVideoBitrate),'-maxrate',String(encoding.maxVideoBitrate),
    '-bufsize',String(encoding.maxVideoBitrate*2),'-g',String(encoding.gopFrames),'-keyint_min',String(encoding.gopFrames),'-sc_threshold','0','-flags','+cgop',
    '-threads','1','-filter_threads','1','-pix_fmt',encoding.pixelFormat,'-r',String(encoding.fps),'-fps_mode','cfr',
    '-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv','-movflags','+faststart','-frames:v',String(frameCount),output];
}

function startEncoder(path,configuration) {
  const encoder=spawn('/usr/bin/ffmpeg',encoderArguments(path,configuration),{stdio:['pipe','ignore','pipe']});
  let errors='',stopping;
  const closed=new Promise(resolve=>encoder.once('close',resolve));
  const stop=()=>stopping??=(async()=>{
    if(encoder.exitCode===null && encoder.signalCode===null)encoder.kill('SIGKILL');
    await closed;
  })();
  encoder.stderr.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-65536);});
  encoder.stdin.on('error',()=>{});
  const finished=new Promise((resolve,reject)=>{
    encoder.once('error',reject);
    encoder.once('close',code=>code===0?resolve():reject(new Error('FFMPEG_FAILED: '+errors)));
  });
  finished.catch(()=>{});
  const write=png=>withDeadline(async()=>{
    if(encoder.exitCode!==null) {await finished;throw new Error('ENCODER_CLOSED_EARLY');}
    if(!encoder.stdin.write(png)) await Promise.race([once(encoder.stdin,'drain'),finished.then(()=>{throw new Error('ENCODER_CLOSED_EARLY');})]);
  },{timeoutMs:60000,code:'ENCODER_WRITE_TIMEOUT',terminate:stop});
  const finish=()=>withDeadline(async()=>{encoder.stdin.end();await finished;},
    {timeoutMs:60000,code:'ENCODER_FINISH_TIMEOUT',terminate:stop});
  return {write,finish,stop};
}

const pixels=png=>PNG.sync.read(png).data;
function verifySwatches(video,{width,height}) {
  const rgb=execFileSync('/usr/bin/ffmpeg',['-v','error','-i',video,'-frames:v','1','-vf',
    'zscale=matrixin=bt709:transferin=bt709:primariesin=bt709:rangein=limited:matrix=gbr:transfer=iec61966-2-1:primaries=bt709:range=full,format=gbrpf32le,format=rgb24',
    '-threads','1','-filter_threads','1','-f','rawvideo','pipe:1'],{maxBuffer:width*height*4,timeout:30000,killSignal:'SIGKILL'});
  const expected=[[255,0,0],[0,255,0],[0,0,255],[128,128,128]],checks=[];
  expected.forEach((color,index)=>{
    const offset=((height-48)*width+52+index*38)*3,actual=[...rgb.subarray(offset,offset+3)];
    assert.equal(actual.length,3);
    color.forEach((channel,channelIndex)=>assert(Math.abs(channel-actual[channelIndex])<=6,'Encoded reference swatch changed color: '+actual));
    checks.push({expected:color,actual,tolerance:6});
  });
  return checks;
}

async function verifyMediaEditing({open,input,screenshot,out,evaluate}) {
  const local=await open({...input,mode:'local_preview'}),frame=300;
  const overlay={headline:'Make the next\nmove count.',accent:'#ba6848',progress:0.9};
  let snapshot,edited,hit;
  try {
    const before=await screenshot(local.page,frame,0),started=performance.now();
    const applied=await evaluate(local.page,valuesOverlay=>window.fixtureHost.setValues({valuesOverlay,requestedEpoch:1}),overlay);
    assert.deepEqual(applied,{event:'values-applied',requestedEpoch:1,appliedEpoch:1});
    edited=await screenshot(local.page,frame,1);
    const applyAndCaptureMs=Math.round(performance.now()-started);
    assert.notEqual(sha256(pixels(before)),sha256(pixels(edited)),'A local edit must actually change captured pixels');
    writeFileSync(join(out,'edited-preview.png'),edited);
    snapshot=await evaluate(local.page,()=>window.fixtureHost.snapshot());
    assert.deepEqual(snapshot.sourceValues,input.values,'Preview edits cannot mutate frozen source values');
    assert.deepEqual(snapshot.values,{...input.values,...overlay});
    hit=await evaluate(local.page,frameIndex=>window.fixtureHost.inspect({frameIndex,x01:0.2,y01:0.2,previewEpoch:1}),frame);
    assert.equal(hit.hit.regionId,'headline');
    assert.equal(hit.hit.sourcePath,'tests/fixtures/render/media.mjs');
    const rejected=await evaluate(local.page,()=>window.fixtureHost.setValues({valuesOverlay:{accent:'not-a-color'},requestedEpoch:2}));
    assert.equal(rejected.event,'values-rejected');assert.equal(rejected.appliedEpoch,1);
    const glyph=await evaluate(local.page,()=>window.fixtureHost.setValues({valuesOverlay:{headline:'未登记字形'},requestedEpoch:2}));
    assert.equal(glyph.event,'values-rejected');assert.equal(glyph.appliedEpoch,1);assert.match(glyph.reason,/GLYPH/);
    assert.equal(sha256(pixels(await screenshot(local.page,frame,1))),sha256(pixels(edited)),
      'Rejected preparation must retain the visible successful edit');
    await assert.rejects(screenshot(local.page,frame,0),/PREVIEW_EPOCH_STALE/);
    const overflow=await evaluate(local.page,()=>window.fixtureHost.setValues({valuesOverlay:{headline:'Wide words '.repeat(100)},requestedEpoch:2}));
    assert.equal(overflow.event,'values-applied');
    await screenshot(local.page,frame,2);
    const actualOverflow=await observeFixtureText(local.page);
    assert.throws(()=>assertTextLayout(actualOverflow,{width:input.width/2,height:input.height/2}),/TEXT_OVERFLOW/);
    snapshot.applyAndCaptureMs=applyAndCaptureMs;
  } finally {await local.context.close();}
  const saved=sourceValuesBytes(snapshot.values),savedPath=join(out,'edited-values.json');
  writeFileSync(savedPath,saved);
  const frozenValues=parseSourceValues(readFileSync(savedPath)).values;
  const replay=await open({...input,mode:'local_preview',values:frozenValues});
  try {
    assert.equal(sha256(pixels(await screenshot(replay.page,frame,0))),sha256(pixels(edited)),
      'The saved values must reproduce the edited local image in a fresh preparation');
  } finally {await replay.context.close();}
  const frozen=await open({...input,values:frozenValues}),trustedHashes=[];
  try {
    await assert.rejects(evaluate(frozen.page,()=>window.fixtureHost.setValues({valuesOverlay:{accent:'#000000'},requestedEpoch:1})),
      /TRUSTED_RENDER_OVERLAY_FORBIDDEN/);
    const actual=await evaluate(frozen.page,()=>window.fixtureHost.snapshot());
    assert.deepEqual(actual.values,frozenValues);
    for(const index of [30,300,600]) {
      const png=await screenshot(frozen.page,index);trustedHashes.push({frame:index,sha256:sha256(pixels(png))});
      assertTextLayout(await observeFixtureText(frozen.page),input);
      if(index===frame)writeFileSync(join(out,'edited-frozen.png'),png);
    }
    const trustedHit=await evaluate(frozen.page,frameIndex=>window.fixtureHost.inspect({frameIndex,x01:0.2,y01:0.2}),frame);
    assert.deepEqual(trustedHit.hit,hit.hit,'Logical inspection coordinates must survive the preview scale');
  } finally {await frozen.context.close();}
  const cold=await open({...input,values:parseSourceValues(readFileSync(savedPath)).values});
  try {
    for(const expected of trustedHashes)
      assert.equal(sha256(pixels(await screenshot(cold.page,expected.frame))),expected.sha256,'Frozen edited frame replay must be stable');
  } finally {await cold.context.close();}
  return {status:'passed',savedValuesSha256:sha256(saved),localReplayPixelHash:sha256(pixels(edited)),trustedHashes,
    localAppliedEpoch:1,applyAndCaptureMs:snapshot.applyAndCaptureMs,regionId:hit.hit.regionId,
    invalidValuesRejected:true,missingGlyphRejected:true,staleEpochRejected:true,textOverflowDetected:true,trustedOverlayRejected:true,
    scope:'saved values and sampled frozen frames; this is not the Studio save/CAS service or a latency p95'};
}

export async function renderSample(options={}) {
  const {outputDirectory,fixture,mode}=renderOptions(options);
  const started=performance.now();
  const timings={prepareMs:0,captureEncodeMs:0,determinismChecksMs:0,regressionChecksMs:0,outputChecksMs:0,cleanupMs:0};
  let currentStage='prepareMs',stageStarted=started,finishedAt;
  const stage=name=>{
    const now=performance.now();
    if (currentStage) timings[currentStage]+=now-stageStarted;
    currentStage=name;stageStarted=now;
    if (name===null) finishedAt=now;
  };
  const {selected,input,encoding,valuesPath,frameCount}=fixtureConfiguration(fixture);
  const captureDiagnostics=createRenderDiagnostics(frameCount);
  const hasMedia=fixture==='media';
  // Read inert metadata; composition modules execute only in the reviewed browser harness.
  const declarationPath=fixtureDeclarationsPath(fixture),declarations=readFixtureDeclarations(fixture);
  input.trustedDeclarations=declarations;
  const verification=fixtureVerificationPlan(frameCount,mode),regression=mode==='regression';
  const {width,height,targetId,durationSeconds}=input;
  const files=new Map([
    ['/', ['apps/renderer/src/host.html','text/html']],
    ['/host.mjs',['apps/renderer/src/host.mjs','text/javascript']],
    ['/composition.mjs',[selected.path,'text/javascript']],
    ['/packages/composition-runtime/src/index.mjs',['packages/composition-runtime/src/index.mjs','text/javascript']],
    ['/packages/composition-runtime/src/diagnostics.mjs',['packages/composition-runtime/src/diagnostics.mjs','text/javascript']],
    ['/packages/contracts/src/source-values.mjs',['packages/contracts/src/source-values.mjs','text/javascript']],
    ['/packages/contracts/src/editable-values.mjs',['packages/contracts/src/editable-values.mjs','text/javascript']],
    ['/packages/contracts/src/canonical.mjs',['packages/contracts/src/canonical.mjs','text/javascript']],
    ['/runtime-media.mjs',['packages/composition-runtime/src/media.mjs','text/javascript']],
    ['/media-spec.mjs',['tests/fixtures/render/media-spec.mjs','text/javascript']]
  ]);
  let bundle,handle,encoder,server,report,media,audio,resourceManifest,ownsFramesDirectory=false;
  const hashes=[],browserErrors=[];
  const textChecks=[],optical={previous:null,frames:{}};
  let maxFramePngBytes=0;
  const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+fixture+'-'+mode;
  const out=resolve(outputDirectory||join(root,'artifacts/m0a',runId));
  const framesDirectory=join(out,'frames');
  try {
    bundle=prepareBrowserBundle(environmentLock.browser);
    const environment=inspectEnvironment(bundle);
    const execution=inspectExecutionResources();
    mkdirSync(out,{recursive:true});
    // Never merge with or remove a pre-existing caller directory on failure.
    mkdirSync(framesDirectory);
    ownsFramesDirectory=true;
    writeFileSync(join(out,'environment.json'),JSON.stringify(environment,null,2)+'\n');
    writeFileSync(join(out,'execution.json'),JSON.stringify(execution,null,2)+'\n');
    const sourcePaths=[...new Set([...files.values()].map(([path])=>path).concat(implementationPaths,
      valuesPath,'apps/renderer/environment.lock.json','apps/renderer/fontconfig.conf','contracts/production.schema.json',
      'apps/renderer/src/render-sample.mjs','apps/renderer/src/frame-capture.mjs','apps/renderer/src/browser-bundle.mjs','apps/renderer/src/environment.mjs',
      ...(hasMedia?[...reviewedFixtureFonts().sourcePaths,'tests/fixtures/render/audio-fixture.mjs','apps/renderer/src/audio.mjs',
        'apps/renderer/src/media-assets.mjs','apps/renderer/src/fixture-qa.mjs']:[])))];
    // Freeze source before resource preparation, and reject edits while preparation reads it.
    // Browser requests and cold restarts subsequently receive only this immutable snapshot.
    const sourceInputs=new Map(sourcePaths.map(path=>[path,readFileSync(join(root,path))]));
    for(const [path,hash] of loadedSourceHashes)
      assert.equal(sha256(sourceInputs.get(path)),hash,'FIXTURE_IMPLEMENTATION_CHANGED_RESTART_REQUIRED: '+path);
    input.values=parseSourceValues(sourceInputs.get(valuesPath)).values;
    assert.deepEqual(parseFixtureDeclarations(sourceInputs.get(declarationPath)),declarations,'FIXTURE_DECLARATIONS_CHANGED');
    if(hasMedia) {
      media=prepareFixtureMedia({outputDirectory:out});
      audio=prepareFixtureAudio({outputDirectory:out,durationSeconds});
      input.mediaManifest=media.manifest;
      resourceManifest={schemaVersion:'2.7.0',kind:'resource_manifest',
        resources:[...media.manifest.resources.map(({url,...resource})=>resource),...audio.resources],
        audioEvents:audio.audioEvents,mixedAudio:audio.mixedAudio};
      assert.deepEqual(validateSchema(resourceManifest,schema.$defs.resourceManifest),[],'Frozen media resources must pass the complete schema');
      assert.deepEqual(declarations.markers,audio.markers,'Visual declarations and frozen events must share stable marker IDs');
      writeFileSync(join(out,'resource-manifest.json'),JSON.stringify(resourceManifest,null,2)+'\n');
      writeFileSync(join(out,'media-manifest.json'),JSON.stringify(media.manifest,null,2)+'\n');
      media.routes.set('/media-fixture/mixed.wav',{bytes:readFileSync(audio.mixedPath),contentType:'audio/wav',path:audio.mixedAudio.resourcePath});
    }
    for(const [path,bytes] of sourceInputs)
      assert(bytes.equals(readFileSync(join(root,path))),'FIXTURE_SOURCE_CHANGED_DURING_PREPARATION: '+path);
    const fixtureFiles=sourceFileDigests([...sourceInputs].map(([path,bytes])=>({path,bytes})));
    const fixtureInputHash=digest({fixtureFiles,input,declarations,resourceManifest:resourceManifest??null,encoding,environmentHash:environment.environmentHash});
    writeFileSync(join(out,'values.json'),sourceValuesBytes(input.values));
    server=createServer((request,response)=>{
      const entry=files.get(request.url);
      const asset=media?.routes.get(request.url);
      if (request.method!=='GET'||(!entry&&!asset)) { response.writeHead(404);response.end();return; }
      response.writeHead(200,{'Content-Type':entry?entry[1]:asset.contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; media-src blob:; img-src blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
      response.end(entry?sourceInputs.get(entry[0]):asset.bytes);
    });
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    const screenshot=(page,index,previewEpoch,onTiming)=>captureFrame(page,index,{terminate:()=>handle.stop(),previewEpoch,onTiming});
    const evaluate=(page,operation,argument)=>withDeadline(()=>page.evaluate(operation,argument),
      {timeoutMs:environmentLock.prepareTimeoutMs,code:'FIXTURE_COMMAND_TIMEOUT',terminate:()=>handle.stop()});
    const open=(runtimeInput=input)=>withDeadline(async()=>{
      const scale=runtimeInput.mode==='local_preview'?0.5:1;
      const context=await handle.browser.newContext({viewport:{width:width*scale,height:height*scale},deviceScaleFactor:1,locale:'en-US',timezoneId:'UTC',
        colorScheme:'light',reducedMotion:'no-preference',serviceWorkers:'block'});
      await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort('blockedbyclient'));
      const page=await context.newPage();
      page.on('pageerror',error=>browserErrors.push(error.message));
      await page.goto(origin,{waitUntil:'load'});
      await page.waitForFunction(()=>!!window.fixtureHost);
      await page.evaluate(input=>window.fixtureHost.init(input),runtimeInput);
      await page.evaluate(()=>{window.fixtureNodes=[...document.querySelector('#composition').querySelectorAll('*')];});
      return {context,page};
    },{timeoutMs:environmentLock.prepareTimeoutMs,code:'PREPARE_TIMEOUT',terminate:()=>handle.stop()});
    handle=await launchFixtureBrowser(bundle);
    const {context,page}=await open();
    assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),false);
    if (regression) {
      stage('regressionChecksMs');
      for (const invalid of [-1,0.5,frameCount])
        await assert.rejects(screenshot(page,invalid),/FRAME_OUT_OF_RANGE/);
      // These deliberate failures test the host; they are not customer output work.
      await page.evaluate(()=>{
        const child=document.querySelector('#composition').firstElementChild;
        window.nativeProbe=child.animate([{opacity:0.5},{opacity:1}],{duration:1000,iterations:Infinity});
        window.nativeProbe.pause();window.nativeProbe.currentTime=250;
      });
      await assert.rejects(screenshot(page,0),/NATIVE_ANIMATION_UNSUPPORTED/);
      await page.evaluate(()=>window.nativeProbe.cancel());
    }
    stage('captureEncodeMs');
    const video=join(out,'sample.mp4');
    const outputEncoder=startEncoder(video,{encoding,frameCount,audioPath:audio?.mixedPath});
    encoder=outputEncoder;
    console.log('M0a '+fixture+' ('+mode+'): rendering '+frameCount+' frames at '+width+'x'+height);
    for(let frame=0;frame<frameCount;frame++) {
      const measurement={frameFileWriteMs:0,opticalQaMs:0,textQaMs:0};
      const measured=(key,operation)=>{
        const start=performance.now();
        try {return operation();}finally {measurement[key]=(measurement[key]??0)+performance.now()-start;}
      };
      const measuredAsync=async(key,operation)=>{
        const start=performance.now();
        try {return await operation();}finally {measurement[key]=(measurement[key]??0)+performance.now()-start;}
      };
      const png=await screenshot(page,frame,undefined,timing=>Object.assign(measurement,timing));
      maxFramePngBytes=Math.max(maxFramePngBytes,png.length);
      // Disk keeps the expected image available for a later mismatch, without N PNG buffers in RAM.
      measured('frameFileWriteMs',()=>writeFileSync(join(framesDirectory,frame+'.png'),png));
      const rgba=measured('pngDecodeMs',()=>pixels(png));
      hashes.push(measured('pixelHashMs',()=>sha256(rgba)));
      if(hasMedia) {
        measured('opticalQaMs',()=>observeOpticalPulse(rgba,input,frame,optical));
        if(frame%30===0 || frame===frameCount-1) {
          await measuredAsync('textQaMs',async()=>{
            const observation=await observeFixtureText(page);
            textChecks.push({frame,...assertTextLayout(observation,input),observations:observation});
          });
        }
      }
      if(frame===Math.floor(frameCount/2))measured('frameFileWriteMs',()=>writeFileSync(join(out,'poster.png'),png));
      await measuredAsync('encoderWriteMs',()=>outputEncoder.write(png));
      captureDiagnostics.frame(frame,measurement);
      if(frame%150===149) console.log('M0a '+fixture+': encoded '+(frame+1)+'/'+frameCount+' source frames');
    }
    const finishStarted=performance.now();
    await outputEncoder.finish();
    captureDiagnostics.finishEncoder(performance.now()-finishStarted);
    const compare=async(page,frame,label)=>{
      const actual=await screenshot(page,frame),actualHash=sha256(pixels(actual));
      if(actualHash!==hashes[frame]) {
        copyFileSync(join(framesDirectory,frame+'.png'),join(out,'failure-expected.png'));
        writeFileSync(join(out,'failure-actual.png'),actual);
      }
      assert.equal(actualHash,hashes[frame],label+' differs at frame '+frame);
    };
    if (regression) {
      stage('regressionChecksMs');
      console.log('M0a '+fixture+': comparing every frame in reverse seek order');
      for(let frame=frameCount-1;frame>=0;frame--) await compare(page,frame,'Reverse seek');
    }
    stage('determinismChecksMs');
    for(const frame of verification.repeated) await compare(page,frame,'Repeated seek');
    for(const frame of verification.unordered) await compare(page,frame,'Unordered seek');
    assert(await page.evaluate(()=>{
      const current=[...document.querySelector('#composition').querySelectorAll('*')];
      return current.length===window.fixtureNodes.length && current.every((node,index)=>node===window.fixtureNodes[index]);
    }),'The fixture must retain its original DOM/SVG/canvas nodes');
    if (regression) {
      stage('regressionChecksMs');
      await page.emulateMedia({reducedMotion:'reduce'});
      for (const frame of verification.reducedMotion) await compare(page,frame,'Motion preference');
      await page.emulateMedia({reducedMotion:'no-preference'});
    }
    stage('determinismChecksMs');
    const browserMedia=hasMedia?await evaluate(page,()=>window.fixtureHost.mediaReport()):null;
    await withDeadline(()=>page.evaluate(()=>window.fixtureHost.dispose()),{
      timeoutMs:environmentLock.prepareTimeoutMs,code:'DISPOSE_TIMEOUT',terminate:()=>handle.stop()});
    if (regression) {
      stage('regressionChecksMs');
      await assert.rejects(screenshot(page,0),/INVALID_SESSION/);
    }
    stage('determinismChecksMs');
    await context.close();
    await handle.stop();
    handle=await launchFixtureBrowser(bundle);
    const cold=await open();
    for(const frame of verification.cold) await compare(cold.page,frame,'Cold seek');
    let previewAudio=null;
    if(hasMedia) {
      previewAudio=await withDeadline(()=>cold.page.evaluate(async()=>{
        const bytes=await (await fetch('/media-fixture/mixed.wav',{credentials:'omit',cache:'no-store'})).arrayBuffer();
        const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
        const context=new AudioContext({sampleRate:48000});
        try {
          const decoded=await context.decodeAudioData(bytes);
          return {sha256,sampleRate:decoded.sampleRate,channels:decoded.numberOfChannels,sampleFrames:decoded.length,duration:decoded.duration};
        } finally {await context.close();}
      }),{timeoutMs:environmentLock.prepareTimeoutMs,code:'AUDIO_DECODE_TIMEOUT',terminate:()=>handle.stop()});
      assert.deepEqual(previewAudio,{sha256:audio.mixedAudio.sha256,sampleRate:48000,channels:2,sampleFrames:frameCount*1600,duration:durationSeconds});
    }
    await cold.context.close();
    let editVerification=null;
    if(hasMedia&&regression) {
      stage('regressionChecksMs');
      editVerification=await verifyMediaEditing({open,input,screenshot,out,evaluate});
    }
    stage('outputChecksMs');
    const probe=parseCanonicalJson(execFileSync('/usr/bin/ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',video],{timeout:30000,killSignal:'SIGKILL'}));
    const stream=probe.streams.find(stream=>stream.codec_type==='video');
    assert.equal(probe.streams.length,hasMedia?2:1,'The media fixture has one frozen soundtrack; other fixtures remain silent');
    for(const [key,value] of Object.entries({width,height,codec_name:'h264',pix_fmt:'yuv420p',r_frame_rate:'30/1',avg_frame_rate:'30/1',color_space:'bt709',color_transfer:'bt709',color_primaries:'bt709',color_range:'tv'}))
      assert.equal(stream[key],value,key);
    assert.equal(Number(stream.nb_read_frames),frameCount);
    assert.equal(Number(stream.duration),durationSeconds);
    assert(Math.abs(Number(probe.format.duration)-durationSeconds)<=2/30);
    assert(statSync(video).size<=presets.productLimits.maxOutputFileBytes);
    let mediaChecks=null;
    if(hasMedia) {
      const observed=assertOpticalMarkers(audio.markers,optical.frames);
      const encodedOptical=assertOpticalMarkers(audio.markers,observeEncodedOptical(video,frameCount));
      const visualMarkerFrames=audio.markers.map(marker=>({audioEventId:marker.audioEventId,frame:encodedOptical[marker.audioEventId]}));
      const encodedAudio=validateEncodedAudio(video,{...audio,durationSeconds,frameCount,visualMarkerFrames});
      const screenshotFrame=300,screenshotPath=join(out,'trusted-screenshot.png');
      copyFileSync(join(framesDirectory,screenshotFrame+'.png'),screenshotPath);
      const clip=assertClipRange({frameStart:270,frameEndExclusive:330},frameCount),clipPath=join(out,'trusted-clip.mp4');
      const clipEncoder=startEncoder(clipPath,{encoding,frameCount:clip.frameCount,audioPath:audio.mixedPath,audioStartSample:clip.startSample});
      encoder=clipEncoder;
      for(let frame=clip.frameStart;frame<clip.frameEndExclusive;frame++)
        await clipEncoder.write(readFileSync(join(framesDirectory,frame+'.png')));
      await clipEncoder.finish();
      const clipProbe=parseCanonicalJson(execFileSync('/usr/bin/ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',clipPath],{timeout:30000,killSignal:'SIGKILL'}));
      const clipVideo=clipProbe.streams.find(stream=>stream.codec_type==='video');
      assert.equal(Number(clipVideo.nb_read_frames),clip.frameCount);
      assert.equal(Number(clipVideo.duration),clip.frameCount/30);
      assert.equal(clipVideo.width,width);assert.equal(clipVideo.height,height);
      const clipMarkers=audio.markers.filter(marker=>marker.frame>=clip.frameStart&&marker.frame<clip.frameEndExclusive)
        .map(marker=>({...marker,frame:marker.frame-clip.frameStart}));
      const clipOptical=assertOpticalMarkers(clipMarkers,observeEncodedOptical(clipPath,clip.frameCount));
      const clipAudio=validateEncodedAudio(clipPath,{...audio,durationSeconds:clip.frameCount/30,frameCount:clip.frameCount,
        referenceStartSample:clip.startSample,markers:clipMarkers,
        visualMarkerFrames:clipMarkers.map(marker=>({audioEventId:marker.audioEventId,frame:clipOptical[marker.audioEventId]}))});
      mediaChecks={status:'passed',fixtureInputHash,resources:media.report,browser:browserMedia,audio:{preparation:audio.report,previewDecode:previewAudio,encoded:encodedAudio},
        layout:{checkedFrames:textChecks.length,checks:textChecks},opticalMarkers:{capture:observed,encoded:encodedOptical},editing:editVerification,
        screenshot:{file:'trusted-screenshot.png',sourceFrame:screenshotFrame,sha256:sha256File(screenshotPath),pixelSha256:hashes[screenshotFrame],fixtureInputHash},
        clip:{file:'trusted-clip.mp4',...clip,sha256:sha256File(clipPath),fixtureInputHash,
          sourcePixelHashes:hashes.slice(clip.frameStart,clip.frameEndExclusive),opticalMarkers:clipOptical,audio:clipAudio},
        scope:'reviewed local engineering media; not a production preview, safety receipt, release QA or AI-marking certificate'};
      writeFileSync(join(out,'media-qa.json'),JSON.stringify(mediaChecks,null,2)+'\n');
    }
    assert.deepEqual(browserErrors,[]);
    report={kind:'m0a_render_result',scope:environmentLock.scope,runId,fixture,mode,targetId,profile:'standard',width,height,durationSeconds,frameCount,
      environmentHash:environment.environmentHash,execution,fixtureFiles,fixtureInputHash,pixelHashes:hashes,
      verification,
      checks:{forwardFrames:frameCount,reverseFrames:verification.reverseFrameCount,repeatedFrames:verification.repeated.length,
        unorderedFrames:verification.unordered.length,coldFrames:verification.cold.length,invalidFrames:regression?3:0,
        disposedSession:regression?true:null,nativeAnimationsRejected:regression?true:null,retainedNodes:true,
        reducedMotionFrames:verification.reducedMotion.length,colorSwatches:verifySwatches(video,input)},
      capture:{frameTimeoutMs:environmentLock.frameTimeoutMs,sourceFrameStorage:'temporary_disk',maxFramePngBytes,
        nodeMaxRssBytes:process.resourceUsage().maxRSS*1024,encodingOverlapsCapture:true,diagnostics:captureDiagnostics.report()},
      video:{file:'sample.mp4',sha256:sha256File(video),byteLength:statSync(video).size},
      media:mediaChecks,probe,limitations:[hasMedia?'reviewed original media with a limited Latin font registry':'silent reviewed geometry fixture',
        'no arbitrary source intake','no customer sandbox or cloud isolation certification',
        'output mode measures the fixture pipeline, not a production p95 or service acceptance',
        'bounded frame comparisons do not prove arbitrary-program determinism',
        'no native animations or WebGL admission','no multilingual shaping or customer-upload certification',
        'no full frame wire bridge or Studio save service','no AI or cost benchmark','nodeMaxRssBytes excludes browser and encoder processes']};
  } finally {
    stage('cleanupMs');
    await encoder?.stop();
    await handle?.stop();
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise(resolve=>server.close(resolve));
    }
    if (ownsFramesDirectory) rmSync(framesDirectory,{recursive:true,force:true});
    bundle?.cleanup();
    stage(null);
  }
  report.timings={...Object.fromEntries(Object.entries(timings).map(([key,value])=>[key,Math.round(value)])),
    totalMs:Math.round(finishedAt-started)};
  writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log('M0a '+mode+' passed; artifacts: '+out);
  return {out,report};
}
