import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,readdirSync,statSync,rmSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {PNG} from 'pngjs';
import {canonical,parseCanonicalJson} from '@promobento/contracts';
import {environmentLock,inspectEnvironment,sha256,sha256File} from './environment.mjs';
import {prepareBrowserBundle} from './browser-bundle.mjs';
import {launchFixtureBrowser,withDeadline} from './frame-capture.mjs';
import {encoderArguments} from './render-sample.mjs';
import {inspectExecutionResources} from './render-diagnostics.mjs';
import {paintAdmissionCanvas,validateAdmissionDraw} from './admission-commands.mjs';

const presets=parseCanonicalJson(readFileSync(new URL('../../../config/platform-presets.json',import.meta.url)));
const frameTimeoutMs=5000;
const shell='<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; object-src \'none\'; base-uri \'none\'"><style>html,body{margin:0;padding:0;overflow:hidden;background:#000}canvas{display:block}</style></head><body><canvas id="admission-canvas"></canvas></body></html>';

export function admissionVerificationPlan(frameCount) {
  if(![450,900].includes(frameCount))throw new Error('ADMISSION_FRAME_COUNT_INVALID');
  const middle=Math.floor(frameCount/2);
  return {version:'admission-determinism-v1',repeated:[middle,0,middle,frameCount-1,0],
    unordered:[17,frameCount-7,Math.floor(frameCount/3),3,Math.floor(frameCount*2/3),middle-11],
    cold:[0,59,Math.floor(frameCount/3),middle,Math.floor(frameCount*2/3),frameCount-1]};
}

function configuration(input,encoding) {
  if(!input || typeof input.targetId!=='string')throw new Error('ADMISSION_TARGET_INVALID');
  const [presetId,aspect,...rest]=input.targetId.split(':');
  const preset=presets.presets.find(item=>item.id===presetId),layout=presets.aspectLayouts[aspect];
  if(rest.length||!preset||![preset.defaultAspect,...preset.optionalAspects].includes(aspect)||!layout)
    throw new Error('ADMISSION_TARGET_INVALID');
  if(input.width!==layout.width||input.height!==layout.height)throw new Error('ADMISSION_CANVAS_DIMENSIONS_INVALID');
  if(!presets.productLimits.durationSeconds.includes(input.durationSeconds))throw new Error('ADMISSION_DURATION_INVALID');
  if(canonical(encoding)!==canonical(presets.encodingProfiles[preset.encodingProfile]))throw new Error('ADMISSION_ENCODING_INVALID');
  return input.durationSeconds*encoding.fps;
}

function startEncoder(output,encoding,frameCount) {
  const encoder=spawn('/usr/bin/ffmpeg',encoderArguments(output,{encoding,frameCount}),{stdio:['pipe','ignore','pipe']});
  let errors='',stopping;
  const closed=new Promise(resolve=>encoder.once('close',resolve));
  const stop=()=>stopping??=(async()=>{
    if(encoder.exitCode===null&&encoder.signalCode===null)encoder.kill('SIGKILL');
    await closed;
  })();
  encoder.stderr.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-65536);});
  encoder.stdin.on('error',()=>{});
  const finished=new Promise((resolve,reject)=>{
    encoder.once('error',reject);
    encoder.once('close',code=>code===0?resolve():reject(new Error('ADMISSION_ENCODER_FAILED: '+errors)));
  });
  finished.catch(()=>{});
  return {stop,write:png=>withDeadline(async()=>{
    if(encoder.exitCode!==null){await finished;throw new Error('ADMISSION_ENCODER_CLOSED_EARLY');}
    if(!encoder.stdin.write(png))await Promise.race([once(encoder.stdin,'drain'),finished.then(()=>{throw new Error('ADMISSION_ENCODER_CLOSED_EARLY');})]);
  },{timeoutMs:60000,code:'ADMISSION_ENCODER_WRITE_TIMEOUT',terminate:stop}),
  finish:()=>withDeadline(async()=>{encoder.stdin.end();await finished;},
    {timeoutMs:60000,code:'ADMISSION_ENCODER_FINISH_TIMEOUT',terminate:stop})};
}

