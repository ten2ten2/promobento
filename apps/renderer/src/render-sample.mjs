import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,statSync,rmSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {PNG} from 'pngjs';
import {parseCanonicalJson,parseSourceValues,sourceFileDigests} from '@promobento/contracts';
import {environmentLock,inspectEnvironment,sha256,sha256File} from './environment.mjs';
import {prepareBrowserBundle} from './browser-bundle.mjs';
import {captureFrame,launchFixtureBrowser,withDeadline} from './frame-capture.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const presets=parseCanonicalJson(readFileSync(join(root,'config/platform-presets.json')));
const fixtures=Object.freeze({
  square:Object.freeze({targetId:'instagram_feed:square',durationSeconds:15,path:'tests/fixtures/render/square.mjs'}),
  inplace:Object.freeze({targetId:'tiktok:portrait',durationSeconds:30,path:'tests/fixtures/render/inplace.mjs'})
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
  const input={targetId:selected.targetId,width,height,durationSeconds:selected.durationSeconds,seed:'m0a-fixture-1',
    values:parseSourceValues(readFileSync(join(root,'tests/fixtures/render/values.json'))).values};
  return {selected,input,encoding,frameCount:input.durationSeconds*encoding.fps};
}

export function encoderArguments(output,{encoding,frameCount}=fixtureConfiguration('square')) {
  return ['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate',String(encoding.fps),'-vcodec','png','-i','pipe:0','-an',
    '-vf','format=gbrpf32le,zscale=matrixin=gbr:transferin=iec61966-2-1:primariesin=bt709:rangein=full:matrix=bt709:transfer=bt709:primaries=bt709:range=limited,format=yuv420p',
    '-c:v','libx264','-preset','fast','-profile:v',encoding.profile,'-b:v',String(encoding.targetVideoBitrate),'-maxrate',String(encoding.maxVideoBitrate),
    '-bufsize',String(encoding.maxVideoBitrate*2),'-g',String(encoding.gopFrames),'-keyint_min',String(encoding.gopFrames),'-sc_threshold','0','-flags','+cgop',
    '-threads','1','-filter_threads','1','-pix_fmt',encoding.pixelFormat,'-r',String(encoding.fps),'-fps_mode','cfr',
    '-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv','-movflags','+faststart','-frames:v',String(frameCount),output];
}

const pixels=png=>PNG.sync.read(png).data;
function verifySwatches(video,{width,height}) {
  const rgb=execFileSync('/usr/bin/ffmpeg',['-v','error','-i',video,'-frames:v','1','-vf',
    'zscale=matrixin=bt709:transferin=bt709:primariesin=bt709:rangein=limited:matrix=gbr:transfer=iec61966-2-1:primaries=bt709:range=full,format=gbrpf32le,format=rgb24',
    '-threads','1','-filter_threads','1','-f','rawvideo','pipe:1'],{maxBuffer:width*height*4,timeout:30000});
  const expected=[[255,0,0],[0,255,0],[0,0,255],[128,128,128]],checks=[];
  expected.forEach((color,index)=>{
    const offset=((height-48)*width+52+index*38)*3,actual=[...rgb.subarray(offset,offset+3)];
    assert.equal(actual.length,3);
    color.forEach((channel,channelIndex)=>assert(Math.abs(channel-actual[channelIndex])<=6,'Encoded reference swatch changed color: '+actual));
    checks.push({expected:color,actual,tolerance:6});
  });
  return checks;
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
  const {selected,input,encoding,frameCount}=fixtureConfiguration(fixture);
  const verification=fixtureVerificationPlan(frameCount,mode),regression=mode==='regression';
  const {width,height,targetId,durationSeconds}=input;
  const files=new Map([
    ['/', ['apps/renderer/src/host.html','text/html']],
    ['/host.mjs',['apps/renderer/src/host.mjs','text/javascript']],
    ['/composition.mjs',[selected.path,'text/javascript']],
    ['/runtime.mjs',['packages/composition-runtime/src/index.mjs','text/javascript']]
  ]);
  let bundle,handle,encoder,server,report,ownsFramesDirectory=false;
  const hashes=[],browserErrors=[];
  let maxFramePngBytes=0;
  const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+fixture+'-'+mode;
  const out=resolve(outputDirectory||join(root,'artifacts/m0a',runId));
  const framesDirectory=join(out,'frames');
  try {
    bundle=prepareBrowserBundle(environmentLock.browser);
    const environment=inspectEnvironment(bundle);
    mkdirSync(out,{recursive:true});
    // Never merge with or remove a pre-existing caller directory on failure.
    mkdirSync(framesDirectory);
    ownsFramesDirectory=true;
    writeFileSync(join(out,'environment.json'),JSON.stringify(environment,null,2)+'\n');
    const sourcePaths=[...new Set([...files.values()].map(([path])=>path).concat(
      'tests/fixtures/render/values.json','apps/renderer/environment.lock.json','apps/renderer/fontconfig.conf',
      'apps/renderer/src/render-sample.mjs','apps/renderer/src/frame-capture.mjs','apps/renderer/src/browser-bundle.mjs','apps/renderer/src/environment.mjs'))];
    // Serve the same immutable bytes that were hashed; edits during a run must not
    // silently replace a module between the first capture and the cold restart.
    const sourceInputs=new Map(sourcePaths.map(path=>[path,readFileSync(join(root,path))]));
    input.values=parseSourceValues(sourceInputs.get('tests/fixtures/render/values.json')).values;
    const fixtureFiles=sourceFileDigests([...sourceInputs].map(([path,bytes])=>({path,bytes})));
    server=createServer((request,response)=>{
      const entry=files.get(request.url);
      if (request.method!=='GET'||!entry) { response.writeHead(404);response.end();return; }
      response.writeHead(200,{'Content-Type':entry[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
      response.end(sourceInputs.get(entry[0]));
    });
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    const screenshot=(page,index)=>captureFrame(page,index,{terminate:()=>handle.stop()});
    const open=()=>withDeadline(async()=>{
      const context=await handle.browser.newContext({viewport:{width,height},deviceScaleFactor:1,locale:'en-US',timezoneId:'UTC',
        colorScheme:'light',reducedMotion:'no-preference',serviceWorkers:'block'});
      await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort('blockedbyclient'));
      const page=await context.newPage();
      page.on('pageerror',error=>browserErrors.push(error.message));
      await page.goto(origin,{waitUntil:'load'});
      await page.waitForFunction(()=>!!window.fixtureHost);
      await page.evaluate(input=>window.fixtureHost.init(input),input);
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
    encoder=spawn('/usr/bin/ffmpeg',encoderArguments(video,{encoding,frameCount}),{stdio:['pipe','ignore','pipe']});
    let encoderErrors='';
    encoder.stderr.on('data',chunk=>{encoderErrors+=chunk.toString();});
    encoder.stdin.on('error',()=>{});
    const finished=new Promise((resolve,reject)=>{
      encoder.once('error',reject);
      encoder.once('close',code=>code===0?resolve():reject(new Error('FFMPEG_FAILED: '+encoderErrors)));
    });
    finished.catch(()=>{});
    console.log('M0a '+fixture+' ('+mode+'): rendering '+frameCount+' frames at '+width+'x'+height);
    for(let frame=0;frame<frameCount;frame++) {
      if (encoder.exitCode!==null) await finished;
      const png=await screenshot(page,frame);
      maxFramePngBytes=Math.max(maxFramePngBytes,png.length);
      // Disk keeps the expected image available for a later mismatch, without N PNG buffers in RAM.
      writeFileSync(join(framesDirectory,frame+'.png'),png);
      hashes.push(sha256(pixels(png)));
      if(frame===Math.floor(frameCount/2)) writeFileSync(join(out,'poster.png'),png);
      if(!encoder.stdin.write(png)) await Promise.race([once(encoder.stdin,'drain'),finished.then(()=>{throw new Error('ENCODER_CLOSED_EARLY');})]);
      if(frame%150===149) console.log('M0a '+fixture+': encoded '+(frame+1)+'/'+frameCount+' source frames');
    }
    encoder.stdin.end();
    await finished;
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
    await cold.context.close();
    stage('outputChecksMs');
    const probe=parseCanonicalJson(execFileSync('/usr/bin/ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',video],{timeout:30000}));
    const stream=probe.streams.find(stream=>stream.codec_type==='video');
    assert.equal(probe.streams.length,1,'These engineering fixtures are deliberately silent');
    for(const [key,value] of Object.entries({width,height,codec_name:'h264',pix_fmt:'yuv420p',r_frame_rate:'30/1',avg_frame_rate:'30/1',color_space:'bt709',color_transfer:'bt709',color_primaries:'bt709',color_range:'tv'}))
      assert.equal(stream[key],value,key);
    assert.equal(Number(stream.nb_read_frames),frameCount);
    assert.equal(Number(stream.duration),durationSeconds);
    assert.equal(Number(probe.format.duration),durationSeconds);
    assert(statSync(video).size<=presets.productLimits.maxOutputFileBytes);
    assert.deepEqual(browserErrors,[]);
    report={kind:'m0a_render_result',scope:environmentLock.scope,runId,fixture,mode,targetId,profile:'standard',width,height,durationSeconds,frameCount,
      environmentHash:environment.environmentHash,fixtureFiles,pixelHashes:hashes,
      verification,
      checks:{forwardFrames:frameCount,reverseFrames:verification.reverseFrameCount,repeatedFrames:verification.repeated.length,
        unorderedFrames:verification.unordered.length,coldFrames:verification.cold.length,invalidFrames:regression?3:0,
        disposedSession:regression?true:null,nativeAnimationsRejected:regression?true:null,retainedNodes:true,
        reducedMotionFrames:verification.reducedMotion.length,colorSwatches:verifySwatches(video,input)},
      capture:{frameTimeoutMs:environmentLock.frameTimeoutMs,sourceFrameStorage:'temporary_disk',maxFramePngBytes,
        nodeMaxRssBytes:process.resourceUsage().maxRSS*1024,encodingOverlapsCapture:true},
      video:{file:'sample.mp4',sha256:sha256File(video),byteLength:statSync(video).size},
      probe,limitations:['silent reviewed fixtures only','no arbitrary source intake','no customer sandbox or cloud isolation certification',
        'output mode measures the fixture pipeline, not a production p95 or service acceptance',
        'bounded frame comparisons do not prove arbitrary-program determinism',
        'no native animations or WebGL admission','no font or video registry','no AI or cost benchmark','nodeMaxRssBytes excludes browser and encoder processes']};
  } finally {
    stage('cleanupMs');
    if(encoder&&encoder.exitCode===null) encoder.kill('SIGKILL');
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
