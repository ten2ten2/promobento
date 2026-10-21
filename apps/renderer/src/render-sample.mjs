import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
import {PNG} from 'pngjs';
import {parseCanonicalJson,parseSourceValues,sourceFileDigests} from '@promobento/contracts';
import {environmentLock,browserExecutable,inspectEnvironment,sha256} from './environment.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const presets=parseCanonicalJson(readFileSync(join(root,'config/platform-presets.json')));
const targetId='instagram_feed:square';
const preset=presets.presets.find(item=>item.id==='instagram_feed');
assert(preset?.optionalAspects.includes('square'),'The engineering fixture must use a configured product target');
const {width,height}=presets.aspectLayouts.square;
const encoding=presets.encodingProfiles[preset.encodingProfile];
const input={targetId,width,height,durationSeconds:15,seed:'m0a-fixture-1',values:parseSourceValues(readFileSync(join(root,'tests/fixtures/render/values.json'))).values};
const frameCount=input.durationSeconds*encoding.fps;
const files=new Map([
  ['/', ['apps/renderer/src/host.html','text/html']],
  ['/host.mjs',['apps/renderer/src/host.mjs','text/javascript']],
  ['/composition.mjs',['tests/fixtures/render/square.mjs','text/javascript']],
  ['/runtime.mjs',['packages/composition-runtime/src/index.mjs','text/javascript']]
]);

export function encoderArguments(output) {
  return ['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate',String(encoding.fps),'-vcodec','png','-i','pipe:0','-an',
    '-vf','format=gbrpf32le,zscale=matrixin=gbr:transferin=iec61966-2-1:primariesin=bt709:rangein=full:matrix=bt709:transfer=bt709:primaries=bt709:range=limited,format=yuv420p',
    '-c:v','libx264','-preset','fast','-profile:v',encoding.profile,'-b:v',String(encoding.targetVideoBitrate),'-maxrate',String(encoding.maxVideoBitrate),
    '-bufsize',String(encoding.maxVideoBitrate*2),'-g',String(encoding.gopFrames),'-keyint_min',String(encoding.gopFrames),'-sc_threshold','0','-flags','+cgop',
    '-threads','1','-filter_threads','1','-pix_fmt',encoding.pixelFormat,'-r',String(encoding.fps),'-fps_mode','cfr',
    '-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv','-movflags','+faststart','-frames:v',String(frameCount),output];
}

const pixels = png => PNG.sync.read(png).data;
function verifySwatches(video) {
  const rgb=execFileSync('/usr/bin/ffmpeg',['-v','error','-i',video,'-frames:v','1','-vf',
    'zscale=matrixin=bt709:transferin=bt709:primariesin=bt709:rangein=limited:matrix=gbr:transfer=iec61966-2-1:primaries=bt709:range=full,format=gbrpf32le,format=rgb24',
    '-threads','1','-filter_threads','1','-f','rawvideo','pipe:1'],{maxBuffer:width*height*4,timeout:30000});
  const expected=[[255,0,0],[0,255,0],[0,0,255],[128,128,128]],checks=[];
  expected.forEach((color,index)=>{
    const offset=(1032*width+52+index*38)*3,actual=[...rgb.subarray(offset,offset+3)];
    assert.equal(actual.length,3);
    color.forEach((channel,channelIndex)=>assert(Math.abs(channel-actual[channelIndex])<=6,'Encoded reference swatch changed color: '+actual));
    checks.push({expected:color,actual,tolerance:6});
  });
  return checks;
}

