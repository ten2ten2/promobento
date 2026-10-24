// Only the existing GitHub Actions secret -> staging Worker binding. Never fetch or log secret values.
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';

const name='MODEL_COMPAT_API_KEY',base='https://promobento-staging.woffordvivian.workers.dev';
const idleSql="SELECT (SELECT COUNT(*) FROM pipeline_operations WHERE status IN ('active','awaiting_user')) AS unfinished, (SELECT COUNT(*) FROM cost_reservations r LEFT JOIN cost_settlements s ON s.reservation_id=r.id WHERE r.kind='compute' AND s.reservation_id IS NULL) AS unsettled_compute;";

export async function bindModelSecret({run,health,secret,report}){
 if(typeof secret!=='string'||!secret.trim())throw Error('ACTIONS_MODEL_KEY_MISSING');
 const names=()=>parseCanonicalJson(run(['secret','list','--env','staging','--format','json'])).map(item=>item.name);
 const before=names();
 if(before.includes('EVAL_API_KEY'))throw Error('ANOTHER_INTERNAL_SESSION_ACTIVE');
 if(!await health())throw Error('STAGING_HEALTH_FAILED_BEFORE_BIND');
 report.configuredBefore=before.includes(name);
 if(report.configuredBefore){report.status='retained_existing_binding';report.configuredAfter=true;return report;}
 const query=parseCanonicalJson(run(['d1','execute','promobento-staging','--env','staging','--remote','--command',idleSql,'--json']));
 const idle=query[0]?.success===true&&query[0]?.results?.[0];
 if(!idle||idle.unfinished!==0||idle.unsettled_compute!==0)throw Error('STAGING_MODEL_BIND_REQUIRES_IDLE');
 // A failed/unknown write is not permission to repeat or erase a potentially applied binding.
 try{run(['secret','put',name,'--env','staging'],secret);}catch{throw Error('MODEL_SECRET_BIND_UNCONFIRMED');}
 report.configuredAfter=names().includes(name);
 if(!report.configuredAfter)throw Error('MODEL_SECRET_BIND_METADATA_MISSING');
 if(!await health()){
  // Only undo the binding this invocation created. No prior model key is overwritten or deleted.
  report.status='rolling_back_new_binding';
  try{
   run(['secret','delete',name,'--env','staging']);report.configuredAfter=names().includes(name);
   report.rollbackHealthy=await health();report.status=report.configuredAfter?'rollback_unconfirmed':'rolled_back_new_binding';
  }catch{report.status='rollback_unconfirmed';}
  throw Error('STAGING_HEALTH_FAILED_AFTER_BIND');
 }
 report.status='bound';return report;
}

async function main(){
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REF!=='refs/heads/main')throw Error('ACTIONS_MAIN_ONLY');
 const report={kind:'staging_model_key_binding',environment:'staging',secretName:name,status:'checking',
  source:'GitHub Actions repository/environment secret',runId:process.env.GITHUB_RUN_ID,sourceSha:process.env.GITHUB_SHA,
  workerCodeChanged:false,modelIntegrationExercised:false,modelCalls:0,renderCalls:0};
 const directory='artifacts/staging-model-key';mkdirSync(directory,{recursive:true});
 // Pass only the provided secret as stdin to Wrangler. No child receives it in its environment or arguments.
 const {MODEL_COMPAT_API_KEY:secret,...env}=process.env;
 const run=(args,input)=>execFileSync('pnpm',['--filter','@promobento/cloud','exec','wrangler',...args],
  {env,input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:60000,maxBuffer:2<<20});
 const health=async()=>{
  try{const response=await fetch(base+'/healthz',{signal:AbortSignal.timeout(15000),cache:'no-store'});
   return response.ok&&(parseCanonicalJson(await response.text())).protocol==='3.0.0';}catch{return false;}
 };
 try{await bindModelSecret({run,health,secret,report});}
 catch(error){report.status=report.status==='checking'?'failed':report.status;report.error=error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'MODEL_KEY_MAINTENANCE_FAILED';process.exitCode=1;}
 finally{writeFileSync(directory+'/binding.json',canonical(report)+'\n');console.log(canonical(report));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
