// Read-only staging diagnosis through approved Actions credentials; never prints credential values.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
const {CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:account,INSPECT_RUN:run,DEPLOYED_SHA:sha}=process.env;
if(process.env.GITHUB_ACTIONS!=='true'||!/^\d{8,20}$/.test(run??'')||!/^([a-f0-9]{40})$/.test(sha??'')||!token||!account)throw Error('INSPECTION_SCOPE_INVALID');
const config=parseCanonicalJson(readFileSync('apps/cloud/wrangler.jsonc','utf8').replace(/^\/\/.*\n/,''));
const operationId='smoke-'+sha.slice(0,12)+'-'+run;
const query=async(sql)=>{
 const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${config.env.staging.d1_databases[0].database_id}/query`,{
  method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:canonical({sql,params:[operationId]}),signal:AbortSignal.timeout(20000)});
 const value=parseCanonicalJson(await response.text());if(!response.ok||!value.success)throw Error('D1_INSPECTION_HTTP_'+response.status);return value.result[0].results;
};
const report={scope:'read_only_staging_diagnosis',deploymentSha:sha,operationId,
 operations:await query('SELECT id,status,generation,created_at,finished_at FROM pipeline_operations WHERE id=?'),
 renders:await query('SELECT id,status,created_at,finished_at,result_json FROM pipeline_renders WHERE operation_id=?'),
 attempts:await query('SELECT id,mode,shard_index,instance,status,started_at,stopped_at,result_json FROM pipeline_attempts WHERE operation_id=?'),
 costs:await query('SELECT r.id,r.reserved_micros,s.actual_micros,s.usage_json FROM cost_reservations r LEFT JOIN cost_settlements s ON s.reservation_id=r.id WHERE r.operation_id=?')};
mkdirSync('artifacts/staging',{recursive:true});writeFileSync('artifacts/staging/inspection.json',canonical(report));console.log(canonical(report));
