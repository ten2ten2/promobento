// Full S1 A-C/E/F control flow, not pixel quality, CF isolation, model capability or performance evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {OperationWorkflow} from '../src/director.ts';
import worker from '../src/index.ts';
import {ShardDO} from '../src/compute.ts';
import {AUDIO_INSTANCE} from '../src/render-task.ts';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {sha256Bytes,digest} from '@promobento/contracts/digest';
import {assertRenderTask} from '@promobento/contracts/render';
import {pngRgba} from '../src/director-sheets.mjs';
import {immutableJson,settle} from '../src/store.ts';
import {directingMethodPack} from '../../../packages/methods/directing.ts';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {filmFixture,pageOptions} from '../../../packages/film-runtime/test/fixture.mjs';
import providers from '../../../config/model-providers.json';
import platform from '../../../config/platform-presets.json';
import {importModelOpening,confirmModelOpening,modelAuthorizationId,modelBudgetStatus} from '../src/model-budget.ts';

const png=pngRgba(1,1,Uint8Array.from([40,80,120,255]));
const clone=structuredClone;
async function fixture({repair=false,alwaysRepair=false,coldBlock=false,missingKey=false,noRights=false,transportFailure=false,badSpec=false,unverified=false,cancel=false,cancelHandoff=false,
 audio=false,missingApproval=false,missingContext=false,noticeFailure=false,cleanupFailure=false,healthFailure=false,oversizedResource=false,unconfirmedHistory=false,httpFailure=false,
 nativeProtocol=false,fixableSpec=false,malformedSpec=false,specTransportFailure=false,fixableCold=false,twoReviewRepairs=false,invalidStage='',alwaysInvalidStage=false,unsupportedDirections=false,unsupportedSpec=false,compactDirections=false,motionSamples=false,customScene=false,badCustom=false,customSourceRepair=false,fixableCustomPath=false}={}){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync('apps/cloud/migrations/0001_s1_pipeline.sql','utf8'));
 db.exec(readFileSync('apps/cloud/migrations/0002_workflow_recovery.sql','utf8'));
 db.exec(readFileSync('apps/cloud/migrations/0003_directing_method.sql','utf8'));
 db.exec(readFileSync('apps/cloud/model-ledger-migrations/0001_model_budget.sql','utf8'));
 const DB={prepare(sql:string){let args:any[]=[];return{
  bind(...values:any[]){args=values;return this;},
  async first(){return db.prepare(sql).get(...args)??null;},async all(){return{results:db.prepare(sql).all(...args)};},
  runSync(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}};},async run(){return this.runSync();}
 };},async batch(statements:any[]){db.exec('BEGIN');try{const rows=statements.map(statement=>statement.runSync());db.exec('COMMIT');return rows;}catch(error){db.exec('ROLLBACK');throw error;}}};
 const objects=new Map<string,any>();
 const MEDIA={async head(key:string){const value=objects.get(key);return value?{size:value.bytes.length,customMetadata:value.customMetadata,httpMetadata:value.httpMetadata}:null;},
  async get(key:string){const value=objects.get(key);return value?{size:value.bytes.length,body:Uint8Array.from(value.bytes),customMetadata:value.customMetadata,arrayBuffer:async()=>Uint8Array.from(value.bytes).buffer}:null;},
  async put(key:string,input:any,options:any){if(objects.has(key)&&options?.onlyIf?.get('If-None-Match')==='*')return null;
   const bytes=typeof input==='string'?new TextEncoder().encode(input):new Uint8Array(input);objects.set(key,{bytes,customMetadata:options?.customMetadata,httpMetadata:options?.httpMetadata});return{};}};
 let clock=Date.parse('2026-10-24T00:00:00Z'),activeStudio:any=null,studioCount=0,closedCount=0,choiceCount=0,networkCalls=0,models:string[]=[],progress:string[]=[],reviewRequests:any[]=[];
 const healthCache=new Map<string,string>();
 const originalDate=Date.now,originalFetch=globalThis.fetch,originalSpec=providers.steps.spec;
 // Exercise the native Messages transport at C; F keeps the actual independent DeepSeek binding.
 if(nativeProtocol)providers.steps.spec='anthropic/claude-opus-5-5';
 const specModel=(providers.models as any)[providers.steps.spec],originalVerified=specModel.capabilities.verified;
 Date.now=()=>clock;
 if(unverified)specModel.capabilities.verified=false;
 const spec=filmFixture(),keyframeFilm=clone(spec),options=pageOptions('landscape',platform.aspectLayouts.landscape);
 if(audio)spec.audio={music:{kind:'score',scoreRef:'audio/original.abc'},sfx:[],captions:'off',mute:false};
 if(customScene)spec.scenes[1]={id:'product',kind:'custom',module:'scenes/product/index.js',start:120,end:336,purpose:'Original custom workflow.',brief:'Preserve one subject through a changing composition.',transitionIn:{type:'push',frames:6},
  params:{hardest:true,textSlots:['product'],assetKeys:['dashboard'],events:[{name:'product-land',frame:21}],readingHolds:[{start:45,end:200}]}};
 const fixtureSource='PB.scene("product",ctx=>{const panel=document.createElement("div");ctx.root.append(panel);ctx.text("product").mount(panel);const image=document.createElement("img");image.src=ctx.asset("dashboard").url;panel.append(image);const timeline=gsap.timeline({paused:true});timeline.to(panel,{duration:7.2,opacity:1,ease:"power2.out"});return {timeline};});';
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
   async checkFrame(_id:string,frame:number){return Response.json({frameIndex:frame,observation:{schemaVersion:'3.0.0',kind:'frame_observation',renderId:activeStudio.job.renderId,aspectId:activeStudio.job.aspectId,frame,texts:[],regions:[],findings:[]}});},
   async frame(_id:string,frame:number){assert.ok(activeStudio.job.frames.includes(frame));return new Response(png);},
   async closeStudio(){if(cleanupFailure)throw Error('MOCK_CLEANUP_FAILURE');if(activeStudio)closedCount++;activeStudio=null;}
  };}},
  OUTBOX:{async send(item:any){if(item.kind!=='render')throw Error('MOCK_UNEXPECTED_OUTBOX');
   const input=await(await MEDIA.get(db.prepare('SELECT job_key FROM pipeline_renders WHERE id=?').get(item.payloadJson?parseCanonicalJson(item.payloadJson).renderId:item.id.slice(7)).job_key))!.arrayBuffer();
   const request=parseCanonicalJson(new Uint8Array(input)),frame=await immutableJson(env,`renders/${request.job.renderId}/mock/observation-frames/45.png`,{mock:'not rendered'});
   if(customScene){const modules=Object.fromEntries(request.inputs.filter((blob:any)=>blob.name.startsWith('scenes/')).map((blob:any)=>[blob.name,new TextDecoder().decode(objects.get(blob.key).bytes)]));assert.equal(request.job.sourceHash,filmSourceHash(objects.get(request.inputs.find((blob:any)=>blob.name==='film').key).bytes,modules));}
   assertRenderTask({schemaVersion:'3.0.0',kind:'render_task',mode:'audio',instance:AUDIO_INSTANCE,taskId:'mock-audio-task',brokerToken:'fixture-non-secret-token',job:request.job,inputs:request.audioInputsBlobs,audioInputs:request.audioInputs});
   if(audio){assert.equal(request.audioInputs.scores[0][0],'music');assert.equal(request.audioInputs.clearedSources[0].requestHash,digest({text:request.audioInputs.scores[0][1],totalFrames:450}));
    assert.equal(request.audioInputsBlobs[1].name,'audio:music');assert.ok(request.job.resources.some((r:any)=>r.kind==='audio'));}
   // Real PNG bytes only for SSE image transport; this render is explicitly simulated.
   objects.set(frame.key,{bytes:png,customMetadata:{sha256:sha256Bytes(png)}});frame.sha256=sha256Bytes(png);frame.byteLength=png.length;frame.mediaType='image/png';
   const motionFrame={...frame,key:frame.key.replace('/observation-frames/45.png','/motion-frames/90.png')};
   if(motionSamples)objects.set(motionFrame.key,{bytes:png,customMetadata:{sha256:sha256Bytes(png)}});
   const fakeMovie=await immutableJson(env,`renders/${request.job.renderId}/mock/film.mp4`,{scope:'simulated_not_media_evidence'});
   const result={renderId:request.job.renderId,status:'passed',outputs:[fakeMovie],observationFrames:[frame],...(motionSamples?{motionFrames:[motionFrame]}:{}),media:{scope:'simulated_not_media_evidence'}};
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
 if(oversizedResource)context.resources[0].height=5064;
 await immutableJson(env,'evals/mock/rights.json',{basis:'Original synthetic test fixture; not real third-party clearance.'});
 if(!noRights)db.prepare('INSERT INTO pipeline_rights VALUES(?,?,?,?,?,?,?)').run('mock-operation',options.resources[0].resourceId,resource.sha256,options.resources[0].licenseRef,'evals/mock/rights.json','internal_eval_only',null);
 if(audio){
  const text='X:1\nT:Original fixture\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\nC E G c | G E D C |',bytes=new TextEncoder().encode(text),sha256=sha256Bytes(bytes),key='evals/mock/original.abc';
  objects.set(key,{bytes,customMetadata:{sha256}});context.audioSources=[{kind:'score',resourceId:'res_original_score',scoreRef:'audio/original.abc',key,sha256,byteLength:bytes.length}];
  await immutableJson(env,'evals/mock/audio-rights.json',{kind:'audio_source_rights',operationId:'mock-operation',resourceId:'res_original_score',sha256,licenseRef:'LicenseRef-Original-Fixture',scope:'internal_eval_only',approvedBy:'owner',source:'original test data',basis:'Original bounded ABC, no third-party source.',
   ...(!missingApproval?{scoreApprovals:[{totalFrames:450,requestHash:digest({text,totalFrames:450})}]}:{})});
  db.prepare('INSERT INTO pipeline_rights VALUES(?,?,?,?,?,?,?)').run('mock-operation','res_original_score',sha256,'LicenseRef-Original-Fixture','evals/mock/audio-rights.json','internal_eval_only',null);
 }
 const method=customScene?await immutableJson(env,'operations/mock-operation/directing-method.json',directingMethodPack):null;
 await immutableJson(env,'evals/mock/context.json',context);if(!missingContext)db.prepare('INSERT INTO pipeline_contexts(operation_id,request_key,directing_method_key) VALUES(?,?,?)').run('mock-operation','evals/mock/context.json',method?.key??null);
 let reviewRound=0,specRequests=0,coldRequests=0;const validationFeedback:any[]=[];
 globalThis.fetch=async(url:any,init:any)=>{
  // No native fetch fallback: any unexpected URL fails before network access.
  const target=String(url),body=parseCanonicalJson(init.body);networkCalls++;
  const provider=Object.values(providers.providers).find(provider=>target.startsWith(provider.baseUrl));assert.ok(provider,'unexpected mock provider URL');
  if(target.endsWith('/count_tokens'))return Response.json({input_tokens:100});
  if(transportFailure)throw Error('MOCK_TRANSPORT_FAILURE');
  if(httpFailure)return new Response('sensitive provider body must not be stored',{status:503});
  const user=provider.kind==='anthropic'?body.messages[0].content[0].text:typeof body.messages[1].content==='string'?body.messages[1].content:body.messages[1].content[0].text;
  const input=parseCanonicalJson(user);let stage:string,value:any;
  if(input.task.startsWith('Organize')){stage='facts';assert.match(provider.kind==='anthropic'?body.system[0].text:body.messages[0].content,/fact_analysis/);value={schemaVersion:'3.0.0',kind:'fact_analysis',factIds:['fixture-cta'],summary:'Original fixture CTA.'};}
  else if(input.task.startsWith('Describe')){stage='assets';value={schemaVersion:'3.0.0',kind:'asset_insight',sha256:resource.sha256,promptVersion:'asset-insight-v1',model:providers.steps.assets,assetKind:'illustration',description:'Original fixture.',regions:[],dominantColors:[],visibleText:[],suitableBlocks:['ui-showcase']};}
  else if(input.task.startsWith('Propose')){stage='directions';value={schemaVersion:'3.0.0',kind:'direction_set',cards:['fit','amplify','unexpected'].map(key=>({key,language:'en',palette:[{color:'#101712',role:'bg',source:'fixture'},{color:'#f4f8ee',role:'ink',source:'fixture'}],logline:'Original mock direction.',feel:{route:'continuous',bpm:100,eventsPerBar:2},sound:'Silent fixture.',risk:'Fixture only.',usesDepth:key==='amplify',skeleton:spec.scenes.map(scene=>({purpose:scene.purpose,approach:scene.kind==='custom'?'custom':'block:'+scene.block.split('@')[0]})),keyframeFilm:clone(keyframeFilm)}))};}
  else if(input.task.startsWith('Write')){stage='spec';specRequests++;assert.deepEqual(input.context,context);
   assert.match(input.mediaLayoutGuidance,/omit textSlot/);assert.match(input.mediaLayoutGuidance,/does not crop or magnify/);
   if(specTransportFailure)throw Error('MOCK_SPEC_TRANSPORT_FAILURE');
   if(specRequests>1&&!input.coldReviewFeedback){assert.ok(input.validationFeedback?.issues?.length);validationFeedback.push(input.validationFeedback);}
   if(input.coldReviewFeedback)assert.equal(input.coldReviewFeedback.review.verdict,'block');
   value=clone(input.coldReviewFeedback?coldFixed:spec);if(badSpec||fixableSpec&&specRequests===1)value.scenes[1].start=200;if(unsupportedSpec&&specRequests===1)value.style.texture={kind:'grain',amount:0.2};}
  else if(input.task.startsWith('Implement')){stage='scenes';const prompt=provider.kind==='anthropic'?body.system[0].text:body.messages[0].content;
   assert.equal(body.reasoning_effort,'none');assert.deepEqual(body.tool_choice,{type:'function',function:{name:'edit_file'}});
   assert.doesNotMatch(prompt,/No custom JS/);assert.match(prompt,/sandboxed DOM\/SVG\/Canvas2D/);
   assert.equal(body.messages[1].content.filter((part:any)=>part.type==='image_url').length,input.resources.length);assert.equal(input.resources.length,1);
   const params=body.tools[0].function.parameters;assert.equal(params.type,'object');assert.equal(params.properties.path.type,'string');assert.deepEqual(params.properties.path.enum,['scenes/product/index.js']);assert.doesNotMatch(canonical(params),/\$ref/);
   if(fixableCustomPath&&models.includes(stage)){assert.ok(input.validationFeedback.issues.some((issue:any)=>issue.code==='CUSTOM_EDIT_PATH_STRING_REQUIRED'&&issue.path==='/toolCalls/0/input/path'));}
   value={toolCalls:[{id:'mock-source',name:'edit_file',arguments:'',input:{command:'create',path:fixableCustomPath&&!models.includes(stage)?{module:'scenes/product/index.js'}:'scenes/product/index.js',fileText:badCustom?fixtureSource.replace('const panel=', 'fetch(\"https://example.com\");const panel='):fixtureSource}}]};}
  else if(input.task.startsWith('Review')){stage='review';assert.equal(input.frames.length,1);assert.equal(input.frames[0].tiles.length,1);
   if(customScene){const params=body.tools.find((entry:any)=>entry.function.name==='edit_file').function.parameters;assert.doesNotMatch(canonical(params),/\$ref/);assert.deepEqual(params.oneOf.map((variant:any)=>variant.properties.command.const),['str_replace','insert']);}
   assert.equal(input.motionFrames.length,motionSamples?1:0);assert.equal(body.messages[1].content.filter((part:any)=>part.type==='image_url').length,motionSamples?2:1);
   assert.match(input.mediaLayoutGuidance,/omit textSlot/);
   reviewRequests.push(input);
   const change=alwaysRepair||repair&&reviewRound===0||twoReviewRepairs&&reviewRound<2;reviewRound++;
   const suggestion=clone(fixed);if(alwaysRepair&&reviewRound===3)suggestion.texts.headline.text='An unapplied third suggestion.';
   value=customSourceRepair&&reviewRound===1?{toolCalls:[{id:'mock-source-edit',name:'edit_file',arguments:'',input:{command:'str_replace',path:'scenes/product/index.js',oldStr:'power2.out',newStr:'power3.out'}}]}:change?{toolCalls:[{id:'mock-fix',name:'write_spec',arguments:'',input:{film:suggestion}}]}:submitted;}
  else if(input.task.startsWith('Independently')){stage='coldReview';coldRequests++;assert.equal(body.max_tokens,16384);assert.deepEqual(body.tools.map((entry:any)=>entry.function.name),['submit_cold_review']);assert.deepEqual(body.tools[0].function.parameters,input.responseSchema);assert.deepEqual(input.frames.map((sheet:any)=>sheet.aspect),context.aspects);assert.ok(input.frames.every((sheet:any)=>sheet.tiles.length===1));
   assert.match(body.tools[0].function.description,/complete cold_review/);assert.equal(input.motionFrames.length,motionSamples?1:0);assert.equal(body.messages[1].content.filter((part:any)=>part.type==='image_url').length,motionSamples?3:2);
   if(motionSamples){assert.deepEqual(input.motionFrames[0].tiles.map((tile:any)=>tile.frame),[90]);assert.equal(input.motionFrames[0].aspect,context.aspects[0]);assert.match(input.motionFrames[0].scope,/mid_hops_not_full_motion_or_audio/);}
   assert.equal(input.repairContext,undefined,'cold review stays independent of E repair history');
   const blocked=coldBlock||fixableCold&&coldRequests===1;value={schemaVersion:'3.0.0',kind:'cold_review',verdict:blocked?'block':'pass',issues:blocked?[{detail:'Synthetic cold-review rejection.',frames:[45]}]:[]};}
  else throw Error('MOCK_UNKNOWN_STAGE');
  if(stage==='directions'&&compactDirections){for(const card of value.cards){delete card.keyframeFilm;card.usesDepth=card.key==='amplify';}}
  if(stage==='directions'&&unsupportedDirections){
    if(!models.includes(stage)){value.cards[1].keyframeFilm.style.texture={kind:'glow',amount:0.2};value.cards[2].keyframeFilm.style.texture={kind:'grain',amount:0.12};}
    else{const last=body.messages.at(-1),feedback=parseCanonicalJson(last.content).validationFeedback;assert.ok(feedback.issues.some((issue:any)=>issue.path==='/cards/1/keyframeFilm/style/texture'));assert.ok(feedback.issues.some((issue:any)=>issue.path==='/cards/2/keyframeFilm/style/texture'));}
  }
  if(stage===invalidStage&&(!models.includes(stage)||alwaysInvalidStage))value.schemaVersionNote=null;
  if(stage===invalidStage&&models.includes(stage)){
    const last=body.messages.at(-1),feedback=parseCanonicalJson(provider.kind==='anthropic'?last.content[0].text:last.content).validationFeedback;
    assert.ok(feedback.issues.some((issue:any)=>issue.path==='/schemaVersionNote'));
  }
  if(stage==='coldReview')value={toolCalls:[{id:'mock-cold-review',name:'submit_cold_review',arguments:'',input:value}]};
  models.push(stage);
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
   if(cancelHandoff&&name==='handoff-review-draft'){db.prepare("UPDATE pipeline_operations SET status='cancelled',generation=generation+1").run();}
   return fn();},async waitForEvent(){choiceCount++;assert.equal(activeStudio,null);
    const row=db.prepare('SELECT directions_hash,previews_key FROM pipeline_contexts').get();assert.equal((parseCanonicalJson(new Uint8Array(await(await MEDIA.get(row.previews_key))!.arrayBuffer())) as any[]).length,3);
    clock+=12*3600000;return{payload:{key:'fit',directionsHash:row.directions_hash}};}};
 try{
  let result:any,error:any;try{result=await new OperationWorkflow({} as any,env).run({payload:{operationId:'mock-operation'}} as any,step);}catch(value){error=value;}
  const state=db.prepare('SELECT status,result_key FROM pipeline_operations').get();
  let draftApi;
  if(result?.kind==='s1_internal_review_draft'){
   env.S1_ENABLED='internal_eval';env.EVAL_API_KEY='fixture-internal-key';
   const read=(path:string,authorized=true)=>worker.fetch(new Request('https://fixture.invalid/internal/s1/'+path,{headers:authorized?{authorization:'Bearer fixture-internal-key'}:{}}),env,{} as any);
   const route='operations/mock-operation/',file=result.movies[0].movie.outputs[0].key;
   const draft=await read(route+'review-draft');assert.equal(draft.status,200);assert.deepEqual(parseCanonicalJson(await draft.text()),result);
   assert.equal((await read(route+'candidate')).status,404);assert.equal((await read(route+'review-draft',false)).status,404);
   assert.equal((await read('artifacts/'+file)).status,200);
   const other=db.prepare('SELECT result_json FROM pipeline_renders WHERE id<>? LIMIT 1').get(result.movies[0].movie.renderId);
   if(other){const outside=parseCanonicalJson(other.result_json).outputs[0].key;
    if(!result.movies.some((entry:any)=>entry.movie.outputs.some((output:any)=>output.key===outside)))assert.equal((await read('artifacts/'+outside)).status,404);}
   db.prepare('UPDATE pipeline_rights SET revoked_at=1').run();
   assert.equal((await read(route+'review-draft')).status,422);assert.equal((await read('artifacts/'+file)).status,422);
   db.prepare('UPDATE pipeline_rights SET revoked_at=NULL').run();db.prepare('UPDATE pipeline_operations SET generation=generation+1').run();
   assert.equal((await read(route+'review-draft')).status,422);assert.equal((await read('artifacts/'+file)).status,404);
   draftApi='private_draft_only_rights_and_generation_checked';
  }
  return{result,error,state,draftApi,models,networkCalls,studioCount,closedCount,choiceCount,activeStudio,progress,specRequests,validationFeedback,reviewRequests,
   reservations:Number(db.prepare('SELECT COUNT(*) AS n FROM cost_reservations').get().n),settlements:Number(db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n),modelStages:db.prepare("SELECT stage FROM cost_reservations WHERE kind='model'").all().map(row=>row.stage),
   renders:db.prepare('SELECT * FROM pipeline_renders').all(),outbox:db.prepare('SELECT * FROM pipeline_outbox').all(),modelBudget:await modelBudgetStatus(env),
   moduleSources:[...objects].filter(([key])=>key.endsWith('/scenes/product/index.js')).map(([,value])=>new TextDecoder().decode(value.bytes)),
   requestFailures:[...objects].filter(([key])=>key.endsWith('-request-failure.json')).map(([,value])=>parseCanonicalJson(value.bytes))};
 }finally{Date.now=originalDate;globalThis.fetch=originalFetch;specModel.capabilities.verified=originalVerified;providers.steps.spec=originalSpec;db.close();}
}

