// Read-only staging diagnosis through approved Actions credentials; never prints credential values.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
const {CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:account,INSPECT_RUN:run,DEPLOYED_SHA:sha}=process.env;
if(process.env.GITHUB_ACTIONS!=='true'||!/^\d{8,20}$/.test(run??'')||!/^([a-f0-9]{40})$/.test(sha??'')||!token||!account)throw Error('INSPECTION_SCOPE_INVALID');
const config=parseCanonicalJson(readFileSync('apps/cloud/wrangler.jsonc','utf8').replace(/^\/\/.*\n/,''));
const baseOperation='smoke-'+sha.slice(0,12)+'-'+run,operationId=process.env.INSPECT_OPERATION||baseOperation;
if(!/^[A-Za-z0-9_-]{4,96}$/.test(operationId)||operationId!==baseOperation&&!operationId.startsWith(baseOperation+'-'))throw Error('INSPECTION_OPERATION_SCOPE_INVALID');
const workflowResponse=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workflows/promobento-staging-render/instances/render-${operationId}`,{
 headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
const workflow=parseCanonicalJson(await workflowResponse.text());
if(!workflowResponse.ok||!workflow.success)throw Error('WORKFLOW_INSPECTION_HTTP_'+workflowResponse.status);
const query=async(sql)=>{
 const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${config.env.staging.d1_databases[0].database_id}/query`,{
  method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:canonical({sql,params:[operationId]}),signal:AbortSignal.timeout(20000)});
 const value=parseCanonicalJson(await response.text());if(!response.ok||!value.success)throw Error('D1_INSPECTION_HTTP_'+response.status);return value.result[0].results;
};
const report={scope:'read_only_staging_diagnosis',deploymentSha:sha,operationId,workflow:workflow.result,
 operations:await query('SELECT id,status,generation,created_at,finished_at FROM pipeline_operations WHERE id=?'),
 renders:await query('SELECT id,status,created_at,finished_at,result_json FROM pipeline_renders WHERE operation_id=?'),
 attempts:await query('SELECT id,mode,shard_index,instance,status,started_at,stopped_at,result_json FROM pipeline_attempts WHERE operation_id=?'),
 costs:await query('SELECT r.id,r.reserved_micros,s.actual_micros,s.usage_json FROM cost_reservations r LEFT JOIN cost_settlements s ON s.reservation_id=r.id WHERE r.operation_id=?')};
mkdirSync('artifacts/staging',{recursive:true});writeFileSync('artifacts/staging/inspection.json',canonical(report));
if(process.env.INSPECT_OPERATION){
 // Query the already-stored logs around this failed child. No container, secret, deploy or replay.
 const start=Date.parse(workflow.result.start),end=Date.parse(workflow.result.end??new Date().toISOString());
 const redact=value=>typeof value==='string'?value.replace(/Bearer\s+[A-Za-z0-9._-]+/gi,'Bearer [redacted]'):Array.isArray(value)?value.map(redact):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/authorization|cookie|secret|token|api.?key/i.test(key)?'[redacted]':redact(item)])):value;
 try{
  if(!Number.isFinite(start)||!Number.isFinite(end))throw Error('INSPECTION_LOG_TIMEFRAME_MISSING');
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/observability/telemetry/query`,{method:'POST',
   headers:{authorization:'Bearer '+token,'content-type':'application/json'},signal:AbortSignal.timeout(20000),
   body:canonical({queryId:'s1-startup-'+run,dry:true,view:'events',limit:200,timeframe:{from:Math.max(start-5000,end-120000),to:end+5000},parameters:{needle:{value:'promobento-staging',isRegex:false}}})});
  report.logQuery={httpStatus:response.status,...redact(parseCanonicalJson(await response.text()))};
 }catch(error){report.logQuery={status:'unavailable',code:String(error.message??error).slice(0,160)};}
 writeFileSync('artifacts/staging/inspection.json',canonical(report));
}
console.log(canonical({scope:report.scope,deploymentSha:sha,operationId,workflowStatus:report.workflow.status??null,operations:report.operations,
 renders:report.renders.map(({id,status})=>({id,status})),attemptCount:report.attempts.length,
 settledMicros:report.costs.reduce((sum,cost)=>sum+(cost.actual_micros??0),0),
 pendingCosts:report.costs.filter(cost=>cost.actual_micros===null).map(({id,reserved_micros})=>({id,reserved_micros}))}));