/** Only validated geometry crosses into this browser. drawFrame reads trusted guest-output data. */
export async function captureAdmission({input,encoding,outputDirectory,drawFrame,verification,declarations={regions:[]}}) {
  const frameCount=configuration(input,encoding),expectedPlan=admissionVerificationPlan(frameCount);
  if(verification!==undefined&&canonical(verification)!==canonical(expectedPlan))throw new Error('ADMISSION_VERIFICATION_INVALID');
  verification=expectedPlan;
  if(typeof drawFrame!=='function')throw new Error('ADMISSION_DRAW_READER_REQUIRED');
  if(typeof outputDirectory!=='string'||!outputDirectory.trim())throw new Error('ADMISSION_OUTPUT_DIRECTORY_REQUIRED');
  const started=performance.now(),out=resolve(outputDirectory),{width,height,durationSeconds,targetId}=input;
  const timings={prepareMs:0,captureEncodeMs:0,determinismChecksMs:0,outputChecksMs:0,cleanupMs:0};
  let currentStage='prepareMs',stageStarted=started,finishedAt;
  const stage=name=>{
    const now=performance.now();
    if(currentStage)timings[currentStage]+=now-stageStarted;
    currentStage=name;stageStarted=now;
    if(name===null)finishedAt=now;
  };
  let bundle,handle,encoder,framesDirectory,report;
  const hashes=[],browserErrors=[],savedFrames=new Set([...verification.repeated,...verification.unordered,...verification.cold]);
  let maxFramePngBytes=0;
  try {
    bundle=prepareBrowserBundle(environmentLock.browser);
    const environment=inspectEnvironment(bundle),execution=inspectExecutionResources();
    mkdirSync(out,{recursive:true});
    const outputNames=['environment.json','execution.json','sample.mp4','poster.png','capture-report.json','failure-expected.png','failure-actual.png'];
    if(readdirSync(out).some(name=>outputNames.includes(name)))throw new Error('ADMISSION_OUTPUT_ALREADY_EXISTS');
    framesDirectory=mkdtempSync(join(out,'sampled-frames-'));
    writeFileSync(join(out,'environment.json'),JSON.stringify(environment,null,2)+'\n',{flag:'wx'});
    writeFileSync(join(out,'execution.json'),JSON.stringify(execution,null,2)+'\n',{flag:'wx'});
    const open=()=>withDeadline(async()=>{
      const context=await handle.browser.newContext({viewport:{width,height},deviceScaleFactor:1,locale:'en-US',timezoneId:'UTC',
        colorScheme:'light',reducedMotion:'no-preference',serviceWorkers:'block'});
      await context.route('**/*',route=>route.abort('blockedbyclient'));
      await context.setOffline(true);
      const page=await context.newPage();
      page.on('pageerror',error=>browserErrors.push(error.message));
      await page.setContent(shell,{waitUntil:'load'});
      return {context,page};
    },{timeoutMs:environmentLock.prepareTimeoutMs,code:'ADMISSION_BROWSER_PREPARE_TIMEOUT',terminate:()=>handle.stop()});
    const screenshot=(page,frame,options)=>withDeadline(async()=>{
      const draw=validateAdmissionDraw(await drawFrame(frame,options),{width,height,declarations});
      await page.evaluate(paintAdmissionCanvas,{commands:draw.commands,width,height});
      return page.screenshot({type:'png',animations:'allow',caret:'hide',timeout:frameTimeoutMs});
    },{timeoutMs:frameTimeoutMs,code:'ADMISSION_FRAME_TIMEOUT: '+frame,terminate:()=>handle.stop()});
    handle=await launchFixtureBrowser(bundle);
    const {context,page}=await open();
    stage('captureEncodeMs');
    const video=join(out,'sample.mp4');
    encoder=startEncoder(video,encoding,frameCount);
    for(let frame=0;frame<frameCount;frame++) {
      const png=await screenshot(page,frame),decoded=PNG.sync.read(png);
      assert.equal(decoded.width,width);assert.equal(decoded.height,height);
      maxFramePngBytes=Math.max(maxFramePngBytes,png.length);
      hashes.push(sha256(decoded.data));
      if(savedFrames.has(frame))writeFileSync(join(framesDirectory,frame+'.png'),png);
      if(frame===Math.floor(frameCount/2))writeFileSync(join(out,'poster.png'),png,{flag:'wx'});
      await encoder.write(png);
    }
    await encoder.finish();
    stage('determinismChecksMs');
    const compare=async(page,frame,label,options)=>{
      const actual=await screenshot(page,frame,options),actualHash=sha256(PNG.sync.read(actual).data);
      if(actualHash!==hashes[frame]) {
        copyFileSync(join(framesDirectory,frame+'.png'),join(out,'failure-expected.png'));
        writeFileSync(join(out,'failure-actual.png'),actual,{flag:'wx'});
      }
      assert.equal(actualHash,hashes[frame],label+' differs at frame '+frame);
    };
    for(const frame of verification.repeated)await compare(page,frame,'Repeated draw');
    for(const frame of verification.unordered)await compare(page,frame,'Unordered draw');
    await context.close();await handle.stop();
    handle=await launchFixtureBrowser(bundle);
    const cold=await open();
    for(const [index,frame] of verification.cold.entries())await compare(cold.page,frame,'Cold draw',index===0?{cold:true}:undefined);
    await cold.context.close();
    stage('outputChecksMs');
    const probe=parseCanonicalJson(execFileSync('/usr/bin/ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',video],
      {timeout:30000,killSignal:'SIGKILL',maxBuffer:1024*1024}));
    assert.equal(probe.streams.length,1,'The geometry profile is silent');
    const stream=probe.streams[0];
    for(const [key,value] of Object.entries({codec_type:'video',width,height,codec_name:'h264',pix_fmt:'yuv420p',r_frame_rate:'30/1',avg_frame_rate:'30/1',
      color_space:'bt709',color_transfer:'bt709',color_primaries:'bt709',color_range:'tv'}))assert.equal(stream[key],value,key);
    assert.equal(Number(stream.nb_read_frames),frameCount);assert.equal(Number(stream.duration),durationSeconds);
    assert(Math.abs(Number(probe.format.duration)-durationSeconds)<=2/30);
    assert(statSync(video).size<=presets.productLimits.maxOutputFileBytes);
    assert.deepEqual(browserErrors,[]);
    const file=name=>({file:name,sha256:sha256File(join(out,name)),byteLength:statSync(join(out,name)).size});
    report={kind:'m0a_admission_capture_result',scope:'trusted_geometry_commands_only',profile:'canvas-commands-v1',
      targetId,width,height,durationSeconds,frameCount,environmentHash:environment.environmentHash,execution,
      verification,pixelHashes:hashes,checks:{forwardFrames:frameCount,repeatedFrames:verification.repeated.length,
        unorderedFrames:verification.unordered.length,coldFrames:verification.cold.length,coldBrowserRestarted:true,sourceCodeInBrowser:false},
      capture:{frameTimeoutMs,sourceFrameStorage:'temporary_sampled_disk',maxFramePngBytes,encodingOverlapsCapture:true},
      video:file('sample.mp4'),poster:{...file('poster.png'),sourceFrame:Math.floor(frameCount/2),pixelSha256:hashes[Math.floor(frameCount/2)]},
      files:['sample.mp4','poster.png','environment.json','execution.json'].map(file),probe};
  } finally {
    stage('cleanupMs');
    try {await encoder?.stop();} finally {
      try {await handle?.stop();} finally {
        try {if(framesDirectory)rmSync(framesDirectory,{recursive:true,force:true});} finally {bundle?.cleanup();stage(null);}
      }
    }
  }
  report.timings={...Object.fromEntries(Object.entries(timings).map(([key,value])=>[key,Math.round(value)])),totalMs:Math.round(finishedAt-started)};
  writeFileSync(join(out,'capture-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  return {out,report};
}
