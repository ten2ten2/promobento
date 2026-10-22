import {readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';
import {parseCanonicalJson,canonical} from '@promobento/contracts';
import {admissionPolicy} from '../src/admission-image.mjs';
import {createAdmissionEngine} from '../src/admission-engine.mjs';
import {validateAdmissionDraw} from '../src/admission-commands.mjs';
import {createAdmissionOutput} from '../src/admission-output.mjs';
import {admissionFailure} from '../src/admission-failure.mjs';

const output=createAdmissionOutput(process.stdout,{maxBytes:admissionPolicy.maxTransportBytes,
  maxLineBytes:admissionPolicy.engine.maxOutputBytes+4096});
async function input() {
  let size=0;const chunks=[];
  for await(const chunk of process.stdin) {size+=chunk.length;if(size>2097152)throw Error('WORKER_INPUT_LIMIT');chunks.push(chunk);}
  return parseCanonicalJson(Buffer.concat(chunks));
}
async function evaluate(job) {
  if(!Array.isArray(job.frames)||job.frames.length>920)throw Error('WORKER_FRAME_PLAN');
  await output({kind:'isolation',...await inspectTaskIsolation()});
  const engine=await createAdmissionEngine({...job,limits:admissionPolicy.engine});
  let failure;
  try {
    for(const [sequence,frameIndex] of job.frames.entries()) {
      const draw=validateAdmissionDraw(engine.draw(frameIndex),{...job.input,declarations:job.declarations,
        profile:job.profile??'canvas-commands-v1',resourceRequest:job.resourceRequest});
      await output({kind:'draw',sequence,frameIndex,draw});
    }
  } catch(error) {failure=error;throw error;}
  finally {try {engine.dispose();}catch(error){if(!failure)throw error;}}
  await output({kind:'complete',count:job.frames.length});
}
async function engineTest(job) {
  await inspectTaskIsolation();
  const {admissionEngineCases,admissionCaseInput:input,admissionCaseDeclarations:declarations}=await import('../test/admission-engine.cases.mjs');
  const selected=admissionEngineCases.filter(item=>item.name===job.name);
  if(selected.length!==1)throw Error('ENGINE_CASE_UNKNOWN');
  for(const item of selected) {
    let engine,phase='create',error;
    try {
      engine=await createAdmissionEngine({source:item.source,input,declarations,limits:admissionPolicy.engine});
      phase='draw';const draw=engine.draw(0);
      if(item.expected==='success') {
        validateAdmissionDraw(draw,{...input,declarations});
        if(canonical(engine.draw(0))!==canonical(draw))throw Error('REPEATED_DRAW_CHANGED');
      } else if(item.expected==='command-reject')validateAdmissionDraw(draw,{...input,declarations});
      phase='dispose';engine.dispose();engine=null;
    } catch(cause) {error=cause;}
    finally {try {engine?.dispose();}catch(cause){error??=cause;}}
    if(item.expected==='success'?!!error:!error||phase!==item.phase)
      throw Error('ENGINE_CASE_FAILED: '+item.name+' phase='+phase+' '+(error?.message??'was accepted'));
    if(item.timeout&&!error.message.includes('TIMEOUT'))throw Error('ENGINE_CASE_TIMEOUT_EXPECTED: '+item.name+' '+error.message);
    await output({kind:'engine-test',name:item.name,status:'passed',phase,errorCode:error?.message??null});
  }
}
const cannotConnect=host=>new Promise((resolve,reject)=>{
  const socket=createConnection({host,port:80});
  socket.once('connect',()=>{socket.destroy();reject(Error('NETWORK_REACHABLE'));});
  socket.once('error',()=>resolve());socket.setTimeout(1000,()=>{socket.destroy();resolve();});
});
async function inspectTaskIsolation() {
  if(process.getuid()!==65532)throw Error('PROBE_ROOT');
  if(process.env.PROMOBENTO_HOST_CANARY||existsSync('/var/run/docker.sock')||existsSync('/host-canary'))throw Error('PROBE_HOST_EXPOSED');
  const status=readFileSync('/proc/self/status','utf8');
  if(!/^NoNewPrivs:\s+1$/mu.test(status)||!/^CapEff:\s+0+$/mu.test(status)||!/^Seccomp:\s+2$/mu.test(status))throw Error('PROBE_PRIVILEGES');
  for(const path of ['/app/unauthorized','/input/readonly-canary']) {
    let blocked=false;try {writeFileSync(path,'not allowed');}catch{blocked=true;}
    if(!blocked)throw Error('PROBE_WRITE_ALLOWED');
  }
  await cannotConnect('1.1.1.1');await cannotConnect('169.254.169.254');
  if(!existsSync('/sys/fs/cgroup/cgroup.controllers'))throw Error('ADMISSION_CGROUP_V2_REQUIRED');
  const read=path=>readFileSync('/sys/fs/cgroup/'+path,'utf8').trim();
  const measured={memory:read('memory.max'),pids:read('pids.max'),cpu:read('cpu.max')};
  const expected=admissionPolicy.engineContainer;
  const [quota,period]=measured.cpu.split(' ').map(Number);
  if(measured.memory!==String(expected.memoryBytes)||measured.pids!==String(expected.pids)||quota/period!==expected.cpus)
    throw Error('PROBE_CGROUP_LIMITS');
  return {status:'passed',cgroups:measured,network:'none',rootReadOnly:true,credentialsAbsent:true,seccomp:true};
}
async function probe() {
  const isolation=await inspectTaskIsolation();
  let full=false,count=0;
  try {for(;count<40;count++)writeFileSync('/tmp/quota-'+count,Buffer.alloc(1048576,1));}
  catch(error){if(error.code!=='ENOSPC')throw error;full=true;}
  finally {for(let i=0;i<=count;i++)rmSync('/tmp/quota-'+i,{force:true});}
  if(!full)throw Error('PROBE_DISK_UNBOUNDED');
  // BusyBox's sleep is not required; existing /usr/bin/sleep stays below the memory budget.
  const children=[];let processLimited=false;
  try {
    for(let i=0;i<64;i++) {
      const child=spawn('/usr/bin/sleep',['30'],{stdio:'ignore'});
      const result=await new Promise(resolve=>{child.once('spawn',()=>resolve('spawn'));child.once('error',error=>resolve(error.code));});
      if(result==='EAGAIN'){processLimited=true;break;}
      if(result!=='spawn')throw Error('PROBE_SPAWN_'+result);
      children.push(child);
    }
  } finally {await Promise.all(children.map(async child=>{child.kill('SIGKILL');await once(child,'close');}));}
  if(!processLimited)throw Error('PROBE_PIDS_UNBOUNDED');
  await output({kind:'probe',...isolation,
    taskMountReadOnly:true,diskLimitObserved:true,processLimitObserved:true});
}
async function capture() {
  const job=parseCanonicalJson(readFileSync('/input/job.json'));
  const {captureAdmission,admissionVerificationPlan}=await import('../src/admission-capture.mjs');
  const plan=admissionVerificationPlan(job.input.totalFrames);
  const requests=[...Array.from({length:job.input.totalFrames},(_,i)=>({frame:i,path:'forward/'+i+'.json'})),
    ...plan.repeated.map((frame,i)=>({frame,path:'repeated/'+i+'.json'})),
    ...plan.unordered.map((frame,i)=>({frame,path:'unordered/'+i+'.json'})),
    ...plan.cold.map((frame,i)=>({frame,path:'cold/'+i+'.json',cold:i===0}))];
  let index=0;
  const {report}=await captureAdmission({...job,verification:plan,outputDirectory:'/output',drawFrame(frame,options){
    const request=requests[index++];
    if(request.frame!==frame||!!request.cold!==!!options?.cold)throw Error('CAPTURE_PLAN_MISMATCH');
    return parseCanonicalJson(readFileSync('/input/'+request.path));
  }});
  if(index!==requests.length)throw Error('CAPTURE_PLAN_INCOMPLETE');
  await output({kind:'capture-complete',frameCount:report.frameCount});
}
try {
  const mode=process.argv[2];
  if(mode==='evaluate')await evaluate(await input());
  else if(mode==='engine-test')await engineTest(await input());
  else if(mode==='probe'){await input();await probe();}
  else if(mode==='hang'){await input();while(true){}}
  else if(mode==='oom'){await input();const retained=[];while(true)retained.push(Buffer.alloc(8*1024*1024,1));}
  else if(mode==='capture'){await input();await capture();}
  else if(mode==='audio-tools'){
    const {runCreativeAudioJob}=await import('../src/creative-audio-worker.mjs');
    await runCreativeAudioJob(await input());await output({kind:'audio-tools-complete'});
  }
  else if(mode==='edit-evidence'){
    await input();const {writeEditEvidence}=await import('../src/edit-evidence.mjs');
    const evidence=writeEditEvidence({...parseCanonicalJson(readFileSync('/input/job.json')),mediaPath:'/input/video.mp4',outputDirectory:'/output'});
    await output({kind:'edit-evidence-complete',frameIndex:evidence.frameIndex});
  }
  else throw Error('WORKER_MODE_INVALID');
} catch(error) {
  process.stderr.write(JSON.stringify({kind:'admission_failure',...admissionFailure(error)})+'\n');process.exitCode=1;
}
