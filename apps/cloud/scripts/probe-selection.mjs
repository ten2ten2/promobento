// New G1 coverage only: capture quality, instance sizes and actual still/check latency; no movie or model.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {canonical} from '@promobento/contracts/canonical';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {renderPageTiming} from '@promobento/contracts/render';
import {filmFixture} from '../../../packages/film-runtime/test/fixture.mjs';
import {webglFixture} from '../../../packages/film-runtime/test/webgl-fixture.mjs';
import {distribution} from './probe-performance.mjs';

export async function probeSelection({json,call,upload,request,rules,policy,directory,operationId,prefix}){
 if(process.env.GITHUB_ACTIONS!=='true'||!/^smoke-[a-f0-9]{12}-\d{8,20}$/.test(operationId))throw Error('SELECTION_SCOPE_INVALID');
 const report={scope:'G1_capture_PNG_JPEG90_92_95_standard3_vs4_and_studio_tools_not_full_G1',status:'running',cases:{},quantiles:'empirical_nearest_rank'},frames=[45,165,375];
 const save=()=>writeFileSync(directory+'/selection-report.json',canonical(report));
 const initial=await json('capacity'),opening=await json('model-budget');if(initial.length)throw Error('SELECTION_REQUIRES_IDLE_STAGING');
 let negativeCreated=false;const negativeId=operationId+'-scope';
 const taskFor=(kind,instance,film)=>{
  const spec=kind==='webgl'?webglFixture():filmFixture(),taskId='select-'+operationId+'-'+kind+'-'+instance;
  return{schemaVersion:'3.0.0',kind:'render_task',mode:'studio',instance,taskId,
   job:{...request.job,renderId:taskId,sourceHash:filmSourceHash(canonical(spec)),quality:'still',frames},
   options:{...request.options,...renderPageTiming(spec,policy.render)},inputs:[{...film,name:'film'},...request.inputs.filter(blob=>blob.name!=='film')]};
 };
 try{
  for(const kind of ['2d','webgl']){
   const film=await upload(prefix+'/'+kind+'-selection.json',canonical(kind==='webgl'?webglFixture():filmFixture()),'application/json');
   for(const instance of ['standard-3','standard-4']){
    const label=kind+'-'+instance,task=taskFor(kind,instance,film),record={kind,instance,status:'starting',samples:[]};report.cases[label]=record;save();
    if(!negativeCreated){
     negativeCreated=true;await json('operations',{method:'POST',body:{id:negativeId,workspaceId:'internal-eval',projectId:'g1-selection',purpose:'evaluation',maxMicros:1000000}});
     await assert.rejects(json('studio',{method:'POST',body:{...task,taskId:'negative-'+operationId,instance:'standard-4',job:{...task.job,operationId:negativeId}}}),/STUDIO_SCOPE_INVALID/);
     await assert.rejects(json('operations/'+negativeId+'/studio/benchmark/45',{method:'POST'}),/BENCHMARK_CALIBRATION_REQUIRED/);
     report.nonCalibration=await json('operations/'+negativeId+'/recovery');
     if(report.nonCalibration.attempts.length||report.nonCalibration.costs.length)throw Error('SELECTION_SCOPE_CONSUMED_COMPUTE');save();
    }
    try{
     const before=Date.now();record.ready=await json('studio',{method:'POST',body:task});record.startToReadyRequestMs=Date.now()-before;
     if(kind==='webgl'&&!record.ready.webgl?.length)throw Error('SELECTION_WEBGL_MISSING');
     await assert.rejects(json('operations/'+operationId+'/studio/check/449',{method:'POST'}),/STUDIO_SCOPE_INVALID/);
     for(let index=0;index<10;index++){
      const frame=frames[index%frames.length],beforeStill=Date.now(),bytes=new Uint8Array(await(await call('operations/'+operationId+'/frames/'+frame)).arrayBuffer());
      const stillRequestMs=Date.now()-beforeStill,beforeCheck=Date.now(),check=await json('operations/'+operationId+'/studio/check/'+frame,{method:'POST'}),checkRequestMs=Date.now()-beforeCheck;
      if(check.frameIndex!==frame||check.observation.frame!==frame||check.observation.findings.some(item=>item.severity==='BLOCK'))throw Error('SELECTION_CHECK_BLOCK');
      const capture=await json('operations/'+operationId+'/studio/benchmark/'+frame,{method:'POST'});
      assert.deepEqual(capture.samples.map(sample=>sample.format),['png','jpeg90','jpeg92','jpeg95']);
      if(capture.samples.some(sample=>!Number.isFinite(sample.captureMs)||!Number.isSafeInteger(sample.byteLength)||sample.byteLength<1
       ||sample.format!=='png'&&(!Number.isFinite(sample.ssim)||sample.ssim<0||sample.ssim>1)))throw Error('SELECTION_METRIC_MISSING');
      record.samples.push({index,frame,stillRequestMs,checkRequestMs,check,capture});if(index===0)writeFileSync(directory+'/selection-'+label+'.png',bytes);save();
     }
     record.summary={stillRequestMs:distribution(record.samples.map(item=>item.stillRequestMs)),checkRequestMs:distribution(record.samples.map(item=>item.checkRequestMs)),formats:{}};
     for(const format of ['png','jpeg90','jpeg92','jpeg95']){
      const values=record.samples.map(item=>item.capture.samples.find(sample=>sample.format===format));
      record.summary.formats[format]={captureMs:distribution(values.map(item=>item.captureMs)),byteLength:distribution(values.map(item=>item.byteLength)),
       ...(format==='png'?{reference:true}:{ssim:distribution(values.map(item=>item.ssim))})};
     }
     record.status='passed';save();
    }finally{
     await call('operations/'+operationId+'/studio/close',{method:'POST'});
     record.recovery=await json('operations/'+operationId+'/recovery');
     if(!record.recovery.costs.some(cost=>cost.id===task.taskId&&cost.kind==='compute'&&cost.physicallyStopped===true)
      ||record.recovery.attempts.some(item=>item.physicallyStopped!==true)||record.recovery.costs.some(cost=>cost.actual_micros===null||cost.kind==='compute'&&cost.physicallyStopped!==true))throw Error('SELECTION_STOP_UNCONFIRMED');save();
    }
   }
  }
  report.leases=await json('capacity');report.modelBudget=await json('model-budget');
  if(report.leases.length||['openingMicros','openingConfirmed','currentChargedMicros','currentReservations'].some(field=>report.modelBudget[field]!==opening[field]))throw Error('SELECTION_FINAL_STATE_CHANGED');
  report.status='passed';save();return report;
 }catch(error){report.status='failed';report.error=String(error.stack??error);save();throw error;}
 finally{if(negativeCreated){await call('operations/'+negativeId+'/cancel',{method:'POST'});report.scopeCleanup=await json('operations/'+negativeId+'/reconcile',{method:'POST'});save();}}
}
