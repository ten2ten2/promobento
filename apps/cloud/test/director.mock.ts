// Full S1 A-C/E/F control flow, not pixel quality, CF isolation, model capability or performance evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {OperationWorkflow} from '../src/director.ts';
import {ShardDO} from '../src/compute.ts';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {sha256Bytes,digest} from '@promobento/contracts/digest';
import {assertRenderTask} from '@promobento/contracts/render';
import {pngRgba} from '../src/director-sheets.mjs';
import {immutableJson,settle} from '../src/store.ts';
import {filmFixture,pageOptions} from '../../../packages/film-runtime/test/fixture.mjs';
import providers from '../../../config/model-providers.json';
import platform from '../../../config/platform-presets.json';
import {importModelOpening,confirmModelOpening,modelAuthorizationId,modelBudgetStatus} from '../src/model-budget.ts';

const png=pngRgba(1,1,Uint8Array.from([40,80,120,255]));
const clone=structuredClone;
async function fixture({repair=false,alwaysRepair=false,coldBlock=false,missingKey=false,noRights=false,transportFailure=false,badSpec=false,unverified=false,cancel=false,
 audio=false,missingApproval=false,missingContext=false,noticeFailure=false,cleanupFailure=false,healthFailure=false,unconfirmedHistory=false,
 nativeProtocol=false,fixableSpec=false,malformedSpec=false,specTransportFailure=false,fixableCold=false,twoReviewRepairs=false}={}){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync('apps/cloud/migrations/0001_s1_pipeline.sql','utf8'));
 db.exec(readFileSync('apps/cloud/migrations/0002_workflow_recovery.sql','utf8'));
 db.exec(readFileSync('apps/cloud/model-ledger-migrations/0001_model_budget.sql','utf8'));
 const DB={prepare(sql:string){let args:any[]=[];return{
  bind(...values:any[]){args=values;return this;},
  async first(){return db.prepare(sql).get(...args)??null;},async all(){return{results:db.prepare(sql).all(...args)};},
  runSync(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}};},async run(){return this.runSync();}
 };},async batch(statements:any[]){db.exec('BEGIN');try{const rows=statements.map(statement=>statement.runSync());db.exec('COMMIT');return rows;}catch(error){db.exec('ROLLBACK');throw error;}}};
 const objects=new Map<string,any>();
 const MEDIA={async head(key:string){const value=objects.get(key);return value?{size:value.bytes.length,customMetadata:value.customMetadata,httpMetadata:value.httpMetadata}:null;},
  async get(key:string){const value=objects.get(key);return value?{size:value.bytes.length,customMetadata:value.customMetadata,arrayBuffer:async()=>Uint8Array.from(value.bytes).buffer}:null;},
  async put(key:string,input:any,options:any){if(objects.has(key)&&options?.onlyIf?.get('If-None-Match')==='*')return null;
   const bytes=typeof input==='string'?new TextEncoder().encode(input):new Uint8Array(input);objects.set(key,{bytes,customMetadata:options?.customMetadata,httpMetadata:options?.httpMetadata});return{};}};
 let clock=Date.parse('2026-10-24T00:00:00Z'),activeStudio:any=null,studioCount=0,closedCount=0,choiceCount=0,networkCalls=0,models:string[]=[],progress:string[]=[];
 const healthCache=new Map<string,string>();
 const originalDate=Date.now,originalFetch=globalThis.fetch,originalSpec=providers.steps.spec,originalCold=providers.steps.coldReview;
 if(nativeProtocol){providers.steps.spec='anthropic/claude-opus-5-5';providers.steps.coldReview='anthropic/claude-sonnet-5-5';}
 const specModel=(providers.models as any)[providers.steps.spec],originalVerified=specModel.capabilities.verified;
 Date.now=()=>clock;
 if(unverified)specModel.capabilities.verified=false;
 const spec=filmFixture(),keyframeFilm=clone(spec),options=pageOptions('landscape',platform.aspectLayouts.landscape);
 if(audio)spec.audio={music:{kind:'score',scoreRef:'audio/original.abc'},sfx:[],captions:'off',mute:false};
 const fixed=clone(spec);fixed.texts.headline.text='Make your next launch\nworth watching.';
 const coldFixed=clone(fixed);coldFixed.texts.headline.text='Make your next launch\nworth watching again.';
 const submitted={toolCalls:[{id:'mock-submit',name:'submit_candidate',arguments:'',input:{note:'Synthetic fixture accepted.'}}]};
 const context={audience:'software',durationSeconds:15,aspects:['landscape','portrait'],seed:options.seed,brief:'Original fictional engineering fixture, internal mock only.',
  runtimeVersion:'film-runtime-v1',rendererRelease:'fixture-release',fonts:options.fonts,confirmedFactIds:['fixture-cta'],facts:[{id:'fixture-cta',text:spec.texts.cta.text}],resources:[] as any[],audioSources:[] as any[]};
 const env:any={DB,MODEL_LEDGER:DB,PIPELINE_ENVIRONMENT:'offline',MEDIA,...(missingKey?{}:{MODEL_COMPAT_API_KEY:'fixture-not-a-secret'}),...(nativeProtocol&&!missingKey?{ANTHROPIC_API_KEY:'fixture-not-a-secret'}:{}),
  COORDINATOR:{getByName(){return{async rendererHealth(key:string){return healthCache.get(key)??'null';},async rememberRendererHealth(key:string,value:string){healthCache.set(key,value);}};}},
  SHARDS:{getByName(){return{async stopAndSettle(){},async imageDigest(){return'sha256:'+'a'.repeat(64);}};}},
  OPERATIONS:{getByName(){return{
   async progress(text:string){if(noticeFailure)throw Error('MOCK_NOTICE_FAILURE');progress.push(parseCanonicalJson(text).status);},
   async studio(_id:string,text:string){const task=parseCanonicalJson(text),{generation,imageDigest,deadlineAt,...input}=task;
    if(healthFailure&&task.taskId.startsWith('health-'))throw Error('MOCK_RENDER_UNAVAILABLE');
    assertRenderTask({...input,brokerToken:'fixture-non-secret-token'});activeStudio=task;studioCount++;return canonical({status:'ready'});},
   async frame(_id:string,frame:number){assert.ok(activeStudio.job.frames.includes(frame));return new Response(png);},
   async closeStudio(){if(cleanupFailure)throw Error('MOCK_CLEANUP_FAILURE');if(activeStudio)closedCount++;activeStudio=null;}
  };}},
  OUTBOX:{async send(item:any){if(item.kind!=='render')throw Error('MOCK_UNEXPECTED_OUTBOX');
   const input=await(await MEDIA.get(db.prepare('SELECT job_key FROM pipeline_renders WHERE id=?').get(item.payloadJson?parseCanonicalJson(item.payloadJson).renderId:item.id.slice(7)).job_key))!.arrayBuffer();
   const request=parseCanonicalJson(new Uint8Array(input)),frame=await immutableJson(env,`renders/${request.job.renderId}/mock/observation-frames/45.png`,{mock:'not rendered'});
   assertRenderTask({schemaVersion:'3.0.0',kind:'render_task',mode:'audio',instance:'standard-1',taskId:'mock-audio-task',brokerToken:'fixture-non-secret-token',job:request.job,inputs:request.audioInputsBlobs,audioInputs:request.audioInputs});
   if(audio){assert.equal(request.audioInputs.scores[0][0],'music');assert.equal(request.audioInputs.clearedSources[0].requestHash,digest({text:request.audioInputs.scores[0][1],totalFrames:450}));
    assert.equal(request.audioInputsBlobs[1].name,'audio:music');assert.ok(request.job.resources.some((r:any)=>r.kind==='audio'));}
   // Real PNG bytes only for SSE image transport; this render is explicitly simulated.
   objects.set(frame.key,{bytes:png,customMetadata:{sha256:sha256Bytes(png)}});frame.sha256=sha256Bytes(png);frame.byteLength=png.length;frame.mediaType='image/png';
   const result={renderId:request.job.renderId,status:'passed',outputs:[],observationFrames:[frame],media:{scope:'simulated_not_media_evidence'}};
   db.prepare("UPDATE pipeline_renders SET status='passed',result_json=? WHERE id=?").run(canonical(result),request.job.renderId);
  }}};
 const opening=await importModelOpening(env,{kind:'historical_model_spend',authorizationId:modelAuthorizationId,scope:'all_model_spend_before_shared_ledger',sources:['offline synthetic fixture; no provider spend'],entries:[]});
 if(!unconfirmedHistory)await confirmModelOpening(env,{kind:'model_spend_confirmation',authorizationId:modelAuthorizationId,openingManifestHash:opening.openingManifestHash,
  approvedBy:'owner',totalUsdMicros:0,basis:'Explicit offline simulation, not a real opening attestation.',source:'offline fixture'});
 db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('mock-operation','mock-workspace','mock-project',0,'evaluation','active','fixture',10000000,clock,null,null);
 db.prepare('INSERT INTO renderer_releases VALUES(?,?,?,?,?)').run('fixture-release','sha256:'+'a'.repeat(64),'film-runtime-v1','fixture-environment','active');
 const resource=await immutableJson(env,'evals/mock/original.json',{original:'fixture image'});
 objects.set(resource.key,{bytes:png,customMetadata:{sha256:sha256Bytes(png)}});resource.sha256=sha256Bytes(png);resource.byteLength=png.length;resource.mediaType='image/png';
 context.resources=[{...resource,...options.resources[0]}];
 await immutableJson(env,'evals/mock/rights.json',{basis:'Original synthetic test fixture; not real third-party clearance.'});
 if(!noRights)db.prepare('INSERT INTO pipeline_rights VALUES(?,?,?,?,?,?,?)').run('mock-operation',options.resources[0].resourceId,resource.sha256,options.resources[0].licenseRef,'evals/mock/rights.json','internal_eval_only',null);
 if(audio){
  const text='X:1\nT:Original fixture\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\nC E G c | G E D C |',bytes=new TextEncoder().encode(text),sha256=sha256Bytes(bytes),key='evals/mock/original.abc';
  objects.set(key,{bytes,customMetadata:{sha256}});context.audioSources=[{kind:'score',resourceId:'res_original_score',scoreRef:'audio/original.abc',key,sha256,byteLength:bytes.length}];
  await immutableJson(env,'evals/mock/audio-rights.json',{kind:'audio_source_rights',operationId:'mock-operation',resourceId:'res_original_score',sha256,licenseRef:'LicenseRef-Original-Fixture',scope:'internal_eval_only',approvedBy:'owner',source:'original test data',basis:'Original bounded ABC, no third-party source.',
   ...(!missingApproval?{scoreApprovals:[{totalFrames:450,requestHash:digest({text,totalFrames:450})}]}:{})});
  db.prepare('INSERT INTO pipeline_rights VALUES(?,?,?,?,?,?,?)').run('mock-operation','res_original_score',sha256,'LicenseRef-Original-Fixture','evals/mock/audio-rights.json','internal_eval_only',null);
 }
 await immutableJson(env,'evals/mock/context.json',context);if(!missingContext)db.prepare('INSERT INTO pipeline_contexts(operation_id,request_key) VALUES(?,?)').run('mock-operation','evals/mock/context.json');
 let reviewRound=0,specRequests=0,coldRequests=0;const validationFeedback:any[]=[];
 globalThis.fetch=async(url:any,init:any)=>{
  // No native fetch fallback: any unexpected URL fails before network access.
  const target=String(url),body=parseCanonicalJson(init.body);networkCalls++;
  const provider=Object.values(providers.providers).find(provider=>target.startsWith(provider.baseUrl));assert.ok(provider,'unexpected mock provider URL');
  if(target.endsWith('/count_tokens'))return Response.json({input_tokens:100});
  if(transportFailure)throw Error('MOCK_TRANSPORT_FAILURE');
  const user=provider.kind==='anthropic'?body.messages[0].content[0].text:typeof body.messages[1].content==='string'?body.messages[1].content:body.messages[1].content[0].text;
  const input=parseCanonicalJson(user);let stage:string,value:any;
  if(input.task.startsWith('Organize')){stage='facts';assert.match(provider.kind==='anthropic'?body.system[0].text:body.messages[0].content,/fact_analysis/);value={schemaVersion:'3.0.0',kind:'fact_analysis',factIds:['fixture-cta'],summary:'Original fixture CTA.'};}
  else if(input.task.startsWith('Describe')){stage='assets';value={schemaVersion:'3.0.0',kind:'asset_insight',sha256:resource.sha256,promptVersion:'asset-insight-v1',model:providers.steps.assets,assetKind:'illustration',description:'Original fixture.',regions:[],dominantColors:[],visibleText:[],suitableBlocks:['ui-showcase']};}
  else if(input.task.startsWith('Propose')){stage='directions';value={schemaVersion:'3.0.0',kind:'direction_set',cards:['fit','amplify','unexpected'].map(key=>({key,language:'en',palette:[{color:'#101712',role:'bg',source:'fixture'},{color:'#f4f8ee',role:'ink',source:'fixture'}],logline:'Original mock direction.',feel:{route:'continuous',bpm:100,eventsPerBar:2},sound:'Silent fixture.',risk:'Fixture only.',usesDepth:false,skeleton:spec.scenes.map(scene=>({purpose:scene.purpose,approach:'block:'+scene.block.split('@')[0]})),keyframeFilm:clone(keyframeFilm)}))};}
  else if(input.task.startsWith('Write')){stage='spec';specRequests++;assert.deepEqual(input.context,context);
   if(specTransportFailure)throw Error('MOCK_SPEC_TRANSPORT_FAILURE');
   if(specRequests>1&&!input.coldReviewFeedback){assert.ok(input.validationFeedback?.issues?.length);validationFeedback.push(input.validationFeedback);}
   if(input.coldReviewFeedback)assert.equal(input.coldReviewFeedback.review.verdict,'block');
   value=clone(input.coldReviewFeedback?coldFixed:spec);if(badSpec||fixableSpec&&specRequests===1)value.scenes[1].start=200;}
  else if(input.task.startsWith('Review')){stage='review';assert.equal(input.frames.length,1);assert.equal(input.frames[0].tiles.length,1);
   const change=alwaysRepair||repair&&reviewRound===0||twoReviewRepairs&&reviewRound<2;reviewRound++;
   value=change?{toolCalls:[{id:'mock-fix',name:'write_spec',arguments:'',input:{film:clone(fixed)}}]}:submitted;}
  else if(input.task.startsWith('Independently')){stage='coldReview';coldRequests++;assert.match(provider.kind==='anthropic'?body.system[0].text:body.messages[0].content,/cold_review/);assert.deepEqual(input.frames.map((sheet:any)=>sheet.aspect),context.aspects);assert.ok(input.frames.every((sheet:any)=>sheet.tiles.length===1));
   const blocked=coldBlock||fixableCold&&coldRequests===1;value={schemaVersion:'3.0.0',kind:'cold_review',verdict:blocked?'block':'pass',issues:blocked?[{detail:'Synthetic cold-review rejection.',frames:[45]}]:[]};}
  else throw Error('MOCK_UNKNOWN_STAGE');models.push(stage);
  const data=(value:any)=>'data: '+canonical(value)+'\n\n';let sse='';const reply=stage==='spec'&&malformedSpec&&specRequests===1?'{':canonical(value);
  if(provider.kind==='anthropic'){
   assert.ok(init.headers['x-api-key']);assert.ok(body.output_config.format);assert.equal(body.system[0].cache_control.ttl,'1h');
   sse=data({type:'message_start',message:{usage:{input_tokens:100,output_tokens:0}}})+data({type:'content_block_delta',index:0,delta:{type:'text_delta',text:reply}})
    +data({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:50}})+data({type:'message_stop'});
  }else{
   assert.ok(init.headers.authorization);assert.equal(body.stream_options.include_usage,true);
   if(value.toolCalls){assert.ok(body.tools?.length);const call=value.toolCalls[0];sse+=data({choices:[{delta:{tool_calls:[{index:0,id:call.id,function:{name:call.name,arguments:canonical(call.input)}}]}}]});}
   else sse+=data({choices:[{delta:{content:reply}}]});
   sse+=data({choices:[{delta:{},finish_reason:value.toolCalls?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:50}})+'data: [DONE]\n\n';
  }
  return new Response(sse,{headers:{'content-type':'text/event-stream'}});
 };
 const step:any={async do(name:string,optionsOrFn:any,callback?:any){const fn=callback??optionsOrFn;clock+=100;
   if(name==='preflight')assert.equal(optionsOrFn.retries.limit,0,'missing keys/rights/verification are deterministic admission failures');
   if(cancel&&name==='spec'){db.prepare("UPDATE pipeline_operations SET status='cancelled',generation=generation+1").run();}
   return fn();},async waitForEvent(){choiceCount++;assert.equal(activeStudio,null);
    const row=db.prepare('SELECT directions_hash,previews_key FROM pipeline_contexts').get();assert.equal((parseCanonicalJson(new Uint8Array(await(await MEDIA.get(row.previews_key))!.arrayBuffer())) as any[]).length,3);
    clock+=12*3600000;return{payload:{key:'fit',directionsHash:row.directions_hash}};}};
 try{
  let result:any,error:any;try{result=await new OperationWorkflow({} as any,env).run({payload:{operationId:'mock-operation'}} as any,step);}catch(value){error=value;}
  const state=db.prepare('SELECT status,result_key FROM pipeline_operations').get();
  return{result,error,state,models,networkCalls,studioCount,closedCount,choiceCount,activeStudio,progress,specRequests,validationFeedback,
   reservations:Number(db.prepare('SELECT COUNT(*) AS n FROM cost_reservations').get().n),settlements:Number(db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n),
   renders:db.prepare('SELECT * FROM pipeline_renders').all(),outbox:db.prepare('SELECT * FROM pipeline_outbox').all(),modelBudget:await modelBudgetStatus(env)};
 }finally{Date.now=originalDate;globalThis.fetch=originalFetch;specModel.capabilities.verified=originalVerified;providers.steps.spec=originalSpec;providers.steps.coldReview=originalCold;db.close();}
}

