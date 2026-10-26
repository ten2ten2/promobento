// Finish cleanup evidence for one already-terminal private case. Never creates/replays work.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
const [arg,...extra]=process.argv.slice(2),file=resolve(arg??'');
if(!arg||extra.length||!file.startsWith(resolve('artifacts')+'/')||!file.endsWith('/report.json'))throw Error('PRIVATE_CASE_REPORT_REQUIRED');
const report=parseCanonicalJson(readFileSync(file));
if(report.scope!=='internal_eval_only'||report.publicUseCleared!==false||!['failed','cancelled','review_draft_delivered_pending_owner_review'].includes(report.status)
 ||!/^eval-[a-z0-9-]+-\d{13}$/.test(report.operationId??''))throw Error('TERMINAL_EVAL_CASE_REQUIRED');
const wrangler=(args,options={})=>execFileSync('pnpm',['--filter','@promobento/cloud','exec','wrangler',...args],
 {env:{...process.env,WRANGLER_LOG_PATH:'/tmp/promobento-s1-recovery-cli.log'},encoding:'utf8',timeout:60000,...options});
if(parseCanonicalJson(wrangler(['secret','list','--env','staging'])).some(secret=>secret.name==='EVAL_API_KEY'))throw Error('ANOTHER_INTERNAL_SESSION_ACTIVE');
const key=randomBytes(32).toString('hex'),base='https://promobento-staging.woffordvivian.workers.dev/internal/s1/';
const save=()=>writeFileSync(file,canonical(report)+'\n');let bound=false;
async function json(path,method='GET'){
 const until=Date.now()+30000;
 for(;;){
  const response=await fetch(base+path,{method,headers:{authorization:'Bearer '+key},signal:AbortSignal.timeout(120000)});
  const text=await response.text();if(response.ok)return parseCanonicalJson(text);
  if(response.status===404&&text==='Not found'&&Date.now()<until){await new Promise(resolve=>setTimeout(resolve,2000));continue;}
  throw Error('EVAL_RECOVERY_'+response.status+' '+path+':'+text.slice(0,300));
 }
}
try{
 wrangler(['secret','put','EVAL_API_KEY','--env','staging'],{input:key});bound=true;report.internalKeyRevoked=false;save();
 const state=await json('operations/'+report.operationId);
 if(!['failed','cancelled'].includes(state.status))throw Error('OPERATION_NOT_TERMINAL');
 report.cleanup=await json('operations/'+report.operationId+'/reconcile','POST');save();
 report.recovery=await json('operations/'+report.operationId+'/recovery');save();
 report.budgetAfter=await json('model-budget');report.capacity=await json('capacity');
 report.cost={chargedMicros:report.recovery.costs.reduce((sum,cost)=>sum+(cost.actual_micros??cost.reserved_micros),0),
  unresolved:report.recovery.costs.filter(cost=>cost.actual_micros===null).map(cost=>({id:cost.id,kind:cost.kind,reservedMicros:cost.reserved_micros}))};
 report.cleanupRecoveredAt=new Date().toISOString();save();
 if(report.capacity.length||report.recovery.costs.some(cost=>cost.kind==='compute'&&(cost.actual_micros===null||cost.physicallyStopped!==true)))throw Error('EVAL_COMPUTE_CLEANUP_UNCONFIRMED');
 report.cleanupStatus='confirmed';save();
 console.log(canonical({operationId:report.operationId,status:state.status,cost:report.cost,capacity:report.capacity,scope:'terminal_cleanup_only_no_model_or_render_calls'}));
}catch(error){report.cleanupStatus='unconfirmed';report.cleanupRecoveryError=String(error.stack??error);save();throw error;}
finally{if(bound){try{wrangler(['secret','delete','EVAL_API_KEY','--env','staging']);report.internalKeyRevoked=true;save();}
 catch(error){report.internalKeyRevoked=false;report.keyRevocationError=String(error.stack??error);save();throw error;}}}
