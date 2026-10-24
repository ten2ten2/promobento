// Execute one owner-approved S1 case through the existing staging creative API.
// No provider secret is read here. Paid calls remain behind the Worker's shared/local ledgers.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';

const[inputArg,caseId,outputArg]=process.argv.slice(2),input=resolve(inputArg??''),output=resolve(outputArg??'');
if(!inputArg||!outputArg||![input,output].every(path=>path.startsWith(resolve('artifacts')+'/'))||existsSync(output))throw Error('NEW_PRIVATE_EVAL_OUTPUT_REQUIRED');
const read=path=>parseCanonicalJson(readFileSync(path)),manifest=read(join(input,'manifest.json'));
const item=manifest.cases.find(item=>item.id===caseId);
if(manifest.status!=='prepared_not_executed'||manifest.scope!=='internal_eval_only'||manifest.publicUseCleared!==false||!item
 ||!/^([a-z0-9-]+)-(15|30)$/.test(caseId)||item.contextFile!==caseId+'.json')throw Error('APPROVED_PREPARED_CASE_REQUIRED');
const context=read(join(input,item.contextFile));
if(context.scope!=='internal_eval_only'||context.publicUseCleared!==false||context.rendererRelease!==manifest.rendererRelease
 ||context.factConfirmation.confirmedBy!=='owner'||canonical(context.aspects)!==canonical(['landscape','portrait']))throw Error('CONFIRMED_CONTEXT_REQUIRED');
const wrangler=(args,options={})=>execFileSync('pnpm',['--filter','@promobento/cloud','exec','wrangler',...args],
 {env:{...process.env,WRANGLER_LOG_PATH:'/tmp/promobento-s1-eval-cli.log'},encoding:'utf8',timeout:60000,...options});
const secrets=parseCanonicalJson(wrangler(['secret','list','--env','staging']));
if(secrets.some(secret=>secret.name==='EVAL_API_KEY'))throw Error('ANOTHER_INTERNAL_SESSION_ACTIVE');
if(!secrets.some(secret=>secret.name==='MODEL_COMPAT_API_KEY'))throw Error('MODEL_RUNTIME_KEY_NOT_BOUND');
const inventory=parseCanonicalJson(wrangler(['d1','execute','promobento-staging','--remote','--env','staging','--json','--command',
 "SELECT COUNT(*) AS unfinished FROM pipeline_operations WHERE status IN ('active','awaiting_user')"]));
