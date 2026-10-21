import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,existsSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseCanonicalJson} from '@promobento/contracts';
import {admissionPolicy,verifiedAdmissionImage,repository} from '../src/admission-image.mjs';
import {runAdmissionSandbox} from '../src/admission-sandbox.mjs';
import {renderAdmission} from '../src/admission-run.mjs';
import {admissionFailure} from '../src/admission-failure.mjs';
import {admissionVerificationPlan} from '../src/admission-capture.mjs';
import {admissionEngineCases,admissionValidSource,admissionCaseInput,admissionCaseDeclarations} from '../test/admission-engine.cases.mjs';
import {admissionDenseSource,admissionTransportLimitSource,admissionSlowSource} from '../test/admission-resource.cases.mjs';

const image=verifiedAdmissionImage(),results=[],started=Date.now();
const createdNames=[];
const onCreated=name=>createdNames.push(name);
const sandbox=options=>runAdmissionSandbox({...options,onCreated});
const temporary=mkdtempSync(join(tmpdir(),'promobento-admission-tests-'));
const out=join(repository,'artifacts/admission-tests',String(started));mkdirSync(out,{recursive:true});
const resourceInput={...admissionCaseInput,totalFrames:900};
const verification=admissionVerificationPlan(resourceInput.totalFrames);
const resourceFrames=[...Array.from({length:resourceInput.totalFrames},(_,frame)=>frame),...verification.repeated,...verification.unordered];
const resourceJob=source=>({source,input:resourceInput,declarations:admissionCaseDeclarations,frames:resourceFrames});
// Trusted expected JSON, not evaluation or import of a candidate composition.
const rectangleDraw=(frame,count)=>({commands:Array.from({length:count},(_,index)=>({op:'rect',x:frame,y:index,
  width:1,height:1,color:'#123456',opacity:1})),regions:[]});
const plannedDrawBytes=countForFrame=>resourceFrames.reduce((total,frameIndex,sequence)=>total+
  Buffer.byteLength(JSON.stringify({kind:'draw',sequence,frameIndex,draw:rectangleDraw(frameIndex,countForFrame(frameIndex))})+'\n'),0);
