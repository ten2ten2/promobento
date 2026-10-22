import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,copyFileSync,readdirSync,lstatSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {canonical,parseCanonicalJson,digest} from '@promobento/contracts';
import {admissionPolicy,verifiedAdmissionImage,repository} from './admission-image.mjs';
import {readAdmissionSource,admissionQaIdentity} from './admission-source.mjs';
import {runAdmissionSandbox} from './admission-sandbox.mjs';
import {admissionKeyframePlan} from './admission-capture.mjs';
import {admissionVerification,admissionEngineRequests} from './admission-verification.mjs';
import {validateAdmissionDraw} from './admission-commands.mjs';
import {admissionEngineBudget} from './admission-budget.mjs';
import {admissionFailure} from './admission-failure.mjs';

export async function renderAdmission({sourceDirectory,outputDirectory,signal,onCreated}) {
  const started=performance.now(),candidate=readAdmissionSource(sourceDirectory),image=verifiedAdmissionImage();
  const verification=admissionVerification(candidate.input.totalFrames),initialQa=admissionQaIdentity(candidate,image,verification);
  let qa=initialQa;
  const profile=candidate.manifest.capabilityProfile;
  const out=resolve(outputDirectory??join(repository,'artifacts/admission',randomUUID()));
  mkdirSync(out,{recursive:true});
  if(readdirSync(out).length)throw Error('ADMISSION_OUTPUT_NOT_EMPTY');
  const temporary=mkdtempSync(join(tmpdir(),'promobento-admission-')),data=join(temporary,'input'),captureOut=join(temporary,'output');
  mkdirSync(data,{mode:0o755});mkdirSync(captureOut,{mode:0o777});chmodSync(captureOut,0o777);
  const resources=[],hashes=[],stages={};
  let denseFrame=0,density=-1;
  const remaining=()=>{const value=admissionPolicy.taskTimeoutMs-(performance.now()-started);if(value<=0)throw Error('ADMISSION_TASK_TIMEOUT');return value;};
  const engineRemaining=admissionEngineBudget(admissionPolicy.engineStageTimeoutMs);
  const engineInput={...candidate.input};delete engineInput.durationSeconds;
  const enginePlan=admissionEngineRequests(verification),commandChecks={};
  const run=async requests=>{
    let sequence=0,complete=false,isolation;
    const taskMs=remaining(),engineMs=engineRemaining();
    const receipt=await runAdmissionSandbox({image,mode:'evaluate',signal,onCreated,timeoutMs:Math.min(taskMs,engineMs),
      timeoutCode:engineMs<=taskMs?'ADMISSION_ENGINE_BUDGET_EXHAUSTED':'ADMISSION_TASK_TIMEOUT',
      input:{source:candidate.source,input:engineInput,declarations:candidate.declarations,profile,resourceRequest:candidate.resourceRequest,
        frames:requests.map(item=>item.frame)},
      onLine(message){
        if(complete)throw Error('ADMISSION_UNEXPECTED_OUTPUT');
        if(message.kind==='isolation') {
          if(isolation||sequence||message.status!=='passed'||message.seccomp!==true)throw Error('ADMISSION_ISOLATION_RECEIPT');
          isolation=message;return;
        }
        if(!isolation)throw Error('ADMISSION_ISOLATION_REQUIRED');
        if(message.kind==='complete') {
          if(Object.keys(message).length!==2||message.count!==requests.length||sequence!==requests.length)throw Error('ADMISSION_INCOMPLETE');
          complete=true;return;
        }
        const expected=requests[sequence];
        if(!expected||Object.keys(message).sort().join(',')!=='draw,frameIndex,kind,sequence'||message.kind!=='draw'
          ||message.sequence!==sequence||message.frameIndex!==expected.frame)throw Error('ADMISSION_FRAME_IDENTITY');
        const draw=validateAdmissionDraw(message.draw,{...candidate.input,declarations:candidate.declarations,profile,resourceRequest:candidate.resourceRequest});
        const hash=digest(draw);
        if(expected.check==='forward') {
          hashes[expected.frame]=hash;
          const score=draw.commands.length+draw.commands.reduce((total,command)=>total+(command.op==='text'?command.text.length:0),0);
          if(score>density){density=score;denseFrame=expected.frame;}
        }
        else if(hashes[expected.frame]!==hash) {
          // Canonical commands and regions differ from the forward baseline at this exact call.
          const error=Error('ADMISSION_DETERMINISM_BLOCK: '+expected.frame);
          error.details={check:expected.check,frameIndex:expected.frame,sequence};throw error;
        }
        for(const file of expected.paths) {
          const path=join(data,file);mkdirSync(dirname(path),{recursive:true,mode:0o755});
          writeFileSync(path,canonical(draw),{mode:0o644,flag:'wx'});
        }
        commandChecks[expected.check]=(commandChecks[expected.check]??0)+1;sequence++;
      }});
    if(!complete)throw Error('ADMISSION_INCOMPLETE');resources.push({...receipt,isolation});
  };
  try {
    let stage=performance.now();
    await run(enginePlan.first);
    stages.executeMs=Math.round(performance.now()-stage);stage=performance.now();
    await run(enginePlan.cold);
    engineRemaining();
    stages.coldMs=Math.round(performance.now()-stage);stage=performance.now();
    writeFileSync(join(data,'job.json'),canonical({input:candidate.input,encoding:candidate.encoding,declarations:candidate.declarations,
      profile,resourceRequest:candidate.resourceRequest,denseFrame}),{mode:0o644});
    let captured=false;
    resources.push(await runAdmissionSandbox({image,mode:'capture',input:{},kind:'capture',signal,onCreated,timeoutMs:remaining(),
      mounts:[{source:data,target:'/input'},{source:captureOut,target:'/output',readonly:false}],
      onLine(message){if(captured||message.kind!=='capture-complete'||message.frameCount!==candidate.input.totalFrames)throw Error('ADMISSION_CAPTURE_RECEIPT');captured=true;}}));
    if(!captured)throw Error('ADMISSION_CAPTURE_INCOMPLETE');
    const capture=parseCanonicalJson(readFileSync(join(captureOut,'capture-report.json')));
    const names=['sample.mp4','poster.png','capture-report.json','environment.json','execution.json',
      ...(profile==='canvas-media-v1'?['text-track.json','keyframes.json',
        ...admissionKeyframePlan(candidate.input.totalFrames,candidate.declarations,denseFrame).map(item=>item.file)]:[]),...(capture.media?.frozenAudio?['mixed.wav']:[])];
    if(readdirSync(captureOut).some(name=>!names.includes(name)))throw Error('ADMISSION_CAPTURE_INVENTORY');
    for(const name of names) {
      const path=join(captureOut,name),stat=lstatSync(path);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>50000000)throw Error('ADMISSION_CAPTURE_FILE');
      copyFileSync(path,join(out,name));
    }
    stages.captureMs=Math.round(performance.now()-stage);
    remaining();
    if(capture.media)qa=admissionQaIdentity(candidate,image,verification,capture.media.resourceManifest);
    const report={kind:'m0a_admission_result',status:'passed',scope:profile+' technical execution admission',
      sourceHash:candidate.sourceHash,sourceArchiveHash:candidate.sourceArchiveHash,sourceFiles:candidate.files,
      targetSourceFiles:candidate.targetFiles,
      qaInputHash:qa.qaInputHash,qaProfileVersion:qa.qaProfileVersion,qaInput:qa.identity,
      capabilityProfile:profile,image,policy:admissionPolicy,verification,
      commandChecks:{forwardFrames:commandChecks.forward,repeatedFrames:commandChecks.repeated,unorderedFrames:commandChecks.unordered,
        coldReverseFrames:commandChecks.cold_reverse,newContainer:true,pixelSamplesUnchanged:true},
      commandHashes:hashes,resources,capture,productionEligible:false,
      limitations:[profile==='canvas-media-v1'?'registered licensed media and unshaped Latin text; no arbitrary upload, DOM, imports or build scripts':'geometry-only synchronous single module; no DOM, media, imports or build scripts',
        'no content-safety, factual verification, customer authorization or production quality association',
        'full cold-reverse command comparison and sampled pixel checks are bounded evidence, not proof of purity; Cloudflare execution remains unverified'],
      timings:{...stages,totalMs:Math.round(performance.now()-started)}};
    writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    return {out,report};
  } catch(error) {
    writeFileSync(join(out,'failure.json'),JSON.stringify({kind:'m0a_admission_failure',status:'BLOCK',qaInputHash:qa.qaInputHash,
      sourceHash:candidate.sourceHash,policy:admissionPolicy,...admissionFailure(error),resources},null,2)+'\n',{flag:'wx'});
    throw error;
  } finally {rmSync(temporary,{recursive:true,force:true});}
}
