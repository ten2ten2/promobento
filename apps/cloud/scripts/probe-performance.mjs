// G1's first performance matrix. Original calibration films only; no model calls or creative evaluation.
import {mkdirSync,writeFileSync} from 'node:fs';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {planShards,renderPageTiming,renderDeadlineMs} from '@promobento/contracts/render';
import {filmFixture,pageOptions} from '../../../packages/film-runtime/test/fixture.mjs';
import {webglFixture} from '../../../packages/film-runtime/test/webgl-fixture.mjs';
import {filmBlockEvents} from '../../../packages/blocks/src/events.mjs';
import {deriveAudioPlan,audioPlanHash} from '../../../packages/audio/src/plan.mjs';

export function performanceFilm(kind){
 if(!['2d','webgl'].includes(kind))throw Error('PERFORMANCE_KIND_INVALID');
 const film=kind==='webgl'?webglFixture():filmFixture();
 for(const scene of film.scenes){scene.start*=2;scene.end*=2;if(scene.transitionIn)scene.transitionIn.frames*=2;}
 film.durationSeconds=30;film.totalFrames=900;
 film.treatment.energyCurve=film.treatment.energyCurve.map(point=>({...point,frame:point.frame===449?899:point.frame*2}));
 film.audio={music:{kind:'procedural',style:'mallet',bpm:100},sfx:'auto',captions:'off'};
 return film;
}

/** Empirical nearest-rank quantiles. Never merge serial and concurrent wall-time populations. */
export function distribution(values){
 if(!values.length||values.some(value=>!Number.isFinite(value)||value<0))throw Error('PERFORMANCE_METRIC_MISSING');
 const sorted=[...values].sort((a,b)=>a-b),rank=p=>sorted[Math.ceil(p*sorted.length)-1];
 return{count:sorted.length,min:sorted[0],p50:rank(.5),p95:rank(.95),max:sorted.at(-1)};
}

export function performanceSummary(samples){
 const summary={quantiles:'empirical_nearest_rank',wallClock:'client_POST_start_to_first_passed_response_including_queue_and_1s_polling',
  containerReady:'new_instance_start_to_controller_health_response_not_Chromium_ready',
  frameCapture:'seek_plus_ready_ack_plus_CDP_jpeg92_excludes_encoder_backpressure_QA_and_seam_PNGs',
  costBasis:'allocated_resource_upper_bound_not_vendor_invoice',groups:{}};
 const peakValues=[],allImages=new Set();let unavailablePeaks=0;
 for(const kind of ['2d','webgl']){
  const population=samples.filter(sample=>sample.kind===kind),groups={};
  for(const [mode,count]of [['serial',10],['parallel',4]]){
   const rows=population.filter(sample=>sample.mode===mode);
   if(rows.length!==count||rows.some(sample=>sample.status!=='passed'||sample.outcome.media.totalFrames!==900))throw Error('PERFORMANCE_MATRIX_INCOMPLETE');
   const captures=[],boot=[],page=[],capacity=[],cost=[],flags={},images=new Set(),seams=[],attemptCounts={total:0,successful:0,unsuccessful:0};
   for(const sample of rows){
    const shards=sample.recovery.attempts.filter(attempt=>attempt.mode==='shard'&&attempt.status==='succeeded');
    if(shards.length!==(kind==='webgl'?24:6)||sample.recovery.attempts.some(attempt=>attempt.physicallyStopped!==true)
     ||sample.recovery.costs.some(item=>item.kind!=='compute'||!Number.isSafeInteger(item.actual_micros)||item.actual_micros<0))throw Error('PERFORMANCE_SETTLEMENT_INCOMPLETE');
    cost.push(sample.recovery.costs.reduce((sum,item)=>sum+item.actual_micros,0));
    attemptCounts.total+=sample.recovery.attempts.length;
    attemptCounts.successful+=sample.recovery.attempts.filter(attempt=>attempt.status==='succeeded').length;
    attemptCounts.unsuccessful+=sample.recovery.attempts.filter(attempt=>attempt.status!=='succeeded').length;
    let frames=0;
    for(const attempt of shards){
     const result=parseCanonicalJson(attempt.result_json),receipt=result.report,timing=result.lifecycleTimings;
     if(receipt.captureFormat!=='jpeg92'||!receipt.timings.frameCaptureMs||receipt.timings.frameCaptureMs.length!==receipt.end-receipt.start
      ||!timing||!Number.isFinite(timing.containerReadyMs)||!Number.isFinite(timing.capacityWaitMs))throw Error('PERFORMANCE_FRAME_TELEMETRY_MISSING');
     if(kind==='webgl'&&!receipt.webgl?.length)throw Error('PERFORMANCE_WEBGL_MISSING');
     frames+=receipt.end-receipt.start;captures.push(...receipt.timings.frameCaptureMs);boot.push(timing.containerReadyMs);
     capacity.push(timing.capacityWaitMs);page.push(receipt.timings.handshakeMs);images.add(receipt.imageDigest);allImages.add(receipt.imageDigest);
     flags[receipt.cpuFlagsHash]=(flags[receipt.cpuFlagsHash]??0)+1;
     if(receipt.peakMemoryMiB===null&&receipt.peakMemoryUnavailableReason==='cgroup_peak_not_exposed')unavailablePeaks++;
     else if(Number.isSafeInteger(receipt.peakMemoryMiB)&&receipt.peakMemoryMiB>0)peakValues.push(receipt.peakMemoryMiB);
     else throw Error('PERFORMANCE_MEMORY_TELEMETRY_INVALID');
    }
    if(frames!==900)throw Error('PERFORMANCE_FRAME_TELEMETRY_MISSING');
    const actualSeams=sample.outcome.seamReport.seams;
    if(actualSeams.length!==shards.length-1||actualSeams.some(seam=>!['pass','pass_within_tolerance'].includes(seam.verdict)))throw Error('PERFORMANCE_SEAMS_INCOMPLETE');
    seams.push(...actualSeams);
   }
   if(images.size!==1)throw Error('PERFORMANCE_ENVIRONMENT_MIXED');
   groups[mode]={films:count,wallMs:distribution(rows.map(sample=>sample.renderToPassedMs)),containerReadyMs:distribution(boot),
    pageHandshakeMs:distribution(page),capacityWaitMs:distribution(capacity),frameCaptureMs:distribution(captures),
    computeUpperBoundMicros:distribution(cost),totalComputeUpperBoundMicros:cost.reduce((a,b)=>a+b,0),imageDigest:[...images][0],cpuFlagsHashCounts:flags,
    computeAttempts:attemptCounts,frameTelemetryScope:'successful_shards_only_failed_attempts_and_all_their_costs_retained_in_raw_samples_and_totals',
    seams:{count:seams.length,identical:seams.filter(seam=>seam.identical).length,withinTolerance:seams.filter(seam=>!seam.identical&&seam.verdict==='pass_within_tolerance').length}};
  }
  summary.groups[kind]=groups;
 }
 if(allImages.size!==1)throw Error('PERFORMANCE_ENVIRONMENT_MIXED');
 summary.peakMemory={status:unavailablePeaks?'unverified':'measured',measuredCount:peakValues.length,unavailableCount:unavailablePeaks,
  ...(unavailablePeaks?{reason:'cgroup_peak_not_exposed'}:{}),...(peakValues.length?{mib:distribution(peakValues)}:{})};
 return summary;
}