const writeSource=(name,source)=>{
  const directory=join(temporary,name);mkdirSync(directory);
  for(const file of ['candidate.json','declarations.json','values.json'])
    copyFileSync(join(repository,'tests/fixtures/admission',file),join(directory,file));
  writeFileSync(join(directory,'composition.mjs'),source);return directory;
};
const assertFailure=(error,code,{mode,oomKilled=false}={})=>{
  const failure=admissionFailure(error);
  assert.equal(failure.errorCode,code);
  assert.equal(failure.sandbox?.mode,mode);assert.equal(failure.sandbox?.kind,'engine');
  assert(createdNames.includes(failure.sandbox?.name));
  assert.equal(failure.sandbox.maxTransportBytes,admissionPolicy.maxTransportBytes);
  assert.equal(failure.sandbox.memoryBytes,admissionPolicy.engineContainer.memoryBytes);
  assert(Number.isSafeInteger(failure.sandbox.transportBytes)&&failure.sandbox.transportBytes>=0);
  assert(Number.isSafeInteger(failure.sandbox.framesReceived)&&failure.sandbox.framesReceived>=0);
  assert.equal(typeof failure.sandboxState?.status,'string');
  assert(Number.isInteger(failure.sandboxState.exitCode));
  assert.equal(failure.sandboxState.oomKilled,oomKilled);
  return failure;
};
const recordFailure=(name,failure)=>{
  const directory=join(out,name);mkdirSync(directory);
  const path=join(directory,'failure.json');
  writeFileSync(path,JSON.stringify(failure,null,2)+'\n');
  assert.deepEqual(parseCanonicalJson(readFileSync(path)),failure);
  return name+'/failure.json';
};
try {
  chmodSync(temporary,0o755);writeFileSync(join(temporary,'readonly-canary'),'read-only task data');
  process.env.PROMOBENTO_HOST_CANARY='must never enter the task';
  const probes=[];
  await sandbox({image,mode:'probe',input:{},mounts:[{source:temporary,target:'/input'}],timeoutMs:20000,onLine:r=>probes.push(r)});
  assert.equal(probes.length,1);assert.equal(probes[0].status,'passed');results.push(probes[0]);
  assert.equal(readFileSync(join(temporary,'readonly-canary'),'utf8'),'read-only task data');
  // Match production: one VM per disposable task. Freed WASM modules are not
  // guaranteed to leave Node's RSS before the next case without a process exit.
  for(const {name} of admissionEngineCases) {
    const records=[];
    await sandbox({image,mode:'engine-test',input:{name},timeoutMs:10000,onLine:r=>records.push(r)});
    assert.equal(records.length,1);assert.equal(records[0].name,name);assert.equal(records[0].status,'passed');
    results.push(records[0]);
  }
  for(const mode of ['hang','oom']) {
    let failure;
    await assert.rejects(sandbox({image,mode,input:{},timeoutMs:mode==='hang'?2500:15000}),
      error=>{failure=assertFailure(error,mode==='hang'?'ADMISSION_TASK_TIMEOUT':'ADMISSION_ENGINE_OOM',{mode,oomKilled:mode==='oom'});return true;});
    assert.equal(failure.sandbox.framesReceived,0);
    results.push({kind:'containment-test',name:mode,status:'passed',failure:recordFailure(mode,failure)});
  }
  const abort=new AbortController();setTimeout(()=>abort.abort(),2000).unref();
  let cancelled;
  await assert.rejects(sandbox({image,mode:'hang',input:{},timeoutMs:10000,signal:abort.signal}),
    error=>{cancelled=assertFailure(error,'ADMISSION_CANCELLED',{mode:'hang'});return true;});
  results.push({kind:'containment-test',name:'cancel',status:'passed',failure:recordFailure('cancel',cancelled)});

  const outputAbort=new AbortController(),cancelAfterFrames=10;
  let cancelledFrames=0,cancelledComplete=false,outputCancelled;
  await assert.rejects(sandbox({image,mode:'evaluate',input:resourceJob(admissionTransportLimitSource),
    timeoutMs:10000,signal:outputAbort.signal,onLine(message){
      if(message.kind==='draw') {
        assert.equal(message.sequence,cancelledFrames);assert.equal(message.frameIndex,resourceFrames[cancelledFrames]);
        cancelledFrames++;
        if(cancelledFrames===cancelAfterFrames)outputAbort.abort();
      }
      if(message.kind==='complete')cancelledComplete=true;
    }}),error=>{outputCancelled=assertFailure(error,'ADMISSION_CANCELLED',{mode:'evaluate'});return true;});
  assert(outputAbort.signal.aborted);assert(!cancelledComplete);
  assert.equal(cancelledFrames,cancelAfterFrames);
  assert.equal(outputCancelled.sandbox.framesReceived,cancelledFrames);
  assert(outputCancelled.sandbox.transportBytes>0&&outputCancelled.sandbox.transportBytes<admissionPolicy.maxTransportBytes);
  results.push({kind:'containment-test',name:'cancel-active-output',status:'passed',framesReceived:cancelledFrames,
    transportBytes:outputCancelled.sandbox.transportBytes,failure:recordFailure('cancel-active-output',outputCancelled)});

  const densePlannedBytes=plannedDrawBytes(frame=>frame===1?4096:600);
  assert(densePlannedBytes<admissionPolicy.maxTransportBytes-4096,'The dense case must fit without raising the transport cap');
  let denseSequence=0,denseIsolation=false,denseComplete=false,denseBytes=0;
  const denseReceipt=await sandbox({image,mode:'evaluate',input:resourceJob(admissionDenseSource),
    timeoutMs:admissionPolicy.engineStageTimeoutMs,onLine(message){
      denseBytes+=Buffer.byteLength(JSON.stringify(message)+'\n');
      assert(!denseComplete,'No output may follow complete');
      if(message.kind==='isolation') {
        assert(!denseIsolation);assert.equal(denseSequence,0);assert.equal(message.status,'passed');
        denseIsolation=true;return;
      }
      assert(denseIsolation);
      if(message.kind==='complete') {
        assert.deepEqual(message,{kind:'complete',count:resourceFrames.length});
        assert.equal(denseSequence,resourceFrames.length);denseComplete=true;return;
      }
      const frame=resourceFrames[denseSequence];
      assert.deepEqual(message,{kind:'draw',sequence:denseSequence,frameIndex:frame,
        draw:rectangleDraw(frame,frame===1?4096:600)});
      denseSequence++;
    }});
  assert(denseComplete);assert.equal(denseReceipt.transportBytes,denseBytes);
  assert(denseBytes<=admissionPolicy.maxTransportBytes);
  results.push({kind:'resource-test',name:'dense-full-frame-plan',status:'passed',forwardFrames:900,
    repeatedFrames:verification.repeated.length,unorderedFrames:verification.unordered.length,
    maxCommands:4096,plannedDrawBytes:densePlannedBytes,transportBytes:denseReceipt.transportBytes});

  const overLimitBytes=plannedDrawBytes(()=>1000);
  assert(overLimitBytes>admissionPolicy.maxTransportBytes,'The oversized case must exceed the actual task cap');
  const overLimitOut=join(out,'transport-limit-rejected');let transportFailure;
  await assert.rejects(renderAdmission({sourceDirectory:writeSource('transport-limit',admissionTransportLimitSource),
    outputDirectory:overLimitOut,onCreated}),error=>{
    transportFailure=assertFailure(error,'ADMISSION_TRANSPORT_LIMIT',{mode:'evaluate'});return true;
  });
  const persistedTransportFailure=parseCanonicalJson(readFileSync(join(overLimitOut,'failure.json')));
  assert.equal(persistedTransportFailure.status,'BLOCK');
  for(const [key,value] of Object.entries(transportFailure))assert.deepEqual(persistedTransportFailure[key],value);
  assert(transportFailure.sandbox.framesReceived>0&&transportFailure.sandbox.framesReceived<900);
  assert(transportFailure.sandbox.transportBytes<=admissionPolicy.maxTransportBytes);
  assert.equal(transportFailure.details.maxTransportBytes,admissionPolicy.maxTransportBytes);
  assert.equal(transportFailure.details.transportBytes,transportFailure.sandbox.transportBytes);
  assert(transportFailure.details.transportBytes+transportFailure.details.nextLineBytes>admissionPolicy.maxTransportBytes);
  assert(!existsSync(join(overLimitOut,'sample.mp4')));
  results.push({kind:'resource-test',name:'transport-limit-blocked-before-capture',status:'passed',
    plannedDrawBytes:overLimitBytes,framesReceived:transportFailure.sandbox.framesReceived,
    transportBytes:transportFailure.sandbox.transportBytes,failure:'transport-limit-rejected/failure.json'});

  let slowFrames=0,slowComplete=false,budgetFailure;
  await assert.rejects(sandbox({image,mode:'evaluate',input:resourceJob(admissionSlowSource),timeoutMs:6000,
    timeoutCode:'ADMISSION_ENGINE_BUDGET_EXHAUSTED',onLine(message){
      if(message.kind==='draw') {
        assert.equal(message.sequence,slowFrames);assert.equal(message.frameIndex,resourceFrames[slowFrames]);slowFrames++;
      }
      if(message.kind==='complete')slowComplete=true;
    }}),error=>{budgetFailure=assertFailure(error,'ADMISSION_ENGINE_BUDGET_EXHAUSTED',{mode:'evaluate'});return true;});
  assert(slowFrames>0&&slowFrames<resourceFrames.length,'Several bounded calls must finish before the accumulated deadline');
  assert(!slowComplete);assert.equal(budgetFailure.sandbox.framesReceived,slowFrames);
  results.push({kind:'resource-test',name:'engine-stage-budget',status:'passed',framesReceived:slowFrames,
    timeoutMs:6000,failure:recordFailure('engine-budget',budgetFailure)});

  const sourceDirectory=writeSource('stateful',admissionValidSource
    .replace('prepare(context) {','prepare(context) { let drawCount=0;')
    .replace('x:time.numerator','x:drawCount++'));
  const rejectedOut=join(out,'stateful-rejected');
  await assert.rejects(renderAdmission({sourceDirectory,outputDirectory:rejectedOut,onCreated}),/ADMISSION_DETERMINISM_BLOCK/);
  assert.equal(parseCanonicalJson(readFileSync(join(rejectedOut,'failure.json'))).status,'BLOCK');
  assert(!existsSync(join(rejectedOut,'sample.mp4')));
  results.push({kind:'determinism-test',name:'stateful-source-blocked',status:'passed'});
  const rendered=await renderAdmission({sourceDirectory:join(repository,'tests/fixtures/admission'),outputDirectory:join(out,'render'),onCreated});
  assert.equal(rendered.report.capture.frameCount,900);
  assert.equal(rendered.report.productionEligible,false);
  results.push({kind:'media-test',status:'passed',frameCount:900,qaInputHash:rendered.report.qaInputHash});
  // Check only this invocation's random names, including failing and successful render tasks.
  const containers=execFileSync('docker',['ps','--all','--filter','name=promobento-admission-','--format','{{.Names}}'],{encoding:'utf8',timeout:30000}).trim();
  assert(!containers.split('\n').some(name=>createdNames.includes(name)),'This test must remove its containers after success, interruption and OOM');
  writeFileSync(join(out,'verification.json'),JSON.stringify({kind:'admission_verification',image,
    commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim(),
    ci:{runId:process.env.GITHUB_RUN_ID??null,attempt:process.env.GITHUB_RUN_ATTEMPT??null},
    results,totalMs:Date.now()-started},null,2)+'\n');
  console.log(JSON.stringify({status:'passed',checks:results.length,out}));
} catch(error) {
  writeFileSync(join(out,'failure.json'),JSON.stringify({status:'failed',results,...admissionFailure(error)},null,2)+'\n');
  throw error;
} finally {delete process.env.PROMOBENTO_HOST_CANARY;rmSync(temporary,{recursive:true,force:true});}