export async function renderSample({outputDirectory}={}) {
  const environment=inspectEnvironment();
  const runId=new Date().toISOString().replace(/[:.]/g,'-');
  const out=resolve(outputDirectory||join(root,'artifacts/m0a',runId));
  mkdirSync(out,{recursive:true});
  writeFileSync(join(out,'environment.json'),JSON.stringify(environment,null,2)+'\n');
  const sourcePaths=[...new Set([...files.values()].map(([path])=>path).concat('tests/fixtures/render/values.json','apps/renderer/environment.lock.json'))];
  const fixtureFiles=sourceFileDigests(sourcePaths.map(path=>({path,bytes:readFileSync(join(root,path))})));
  const server=createServer((request,response)=>{
    const entry=files.get(request.url);
    if (request.method!=='GET'||!entry) { response.writeHead(404);response.end();return; }
    response.writeHead(200,{'Content-Type':entry[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
    response.end(readFileSync(join(root,entry[0])));
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  let browser,encoder;
  const browserErrors=[];
  const hashes=[];
  const sourceFrames=[];
  const screenshot=async(page,index)=>{
    const receipt=await page.evaluate(index=>window.fixtureHost.seek(index),index);
    assert.equal(receipt.frameIndex,index);
    return page.screenshot({type:'png',animations:'disabled',caret:'hide',timeout:15000});
  };
  const open=async()=>{
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,locale:'en-US',timezoneId:'UTC',colorScheme:'light',reducedMotion:'reduce',serviceWorkers:'block'});
    await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort('blockedbyclient'));
    const page=await context.newPage();
    page.on('pageerror',error=>browserErrors.push(error.message));
    await page.goto(origin,{waitUntil:'load'});
    await page.waitForFunction(()=>!!window.fixtureHost);
    await page.evaluate(input=>window.fixtureHost.init(input),input);
    return {context,page};
  };
  try {
    browser=await chromium.launch({executablePath:browserExecutable(),headless:true,chromiumSandbox:false,args:environmentLock.launchArgs});
    assert.equal(browser.version(),environmentLock.browser.version);
    const {context,page}=await open();
    for (const invalid of [-1,0.5,450])
      await assert.rejects(page.evaluate(index=>window.fixtureHost.seek(index),invalid),/FRAME_OUT_OF_RANGE/);
    const video=join(out,'sample.mp4');
    encoder=spawn('/usr/bin/ffmpeg',encoderArguments(video),{stdio:['pipe','ignore','pipe']});
    let encoderErrors='';
    encoder.stderr.on('data',chunk=>{encoderErrors+=chunk.toString();});
    encoder.stdin.on('error',()=>{});
    const finished=new Promise((resolve,reject)=>{
      encoder.once('error',reject);
      encoder.once('close',code=>code===0?resolve():reject(new Error('FFMPEG_FAILED: '+encoderErrors)));
    });
    // Handle a premature encoder failure while the screenshot loop is still active.
    finished.catch(()=>{});
    console.log('M0a: rendering '+frameCount+' frames at '+width+'x'+height);
    for(let frame=0;frame<frameCount;frame++) {
      if (encoder.exitCode!==null) await finished;
      const png=await screenshot(page,frame);
      sourceFrames.push(png);
      hashes.push(sha256(pixels(png)));
      if(frame===225) writeFileSync(join(out,'poster.png'),png);
      if(!encoder.stdin.write(png)) await Promise.race([once(encoder.stdin,'drain'),finished.then(()=>{throw new Error('ENCODER_CLOSED_EARLY');})]);
      if(frame%150===149) console.log('M0a: encoded '+(frame+1)+'/'+frameCount+' source frames');
    }
    encoder.stdin.end();
    await finished;
    console.log('M0a: comparing every frame in reverse seek order');
    for(let frame=frameCount-1;frame>=0;frame--) {
      const actual=await screenshot(page,frame);
      if(sha256(pixels(actual))!==hashes[frame]) {
        writeFileSync(join(out,'failure-expected.png'),sourceFrames[frame]);
        writeFileSync(join(out,'failure-actual.png'),actual);
      }
      assert.equal(sha256(pixels(actual)),hashes[frame],'Reverse seek differs at frame '+frame);
    }
    for(const frame of [225,0,225,449,0])
      assert.equal(sha256(pixels(await screenshot(page,frame))),hashes[frame],'Repeated seek differs at frame '+frame);
    await page.evaluate(()=>window.fixtureHost.dispose());
    await assert.rejects(page.evaluate(()=>window.fixtureHost.seek(0)),/INVALID_SESSION/);
    await context.close();
    await browser.close();
    // Cold means a new browser process, not just a freshly prepared module.
    browser=await chromium.launch({executablePath:browserExecutable(),headless:true,chromiumSandbox:false,args:environmentLock.launchArgs});
    const cold=await open();
    for(const frame of [0,59,150,225,300,449])
      assert.equal(sha256(pixels(await screenshot(cold.page,frame))),hashes[frame],'Cold seek differs at frame '+frame);
    await cold.context.close();
    const probe=parseCanonicalJson(execFileSync('/usr/bin/ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',video],{timeout:30000}));
    const stream=probe.streams.find(stream=>stream.codec_type==='video');
    assert.equal(probe.streams.length,1,'This fixture is deliberately silent');
    for(const [key,value] of Object.entries({width,height,codec_name:'h264',pix_fmt:'yuv420p',r_frame_rate:'30/1',avg_frame_rate:'30/1',color_space:'bt709',color_transfer:'bt709',color_primaries:'bt709',color_range:'tv'}))
      assert.equal(stream[key],value,key);
    assert.equal(Number(stream.nb_read_frames),frameCount);
    assert.equal(Number(stream.duration),15);
    assert.equal(Number(probe.format.duration),15);
    assert(statSync(video).size<=presets.productLimits.maxOutputFileBytes);
    assert.deepEqual(browserErrors,[]);
    const report={kind:'m0a_render_result',scope:environmentLock.scope,runId,targetId,profile:'standard',width,height,durationSeconds:15,frameCount,
      environmentHash:environment.environmentHash,fixtureFiles,pixelHashes:hashes,
      checks:{forwardFrames:450,reverseFrames:450,repeatedFrames:5,coldFrames:6,invalidFrames:3,disposedSession:true,colorSwatches:verifySwatches(video)},
      video:{file:'sample.mp4',sha256:sha256(readFileSync(video)),byteLength:statSync(video).size},
      probe,limitations:['silent reviewed fixture only','no arbitrary source intake','no customer sandbox or cloud isolation certification','no font or video registry','no AI or cost benchmark']};
    writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
    console.log('M0a passed; artifacts: '+out);
    return {out,report};
  } finally {
    if(encoder&&encoder.exitCode===null) encoder.kill('SIGTERM');
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
}