export async function probePerformance({json,call,upload,request,rules,policy,directory,operationId,prefix}){
 if(process.env.GITHUB_ACTIONS!=='true'||!/^smoke-[a-f0-9]{12}-\d{8,20}$/.test(operationId))throw Error('PERFORMANCE_SCOPE_INVALID');
 const samples=[],open=new Set(),report={scope:'G1_performance_10_serial_plus_4_concurrent_30s_each_2d_and_webgl_not_complete_G1',status:'running',samples,
  deploymentSha:process.env.DEPLOYED_SHA,harnessSha:process.env.GITHUB_SHA,samplingOrder:['webgl','2d'],workspaceShardLimit:policy.limits.workspaceShardInstances,perOperationBudgetMicros:1000000};
 const save=()=>writeFileSync(directory+'/performance-report.json',canonical(report));
 const pause=()=>new Promise(resolve=>setTimeout(resolve,1000));
 const opening=await json('model-budget'),initialLeases=await json('capacity');
 if(initialLeases.length)throw Error('PERFORMANCE_REQUIRES_IDLE_STAGING');
 const prepare=async(kind,mode,index)=>{
  const id=operationId+'-'+kind+'-'+mode+'-'+index,renderId='render-'+id;
  const sample={operationId:id,renderId,kind,mode,index,status:'preparing'};samples.push(sample);open.add(id);save();
  await json('operations',{method:'POST',body:{id,workspaceId:'internal-eval',projectId:'g1-performance',purpose:'calibration',maxMicros:1000000}});
  for(const resource of request.job.resources)await call('rights',{method:'POST',body:{operationId:id,resourceId:resource.resourceId,sha256:resource.sha256,
   licenseRef:request.options.resources.find(item=>item.resourceId===resource.resourceId).licenseRef,scope:'internal_eval_only',evidenceKey:prefix+'/rights.json'}});
  const spec=performanceFilm(kind),options=pageOptions('landscape',rules.aspectLayouts.landscape);delete options.target.ratio;
  options.target.totalFrames=900;options.fonts=request.options.fonts;options.resources=request.options.resources;Object.assign(options,renderPageTiming(spec,policy.render));
  const film=await upload(prefix+'/'+kind+'-'+mode+'-'+index+'-film.json',canonical(spec),'application/json');
  const plan=deriveAudioPlan(spec,filmBlockEvents(spec)),audio=await upload(prefix+'/'+kind+'-'+mode+'-'+index+'-audio.json',canonical(plan),'application/json');
  const job={...request.job,operationId:id,renderId,candidateId:'candidate-'+id,sourceHash:filmSourceHash(canonical(spec)),durationSeconds:30,totalFrames:900,audioPlanHash:audioPlanHash(plan,{seed:options.seed})};
  const input={...request,job,options,inputs:[{...film,name:'film'},...request.inputs.filter(blob=>blob.name!=='film')],audioInputsBlobs:[{...audio,name:'audio-plan'}],
   audioInputs:{seed:options.seed,clearedSources:plan.sources.map(source=>({sourceId:source.sourceId,licenseRef:source.licenseRef,rightsCleared:true}))},coverFrame:450};
  const partition=planShards(job,spec,{seed:options.seed});sample.partition=partition;sample.input=input;sample.status='prepared';save();return{sample,input,partition};
 };
 const cleanup=async sample=>{
  await call('operations/'+sample.operationId+'/cancel',{method:'POST'});
  const until=Date.now()+60000;let state;
  do{
   await json('operations/'+sample.operationId+'/reconcile',{method:'POST'});state=await json('operations/'+sample.operationId+'/recovery');
   if(['cancelled','failed'].includes(state.operation.status)&&state.attempts.every(attempt=>attempt.physicallyStopped===true)&&state.costs.every(cost=>cost.actual_micros!==null)){
    sample.recovery??=state;
    sample.cleanup={status:'confirmed',operation:state.operation,attempts:state.attempts.map(({id,physicallyStopped})=>({id,physicallyStopped})),costs:state.costs};
    open.delete(sample.operationId);save();return;
   }
   await pause();
  }while(Date.now()<until);
  sample.cleanup={status:'unconfirmed',state};save();throw Error('PERFORMANCE_STOP_OR_SETTLEMENT_UNCONFIRMED');
 };
 const run=async({sample,input,partition})=>{
  let failure;
  try{
   sample.startedAt=Date.now();sample.status='running';save();await json('renders',{method:'POST',body:input});
   const until=sample.startedAt+renderDeadlineMs(input.job,partition,policy.render)+15000;
   while(Date.now()<until){
    const row=await json('renders/'+sample.renderId);
    if(row.status==='passed'){sample.outcome=parseCanonicalJson(row.result_json);sample.renderToPassedMs=Date.now()-sample.startedAt;break;}
    if(['blocked','cancelled'].includes(row.status))throw Error('PERFORMANCE_RENDER_BLOCKED:'+row.result_json);
    await pause();
   }
   if(!sample.outcome)throw Error('PERFORMANCE_RENDER_DEADLINE');
   sample.recovery=await json('operations/'+sample.operationId+'/recovery');
   // Preserve one actual movie and cover per kind. All 28 immutable output references stay in the report/R2.
   if(sample.mode==='serial'&&sample.index===0){
    const dest=directory+'/performance-'+sample.kind;mkdirSync(dest,{recursive:true});
    for(const object of sample.outcome.outputs.filter(blob=>/\/(film.mp4|poster.png)$/.test(blob.key))){
     const bytes=new Uint8Array(await(await call('artifacts/'+object.key)).arrayBuffer());
     if(sha256Bytes(bytes)!==object.sha256)throw Error('PERFORMANCE_OUTPUT_IDENTITY_MISMATCH');
     writeFileSync(dest+'/'+object.key.split('/').at(-1),bytes);
    }
   }
   sample.status='passed';save();console.log(canonical({kind:sample.kind,mode:sample.mode,index:sample.index,renderToPassedMs:sample.renderToPassedMs,status:sample.status}));
  }catch(error){
   failure=error;sample.status='failed';sample.error=String(error.stack??error);
   try{sample.renderFailure=await json('renders/'+sample.renderId);}catch(diagnosis){sample.diagnosisError=String(diagnosis);}
   save();
  }finally{
   try{await cleanup(sample);}catch(error){sample.cleanupError=String(error.stack??error);sample.status='failed';failure??=error;save();}
  }
  if(failure)throw failure;
 };
 try{
  for(const kind of report.samplingOrder){
   for(let index=0;index<10;index++)await run(await prepare(kind,'serial',index));
   const batch=[];for(let index=0;index<4;index++)batch.push(await prepare(kind,'parallel',index));
   const results=await Promise.allSettled(batch.map(run));
   const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  }
  report.summary=performanceSummary(samples);report.modelBudget=await json('model-budget');report.leases=await json('capacity');
 if(report.leases.length||['openingMicros','openingConfirmed','currentChargedMicros','currentReservations'].some(field=>report.modelBudget[field]!==opening[field]))throw Error('PERFORMANCE_FINAL_STATE_CHANGED');
  report.status='passed';save();return report;
 }catch(error){report.status='failed';report.error=String(error.stack??error);save();throw error;}
 finally{
  const pending=await Promise.allSettled([...open].map(id=>cleanup(samples.find(sample=>sample.operationId===id))));
  if(pending.some(result=>result.status==='rejected')){report.cleanupPending=[...open];report.status='failed';save();throw Error('PERFORMANCE_CLEANUP_PENDING');}
 }
}
