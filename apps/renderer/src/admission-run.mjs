import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,copyFileSync,readdirSync,lstatSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {canonical,parseCanonicalJson,digest} from '@promobento/contracts';
import {admissionPolicy,verifiedAdmissionImage,repository} from './admission-image.mjs';
import {readAdmissionSource,admissionQaIdentity} from './admission-source.mjs';
import {runAdmissionSandbox} from './admission-sandbox.mjs';
import {admissionVerificationPlan} from './admission-capture.mjs';
import {validateAdmissionDraw} from './admission-commands.mjs';
import {admissionEngineBudget} from './admission-budget.mjs';
import {admissionFailure} from './admission-failure.mjs';

export async function renderAdmission({sourceDirectory,outputDirectory,signal,onCreated}) {
  const started=performance.now(),candidate=readAdmissionSource(sourceDirectory),image=verifiedAdmissionImage();
  const verification=admissionVerificationPlan(candidate.input.totalFrames),qa=admissionQaIdentity(candidate,image,verification);
  const out=resolve(outputDirectory??join(repository,'artifacts/admission',randomUUID()));
  mkdirSync(out,{recursive:true});
  if(readdirSync(out).length)throw Error('ADMISSION_OUTPUT_NOT_EMPTY');
  const temporary=mkdtempSync(join(tmpdir(),'promobento-admission-')),data=join(temporary,'input'),captureOut=join(temporary,'output');
  mkdirSync(data,{mode:0o755});mkdirSync(captureOut,{mode:0o777});chmodSync(captureOut,0o777);
  const resources=[],hashes=[],stages={};
  const remaining=()=>{const value=admissionPolicy.taskTimeoutMs-(performance.now()-started);if(value<=0)throw Error('ADMISSION_TASK_TIMEOUT');return value;};
  const engineRemaining=admissionEngineBudget(admissionPolicy.engineStageTimeoutMs);
  const engineInput={...candidate.input};delete engineInput.durationSeconds;
  const forward=Array.from({length:candidate.input.totalFrames},(_,frame)=>({frame,path:'forward/'+frame+'.json'}));
  const check=(name,frames)=>frames.map((frame,i)=>({frame,path:name+'/'+i+'.json'}));
  const run=async requests=>{
    let sequence=0,complete=false,isolation;
    const taskMs=remaining(),engineMs=engineRemaining();
    const receipt=await runAdmissionSandbox({image,mode:'evaluate',signal,onCreated,timeoutMs:Math.min(taskMs,engineMs),
      timeoutCode:engineMs<=taskMs?'ADMISSION_ENGINE_BUDGET_EXHAUSTED':'ADMISSION_TASK_TIMEOUT',
      input:{source:candidate.source,input:engineInput,declarations:candidate.declarations,frames:requests.map(item=>item.frame)},
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
        const draw=validateAdmissionDraw(message.draw,{...candidate.input,declarations:candidate.declarations});
        const hash=digest(draw);
        if(expected.path.startsWith('forward/'))hashes[expected.frame]=hash;
        else if(hashes[expected.frame]!==hash)throw Error('ADMISSION_DETERMINISM_BLOCK: '+expected.frame);
        const path=join(data,expected.path);mkdirSync(dirname(path),{recursive:true,mode:0o755});
        writeFileSync(path,canonical(draw),{mode:0o644,flag:'wx'});sequence++;
      }});
    if(!complete)throw Error('ADMISSION_INCOMPLETE');resources.push({...receipt,isolation});
  };
  try {
    let stage=performance.now();
    await run([...forward,...check('repeated',verification.repeated),...check('unordered',verification.unordered)]);
    stages.executeMs=Math.round(performance.now()-stage);stage=performance.now();
    await run(check('cold',verification.cold));
    engineRemaining();
    stages.coldMs=Math.round(performance.now()-stage);stage=performance.now();
    writeFileSync(join(data,'job.json'),canonical({input:candidate.input,encoding:candidate.encoding,declarations:candidate.declarations}),{mode:0o644});
    let captured=false;
    resources.push(await runAdmissionSandbox({image,mode:'capture',input:{},kind:'capture',signal,onCreated,timeoutMs:remaining(),
      mounts:[{source:data,target:'/input'},{source:captureOut,target:'/output',readonly:false}],
      onLine(message){if(captured||message.kind!=='capture-complete'||message.frameCount!==candidate.input.totalFrames)throw Error('ADMISSION_CAPTURE_RECEIPT');captured=true;}}));
    if(!captured)throw Error('ADMISSION_CAPTURE_INCOMPLETE');
    const capture=parseCanonicalJson(readFileSync(join(captureOut,'capture-report.json')));
    const names=['sample.mp4','poster.png','capture-report.json','environment.json','execution.json'];
    if(readdirSync(captureOut).some(name=>!names.includes(name)))throw Error('ADMISSION_CAPTURE_INVENTORY');
    for(const name of names) {
      const path=join(captureOut,name),stat=lstatSync(path);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>50000000)throw Error('ADMISSION_CAPTURE_FILE');
      copyFileSync(path,join(out,name));
    }
    stages.captureMs=Math.round(performance.now()-stage);
    remaining();
    const report={kind:'m0a_admission_result',status:'passed',scope:'canvas-commands-v1 technical execution admission',
      sourceHash:candidate.sourceHash,sourceArchiveHash:candidate.sourceArchiveHash,sourceFiles:candidate.files,
      targetSourceFiles:candidate.targetFiles,
      qaInputHash:qa.qaInputHash,qaProfileVersion:qa.qaProfileVersion,qaInput:qa.identity,
      capabilityProfile:admissionPolicy.capabilityProfile,image,policy:admissionPolicy,verification,
      commandHashes:hashes,resources,capture,productionEligible:false,
      limitations:['geometry-only synchronous single module; no DOM, media, imports or build scripts',
        'no content-safety, factual verification, customer authorization or production quality association',
        'bounded determinism checks; Cloudflare execution remains unverified'],
      timings:{...stages,totalMs:Math.round(performance.now()-started)}};
    writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    return {out,report};
  } catch(error) {
    writeFileSync(join(out,'failure.json'),JSON.stringify({kind:'m0a_admission_failure',status:'BLOCK',qaInputHash:qa.qaInputHash,
      sourceHash:candidate.sourceHash,policy:admissionPolicy,...admissionFailure(error),resources},null,2)+'\n',{flag:'wx'});
    throw error;
  } finally {rmSync(temporary,{recursive:true,force:true});}
}
