// Execute one owner-approved S1 case through the existing staging creative API.
// No provider secret is read here. Paid calls remain behind the Worker's shared/local ledgers.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {probeCardLayout} from './probe-card-layout.mjs';
import {probeReviewRender} from './probe-review-render.mjs';
import {readApprovedMusic,admitMusic} from './admit-music.mjs';

const[inputArg,caseId,outputArg,modeArg,sourceArg,...extra]=process.argv.slice(2),input=resolve(inputArg??''),output=resolve(outputArg??'');
if(modeArg!==undefined&&(!['--check-card-layout','--check-review-render','--check-final-render','--score','--music'].includes(modeArg)||!sourceArg))throw Error('EVAL_MODE_INVALID');
if(extra.length&&(!['--check-review-render','--check-final-render'].includes(modeArg)||extra.length!==2||!['--score','--music'].includes(extra[0])||!extra[1]))throw Error('EVAL_MODE_INVALID');
const probeSource=modeArg?.startsWith('--check-')?resolve(sourceArg):null,layoutSource=modeArg==='--check-card-layout'?probeSource:null,probeQuality=modeArg==='--check-final-render'?'final':'review';
const musicMode=['--score','--music'].includes(modeArg)?modeArg:extra[0],musicFile=musicMode===modeArg?sourceArg:extra[1];
if(probeSource&&!probeSource.startsWith(resolve('artifacts')+'/')&&!probeSource.startsWith(resolve('docs/evidence')+'/'))throw Error('PRIVATE_COMPLETED_RECEIPT_REQUIRED');
if(!inputArg||!outputArg||![input,output].every(path=>path.startsWith(resolve('artifacts')+'/'))||existsSync(output))throw Error('NEW_PRIVATE_EVAL_OUTPUT_REQUIRED');
const read=path=>parseCanonicalJson(readFileSync(path)),manifest=read(join(input,'manifest.json'));
const item=manifest.cases.find(item=>item.id===caseId);
if(manifest.status!=='prepared_not_executed'||manifest.scope!=='internal_eval_only'||manifest.publicUseCleared!==false||!item
 ||!/^([a-z0-9-]+)-(15|30)$/.test(caseId)||item.contextFile!==caseId+'.json')throw Error('APPROVED_PREPARED_CASE_REQUIRED');
const context=read(join(input,item.contextFile));
if(context.scope!=='internal_eval_only'||context.publicUseCleared!==false||context.rendererRelease!==manifest.rendererRelease
 ||context.factConfirmation.confirmedBy!=='owner'||canonical(context.aspects)!==canonical(['landscape','portrait']))throw Error('CONFIRMED_CONTEXT_REQUIRED');
if(!/^renderer-[a-f0-9]{12}$/.test(context.rendererRelease))throw Error('PINNED_RENDERER_SOURCE_REQUIRED');
const music=musicMode?readApprovedMusic(musicMode==='--score'?'score':'upload',resolve(musicFile),context.durationSeconds*30):null;
const rendererSourceSha=execFileSync('git',['rev-parse',context.rendererRelease.slice(9)+'^{commit}'],{encoding:'utf8'}).trim();
const wrangler=(args,options={})=>execFileSync('pnpm',['--filter','@promobento/cloud','exec','wrangler',...args],
 {env:{...process.env,WRANGLER_LOG_PATH:'/tmp/promobento-s1-eval-cli.log'},encoding:'utf8',timeout:60000,...options});
const secrets=parseCanonicalJson(wrangler(['secret','list','--env','staging']));
if(secrets.some(secret=>secret.name==='EVAL_API_KEY'))throw Error('ANOTHER_INTERNAL_SESSION_ACTIVE');
if(!probeSource&&!secrets.some(secret=>secret.name==='MODEL_COMPAT_API_KEY'))throw Error('MODEL_RUNTIME_KEY_NOT_BOUND');
const inventory=parseCanonicalJson(wrangler(['d1','execute','promobento-staging','--remote','--env','staging','--json','--command',
 "SELECT COUNT(*) AS unfinished FROM pipeline_operations WHERE status IN ('active','awaiting_user')"]));
