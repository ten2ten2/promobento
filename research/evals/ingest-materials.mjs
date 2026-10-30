// Owner's internal evaluation only. Uses the existing Wrangler connection; never reads or exports credentials.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {materialApproval,assertLocalMaterialIdentity} from './material-approval.mjs';

const directory=resolve(process.argv[2]??'artifacts/eval-materials-2026-10-24');
if(!directory.startsWith(resolve('artifacts')+'/'))throw Error('PRIVATE_ARTIFACT_DIRECTORY_REQUIRED');
const selected=parseCanonicalJson(readFileSync(join(directory,'selected.json'))),topics=parseCanonicalJson(readFileSync('research/evals/topics.json'));
if(!Array.isArray(selected.assets)||!selected.assets.length||new Set(selected.assets.map(asset=>asset.id)).size!==selected.assets.length)throw Error('MATERIAL_SELECTION_INVALID');
const receiptPath=join(directory,'ingestion.json'),previous=existsSync(receiptPath)?parseCanonicalJson(readFileSync(receiptPath)):null;
if(selected.scope!=='internal_eval_only'||selected.publicUseCleared!==false||topics.factConfirmation.confirmedBy!=='owner')throw Error('INTERNAL_SOURCE_APPROVAL_REQUIRED');
const prepared=selected.assets.map(asset=>{
 const topic=topics.topics.find(topic=>topic.id===asset.topicId&&topic.countsTowardGate!==false);if(!topic)throw Error('TOPIC_NOT_APPROVED');
 const card=parseCanonicalJson(readFileSync(topic.factCard));
 if(card.status!=='confirmed_for_s1_eval'||card.confirmation.confirmedBy!=='owner'||card.confirmation.scope!=='s1-first-internal-evaluation'||card.rights.scope!=='internal_eval_only'||asset.review!=='approved_for_internal_eval_by_codex'||!asset.reviewedAt)throw Error('MATERIAL_REVIEW_REQUIRED');
 const approval=materialApproval(card,asset);
 if(!/^[a-z0-9-]+\.png$/.test(asset.file))throw Error('MATERIAL_SOURCE_INVALID');
 let originalSource;
 if(approval.original){
  originalSource=readFileSync(join(directory,asset.originalSourceFile));
  if(originalSource.length>8<<20||!originalSource.toString('utf8').trimStart().startsWith('<svg')
   ||/<\s*(?:script|image|foreignObject|!DOCTYPE|!ENTITY)\b|\bhref\s*=|\bon[a-z]+\s*=|url\s*\(/i.test(originalSource.toString('utf8')))throw Error('ORIGINAL_MATERIAL_SOURCE_INVALID');
 }
 const bytes=readFileSync(join(directory,asset.file));if(bytes.length>8<<20||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'
  ||bytes.readUInt32BE(16)!==asset.width||bytes.readUInt32BE(20)!==asset.height)throw Error('MATERIAL_IDENTITY_INVALID');
 const sha256=sha256Bytes(bytes);assertLocalMaterialIdentity(approval,asset,sha256);
 return{asset,bytes,sha256,original:approval.original,explicit:approval.explicit,originalSource};
});
const env={...process.env,WRANGLER_LOG_PATH:'/tmp/promobento-material-ingest.log'},args=['--filter','@promobento/cloud','exec','wrangler'];
const wrangler=(command,options={})=>execFileSync('pnpm',[...args,...command],{env,encoding:'utf8',timeout:60000,...options});
// Never overwrite another active internal session. The root also checks the account identity before invoking this script.
const secrets=parseCanonicalJson(wrangler(['secret','list','--env','staging']));
if(secrets.some(secret=>secret.name==='EVAL_API_KEY'))throw Error('ANOTHER_INTERNAL_SESSION_ACTIVE');
const key=randomBytes(32).toString('hex'),base='https://promobento-staging.woffordvivian.workers.dev/internal/s1/';
const operationId=process.argv[3]??'materials-'+new Date().toISOString().replace(/\D/g,'').slice(0,14);
if(!/^materials-[A-Za-z0-9_-]{8,70}$/.test(operationId))throw Error('MATERIAL_OPERATION_INVALID');
const prefix='evals/'+operationId,licenseRef='LicenseRef-S1-Internal-Evaluation';
const manifest={kind:'s1_internal_materials',scope:'internal_eval_only',publicUseCleared:false,operationId,
 rightsDecision:'research/evals/topics.json#/rights',acquiredAt:new Date().toISOString(),assets:[],pending:[]};
const save=()=>writeFileSync(join(directory,'ingestion.json'),canonical(manifest)+'\n');
let secretAttempted=false,operationCreated=false;
const call=async(path,{method='GET',body,mediaType='application/json'}={})=>{
 const until=Date.now()+30000;
 for(;;){
 const response=await fetch(base+path,{method,headers:{authorization:'Bearer '+key,'content-type':mediaType},
  ...(body===undefined?{}:{body:body instanceof Uint8Array?body:canonical(body)}),signal:AbortSignal.timeout(45000)});
 if(!response.ok){
  const detail=await response.text();
  // This exact response precedes dispatch. Different Cloudflare requests can see the new secret at different times.
  if(response.status===404&&detail==='Not found'&&Date.now()<until){await new Promise(resolve=>setTimeout(resolve,1000));continue;}
  throw Error('MATERIAL_API_'+response.status+' '+path+':'+detail.slice(0,200));
 }
 return [201,204].includes(response.status)?null:parseCanonicalJson(await response.text());
 }
};
const upload=(path,body,mediaType='application/json')=>call('objects/'+path,{method:'PUT',body:body instanceof Uint8Array?body:new TextEncoder().encode(canonical(body)),mediaType});
try{
 secretAttempted=true;wrangler(['secret','put','EVAL_API_KEY','--env','staging'],{input:key});
 let ready=false;const until=Date.now()+60000;
 do{
  const response=await fetch(base+'capacity',{headers:{authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});
  if(response.ok){const leases=parseCanonicalJson(await response.text());if(leases.length)throw Error('OTHER_COMPUTE_ACTIVE');ready=true;break;}
  if(response.status!==404)throw Error('MATERIAL_AUTH_HEALTH_'+response.status);await response.arrayBuffer();await new Promise(resolve=>setTimeout(resolve,1000));
 }while(Date.now()<until);
 if(!ready)throw Error('MATERIAL_SECRET_PROPAGATION_TIMEOUT');
 const budgetBefore=await call('model-budget');
 await call('operations',{method:'POST',body:{id:operationId,workspaceId:'internal-eval',projectId:'eval-materials',purpose:'evaluation',maxMicros:1000000}});operationCreated=true;
 for(const{asset,bytes,sha256,original,explicit,originalSource}of prepared){
  const reused=previous?.assets.find(item=>item.id===asset.id&&item.topicId===asset.topicId&&item.sha256===sha256&&item.byteLength===bytes.length
   &&item.sourceUrl===asset.sourceUrl&&item.scope==='internal_eval_only'&&item.publicUseCleared===false&&item.licenseRef===licenseRef);
  if(reused){
   // Re-admit the exact existing evidence for this operation; do not upload passed material again.
   await call('rights',{method:'POST',body:{operationId,resourceId:reused.resourceId,sha256,licenseRef,scope:'internal_eval_only',evidenceKey:reused.evidenceKey}});
   manifest.assets.push(reused);save();console.log(canonical({id:asset.id,key:reused.key,reused:true}));continue;
  }
  const resourceId='res_s1_'+asset.id.replaceAll('-','_')+'_'+sha256.slice(0,12),object=await upload(`${prefix}/${asset.topicId}/${asset.id}.png`,bytes,'image/png');
  if(object.sha256!==sha256||object.byteLength!==bytes.length)throw Error('MATERIAL_UPLOAD_IDENTITY_MISMATCH');
  let licenseNotice;
  if(asset.licenseFile){
   if(!/^[a-z0-9.-]{8,80}\.txt$/.test(asset.licenseFile))throw Error('MATERIAL_LICENSE_INVALID');
   const text=readFileSync(join(directory,asset.licenseFile));if(text.length>32000)throw Error('MATERIAL_LICENSE_INVALID');
   const name=asset.licenseFile.slice(0,-4).replaceAll('.','-')+'.txt';
   licenseNotice=await upload(`${prefix}/${asset.topicId}/${name}`,text,'text/plain');
  }
  const sourceObject=originalSource?await upload(`${prefix}/${asset.topicId}/${asset.id}-source.svg`,originalSource,'image/svg+xml'):null;
  const evidence=await upload(`${prefix}/${asset.topicId}/${asset.id}-rights.json`,{kind:'eval_material_rights',resourceId,sha256,licenseRef,scope:'internal_eval_only',approvedBy:'owner',
   source:asset.sourceUrl,basis:original?'Original self-contained factual diagram created for this project; no copied interface, logo, image, portrait or testimonial.':explicit?explicit.basis:topics.rights.rule,
   decisionRef:original||explicit?asset.approvalRef:manifest.rightsDecision,decidedBy:original?original.approvedBy:explicit?explicit.approvedBy:topics.decidedBy,decidedAt:original?original.approvedAt:explicit?explicit.approvedOn:topics.decidedAt,
   ...(original?{origin:asset.origin,factIds:asset.factIds,originalSource:sourceObject}:{}),
   ...(asset.imageUrl?{imageUrl:asset.imageUrl}:{}),...(asset.attribution?{attribution:asset.attribution}:{}),...(licenseNotice?{licenseNoticeKey:licenseNotice.key,licenseSource:asset.licenseSource}:{}),
   acquisition:{description:asset.description,...(asset.clip?{clip:asset.clip}:{}),...(asset.derivation?{derivation:asset.derivation}:{}),reviewedBy:'codex',reviewedAt:asset.reviewedAt},publicUseCleared:false});
  await call('rights',{method:'POST',body:{operationId,resourceId,sha256,licenseRef,scope:'internal_eval_only',evidenceKey:evidence.key}});
  manifest.assets.push({id:asset.id,topicId:asset.topicId,resourceId,key:object.key,sha256,byteLength:object.byteLength,kind:'image',mediaType:'image/png',width:asset.width,height:asset.height,
   sourceUrl:asset.sourceUrl,...(asset.imageUrl?{imageUrl:asset.imageUrl}:{}),description:asset.description,licenseRef,evidenceKey:evidence.key,
   ...(original?{origin:asset.origin,factIds:asset.factIds,originalSourceKey:sourceObject.key,approvalRef:asset.approvalRef}:{}),
   ...(explicit?{approvalRef:asset.approvalRef}:{}),
   ...(asset.derivation?{derivation:asset.derivation}:{}),
   ...(asset.attribution?{attribution:asset.attribution}:{}),...(licenseNotice?{licenseNoticeKey:licenseNotice.key,licenseSource:asset.licenseSource}:{}),scope:'internal_eval_only',publicUseCleared:false});save();
  console.log(canonical({id:asset.id,key:object.key,byteLength:object.byteLength}));
 }
 for(const topic of topics.topics.filter(topic=>topic.countsTowardGate!==false))if(!manifest.assets.some(asset=>asset.topicId===topic.id))manifest.pending.push({topicId:topic.id,reason:'No reviewed source image ingested.'});
 manifest.modelBudget=await call('model-budget');
 if(manifest.modelBudget.currentReservations!==budgetBefore.currentReservations||manifest.modelBudget.openingMicros!==budgetBefore.openingMicros)throw Error('MODEL_BUDGET_CHANGED_DURING_MATERIAL_INGESTION');
 manifest.manifestKey=prefix+'/manifest.json';manifest.status=manifest.pending.length?'partial':'ingested_internal_eval';
 await upload(manifest.manifestKey,{kind:manifest.kind,scope:manifest.scope,publicUseCleared:false,operationId,rightsDecision:manifest.rightsDecision,
  acquiredAt:manifest.acquiredAt,manifestKey:manifest.manifestKey,status:manifest.status,assets:manifest.assets,pending:manifest.pending});save();
}finally{
 try{
  if(operationCreated){await call('operations/'+operationId+'/cancel',{method:'POST'});manifest.cleanup=await call('operations/'+operationId+'/reconcile',{method:'POST'});save();}
 }finally{if(secretAttempted)wrangler(['secret','delete','EVAL_API_KEY','--env','staging']);}
}
