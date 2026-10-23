// One real staging render, not the complete G1 benchmark or an authorized public customer route.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {deriveAudioPlan,audioPlanHash} from '../../../packages/audio/src/plan.mjs';
import {filmBlockEvents} from '../../../packages/blocks/src/events.mjs';
import {filmFixture,pageOptions} from '../../../packages/film-runtime/test/fixture.mjs';

if(process.env.GITHUB_ACTIONS!=='true')throw Error('ACTIONS_ONLY');
const base=process.env.STAGING_URL,key=process.env.EVAL_API_KEY,sha=process.env.DEPLOYED_SHA??process.env.GITHUB_SHA,harnessSha=process.env.GITHUB_SHA;
if(!/^https:\/\/promobento-staging\.[a-z0-9-]+\.workers\.dev$/.test(base??'')||!key||!sha)throw Error('STAGING_ENV_REQUIRED');
const root=new URL('../../../',import.meta.url),directory='artifacts/staging';mkdirSync(directory,{recursive:true});
const rules=parseCanonicalJson(readFileSync(new URL('config/platform-presets.json',root)));
let authPropagationRetries=0;
const call=async(path,{method='GET',body,mediaType='application/json'}={})=>{
 const until=Date.now()+30000;
 for(;;){
 const response=await fetch(base+'/internal/s1/'+path,{method,headers:{authorization:'Bearer '+key,'content-type':mediaType},
  ...(body===undefined?{}:{body:typeof body==='string'||body instanceof Uint8Array?body:canonical(body)}),signal:AbortSignal.timeout(45000)});
 if(response.ok)return response;
 const detail=await response.text();
 // A newly bound secret can reach adjacent requests at different times. This exact 404 occurs
 // before dispatch: no task was admitted. Never retry model/render failures or uncertain timeouts.
 if(response.status===404&&detail==='Not found'&&Date.now()<until){authPropagationRetries++;await new Promise(resolve=>setTimeout(resolve,1000));continue;}
 throw Error('STAGING_'+response.status+' '+method+' '+path+':'+detail.slice(0,500));
 }
};
const json=async(path,options)=>parseCanonicalJson(await(await call(path,options)).text());
const upload=async(name,bytes,mediaType)=>json('objects/'+name,{method:'PUT',body:bytes,mediaType});
const operationId='smoke-'+sha.slice(0,12)+'-'+process.env.GITHUB_RUN_ID,renderId='render-'+operationId,releaseId='renderer-'+sha.slice(0,12);
const started=Date.now(),prefix='evals/'+operationId;
let operationAttempted=false;
try{
const health=await fetch(base+'/healthz',{signal:AbortSignal.timeout(15000)});
if(!health.ok||(await health.json()).protocol!=='3.0.0')throw Error('STAGING_HEALTH_FAILED');
// Secret updates propagate independently of deploy. Poll a read-only route before creating any job.
const readyUntil=Date.now()+60000;let ready=false;
do{
 const response=await fetch(base+'/internal/s1/capacity',{headers:{authorization:'Bearer '+key},cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(response.ok){await response.arrayBuffer();ready=true;break;}
 if(response.status!==404)throw Error('STAGING_AUTH_HEALTH_'+response.status);
 await response.arrayBuffer();await new Promise(resolve=>setTimeout(resolve,1000));
}while(Date.now()<readyUntil);
if(!ready)throw Error('STAGING_SECRET_PROPAGATION_TIMEOUT');
if(process.env.RECONCILE_OPERATION){
 const id=process.env.RECONCILE_OPERATION;if(!/^smoke-[a-f0-9]{12}-\d{8,20}$/.test(id))throw Error('RECONCILIATION_SCOPE_INVALID');
 const report=await json('operations/'+id+'/reconcile',{method:'POST'});writeFileSync(directory+'/reconciliation.json',canonical(report));
 if(report.pendingCosts.some(cost=>cost.kind==='compute'))throw Error('COMPUTE_COST_RECONCILIATION_REQUIRED');
}
operationAttempted=true;
await json('operations',{method:'POST',body:{id:operationId,workspaceId:'internal-eval',projectId:'pipeline-smoke',purpose:'calibration',maxMicros:1000000}});
const envObject=await upload(prefix+'/environment.json',canonical({gitSha:sha,environmentLock:parseCanonicalJson(readFileSync(new URL('apps/render-container/environment.lock.json',root)))}),'application/json');
await call('releases',{method:'POST',body:{id:releaseId,runtimeVersion:'film-runtime-v1',environmentKey:envObject.key}});
const spec=filmFixture(),options=pageOptions('landscape',rules.aspectLayouts.landscape);delete options.target.ratio;
options.fonts[0].licenseRef='geist-ofl-1.1';options.resources[0].kind='svg';
const resource=await upload(prefix+'/original.svg',readFileSync(new URL('apps/render-container/tests/product.svg',root)),'image/svg+xml');
const resourceId='res_fixture_dashboard',licenseRef=options.resources[0].licenseRef;
const evidence=await upload(prefix+'/rights.json',canonical({resourceId,sha256:resource.sha256,licenseRef,scope:'internal_eval_only',approvedBy:'owner',
 source:'PromoBento original engineering SVG in apps/render-container/tests/product.svg',basis:'Original geometric illustration authored for this repository; no third-party interface, logo, person or commercial claim.'}),'application/json');
await call('rights',{method:'POST',body:{operationId,resourceId,sha256:resource.sha256,licenseRef,scope:'internal_eval_only',evidenceKey:evidence.key}});
const film=await upload(prefix+'/film.json',canonical(spec),'application/json'),plan=deriveAudioPlan(spec,filmBlockEvents(spec));
const audio=await upload(prefix+'/audio-plan.json',canonical(plan),'application/json');
const job={schemaVersion:'3.0.0',kind:'render_job',renderId,operationId,candidateId:'candidate-'+operationId,sourceHash:filmSourceHash(canonical(spec)),runtimeVersion:'film-runtime-v1',rendererRelease:releaseId,
 aspectId:'landscape',durationSeconds:15,totalFrames:450,quality:'final',renderProfile:{sampleCount:1,shutterAngle:0,sampling:'centered-box-v1',edgePolicy:'clamp-v1'},
 resources:[{resourceId,kind:'svg',sha256:resource.sha256}],audioPlanHash:audioPlanHash(plan,{seed:options.seed})};
const request={job,options,inputs:[{...film,name:'film'},{...resource,name:'resource:'+resourceId}],audioInputsBlobs:[{...audio,name:'audio-plan'}],audioInputs:{seed:options.seed,clearedSources:[]},coverFrame:165};
// Studio reverse seek already passed in run 39987356301 with this fixture and media environment.
// Reuse that evidence; each new shard still checks its actual health and reports its memory telemetry.
await json('renders',{method:'POST',body:request});
let outcome;
 while(Date.now()-started<240000){
  const row=await json('renders/'+renderId);
  if(row.status==='passed'){outcome=parseCanonicalJson(row.result_json);break;}
  if(row.status==='blocked')throw Error('SMOKE_RENDER_BLOCKED:'+row.result_json);
  await new Promise(resolve=>setTimeout(resolve,2000));
 }
 if(!outcome)throw Error('SMOKE_RENDER_DEADLINE');
 for(const object of outcome.outputs.filter(object=>/\/(film.mp4|poster.png)$/.test(object.key))){
  const bytes=new Uint8Array(await(await call('artifacts/'+object.key)).arrayBuffer());
  if(sha256Bytes(bytes)!==object.sha256)throw Error('SMOKE_OUTPUT_IDENTITY_MISMATCH');
  writeFileSync(directory+'/'+object.key.split('/').at(-1),bytes);
 }
 const leases=await json('capacity');if(leases.length)throw Error('SMOKE_LEASE_NOT_RETURNED');
 writeFileSync(directory+'/smoke-report.json',canonical({scope:'one_2d_staging_render_not_full_G1',gitSha:sha,harnessSha,operationId,renderId,elapsedMs:Date.now()-started,authPropagationRetries,outcome,leases,status:'passed'}));
 console.log(canonical({status:'passed',renderId,elapsedMs:Date.now()-started,media:outcome.media,peakMemory:outcome.peakMemory,leases}));
}catch(error){
 writeFileSync(directory+'/smoke-report.json',canonical({scope:'one_2d_staging_render_not_full_G1',gitSha:sha,harnessSha,operationId,renderId,elapsedMs:Date.now()-started,authPropagationRetries,status:'failed',error:String(error.stack??error)}));throw error;
}finally{
 if(operationAttempted){
 await call('operations/'+operationId+'/cancel',{method:'POST'});
 // Cancellation is asynchronous. A timeout is a failure, not permission to free an occupied slot.
 const until=Date.now()+45000;let leases;
 do{leases=await json('capacity');if(!leases.length)break;await new Promise(resolve=>setTimeout(resolve,1000));}while(Date.now()<until);
 if(leases.length)throw Error('SMOKE_CANCEL_STOP_UNCONFIRMED');
 }
}