if(inventory[0]?.results?.[0]?.unfinished!==0)throw Error('OTHER_OPERATION_ACTIVE');
mkdirSync(output,{recursive:true});
const operationId='eval-'+caseId+'-'+Date.now(),prefix='evals/'+operationId,key=randomBytes(32).toString('hex');
const base='https://promobento-staging.woffordvivian.workers.dev/internal/s1/';
const report={kind:'s1_actual_creative_case',caseId,operationId,sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 rendererRelease:context.rendererRelease,scope:'internal_eval_only',publicUseCleared:false,status:'starting',ownerNormalSpeedReview:'pending'};
const save=()=>writeFileSync(join(output,'report.json'),canonical(report)+'\n');
let secretBound=false,operationAttempted=false,stopping=false;process.once('SIGINT',()=>{stopping=true;});process.once('SIGTERM',()=>{stopping=true;});
const pause=()=>new Promise(resolve=>setTimeout(resolve,2000));
async function call(path,{method='GET',body,mediaType='application/json',allowMissing=false}={}){
 const response=await fetch(base+path,{method,headers:{authorization:'Bearer '+key,'content-type':mediaType},
  ...(body===undefined?{}:{body:body instanceof Uint8Array?body:canonical(body)}),signal:AbortSignal.timeout(45000)});
 if(!response.ok){const detail=await response.text();if(allowMissing&&response.status===404)return null;
  throw Error('EVAL_API_'+response.status+' '+path+':'+detail.slice(0,500));}
 return response;
}
const json=async(path,options)=>{const response=await call(path,options);return response&&response.status!==204&&response.status!==201?parseCanonicalJson(await response.text()):null;};
async function download(ref,file){
 if(!ref.key.startsWith('operations/'+operationId+'/')&&!ref.key.startsWith('renders/'))throw Error('EVAL_OUTPUT_SCOPE_INVALID');
 const response=await call('artifacts/'+ref.key),bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes.length!==ref.byteLength||sha256Bytes(bytes)!==ref.sha256)throw Error('EVAL_OUTPUT_IDENTITY_MISMATCH');
 writeFileSync(join(output,file),bytes);
}
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
save();
try{
 wrangler(['secret','put','EVAL_API_KEY','--env','staging'],{input:key});secretBound=true;
 const until=Date.now()+60000;let ready=false;
 do{
  const response=await fetch(base+'capacity',{headers:{authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)}),text=await response.text();
  if(response.ok){if(parseCanonicalJson(text).length)throw Error('OTHER_COMPUTE_ACTIVE');ready=true;break;}
  if(response.status!==404||text!=='Not found')throw Error('EVAL_AUTH_HEALTH_'+response.status);await pause();
 }while(Date.now()<until);
 if(!ready)throw Error('EVAL_SECRET_PROPAGATION_TIMEOUT');
 report.budgetBefore=await json('model-budget');
 if(!['provisional','confirmed'].includes(report.budgetBefore.budgetBasis))throw Error('MODEL_BUDGET_NOT_READY');
 operationAttempted=true;
 await json('operations',{method:'POST',body:{id:operationId,workspaceId:'internal-eval',projectId:'s1-'+item.topicId,purpose:'evaluation',maxMicros:3000000}});
 for(const admission of item.rightsAdmissions)await call('rights',{method:'POST',body:{operationId,...admission}});
 const object=await json('objects/'+prefix+'/context.json',{method:'PUT',body:new TextEncoder().encode(canonical(context))});
 report.startedAt=new Date().toISOString();report.status='running';save();
 await json('creative',{method:'POST',body:{operationId,contextKey:object.key}});
 const limit=Date.now()+40*60000;let preparedDirections=false,chosen=false,lastStatus='';
 for(;;){
  if(stopping)throw Error('EVAL_INTERRUPTED');if(Date.now()>=limit)throw Error('EVAL_WALL_CLOCK_LIMIT');
  const state=await json('operations/'+operationId);writeFileSync(join(output,'operation.json'),canonical(state)+'\n');
  if(state.status!==lastStatus){lastStatus=state.status;console.log(canonical({operationId,status:state.status}));}
  if(state.status==='awaiting_user'&&!chosen){
   if(!preparedDirections){
    if(state.directions?.cards.length!==3||state.previews?.length!==3)throw Error('EVAL_DIRECTION_PREVIEWS_MISSING');
    for(const preview of state.previews)await download(preview,'direction-'+preview.direction+'.png');
    writeFileSync(join(output,'directions.json'),canonical({directionsHash:state.directions_hash,cards:state.directions.cards,previews:state.previews})+'\n');
    writeFileSync(join(output,'choice.example.json'),canonical({key:'fit',directionsHash:state.directions_hash,reason:'Replace with the visual reviewer decision, then save as choice.json.'})+'\n');
    report.directionsReadyAt=new Date().toISOString();report.status='awaiting_visual_direction_choice';save();preparedDirections=true;
    console.log(canonical({status:report.status,directory:output,action:'Inspect all three PNGs and directions.json, then write choice.json with key, directionsHash and reason.'}));
   }
   const choiceFile=join(output,'choice.json');
   if(existsSync(choiceFile)){
    const choice=read(choiceFile);
    if(!['fit','amplify','unexpected'].includes(choice.key)||choice.directionsHash!==state.directions_hash||!choice.reason?.trim())throw Error('EVAL_VISUAL_CHOICE_INVALID');
    await json('operations/'+operationId+'/direction',{method:'POST',body:{key:choice.key,directionsHash:choice.directionsHash}});
    report.choice=choice;report.status='running';chosen=true;save();
   }
  }else if(state.status==='succeeded'){
   const candidate=await json('operations/'+operationId+'/candidate');writeFileSync(join(output,'candidate.json'),canonical(candidate)+'\n');
   if(candidate.final.length!==context.aspects.length||candidate.publicUseCleared!==false)throw Error('EVAL_FINAL_ASPECTS_MISSING');
   for(const[index,movie]of candidate.final.entries())for(const ref of movie.outputs.filter(ref=>/\/(film.mp4|poster.png)$/.test(ref.key)))
    await download(ref,context.aspects[index]+'-'+ref.key.split('/').at(-1));
   writeFileSync(join(output,'index.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+escape(caseId)+' · S1 内部视听</title><style>body{margin:32px auto;max-width:1050px;padding:0 24px;background:#101712;color:#f4f8ee;font:18px system-ui}video{width:100%;max-height:75vh;background:#000}section{margin:32px 0}a{color:#d9fa73}</style><h1>'+escape(caseId)+'</h1><p>内部评测 · 正常速度 1× · 待负责人视听，不公开成片</p>'+context.aspects.map(aspect=>'<section><h2>'+escape(aspect)+'</h2><video controls preload="metadata" poster="'+aspect+'-poster.png" src="'+aspect+'-film.mp4"></video></section>').join('')+'<p><a href="candidate.json">候选、事实与冷审</a> · <a href="report.json">实际费用与运行回执</a></p></html>');
   report.status='candidate_delivered_pending_owner_review';report.finishedAt=new Date().toISOString();save();break;
  }else if(['failed','cancelled'].includes(state.status)){
   report.failure=await json('operations/'+operationId+'/recovery');throw Error('EVAL_DIRECTOR_'+(report.failure.failure?.code??state.status.toUpperCase()));
  }
  await pause();
 }
}catch(error){report.status='failed';report.error=String(error.stack??error);save();throw error;}
finally{
 try{
  if(secretBound&&operationAttempted){
   const state=await json('operations/'+operationId,{allowMissing:true});
   if(state&&['active','awaiting_user'].includes(state.status))await call('operations/'+operationId+'/cancel',{method:'POST'});
   if(state&&state.status!=='succeeded')report.cleanup=await json('operations/'+operationId+'/reconcile',{method:'POST'});
   if(state){await json('workflows/reconcile',{method:'POST'});report.recovery=await json('operations/'+operationId+'/recovery');}
   report.budgetAfter=await json('model-budget');report.capacity=await json('capacity');
   if(report.recovery)report.cost={chargedMicros:report.recovery.costs.reduce((sum,cost)=>sum+(cost.actual_micros??cost.reserved_micros),0),
    unresolved:report.recovery.costs.filter(cost=>cost.actual_micros===null).map(cost=>({id:cost.id,kind:cost.kind,reservedMicros:cost.reserved_micros}))};
   save();
   if(report.capacity.length||report.recovery?.costs.some(cost=>cost.kind==='compute'&&(cost.actual_micros===null||cost.physicallyStopped!==true)))throw Error('EVAL_COMPUTE_CLEANUP_UNCONFIRMED');
  }
 }finally{
  if(secretBound){wrangler(['secret','delete','EVAL_API_KEY','--env','staging']);report.internalKeyRevoked=true;save();}
 }
}
