// Formal S1 isolation on the deployed render image, using only fixed probes and original material.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {canonical} from '@promobento/contracts/canonical';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {renderPageTiming} from '@promobento/contracts/render';
import {filmFixture} from '../../../packages/film-runtime/test/fixture.mjs';
import {webglFixture} from '../../../packages/film-runtime/test/webgl-fixture.mjs';

export async function probeIsolation({json,call,upload,request,policy,directory,operationId,prefix}){
 if(process.env.GITHUB_ACTIONS!=='true'||!/^smoke-[a-f0-9]{12}-\d{8,20}$/.test(operationId))throw Error('ISOLATION_SCOPE_INVALID');
 const report={scope:'S1_formal_image_network_token_uid_browser_corpus_and_stop_not_full_S2_fault_corpus',rendererRelease:request.job.rendererRelease,status:'running',cases:{}};
 const save=()=>writeFileSync(directory+'/isolation-report.json',canonical(report)),negativeId=operationId+'-scope';
 const opening=await json('model-budget');if((await json('capacity')).length)throw Error('ISOLATION_REQUIRES_IDLE_STAGING');
 let negativeCreated=false;
 try{
  negativeCreated=true;await json('operations',{method:'POST',body:{id:negativeId,workspaceId:'internal-eval',projectId:'g1-isolation',purpose:'evaluation',maxMicros:1000000}});
  await assert.rejects(json('operations/'+negativeId+'/studio/isolation/45',{method:'POST'}),/ISOLATION_CALIBRATION_REQUIRED/);
  report.nonCalibration=await json('operations/'+negativeId+'/recovery');
  if(report.nonCalibration.attempts.length||report.nonCalibration.costs.length)throw Error('ISOLATION_SCOPE_CONSUMED_COMPUTE');save();
  for(const kind of ['2d','webgl']){
   const spec=kind==='webgl'?webglFixture():filmFixture(),instance=kind==='webgl'?'standard-4':'standard-3';
   const film=await upload(prefix+'/'+kind+'-isolation.json',canonical(spec),'application/json'),taskId='isolate-'+operationId+'-'+kind;
   const task={schemaVersion:'3.0.0',kind:'render_task',mode:'studio',instance,taskId,
    job:{...request.job,renderId:taskId,sourceHash:filmSourceHash(canonical(spec)),quality:'still',frames:[45]},
    options:{...request.options,...renderPageTiming(spec,policy.render)},inputs:[{...film,name:'film'},...request.inputs.filter(item=>item.name!=='film')]};
   const record={kind,instance,status:'starting'};report.cases[kind]=record;save();
   try{
    record.ready=await json('studio',{method:'POST',body:task});
    if(kind==='webgl'&&!record.ready.webgl?.length)throw Error('ISOLATION_WEBGL_MISSING');
    await assert.rejects(json('operations/'+operationId+'/studio/isolation/46',{method:'POST'}),/STUDIO_SCOPE_INVALID/);
    record.result=await json('operations/'+operationId+'/studio/isolation/45',{method:'POST'});save();
    if(record.result.passed!==true)throw Error('ISOLATION_PROBE_FAILED');
    record.status='passed';
   }finally{
    await call('operations/'+operationId+'/studio/close',{method:'POST'});record.recovery=await json('operations/'+operationId+'/recovery');save();
    if(!record.recovery.costs.some(item=>item.id===taskId&&item.kind==='compute'&&item.physicallyStopped===true)
     ||record.recovery.attempts.some(item=>item.physicallyStopped!==true)||record.recovery.costs.some(item=>item.actual_micros===null||item.kind==='compute'&&item.physicallyStopped!==true))throw Error('ISOLATION_STOP_UNCONFIRMED');
   }
  }
  report.leases=await json('capacity');report.modelBudget=await json('model-budget');
  if(report.leases.length||['openingMicros','openingConfirmed','currentChargedMicros','currentReservations'].some(field=>report.modelBudget[field]!==opening[field]))throw Error('ISOLATION_FINAL_STATE_CHANGED');
  report.status='passed';save();return report;
 }catch(error){report.status='failed';report.error=String(error.stack??error);save();throw error;}
 finally{if(negativeCreated){await call('operations/'+negativeId+'/cancel',{method:'POST'});report.scopeCleanup=await json('operations/'+negativeId+'/reconcile',{method:'POST'});save();}}
}
