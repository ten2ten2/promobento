// Deliberately interrupts only this Actions run's new calibration operations. No model calls or complete-film reruns.
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';

export async function probeRecovery({json,call,upload,request,directory,operationId,prefix}){
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 if(process.env.GITHUB_ACTIONS!=='true'||!account||!token||!/^smoke-[a-f0-9]{12}-\d{8,20}$/.test(operationId))throw Error('RECOVERY_PROBE_SCOPE_INVALID');
 const operations=[operationId],report={scope:'native_cancel_termination_restart_fences_and_director_preflight_not_full_G1',status:'running',cases:{}};
 const budgetBefore=await json('model-budget');
 const save=()=>writeFileSync(directory+'/recovery-report.json',canonical(report));
 const pause=()=>new Promise(resolve=>setTimeout(resolve,1000));
 const until=async(name,work,accept,limit=60000)=>{const end=Date.now()+limit;let value;do{value=await work();if(accept(value))return value;await pause();}while(Date.now()<end);throw Error('RECOVERY_'+name+'_TIMEOUT');};
 const snapshot=id=>json('operations/'+id+'/recovery');
 const recover=()=>json('workflows/reconcile',{method:'POST'});
 const fault=(command,renderId)=>{
  if(!operations.some(id=>'render-'+id===renderId)||!['terminate','restart'].includes(command))throw Error('RECOVERY_FAULT_SCOPE_INVALID');
  const output=execFileSync('pnpm',['--filter','@promobento/cloud','exec','wrangler','workflows','instances',command,'promobento-staging-render',renderId,'--env','staging','--json'],{encoding:'utf8',timeout:45000});
  writeFileSync(`${directory}/${command}-${renderId}.json`,output);
 };
 const native=async(id,kind='render')=>{
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workflows/promobento-staging-${kind}/instances/${id}`,{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
  const value=parseCanonicalJson(await response.text());if(!response.ok||!value.success)throw Error('RECOVERY_NATIVE_STATUS_HTTP_'+response.status);return value.result;
 };
 const settled=value=>value.attempts.length>0&&value.attempts.every(attempt=>attempt.physicallyStopped===true&&attempt.stopped_at!==null)
  &&value.costs.every(cost=>cost.actual_micros!==null)&&value.workflows.every(workflow=>workflow.reconciled_at!==null&&['complete','errored','terminated'].includes(workflow.native_status));
 const start=async id=>{
  if(id!==operationId){operations.push(id);await json('operations',{method:'POST',body:{id,workspaceId:'internal-eval',projectId:'pipeline-recovery',purpose:'calibration',maxMicros:1000000}});}
  // Each operation needs its own rights row; source bytes and existing evidence stay immutable.
  if(id!==operationId)for(const resource of request.job.resources)await call('rights',{method:'POST',body:{operationId:id,resourceId:resource.resourceId,sha256:resource.sha256,licenseRef:request.options.resources.find(item=>item.resourceId===resource.resourceId).licenseRef,scope:'internal_eval_only',evidenceKey:prefix+'/rights.json'}});
  const input={...request,job:{...request.job,operationId:id,renderId:'render-'+id,candidateId:'candidate-'+id}};
  await json('renders',{method:'POST',body:input});
  const running=await until('ACTIVE_COMPUTE',()=>snapshot(id),value=>value.attempts.some(attempt=>attempt.mode==='shard'&&attempt.physicallyStopped===false)&&value.costs.some(cost=>cost.kind==='compute'&&cost.actual_micros===null));
  return{input,running};
 };
 try{
  const first=await start(operationId);report.cases.cancel={before:first.running};save();
  await call('operations/'+operationId+'/cancel',{method:'POST'});
  const cancelled=await until('CANCEL_STOP',async()=>{await recover();return snapshot(operationId);},settled);
  const cancelledRender=await json('renders/'+first.input.job.renderId);
  if(cancelled.operation.status!=='cancelled'||cancelled.operation.generation!==1||cancelledRender.status!=='cancelled')throw Error('RECOVERY_CANCEL_FENCE_FAILED');
  report.cases.cancel={before:first.running,after:cancelled,render:cancelledRender};save();

  const id=operationId+'-platform',second=await start(id),renderId=second.input.job.renderId;
  report.cases.platform={before:second.running};save();fault('terminate',renderId);
  await until('NATIVE_TERMINATION',()=>native(renderId),value=>value.status==='terminated');
  const terminated=await until('PLATFORM_CLEANUP',async()=>{await recover();return snapshot(id);},settled);
  const blocked=await json('renders/'+renderId);
  if(blocked.status!=='blocked'||parseCanonicalJson(blocked.result_json).code!=='RENDER_WORKFLOW_TERMINATED')throw Error('RECOVERY_PLATFORM_REPAIR_FAILED');
  report.cases.platform={before:second.running,after:terminated,render:blocked};save();
  // Full restart clears native checkpoints. The durable D1 execution claim must prevent a new paid attempt.
  fault('restart',renderId);
  const restartedNative=await until('RESTART_FENCE',()=>native(renderId),value=>['errored','terminated'].includes(value.status));
  await recover();const restarted=await snapshot(id);
  if(canonical(restarted.attempts.map(attempt=>attempt.id))!==canonical(terminated.attempts.map(attempt=>attempt.id))||canonical(restarted.costs)!==canonical(terminated.costs)
   ||(await json('renders/'+renderId)).result_json!==blocked.result_json||!settled(restarted))throw Error('RECOVERY_RESTART_REPEATED_WORK');
  report.cases.restart={native:restartedNative,after:restarted,newAttempts:0,newCosts:0};save();

  const directorId=operationId+'-director';operations.push(directorId);
  await json('operations',{method:'POST',body:{id:directorId,workspaceId:'internal-eval',projectId:'pipeline-recovery',purpose:'calibration',maxMicros:1000000}});
  const resource=request.job.resources[0],blob=request.inputs.find(item=>item.name==='resource:'+resource.resourceId),font=request.options.fonts[0];
  const context=await upload(prefix+'/director-context.json',canonical({audience:'software',durationSeconds:15,aspects:['landscape'],seed:request.options.seed,
   brief:'Original internal engineering fixture; blocked preflight, no model requests.',runtimeVersion:request.job.runtimeVersion,rendererRelease:request.job.rendererRelease,
   fonts:[font],confirmedFactIds:['fixture-cta'],facts:[{id:'fixture-cta',text:'Original internal calibration only.'}],resources:[{...blob,...request.options.resources[0]}]}),'application/json');
  await json('creative',{method:'POST',body:{operationId:directorId,contextKey:context.key}});
  const failed=await until('DIRECTOR_PREFLIGHT',()=>json('operations/'+directorId),value=>value.status==='failed');
  const director=await until('DIRECTOR_CLEANUP',async()=>{await recover();return snapshot(directorId);},value=>value.workflows.length===1&&value.workflows[0].reconciled_at!==null);
  if(director.costs.length||director.attempts.length||failed.result_key!==`operations/${directorId}/failure.json`)throw Error('RECOVERY_PREFLIGHT_SPENT_RESOURCES');
  const directorNative=await native(directorId,'operation');
  if(!/MODEL_(SECRET_MISSING|INTEGRATION_UNVERIFIED)/.test(canonical(directorNative)))throw Error('RECOVERY_PREFLIGHT_WRONG_CAUSE');
  report.cases.director={operation:failed,recovery:director,native:directorNative,modelRequests:0};
  const budget=await json('model-budget');if(budget.openingConfirmed!==budgetBefore.openingConfirmed||budget.openingMicros!==budgetBefore.openingMicros||budget.currentReservations!==budgetBefore.currentReservations)throw Error('RECOVERY_MODEL_GATE_CHANGED');
  report.modelBudget=budget;report.leases=await json('capacity');if(report.leases.length)throw Error('RECOVERY_LEASE_NOT_RETURNED');
  report.status='passed';save();return report;
 }catch(error){report.status='failed';report.error=String(error.stack??error);save();throw error;}
 finally{
  const cleanup=await Promise.allSettled(operations.map(async id=>{await call('operations/'+id+'/cancel',{method:'POST'});return json('operations/'+id+'/reconcile',{method:'POST'});}));
  report.cleanup=cleanup.map((result,index)=>({operationId:operations[index],status:result.status,...(result.status==='fulfilled'?{result:result.value}:{error:String(result.reason)})}));save();
  if(cleanup.some(result=>result.status==='rejected')&&report.status==='passed')throw Error('RECOVERY_FINAL_STOP_UNCONFIRMED');
 }
}
