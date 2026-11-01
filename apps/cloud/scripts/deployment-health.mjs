// Deployment readback, not a paid model probe or a media/test rerun.
import {writeFileSync} from 'node:fs';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {NATIVE_RUNTIME_COMMIT} from '@promobento/contracts/native-project';
const{GITHUB_ACTIONS,STAGING_URL,EVAL_API_KEY,GITHUB_SHA}=process.env;
if(GITHUB_ACTIONS!=='true'||STAGING_URL!=='https://promobento-staging.woffordvivian.workers.dev'||!EVAL_API_KEY)throw Error('DEPLOYMENT_HEALTH_SCOPE_INVALID');
const health=await fetch(STAGING_URL+'/healthz',{signal:AbortSignal.timeout(15000)});
const healthBody=health.ok?parseCanonicalJson(await health.text()):null;
if(!healthBody||healthBody.ok!==true||healthBody.nativeProjectSchema!=='1.0.0'
 ||healthBody.runtime!=='huashu-motion'||healthBody.nativeCommit!==NATIVE_RUNTIME_COMMIT)throw Error('DEPLOYMENT_UNHEALTHY');
async function read(path){
 const until=Date.now()+60000;
 for(;;){
  const response=await fetch(STAGING_URL+'/internal/s1/'+path,{headers:{authorization:'Bearer '+EVAL_API_KEY},signal:AbortSignal.timeout(15000)});
  const text=await response.text();
  if(response.ok)return parseCanonicalJson(text);
  if(response.status!==404||text!=='Not found'||Date.now()>=until)throw Error('DEPLOYMENT_READBACK_'+response.status);
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
}
const capacity=await read('capacity');if(capacity.length)throw Error('DEPLOYMENT_REQUIRES_IDLE_STAGING');
writeFileSync('artifacts/staging/deployment-health.json',canonical({sourceSha:GITHUB_SHA,scope:'read_only_deployment_health_no_operations',health:'ok',capacity,
 modelBudget:await read('model-budget'),modelCalls:0,renderCalls:0}));
