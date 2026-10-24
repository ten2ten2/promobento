// Read the platform's sampled workload maxima for the retained G1 matrix; never start work.
// https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-container-metrics/
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {canonical,parseCanonicalJson} from '../../../packages/contracts/src/canonical.mjs';

const {GITHUB_ACTIONS,CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:account,GITHUB_SHA}=process.env;
if(GITHUB_ACTIONS!=='true'||!token||!account)throw Error('METRICS_ACTIONS_CREDENTIALS_REQUIRED');
const source='docs/evidence/2026-10-24-s1-performance/matrix/performance-report.json';
const matrix=parseCanonicalJson(readFileSync(source));
if(matrix.status!=='passed'||matrix.samples.length!==28||matrix.samples.some(sample=>sample.status!=='passed'))throw Error('METRICS_COMPLETED_MATRIX_REQUIRED');
const start=Math.min(...matrix.samples.map(sample=>sample.startedAt)),end=Math.max(...matrix.samples.map(sample=>sample.startedAt+sample.renderToPassedMs));
if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start||end-start>3600000)throw Error('METRICS_WINDOW_INVALID');
const directory='artifacts/container-metrics';mkdirSync(directory,{recursive:true});
const report={scope:'read_only_retained_staging_G1_matrix',source,sourceSha:matrix.deploymentSha,harnessSha:GITHUB_SHA,
  datetimeStart:new Date(start-60000).toISOString(),datetimeEnd:new Date(end+60000).toISOString(),
  measurement:'platform_sampled_workload_maximum_not_cgroup_high_water_mark',status:'querying',modelCalls:0,renderCalls:0};
const save=()=>writeFileSync(directory+'/report.json',canonical(report)+'\n');save();
async function api(path,body){
  const response=await fetch('https://api.cloudflare.com/client/v4'+path,{method:body?'POST':'GET',
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:canonical(body)}:{}),signal:AbortSignal.timeout(30000)});
  const value=parseCanonicalJson(await response.text());
  if(!response.ok||value.success===false||value.errors?.length){
    // Only explicit API errors are retained. Never serialize request headers or credential-bearing config.
    report.apiError={status:response.status,errors:(value.errors??[]).map(error=>({code:error.code??null,message:error.message??'Unknown API error'}))};save();
    throw Error('METRICS_API_DENIED_OR_FAILED_'+response.status);
  }
  return value;
}
try{
  const applications=(await api('/accounts/'+account+'/containers/applications?name=promobento-staging-render')).result;
  if(!Array.isArray(applications))throw Error('METRICS_APPLICATION_RESPONSE_INVALID');
  const application=applications.find(item=>item.name==='promobento-staging-render');
  if(!application||typeof application.id!=='string')throw Error('METRICS_STAGING_APPLICATION_MISSING');
  report.applicationId=application.id;save();
  const query=`query G1Metrics($accountTag:String,$from:Time,$to:Time,$applicationId:String){viewer{accounts(filter:{accountTag:$accountTag}){
    containersMetricsAdaptiveGroups(limit:1000,filter:{datetime_geq:$from,datetime_leq:$to,applicationId:$applicationId}){
      dimensions{instanceId placementId} count max{memory} avg{memory} sum{cpuTimeSec}
    }}}}`;
  const value=await api('/graphql',{query,variables:{accountTag:account,from:report.datetimeStart,to:report.datetimeEnd,applicationId:application.id}});
  const accounts=value.data?.viewer?.accounts;
  if(!Array.isArray(accounts)||accounts.length!==1||!Array.isArray(accounts[0].containersMetricsAdaptiveGroups))throw Error('METRICS_GRAPHQL_RESPONSE_INVALID');
  report.groups=accounts[0].containersMetricsAdaptiveGroups;
  if(report.groups.length>=1000)throw Error('METRICS_RESULT_TRUNCATED');
  report.status=report.groups.length?'observed_platform_samples':'no_platform_samples';save();
  console.log(canonical({scope:report.scope,status:report.status,groups:report.groups.length,measurement:report.measurement,modelCalls:0,renderCalls:0}));
}catch(error){report.status='unverified';report.error=String(error.message??error);save();throw error;}