test('A-C/E/F replay both SSE adapters, three real-protocol still requests and user wait exclusion',async()=>{
 for(const nativeProtocol of [false,true]){
 const r=await fixture({nativeProtocol});assert.ifError(r.error);assert.equal(r.state.status,'succeeded');assert.equal(r.result.publicUseCleared,false);assert.equal(r.result.ownerNormalSpeedReview,'pending');
 assert.deepEqual(r.models,['facts','assets','directions','spec','review','coldReview']);assert.equal(r.reservations,6);assert.equal(r.settlements,6);
 assert.equal(r.choiceCount,1);assert.equal(r.studioCount,5);assert.equal(r.closedCount,5);assert.equal(r.activeStudio,null);assert.equal(r.renders.length,3);
 }
});
test('review repairs the spec once and regenerates review before final/cold review',async()=>{
 const r=await fixture({repair:true});assert.ifError(r.error);assert.equal(r.models.filter(stage=>stage==='review').length,2);assert.equal(r.renders.length,4);assert.match(r.result.film.texts.headline.text,/worth watching/);
});
test('cold-review rejection withholds candidate delivery',async()=>{const r=await fixture({coldBlock:true});assert.match(r.error.message,/COLD_REVIEW_BLOCK/);assert.equal(r.state.status,'failed');assert.match(r.state.result_key,/failure.json$/);assert.equal(r.activeStudio,null);});
test('cold-review correction rerenders every aspect, re-reviews and shares the two internal repairs with E',async()=>{
 const good=await fixture({fixableCold:true,repair:true});assert.ifError(good.error);assert.equal(good.result.internalRepairs,2);assert.equal(good.specRequests,2);
 assert.equal(good.models.filter(stage=>stage==='coldReview').length,2);assert.equal(good.renders.filter((row:any)=>row.id===good.result.final[0].renderId).length,1);
 assert.match(good.result.film.texts.headline.text,/worth watching/);assert.equal(good.renders.length,7);assert.equal(good.reservations,good.settlements);
 const spent=await fixture({twoReviewRepairs:true,coldBlock:true});assert.equal(spent.error.message,'COLD_REVIEW_BLOCK');assert.equal(spent.specRequests,1);assert.equal(spent.models.filter(stage=>stage==='coldReview').length,1);assert.equal(spent.models.filter(stage=>stage==='review').length,3);
});
test('missing later key, unverified integration and missing rights stop before any model request',async()=>{
 for(const [options,code]of [[{missingKey:true},'MODEL_SECRET_MISSING'],[{unverified:true},'MODEL_INTEGRATION_UNVERIFIED'],[{noRights:true},'ASSET_RIGHTS_PENDING']] as const){
  const r=await fixture(options);assert.equal(r.error.message,code);assert.equal(r.networkCalls,0);assert.equal(r.reservations,0);assert.equal(r.state.status,'failed');}
});
test('unknown transport spend remains reserved and is not silently retried or settled as zero',async()=>{const r=await fixture({transportFailure:true});assert.equal(r.error.message,'MOCK_TRANSPORT_FAILURE');assert.equal(r.networkCalls,1);assert.equal(r.reservations,1);assert.equal(r.settlements,0);});
test('spec validation repairs completed output only, preserves charges and stops after two corrections',async()=>{
 const fixed=await fixture({fixableSpec:true});assert.ifError(fixed.error);assert.equal(fixed.specRequests,2);assert.equal(fixed.settlements,7);assert.equal(fixed.renders.length,3);
 assert.equal(fixed.validationFeedback[0].code,'FILM_SEMANTICS_INVALID');assert.ok(fixed.validationFeedback[0].issues.some((issue:any)=>issue.path==='/scenes/1/start'));
 const json=await fixture({malformedSpec:true});assert.ifError(json.error);assert.equal(json.specRequests,2);assert.equal(json.validationFeedback[0].code,'MODEL_OUTPUT_JSON_INVALID');assert.equal(json.settlements,7);
 const bad=await fixture({badSpec:true});assert.match(bad.error.message,/FILM_SEMANTICS_INVALID/);assert.equal(bad.specRequests,3);assert.equal(bad.renders.length,0);assert.equal(bad.settlements,6);assert.match(bad.state.result_key,/failure.json$/);
 const unknown=await fixture({specTransportFailure:true});assert.equal(unknown.error.message,'MOCK_SPEC_TRANSPORT_FAILURE');assert.equal(unknown.specRequests,1);assert.equal(unknown.reservations,4);assert.equal(unknown.settlements,3);assert.equal(unknown.modelBudget.pending.length,1);assert.equal(unknown.renders.length,0);
});
test('cancellation fences the next paid stage and preserves the cancelled status',async()=>{const r=await fixture({cancel:true});assert.equal(r.error.message,'OPERATION_FENCED');assert.equal(r.state.status,'cancelled');assert.deepEqual(r.models,['facts','assets','directions']);assert.equal(r.activeStudio,null);});

