import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,existsSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseCanonicalJson} from '@promobento/contracts';
import {verifiedAdmissionImage,repository} from '../src/admission-image.mjs';
import {runAdmissionSandbox} from '../src/admission-sandbox.mjs';
import {renderAdmission} from '../src/admission-run.mjs';
import {admissionEngineCases,admissionValidSource} from '../test/admission-engine.cases.mjs';

const image=verifiedAdmissionImage(),results=[],started=Date.now();
const createdNames=[];
const onCreated=name=>createdNames.push(name);
const sandbox=options=>runAdmissionSandbox({...options,onCreated});
const temporary=mkdtempSync(join(tmpdir(),'promobento-admission-tests-'));
const out=join(repository,'artifacts/admission-tests',String(started));mkdirSync(out,{recursive:true});
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
    await assert.rejects(sandbox({image,mode,input:{},timeoutMs:mode==='hang'?2500:15000}),
      mode==='hang'?/ADMISSION_TASK_TIMEOUT/:error=>error.message.includes('ADMISSION_SANDBOX_FAILED')&&error.sandboxState?.oomKilled===true);
    results.push({kind:'containment-test',name:mode,status:'passed'});
  }
  const abort=new AbortController();setTimeout(()=>abort.abort(),2000).unref();
  await assert.rejects(sandbox({image,mode:'hang',input:{},timeoutMs:10000,signal:abort.signal}),/ADMISSION_CANCELLED/);
  results.push({kind:'containment-test',name:'cancel',status:'passed'});
  const sourceDirectory=join(temporary,'stateful');mkdirSync(sourceDirectory);
  for(const name of ['candidate.json','declarations.json','values.json'])
    copyFileSync(join(repository,'tests/fixtures/admission',name),join(sourceDirectory,name));
  writeFileSync(join(sourceDirectory,'composition.mjs'),admissionValidSource
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
  writeFileSync(join(out,'failure.json'),JSON.stringify({status:'failed',results,error:error.message},null,2)+'\n');
  throw error;
} finally {delete process.env.PROMOBENTO_HOST_CANARY;rmSync(temporary,{recursive:true,force:true});}