test('A-C/E/F replay both SSE adapters, three real-protocol still requests and user wait exclusion',async()=>{
 for(const nativeProtocol of [false,true]){
 const r=await fixture({nativeProtocol});assert.ifError(r.error);assert.equal(r.state.status,'succeeded');assert.equal(r.result.publicUseCleared,false);assert.equal(r.result.ownerNormalSpeedReview,'pending');
 assert.deepEqual(r.models,['facts','assets','directions','spec','review','coldReview']);assert.equal(r.reservations,6);assert.equal(r.settlements,6);
 assert.equal(r.choiceCount,1);assert.equal(r.studioCount,5);assert.equal(r.closedCount,5);assert.equal(r.activeStudio,null);assert.equal(r.renders.length,3);
 }
});
test('completed structured output with an extra null field gets one charged correction, never stripping or transport retry',async()=>{
 for(const invalidStage of ['facts','assets','directions','coldReview']){
  const fixed=await fixture({invalidStage});assert.ifError(fixed.error);assert.equal(fixed.models.filter(stage=>stage===invalidStage).length,2);assert.equal(fixed.reservations,7);assert.equal(fixed.settlements,7);
  if(invalidStage==='assets')assert.equal(new Set(fixed.modelStages.filter(stage=>stage.startsWith('assets:'))).size,1);
 }
 const blocked=await fixture({invalidStage:'facts',alwaysInvalidStage:true});assert.equal(blocked.error.message,'FACT_ANALYSIS_INVALID');assert.deepEqual(blocked.models,['facts','facts']);assert.equal(blocked.settlements,2);assert.equal(blocked.renders.length,0);
 const noColdCalls=await fixture({invalidStage:'coldReview',coldBlock:true});assert.ifError(noColdCalls.error);assert.equal(noColdCalls.result.reason,'COLD_REVIEW_BLOCK');assert.equal(noColdCalls.specRequests,1);assert.equal(noColdCalls.models.filter(stage=>stage==='coldReview').length,2);
 const unknown=await fixture({transportFailure:true});assert.equal(unknown.error.message,'MOCK_TRANSPORT_FAILURE');assert.equal(unknown.networkCalls,1);assert.equal(unknown.settlements,0);
});
test('actual page generator gates all direction films and spec before studio/render, preserving the supported S1 subset',async()=>{
 const directions=await fixture({unsupportedDirections:true});assert.ifError(directions.error);assert.equal(directions.models.filter(stage=>stage==='directions').length,2);assert.equal(directions.studioCount,5);
 const spec=await fixture({unsupportedSpec:true});assert.ifError(spec.error);assert.equal(spec.specRequests,2);assert.equal(spec.validationFeedback[0].code,'FILM_RUNTIME_UNSUPPORTED');assert.equal(spec.validationFeedback[0].issues[0].code,'TEXTURE_NOT_IMPLEMENTED');assert.equal(spec.renders.length,3);
});
test('compact direction cards materialize three real-protocol trusted heroes without model-written FilmSpecs',async()=>{
 for(const nativeProtocol of [false,true]){
  const r=await fixture({compactDirections:true,nativeProtocol});assert.ifError(r.error);assert.equal(r.studioCount,5);assert.equal(r.choiceCount,1);assert.equal(r.models.filter(stage=>stage==='directions').length,1);assert.equal(r.result.final.length,2);
 }
});
test('review repairs the spec once and regenerates review before final/cold review',async()=>{
 const r=await fixture({repair:true});assert.ifError(r.error);assert.equal(r.models.filter(stage=>stage==='review').length,2);assert.equal(r.renders.length,4);assert.match(r.result.film.texts.headline.text,/worth watching/);
 assert.deepEqual(r.reviewRequests[0].repairContext,{previousFilms:[],internalRepairs:0,limit:2});
 assert.equal(r.reviewRequests[1].repairContext.internalRepairs,1);assert.equal(r.reviewRequests[1].repairContext.previousFilms.length,1);
 assert.equal(r.reviewRequests[1].repairContext.previousFilms[0].texts.headline.text,filmFixture().texts.headline.text);
 assert.match(r.reviewRequests[1].film.texts.headline.text,/worth watching/);
});
test('cold-review rejection retains a private unapproved draft, never a passed candidate',async()=>{const r=await fixture({coldBlock:true});assert.ifError(r.error);assert.equal(r.result.reason,'COLD_REVIEW_BLOCK');assert.equal(r.state.status,'failed');assert.match(r.state.result_key,/review-draft.json$/);assert.equal(r.result.coldReviewStatus,'blocked');assert.equal(r.result.cold.verdict,'block');assert.equal(r.result.acceptanceStatus,'unapproved');assert.equal(r.result.movies.length,2);assert.equal(r.activeStudio,null);});
test('relay evidence travels separately to E and F without shrinking all-aspect reading sheets or increasing stage budgets',async()=>{
 const r=await fixture({motionSamples:true});assert.ifError(r.error);assert.equal(r.state.status,'succeeded');assert.equal(r.result.cold.verdict,'pass');
});
test('cold-review correction rerenders every aspect, re-reviews and shares the two internal repairs with E',async()=>{
 const good=await fixture({fixableCold:true,repair:true});assert.ifError(good.error);assert.equal(good.result.internalRepairs,2);assert.equal(good.specRequests,2);
 assert.equal(good.models.filter(stage=>stage==='coldReview').length,2);assert.equal(good.renders.filter((row:any)=>row.id===good.result.final[0].renderId).length,1);
 assert.match(good.result.film.texts.headline.text,/worth watching/);assert.equal(good.renders.length,7);assert.equal(good.reservations,good.settlements);
 assert.deepEqual(good.reviewRequests.at(-1).repairContext,{previousFilms:[],internalRepairs:2,limit:2},'cold repair starts a new E history but retains the shared allowance');
 const spent=await fixture({twoReviewRepairs:true,coldBlock:true});assert.ifError(spent.error);assert.equal(spent.result.reason,'COLD_REVIEW_BLOCK');assert.equal(spent.specRequests,1);assert.equal(spent.models.filter(stage=>stage==='coldReview').length,1);assert.equal(spent.models.filter(stage=>stage==='review').length,3);
});
test('missing later key, unverified integration and missing rights stop before any model request',async()=>{
 for(const [options,code]of [[{missingKey:true},'MODEL_SECRET_MISSING'],[{unverified:true},'MODEL_INTEGRATION_UNVERIFIED'],[{noRights:true},'ASSET_RIGHTS_PENDING']] as const){
  const r=await fixture(options);assert.equal(r.error.message,code);assert.equal(r.networkCalls,0);assert.equal(r.reservations,0);assert.equal(r.state.status,'failed');}
});
test('unknown transport spend remains reserved and is not silently retried or settled as zero',async()=>{const r=await fixture({transportFailure:true});assert.equal(r.error.message,'MOCK_TRANSPORT_FAILURE');assert.equal(r.networkCalls,1);assert.equal(r.reservations,1);assert.equal(r.settlements,0);});
test('spec validation repairs completed output only, preserves charges and stops after two corrections',async()=>{
 const fixed=await fixture({fixableSpec:true});assert.ifError(fixed.error);assert.equal(fixed.specRequests,2);assert.equal(fixed.settlements,7);assert.equal(fixed.renders.length,3);
 assert.equal(fixed.validationFeedback[0].code,'FILM_SEMANTICS_INVALID');assert.ok(fixed.validationFeedback[0].issues.some((issue:any)=>issue.path==='/scenes/1/start'));
 const json=await fixture({malformedSpec:true});assert.ifError(json.error);assert.equal(json.specRequests,2);assert.equal(json.validationFeedback[0].code,'MODEL_OUTPUT_JSON_INVALID');
 assert.deepEqual(json.validationFeedback[0].previousOutput,{text:'{',toolCalls:[]});assert.equal(json.settlements,7);
 const bad=await fixture({badSpec:true});assert.match(bad.error.message,/FILM_SEMANTICS_INVALID/);
 assert.equal(bad.specRequests,2,'an identical correction reuses its already-settled invalid response');
 assert.equal(bad.renders.length,0);assert.equal(bad.settlements,5);assert.match(bad.state.result_key,/failure.json$/);
 const unknown=await fixture({specTransportFailure:true});assert.equal(unknown.error.message,'MOCK_SPEC_TRANSPORT_FAILURE');assert.equal(unknown.specRequests,1);assert.equal(unknown.reservations,4);assert.equal(unknown.settlements,3);assert.equal(unknown.modelBudget.pending.length,1);assert.equal(unknown.renders.length,0);
});
test('cancellation fences the next paid stage and preserves the cancelled status',async()=>{const r=await fixture({cancel:true});assert.equal(r.error.message,'OPERATION_FENCED');assert.equal(r.state.status,'cancelled');assert.deepEqual(r.models,['facts','assets','directions']);assert.equal(r.activeStudio,null);});