test('admitted ABC follows the actual director-to-render path; missing independent approval spends nothing',async()=>{
 const good=await fixture({audio:true,noticeFailure:true});assert.ifError(good.error);assert.equal(good.state.status,'succeeded');assert.equal(good.renders.length,3);
 assert.ok(good.outbox.some((row:any)=>row.kind==='operation_progress'&&parseCanonicalJson(row.payload_json).status==='succeeded'));
 const bad=await fixture({audio:true,missingApproval:true});assert.equal(bad.error.message,'SCORE_APPROVAL_REQUIRED');assert.equal(bad.networkCalls,0);assert.equal(bad.reservations,0);
});
test('director preparation/cleanup preserve the first cause, and internal repairs stop at two',async()=>{
 const missing=await fixture({missingContext:true,cleanupFailure:true});assert.equal(missing.error.message,'DIRECTOR_CONTEXT_MISSING');assert.equal(missing.state.status,'failed');
 assert.equal(parseCanonicalJson(missing.outbox.find((row:any)=>row.kind==='operation_failure').payload_json).code,'DIRECTOR_CONTEXT_MISSING');
 const limit=await fixture({alwaysRepair:true});assert.equal(limit.error.message,'DIRECTOR_REPAIR_LIMIT');assert.equal(limit.state.status,'failed');
 assert.equal(limit.models.filter(stage=>stage==='review').length,3);assert.equal(limit.renders.length,3);assert.equal(limit.models.includes('coldReview'),false);
});
test('environment preflight is refreshed after user wait, and a broken renderer spends no model tokens',async()=>{
 const good=await fixture();assert.ifError(good.error);assert.equal(good.studioCount,5);assert.equal(good.closedCount,5);assert.equal(good.reservations,6);
 const bad=await fixture({healthFailure:true,cleanupFailure:true});assert.equal(bad.error.message,'MOCK_RENDER_UNAVAILABLE');assert.equal(bad.networkCalls,0);assert.equal(bad.reservations,0);assert.equal(bad.state.status,'failed');
});
test('shared model ledger gates unknown opening and retains unresolved transport liability across the real director',async()=>{
 const blocked=await fixture({unconfirmedHistory:true});assert.equal(blocked.error.message,'MODEL_HISTORY_RECONCILIATION_REQUIRED');assert.equal(blocked.networkCalls,0);assert.equal(blocked.studioCount,0);
 const good=await fixture();assert.ifError(good.error);assert.equal(good.modelBudget.currentReservations,6);assert.equal(good.modelBudget.pending.length,0);assert.equal(good.settlements,6);
 const unknown=await fixture({transportFailure:true});assert.equal(unknown.error.message,'MOCK_TRANSPORT_FAILURE');assert.equal(unknown.networkCalls,1);assert.equal(unknown.modelBudget.pending.length,1);assert.ok(unknown.modelBudget.pending[0].dispatched_at);
});

