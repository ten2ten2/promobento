// This file is a trusted controller run ONLY inside the isolated research container.
import {cpSync,mkdirSync,readdirSync,readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {parseCanonicalJson,safePath} from '/app/packages/contracts/index.mjs';
import {prepareBrowserBundle,sha256File,sha256} from '/app/apps/renderer/src/browser-bundle.mjs';
import {environmentLock,inspectEnvironment} from '/app/apps/renderer/src/environment.mjs';

async function main() {
const duration=Number(process.argv[2]);
if(![15,30].includes(duration))throw Error('BASELINE_DURATION_INVALID');
const project='/tmp/project',result='/tmp/result';
mkdirSync(project);mkdirSync(result);
cpSync('/project',project,{recursive:true});
mkdirSync(project+'/vendor',{recursive:true});
for(const file of ['gsap.min.js','GSAP-LICENSE.html'])copyFileSync('/upstream/templates/blank/vendor/'+file,project+'/vendor/'+file);
let mediaReport=null;
if(existsSync(project+'/baseline-resources.json')) {
  const request=parseCanonicalJson(readFileSync(project+'/baseline-resources.json'));
  const {prepareAdmissionMedia}=await import('/app/apps/renderer/src/admission-media.mjs');
  mkdirSync('/tmp/media');
  const media=prepareAdmissionMedia({request:request.resources,declarations:request.declarations,input:{totalFrames:duration*30},outputDirectory:'/tmp/media'});
  for(const resource of media.manifest.resources) {
    if(!safePath(resource.path))throw Error('BASELINE_RESOURCE_PATH');
    const route=media.routes.get(resource.url);if(!route)throw Error('BASELINE_RESOURCE_BYTES_MISSING');
    mkdirSync(dirname(join(project,resource.path)),{recursive:true});
    if(route.bytes)writeFileSync(join(project,resource.path),route.bytes);else copyFileSync(route.path,join(project,resource.path));
  }
  if(media.audio) {
    mkdirSync(project+'/audio',{recursive:true});copyFileSync(media.audio.mixedPath,project+'/audio/mixed.wav');
    const html=readFileSync(project+'/index.html','utf8');
    if(/<audio\b/iu.test(html))throw Error('BASELINE_AUDIO_MUST_USE_FROZEN_TRACK');
    writeFileSync(project+'/index.html',html.replace('</body>',`<audio id="baseline-frozen-audio" src="audio/mixed.wav" data-start="0" data-duration="${duration}"></audio></body>`));
  }
  mediaReport=media.report;
}
const bundle=prepareBrowserBundle(environmentLock.browser);
try {
  const environment=inspectEnvironment(bundle);
  // Chromium's user-namespace sandbox is unavailable in this constrained Docker
  // environment. The complete browser + upstream process stays behind Docker's
  // no-network, read-only-host, non-root boundary; this wrapper never runs on host.
  const browserWrapper='/tmp/baseline-chrome';
  writeFileSync(browserWrapper,'#!/bin/sh\nexec "$BASELINE_BROWSER" --no-sandbox "$@"\n',{mode:0o700});
  const env={...process.env,...bundle.fontEnvironment,OM_CHROME:browserWrapper,BASELINE_BROWSER:bundle.executablePath};
  const started=performance.now();
  const args=['/upstream/cli/om.js','render',project,'--format','mp4','--fps','30','--workers','1','--frames','png','--silent'];
  execFileSync(process.execPath,args,{env,stdio:['ignore','pipe','pipe'],timeout:540000,maxBuffer:4*1024*1024});
  const files=readdirSync(project+'/out').filter(file=>file.endsWith('.mp4'));
  if(files.length!==1)throw Error('BASELINE_OUTPUT_COUNT');
  const file=project+'/out/'+files[0];
  const probe=parseCanonicalJson(execFileSync('/usr/bin/ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',file],{timeout:30000,maxBuffer:4*1024*1024}));
  const video=probe.streams.find(stream=>stream.codec_type==='video');
  if(video?.codec_name!=='h264'||video.r_frame_rate!=='30/1'||Number(video.nb_read_frames)!==duration*30||Math.abs(Number(probe.format.duration)-duration)>2/30)
    throw Error('BASELINE_OUTPUT_SPEC');
  const {openFilm}=await import('/upstream/cli/lib/capture.js');
  Object.assign(process.env,env);
  const total=duration*30,frames=[0,17,Math.floor(total/3),Math.floor(total/2),total-7,total-1];
  const first=await openFilm(project+'/index.html',{chrome:browserWrapper});
  const hashes={};
  try {
    for(const frame of frames){await first.seek(frame/30);hashes[frame]=sha256(await first.shot());}
    for(const frame of [...frames].reverse().concat(frames[0],frames[3],frames[0])) {
      await first.seek(frame/30);if(sha256(await first.shot())!==hashes[frame])throw Error('BASELINE_NONDETERMINISTIC');
    }
    if(first.errors.length)throw Error('BASELINE_PAGE_ERRORS');
  } finally {await first.close();}
  const cold=await openFilm(project+'/index.html',{chrome:browserWrapper});
  try {
    for(const frame of [frames[3],frames[0],frames[5],frames[1],frames[4],frames[2]]) {
      await cold.seek(frame/30);if(sha256(await cold.shot())!==hashes[frame])throw Error('BASELINE_COLD_NONDETERMINISTIC');
    }
    if(cold.errors.length)throw Error('BASELINE_PAGE_ERRORS');
  } finally {await cold.close();}
  copyFileSync(file,result+'/sample.mp4');
  const report={kind:'m0a_baseline_render',productionEligible:false,upstreamCommit:'5f2608c2e12abcf518f74dde86093b19f7f88603',
    durationSeconds:duration,frames:Number(video.nb_read_frames),width:video.width,height:video.height,environment,probe,
    browserSandbox:false,additionalBrowserArgs:['--no-sandbox'],media:mediaReport,
    timings:{renderAndProbeMs:Math.ceil(performance.now()-started)},artifactSha256:sha256File(result+'/sample.mp4'),
    upstreamRenderLog:readFileSync(project+'/.om/renders.jsonl','utf8'),determinism:{status:'passed',policy:'m0a-baseline-seek-v1',sampledFrames:frames,hashes},cost:'not_calibrated'};
  writeFileSync(result+'/report.json',JSON.stringify(report,null,2)+'\n');
} finally {bundle.cleanup();}
// Docker unmounts tmpfs when a container exits. Keep it alive until the host has
// copied the two bounded artifacts, then the host removes this exact container.
if(!/^[a-f0-9-]{36}$/u.test(process.argv[3]??''))throw Error('BASELINE_HANDSHAKE_REQUIRED');
process.stdout.write('BASELINE_RESULT_READY '+process.argv[3]+'\n');
process.stdin.resume();await once(process.stdin,'end');
}
main().catch(error=>{
  // A nonce-bound controller code may be retried; arbitrary CLI stderr is never
  // promoted to a repairable content error or emitted by the public host CLI.
  const repairable=new Set(['BASELINE_OUTPUT_COUNT','BASELINE_OUTPUT_SPEC','BASELINE_NONDETERMINISTIC',
    'BASELINE_COLD_NONDETERMINISTIC','BASELINE_PAGE_ERRORS','BASELINE_AUDIO_MUST_USE_FROZEN_TRACK']);
  const code=repairable.has(error.message)?error.message:'BASELINE_EXECUTION_FAILED';
  process.stderr.write(String(error.stack??error).slice(-16384)+'\n');
  process.stderr.write('BASELINE_ERROR '+process.argv[3]+' '+code+'\n');process.exit(1);
});