test('provider HTTP failures retain only status and unknown liability without retry or settlement',async()=>{
 const r=await fixture({httpFailure:true});assert.equal(r.error.message,'MODEL_REQUEST_FAILED');assert.equal(r.networkCalls,1);
 assert.equal(r.reservations,1);assert.equal(r.settlements,0);assert.equal(r.modelBudget.pending.length,1);assert.equal(r.renders.length,0);
 assert.equal(r.requestFailures.length,1);assert.equal(r.requestFailures[0].httpStatus,503);assert.equal(r.requestFailures[0].usageStatus,'unknown');
 assert.equal(r.requestFailures[0].callId,'mock-operation-facts');assert.doesNotMatch(canonical(r.requestFailures),/sensitive|fixture-not-a-secret/);
});

test('admitted ABC follows the actual director-to-render path; missing independent approval spends nothing',async()=>{
 const good=await fixture({audio:true,noticeFailure:true});assert.ifError(good.error);assert.equal(good.state.status,'succeeded');assert.equal(good.renders.length,3);
 assert.ok(good.outbox.some((row:any)=>row.kind==='operation_progress'&&parseCanonicalJson(row.payload_json).status==='succeeded'));
 const bad=await fixture({audio:true,missingApproval:true});assert.equal(bad.error.message,'SCORE_APPROVAL_REQUIRED');assert.equal(bad.networkCalls,0);assert.equal(bad.reservations,0);
});
test('director preparation/cleanup preserve the first cause, and internal repairs stop at two',async()=>{
 const missing=await fixture({missingContext:true,cleanupFailure:true});assert.equal(missing.error.message,'DIRECTOR_CONTEXT_MISSING');assert.equal(missing.state.status,'failed');
 assert.equal(parseCanonicalJson(missing.outbox.find((row:any)=>row.kind==='operation_failure').payload_json).code,'DIRECTOR_CONTEXT_MISSING');
 const limit=await fixture({alwaysRepair:true});assert.ifError(limit.error);assert.equal(limit.result.reason,'DIRECTOR_REPAIR_LIMIT');assert.equal(limit.state.status,'failed');
 assert.equal(limit.models.filter(stage=>stage==='review').length,3);assert.equal(limit.renders.length,3);assert.equal(limit.models.includes('coldReview'),false);
 assert.equal(limit.reviewRequests.at(-1).repairContext.internalRepairs,2);assert.equal(limit.reviewRequests.at(-1).repairContext.previousFilms.length,2);
 assert.deepEqual(limit.result.film,limit.reviewRequests.at(-1).film);assert.equal(limit.result.unappliedSuggestion.texts.headline.text,'An unapplied third suggestion.');
 assert.equal(limit.result.coldReviewStatus,'not_run');assert.equal(limit.result.acceptanceStatus,'unapproved');assert.equal(limit.result.publicUseCleared,false);
 assert.equal(limit.result.movies.length,1);assert.equal(limit.result.movies[0].quality,'review');assert.equal(limit.draftApi,'private_draft_only_rights_and_generation_checked');
 assert.equal(limit.reservations,limit.settlements);assert.equal(limit.activeStudio,null);
 const cancelled=await fixture({alwaysRepair:true,cancelHandoff:true});assert.equal(cancelled.error.message,'OPERATION_FENCED');assert.equal(cancelled.state.status,'cancelled');assert.equal(cancelled.result,undefined);
});
test('environment preflight is refreshed after user wait, and a broken renderer spends no model tokens',async()=>{
 const good=await fixture();assert.ifError(good.error);assert.equal(good.studioCount,5);assert.equal(good.closedCount,5);assert.equal(good.reservations,6);
 const bad=await fixture({healthFailure:true,cleanupFailure:true});assert.equal(bad.error.message,'MOCK_RENDER_UNAVAILABLE');assert.equal(bad.networkCalls,0);assert.equal(bad.reservations,0);assert.equal(bad.state.status,'failed');
 const oversized=await fixture({oversizedResource:true});assert.equal(oversized.error.message,'DIRECTOR_MATERIAL_NORMALIZATION_REQUIRED');assert.equal(oversized.networkCalls,0);assert.equal(oversized.reservations,0);assert.equal(oversized.studioCount,0);
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

// These are transport/control-flow checks; pixel quality and isolation are exercised in the container.
test('custom D source is scoped and metered, checked in both aspects before review, and E edits rerender without another D call',async()=>{
 const r=await fixture({customScene:true,customSourceRepair:true});assert.ifError(r.error);assert.equal(r.state.status,'succeeded');
 assert.equal(r.models.filter(stage=>stage==='scenes').length,1);assert.ok(r.modelStages.includes('scenes:product'));
 assert.equal(r.result.sceneModules.length,1);assert.match(r.result.sceneProofKey,/custom-check/);assert.equal(r.result.directingMethod.version,'1.1.0');
 assert.equal(r.result.internalRepairs,1);assert.equal(r.models.filter(stage=>stage==='review').length,2);assert.ok(r.moduleSources.some(source=>source.includes('power3.out')));
 assert.equal(r.reservations,r.settlements);assert.equal(r.activeStudio,null);
 const corrected=await fixture({customScene:true,fixableCustomPath:true});assert.ifError(corrected.error);assert.equal(corrected.models.filter(stage=>stage==='scenes').length,2);assert.equal(corrected.reservations,corrected.settlements);
 const bad=await fixture({customScene:true,badCustom:true});assert.equal(bad.error.message,'CUSTOM_SOURCE_INVALID');assert.equal(bad.renders.length,0);assert.equal(bad.reservations,bad.settlements);
 const unhealthy=await fixture({customScene:true,healthFailure:true});assert.equal(unhealthy.networkCalls,0);assert.equal(unhealthy.reservations,0);
});