test('concurrent stop and timeout settle one persisted compute usage and reject conflicting charges',async()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync('apps/cloud/migrations/0001_s1_pipeline.sql','utf8'));
 db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('mock-stop','workspace','project',0,'evaluation','active','request',1000000,Date.now(),null,null);
 db.prepare('INSERT INTO cost_reservations VALUES(?,?,?,?,?,?,?,?)').run('task-stop','mock-stop','request','compute','render',100000,'fixture',Date.now());
 const DB={prepare(sql:string){let args:any[]=[];return{bind(...values:any[]){args=values;return this;},async first(){return db.prepare(sql).get(...args)??null;},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};}};
 const values=new Map<string,any>([['taskId','task-stop'],['startedAt',Date.now()-1000],['instance','standard-3']]);
 const storage={get:async(key:string)=>values.get(key),delete:async(key:string)=>values.delete(key),deleteAlarm:async()=>{},
  transactionSync:(fn:any)=>fn(),kv:{get:(key:string)=>values.get(key),put:(key:string,value:any)=>values.set(key,value)}};
 const container={running:true,async destroy(){this.running=false;}},env:any={DB,COORDINATOR:{getByName(){return{async release(){assert.equal(container.running,false);}};}}};
 try{
  const shard=new ShardDO({storage,container} as any,env);
  await Promise.all([shard.stopAndSettle(),shard.stopAndSettle()]);
  const rows=db.prepare('SELECT * FROM cost_settlements').all();assert.equal(rows.length,1);assert.ok(rows[0].actual_micros>0);
  const usage=canonical(values.get('costUsage'));assert.equal(rows[0].usage_json,usage);
  await shard.stopAndSettle();assert.equal(canonical(values.get('costUsage')),usage);
  await assert.rejects(settle(env,'task-stop',Number(rows[0].actual_micros)+1,{changed:true}),/COST_SETTLEMENT_CONFLICT/);
 }finally{db.close();}
});