if(inventory[0]?.results?.[0]?.unfinished!==0)throw Error('OTHER_OPERATION_ACTIVE');
mkdirSync(output,{recursive:true});
const operationId='eval-'+caseId+'-'+Date.now(),prefix='evals/'+operationId,key=randomBytes(32).toString('hex');
const base='https://promobento-staging.woffordvivian.workers.dev/internal/s1/';
const report={kind:probeSource?(layoutSource?'s1_actual_card_layout_check':'s1_actual_'+probeQuality+'_render_check'):'s1_actual_creative_case',caseId,operationId,sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 rendererRelease:context.rendererRelease,rendererSourceSha,scope:'internal_eval_only',publicUseCleared:false,status:'starting',authPropagationRetries:0,ownerNormalSpeedReview:probeSource?'not_applicable_regression':'pending'};
const save=()=>writeFileSync(join(output,'report.json'),canonical(report)+'\n');
let secretBound=false,operationAttempted=false,stopping=false,primaryFailure;process.once('SIGINT',()=>{stopping=true;});process.once('SIGTERM',()=>{stopping=true;});
const pause=()=>new Promise(resolve=>setTimeout(resolve,2000));
async function call(path,{method='GET',body,mediaType='application/json',allowMissing=false}={}){
 const until=Date.now()+30000;
 for(;;){
 const response=await fetch(base+path,{method,headers:{authorization:'Bearer '+key,'content-type':mediaType},
  ...(body===undefined?{}:{body:body instanceof Uint8Array?body:canonical(body)}),signal:AbortSignal.timeout(45000)});
 if(!response.ok){const detail=await response.text();
  // Same bounded pre-dispatch gate as the Actions smoke runner: adjacent requests can see
  // different secret versions. This exact response precedes routing and admits no work.
  if(response.status===404&&detail==='Not found'&&Date.now()<until){report.authPropagationRetries++;await pause();continue;}
  if(allowMissing&&response.status===404&&detail!=='Not found')return null;
  throw Error('EVAL_API_'+response.status+' '+path+':'+detail.slice(0,500));}
 return response;
 }
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
 if(!probeSource&&!['provisional','confirmed'].includes(report.budgetBefore.budgetBasis))throw Error('MODEL_BUDGET_NOT_READY');
 let release=await json('releases/'+context.rendererRelease,{allowMissing:true});
 if(!release){
  const environment=await json('objects/'+prefix+'/environment.json',{method:'PUT',body:new TextEncoder().encode(canonical({gitSha:rendererSourceSha,
    environmentLock:parseCanonicalJson(execFileSync('git',['show',rendererSourceSha+':apps/render-container/environment.lock.json']))}))});
  await call('releases',{method:'POST',body:{id:context.rendererRelease,runtimeVersion:context.runtimeVersion,environmentKey:environment.key}});
  release=await json('releases/'+context.rendererRelease);
 }
 if(release.status!=='active'||release.runtime_version!==context.runtimeVersion||release.image_digest!==release.currentImageDigest)throw Error('EVAL_PINNED_RENDERER_NOT_DEPLOYED');
 report.renderer=release;save();
 operationAttempted=true;
 await json('operations',{method:'POST',body:{id:operationId,workspaceId:'internal-eval',projectId:'s1-'+item.topicId,purpose:'evaluation',maxMicros:3000000}});
 for(const admission of item.rightsAdmissions)await call('rights',{method:'POST',body:{operationId,...admission}});
 let externalMusic;
 if(music){
  const admitted=await admitMusic(music,{operationId,prefix,json,call});
  externalMusic={...admitted.source,licenseRef:music.licenseRef,approvals:music.approval.scoreApprovals,
   ...(music.kind==='score'?{text:new TextDecoder('utf-8',{fatal:true}).decode(music.bytes)}:{})};
  context.audioSources=[...(context.audioSources??[]),admitted.source];
  context.music={allowedKinds:[music.kind],required:admitted.selector,
   instruction:'Use this supplied owner-approved original music, unmuted, for the full film. Keep the original melody at 96 BPM; the 15-second film uses its first half. SFX may follow the film events.'};
  report.audioInput=admitted;save();
 }
 const object=await json('objects/'+prefix+'/context.json',{method:'PUT',body:new TextEncoder().encode(canonical(context))});
 report.startedAt=new Date().toISOString();report.status='running';save();
 if(layoutSource){
  report.layout=await probeCardLayout({receipt:read(layoutSource),context,operationId,prefix,output,json,call});
  report.status='layout_validated';report.finishedAt=new Date().toISOString();save();
 }else if(probeSource){
  report[probeQuality]=await probeReviewRender({receipt:read(probeSource),context,operationId,prefix,output,json,download,stopping:()=>stopping,quality:probeQuality,externalMusic});
  report.status=probeQuality+'_render_validated';report.finishedAt=new Date().toISOString();save();
 }else{
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
    report.choiceRequestedAt=new Date().toISOString();save();
    await json('operations/'+operationId+'/direction',{method:'POST',body:{key:choice.key,directionsHash:choice.directionsHash}});
    report.choiceAcknowledgedAt=new Date().toISOString();report.choice=choice;report.status='running';chosen=true;save();
   }
  }else if(state.status==='succeeded'){
   const candidate=await json('operations/'+operationId+'/candidate');writeFileSync(join(output,'candidate.json'),canonical(candidate)+'\n');
   if(candidate.final.length!==context.aspects.length||candidate.publicUseCleared!==false)throw Error('EVAL_FINAL_ASPECTS_MISSING');
   if(music&&(candidate.film.audio.mute===true||canonical(candidate.film.audio.music)!==canonical(music.selector)))throw Error('EVAL_REQUIRED_MUSIC_NOT_USED');
   for(const[index,movie]of candidate.final.entries())for(const ref of movie.outputs.filter(ref=>/\/(film.mp4|poster.png)$/.test(ref.key)))
    await download(ref,context.aspects[index]+'-'+ref.key.split('/').at(-1));
   writeFileSync(join(output,'index.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+escape(caseId)+' · S1 内部视听</title><style>body{margin:32px auto;max-width:1050px;padding:0 24px;background:#101712;color:#f4f8ee;font:18px system-ui}video{width:100%;max-height:75vh;background:#000}section{margin:32px 0}a{color:#d9fa73}</style><h1>'+escape(caseId)+'</h1><p>内部评测 · 正常速度 1× · 待负责人视听，不公开成片</p>'+context.aspects.map(aspect=>'<section><h2>'+escape(aspect)+'</h2><video controls preload="metadata" poster="'+aspect+'-poster.png" src="'+aspect+'-film.mp4"></video></section>').join('')+'<p><a href="candidate.json">候选、事实与冷审</a> · <a href="report.json">实际费用与运行回执</a></p></html>');
   report.status='candidate_delivered_pending_owner_review';report.finishedAt=new Date().toISOString();save();break;
  }else if(['failed','cancelled'].includes(state.status)){
   report.failure=await json('operations/'+operationId+'/recovery');throw Error('EVAL_DIRECTOR_'+(report.failure.failure?.code??state.status.toUpperCase()));
  }
  await pause();
 }
 }
}catch(error){primaryFailure=error;report.status='failed';report.error=String(error.stack??error);save();throw error;}
finally{
 try{
  if(secretBound&&operationAttempted){
   const state=await json('operations/'+operationId,{allowMissing:true});
   if(state&&['active','awaiting_user'].includes(state.status))await call('operations/'+operationId+'/cancel',{method:'POST'});
   if(state&&state.status!=='succeeded'){report.cleanup=await json('operations/'+operationId+'/reconcile',{method:'POST'});save();}
   if(state){await json('workflows/reconcile',{method:'POST'});report.recovery=await json('operations/'+operationId+'/recovery');save();}
   report.budgetAfter=await json('model-budget');save();report.capacity=await json('capacity');
   if(report.recovery)report.cost={chargedMicros:report.recovery.costs.reduce((sum,cost)=>sum+(cost.actual_micros??cost.reserved_micros),0),
    unresolved:report.recovery.costs.filter(cost=>cost.actual_micros===null).map(cost=>({id:cost.id,kind:cost.kind,reservedMicros:cost.reserved_micros}))};
   save();
   if(report.capacity.length||report.recovery?.costs.some(cost=>cost.kind==='compute'&&(cost.actual_micros===null||cost.physicallyStopped!==true)))throw Error('EVAL_COMPUTE_CLEANUP_UNCONFIRMED');
   report.cleanupStatus='confirmed';save();
  }
 }catch(error){report.cleanupStatus='unconfirmed';report.cleanupError=String(error.stack??error);save();if(!primaryFailure)throw error;
 }finally{
  if(secretBound){
   try{wrangler(['secret','delete','EVAL_API_KEY','--env','staging']);report.internalKeyRevoked=true;save();}
   catch(error){report.internalKeyRevoked=false;report.keyRevocationError=String(error.stack??error);save();if(!primaryFailure)throw error;}
  }
 }
}
