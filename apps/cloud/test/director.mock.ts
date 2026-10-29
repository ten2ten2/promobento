// Full S1 A-C/E/F control flow, not pixel quality, CF isolation, model capability or performance evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {OperationWorkflow,directorActiveLimitMs} from '../src/director.ts';
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
import policy from '../../../config/agent-policy.json';
import platform from '../../../config/platform-presets.json';
import {importModelOpening,confirmModelOpening,modelAuthorizationId,modelBudgetStatus} from '../src/model-budget.ts';

const png=pngRgba(1,1,Uint8Array.from([40,80,120,255]));
const clone=structuredClone;
async function fixture({repair=false,alwaysRepair=false,coldBlock=false,missingKey=false,noRights=false,transportFailure=false,badSpec=false,unverified=false,cancel=false,cancelHandoff=false,
 audio=false,missingApproval=false,missingContext=false,noticeFailure=false,cleanupFailure=false,healthFailure=false,oversizedResource=false,unconfirmedHistory=false,httpFailure=false,networkStreamFailure=false,
 nativeProtocol=false,fixableSpec=false,malformedSpec=false,specTransportFailure=false,fixableCold=false,twoReviewRepairs=false,invalidStage='',alwaysInvalidStage=false,unsupportedDirections=false,unsupportedSpec=false,compactDirections=false,motionSamples=false,motionAudit=false,customScene=false,reviewToCustom=false,twoCustom=false,frozenMethodVersion='',methodWithoutCustom=false,relaySpec=false,relayBehavior='return-to-source',returnRelayRepair=false,omitRelayBehavior=false,oldRelayRenderer=false,oldScopedRelayRenderer=false,badCustom=false,customSourceRepair=false,fixableCustomPath=false,fixableCustomAsset=false,emptyCustomMotion=false,textOnlyScenes=false,scene502=false,sceneInputMode='',customSeekFailure='',customSeekOverlap=false,customQaFailure=false,legacyCustomMethod=false,legacyHoldMetadata=false,customTextMissing=false,customTextWrongScene=false,fixableFrameFailure=false,unchangedFrameRepair=false,repairTransportFailure=false,omitHoldPlanFirst=false,failCustomClose=false,oldScopedObservation=false,oldAssetObservation=false,customAssetMissing=false,customAssetWrongScene=false,invalidAssetPlanFirst=false,noAssetPlan=false,unsafeCtaFirst=false}={}){
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
 let clock=Date.parse('2026-10-24T00:00:00Z'),activeStudio:any=null,studioCount=0,closedCount=0,choiceCount=0,networkCalls=0,models:string[]=[],progress:string[]=[],reviewRequests:any[]=[],frameRepairs=0;const trace:string[]=[];
 const healthCache=new Map<string,string>();
 const studioFrames=new Map<number,number>();
 const originalDate=Date.now,originalFetch=globalThis.fetch,originalSpec=providers.steps.spec,originalScenes=providers.steps.scenes,originalSceneMode=policy.director.steps.scenes.inputMode,originalSceneEffort=policy.director.steps.scenes.effort;
 if(!textOnlyScenes){providers.steps.scenes='modelswitch/deepseek-v4.1-flash-1017';policy.director.steps.scenes.inputMode='images';policy.director.steps.scenes.effort='none';}
 if(sceneInputMode)policy.director.steps.scenes.inputMode=sceneInputMode;
 // Exercise the native Messages transport at C; F keeps the actual independent DeepSeek binding.
 if(nativeProtocol)providers.steps.spec='anthropic/claude-opus-5-5';
 const specModel=(providers.models as any)[providers.steps.spec],originalVerified=specModel.capabilities.verified;
 Date.now=()=>clock;
 if(unverified)specModel.capabilities.verified=false;
 const spec=filmFixture(),keyframeFilm=clone(spec),options=pageOptions('landscape',platform.aspectLayouts.landscape);
 if(relaySpec)spec.scenes[1]={...spec.scenes[1],block:'component-relay@1',params:{textSlot:'product',focus:'roi:0',...(!omitRelayBehavior?{componentBehavior:relayBehavior}:{}),beatFrames:18,items:[{assetKey:'dashboard'},{assetKey:'dashboard'}]}};
 if(audio)spec.audio={music:{kind:'score',scoreRef:'audio/original.abc'},sfx:[],captions:'off',mute:false};
 if(customScene)spec.scenes[1]={id:'product',kind:'custom',module:'scenes/product/index.js',start:120,end:336,purpose:'Original custom workflow.',brief:'Preserve one subject through a changing composition.',transitionIn:{type:'push',frames:6},
  params:{hardest:true,textSlots:['product'],assetKeys:['dashboard'],events:[{name:'product-land',frame:21}],readingHolds:[{start:45,end:200,...(!legacyCustomMethod?{visibleTextSlots:['product']}:legacyHoldMetadata?{visibleTextSlots:'legacy-unused-metadata'}:{})}]}};
 if(twoCustom)spec.scenes[2]={id:'cta',kind:'custom',module:'scenes/cta/index.js',start:330,end:450,purpose:'Hold the call to action.',brief:'A readable fictional closing.',transitionIn:{type:'crossfade',frames:6},
  params:{textSlots:['cta'],assetKeys:[],events:[{name:'cta-land',frame:20}],readingHolds:[{start:30,end:110,visibleTextSlots:['cta']}]}};
 const modern=(customScene||methodWithoutCustom)&&!legacyCustomMethod&&(!frozenMethodVersion||Number(frozenMethodVersion.split('.')[0])>1||Number(frozenMethodVersion.split('.')[1])>=6);
 if(modern){spec.scenes[2].transitionIn.type='fade-through';if(customScene&&!noAssetPlan)spec.scenes[1].params.assetChecks=[{frame:70,assetKeys:['dashboard']}];}
 const fixtureSource='PB.scene("product",ctx=>{const panel=document.createElement("div");ctx.root.append(panel);ctx.text("product").mount(panel);const image=document.createElement("img");image.src=ctx.asset("dashboard").url;panel.append(image);const timeline=gsap.timeline({paused:true});timeline.to(panel,{duration:7.2,opacity:1,ease:"power2.out"});return {timeline};});';
 const authoredScene=reviewToCustom?clone(spec.scenes[1]):null;
 if(reviewToCustom)spec.scenes[1]=filmFixture().scenes[1];
 const fixed=clone(spec);fixed.texts.headline.text='Make your next launch\nworth watching.';
 if(authoredScene)fixed.scenes[1]=authoredScene;
 if(returnRelayRepair)fixed.scenes[1].params.componentBehavior='return-to-source';
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
    const filmBlob=task.inputs?.find((blob:any)=>blob.name==='film');
    if(filmBlob&&task.taskId.startsWith('health-')){
      const film=parseCanonicalJson(objects.get(filmBlob.key).bytes);
      if(film.scenes.some((scene:any)=>scene.block==='component-relay@1')){trace.push('relay-preflight');if(oldRelayRenderer)throw Error('MOCK_RELAY_UNAVAILABLE');
       if(oldScopedRelayRenderer&&film.scenes.some((scene:any)=>scene.params?.componentBehavior))throw Error('MOCK_SCOPED_RELAY_UNAVAILABLE');}
    }
    if(task.inputs?.some((blob:any)=>blob.key.includes('/custom-probe/')))trace.push('probe-studio');
    assertRenderTask({...input,brokerToken:'fixture-non-secret-token'});activeStudio=task;studioFrames.clear();studioCount++;return canonical({status:'ready'});},
   async checkFrame(_id:string,frame:number){const health=activeStudio.taskId.startsWith('health-'),visible=health||activeStudio.taskId.startsWith('custom-')&&(!customTextMissing||fixableFrameFailure&&frameRepairs>0);
    const sceneId=health?'health':twoCustom&&frame>=336?'cta':'product',slotId=health?'headline':sceneId;
    const texts=visible?[{slotId,...(!(health&&oldScopedObservation)?{sceneId:health?'health':customTextWrongScene?'other':sceneId}:{}),text:health?'Render health check':spec.texts[slotId].text,box:{x:10,y:10,width:100,height:40},fonts:[{family:'fixture',glyphCount:5}],fallbackUsed:false,missingGlyphs:0,contrastRatio:5,insideSafeArea:true,clipped:false,covered:false}]:[];
    const assetId=health?activeStudio.options.resources[0]?.resourceId:options.resources[0].resourceId;
    const assets=activeStudio.options.observeAssets&&!oldAssetObservation?[{sceneId:health?'health':customAssetWrongScene?'other':'product',resourceId:assetId,visibility:!health&&customAssetMissing?'hidden':'visible'}]:undefined;
    return Response.json({frameIndex:frame,observation:{schemaVersion:'3.0.0',kind:'frame_observation',renderId:activeStudio.job.renderId,aspectId:activeStudio.job.aspectId,frame,texts,regions:[],findings:customQaFailure&&activeStudio.taskId.startsWith('custom-')&&(!fixableFrameFailure||frameRepairs===0)?[{code:'text-clipped',severity:'BLOCK',slotId:'product'}]:[],...(assets?{assets}:{})}});},
   async frame(_id:string,frame:number){assert.ok(activeStudio.job.frames.includes(frame));const visits=(studioFrames.get(frame)??0)+1;studioFrames.set(frame,visits);
    const mismatch=activeStudio.taskId.startsWith('custom-')&&(!fixableFrameFailure||frameRepairs===0)&&(customSeekFailure==='cold'?activeStudio.taskId.endsWith('-cold'):customSeekFailure==='reverse'&&visits>1&&frame===(customSeekOverlap?335:242));
    return new Response(mismatch?pngRgba(1,1,Uint8Array.from([200,0,0,255])):png);},
   async closeStudio(){if(cleanupFailure||failCustomClose&&activeStudio?.taskId.startsWith('custom-'))throw Error('MOCK_CLEANUP_FAILURE');if(activeStudio)closedCount++;activeStudio=null;}
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
   const motionFrame={...frame,key:frame.key.replace('/observation-frames/45.png',`/motion-frames/${customScene?150:90}.png`)};
   if(motionSamples)objects.set(motionFrame.key,{bytes:png,customMetadata:{sha256:sha256Bytes(png)}});
   const fakeMovie=await immutableJson(env,`renders/${request.job.renderId}/mock/film.mp4`,{scope:'simulated_not_media_evidence'});
   const auditImage={...frame,key:`renders/${request.job.renderId}/mock/out/audit-frames/0-overview.jpg`};
   if(motionAudit&&request.job.quality==='review')objects.set(auditImage.key,{bytes:png,customMetadata:{sha256:sha256Bytes(png)}});
   const inspection={status:'available',fps:15,frameTimelineFps:30,omitted:1,sheets:[{path:'audit-frames/0-overview.jpg',kind:'low_motion',view:'overview',frames:[30,32,34,36,38,40]}]};
   const result={renderId:request.job.renderId,status:'passed',outputs:[fakeMovie,...(motionAudit&&request.job.quality==='review'?[auditImage]:[])],observationFrames:[frame],...(motionSamples?{motionFrames:[motionFrame]}:{}),media:{scope:'simulated_not_media_evidence',...(motionAudit&&request.job.quality==='review'?{motionAudit:{status:'measured',dead:[{from:1,to:3,seconds:2}],inspection}}:{})}};
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
 const method=customScene||methodWithoutCustom?await immutableJson(env,'operations/mock-operation/directing-method.json',legacyCustomMethod?{...directingMethodPack,version:'1.1.0'}:frozenMethodVersion?{...directingMethodPack,version:frozenMethodVersion}:directingMethodPack):null;
 await immutableJson(env,'evals/mock/context.json',context);if(!missingContext)db.prepare('INSERT INTO pipeline_contexts(operation_id,request_key,directing_method_key) VALUES(?,?,?)').run('mock-operation','evals/mock/context.json',method?.key??null);
 let reviewRound=0,specRequests=0,coldRequests=0;const validationFeedback:any[]=[],specInputs:any[]=[],directionInputs:any[]=[];
 globalThis.fetch=async(url:any,init:any)=>{
  // No native fetch fallback: any unexpected URL fails before network access.
  const target=String(url),body=parseCanonicalJson(init.body);networkCalls++;
  const provider=Object.values(providers.providers).find(provider=>target.startsWith(provider.baseUrl));assert.ok(provider,'unexpected mock provider URL');
  if(target.endsWith('/count_tokens'))return Response.json({input_tokens:100});
  if(transportFailure)throw Error('MOCK_TRANSPORT_FAILURE');
  if(httpFailure)return new Response('sensitive provider body must not be stored',{status:503});
  if(networkStreamFailure)return new Response(new ReadableStream({pull(controller){controller.error(Error('Network connection lost.'));}}));
  const user=provider.kind==='anthropic'?body.messages[0].content[0].text:typeof body.messages[1].content==='string'?body.messages[1].content:body.messages[1].content[0].text;
  const input=parseCanonicalJson(user);let stage:string,value:any;
  if(scene502&&input.task.startsWith('Implement')&&input.phase==='motion-0'&&body.model==='claude-opus-5-5'){
   trace.push('claude-scene-502');return new Response('data: '+canonical({error:{code:502,type:'service_error'}})+'\n\ndata: [DONE]\n\n');
  }
  if(input.task.startsWith('Organize')){stage='facts';assert.match(provider.kind==='anthropic'?body.system[0].text:body.messages[0].content,/fact_analysis/);value={schemaVersion:'3.0.0',kind:'fact_analysis',factIds:['fixture-cta'],summary:'Original fixture CTA.'};}
  else if(input.task.startsWith('Describe')){stage='assets';value={schemaVersion:'3.0.0',kind:'asset_insight',sha256:resource.sha256,promptVersion:'asset-insight-v1',model:providers.steps.assets,assetKind:'illustration',description:'Original fixture.',regions:relaySpec?[{label:'fixture detail',box:spec.assets.dashboard.roi[0]}]:[],dominantColors:[],visibleText:[],suitableBlocks:['ui-showcase']};}
  else if(input.task.startsWith('Propose')){stage='directions';directionInputs.push(input);value={schemaVersion:'3.0.0',kind:'direction_set',cards:['fit','amplify','unexpected'].map(key=>({key,language:'en',palette:[{color:'#101712',role:'bg',source:'fixture'},{color:'#f4f8ee',role:'ink',source:'fixture'}],logline:'Original mock direction.',feel:{route:'continuous',bpm:100,eventsPerBar:2},sound:'Silent fixture.',risk:'Fixture only.',usesDepth:key==='amplify',skeleton:spec.scenes.map(scene=>({purpose:scene.purpose,approach:scene.kind==='custom'?'custom':'block:'+scene.block.split('@')[0]})),keyframeFilm:clone(keyframeFilm)}))};}
  else if(input.task.startsWith('Write')){stage='spec';specRequests++;specInputs.push(input);assert.deepEqual(input.context,context);
   assert.match(input.mediaLayoutGuidance,/omit textSlot/);assert.match(input.mediaLayoutGuidance,/does not crop or magnify/);
   if(specTransportFailure)throw Error('MOCK_SPEC_TRANSPORT_FAILURE');
   if(specRequests>1&&!input.coldReviewFeedback){assert.ok(input.validationFeedback?.issues?.length);validationFeedback.push(input.validationFeedback);}
   if(input.coldReviewFeedback)assert.equal(input.coldReviewFeedback.review.verdict,'block');
   value=clone(input.coldReviewFeedback?coldFixed:spec);if(omitHoldPlanFirst&&specRequests===1)delete value.scenes[1].params.readingHolds[0].visibleTextSlots;
   if(invalidAssetPlanFirst&&specRequests===1)value.scenes[1].params.assetChecks=[{frame:70,assetKeys:['unknown']}];
   if(unsafeCtaFirst&&specRequests===1)value.scenes[2].transitionIn.type='crossfade';
   if(badSpec||fixableSpec&&specRequests===1)value.scenes[1].start=200;if(unsupportedSpec&&specRequests===1)value.style.texture={kind:'grain',amount:0.2};}
  else if(input.task.startsWith('Repair this custom')){stage='scenes';assert.equal(activeStudio,null,'the failed studio must close before another model call');frameRepairs++;
   assert.equal(input.scene.id,'product');assert.ok(['CUSTOM_HOLD_TEXT_MISSING','CUSTOM_SEEK_MISMATCH','CUSTOM_QA_BLOCK'].includes(input.validationFeedback.code));assert.ok(input.validationFeedback.frame>=120);
   assert.deepEqual(input.targetAspects.map((target:any)=>target.aspect),['landscape','portrait']);assert.equal(input.resources[0].resourceId,context.resources[0].resourceId);assert.equal(input.resources[0].sha256,resource.sha256);
   if(customTextMissing)assert.deepEqual(input.validationFeedback.expectation.missingTextSlots,['product']);
   if(textOnlyScenes){assert.equal(typeof body.messages[1].content,'string');assert.match(input.validationFeedback.frameImages,/No images attached/);assert.equal(input.assetObservations[0].sha256,resource.sha256);}
   else{assert.equal(body.messages[1].content.filter((part:any)=>part.type==='image_url').length,1);assert.match(input.validationFeedback.frameImages,/contact sheet/);}
   if(repairTransportFailure)throw Error('MOCK_REPAIR_TRANSPORT_FAILURE');
   value={toolCalls:[{id:'mock-frame-repair',name:'edit_file',arguments:'',input:{command:'str_replace',path:'scenes/product/index.js',oldStr:'/* tail authored */',newStr:unchangedFrameRepair?'/* tail authored */':'/* runtime repaired */'}}]};}
  else if(input.task.startsWith('Implement')){stage='scenes';const prompt=provider.kind==='anthropic'?body.system[0].text:body.messages[0].content;
   if(input.scene.id==='cta'){
    trace.push('author-cta');
    const source='PB.scene("cta",ctx=>{ctx.text("cta");const timeline=gsap.timeline({paused:true});timeline.to({},{duration:4});return {timeline};});';
    value={toolCalls:[{id:'mock-cta',name:'edit_file',arguments:'',input:input.phase==='layout'?{command:'create',path:'scenes/cta/index.js',fileText:source}:{command:'str_replace',path:'scenes/cta/index.js',oldStr:'return {timeline}',newStr:'/* '+input.phase+' */ return {timeline}'}}]};
   }else{
   const isFallback=scene502&&body.model==='deepseek-v4.1-flash-1017';if(isFallback)trace.push('deepseek-scene-fallback');
   assert.equal(body.reasoning_effort,textOnlyScenes&&!isFallback?'high':'none');if(textOnlyScenes&&!isFallback)assert.equal(body.tool_choice,undefined);else assert.deepEqual(body.tool_choice,{type:'function',function:{name:'edit_file'}});
   assert.doesNotMatch(prompt,/No custom JS/);assert.match(prompt,/sandboxed DOM\/SVG\/Canvas2D/);
   if(textOnlyScenes){assert.equal(typeof body.messages[1].content,'string');assert.equal(body.model,isFallback?'deepseek-v4.1-flash-1017':'claude-opus-5-5');assert.equal(input.assetObservations.length,input.resources.length);assert.equal(input.assetObservations[0].sha256,input.resources[0].sha256);assert.equal(input.assetObservations[0].resourceId,input.resources[0].resourceId);assert.equal(input.assetObservations[0].insight.description,'Original fixture.');assert.match(input.sourceImages,/no images are attached/i);}
   else assert.equal(body.messages[1].content.filter((part:any)=>part.type==='image_url').length,input.resources.length);assert.equal(input.resources.length,1);
   const params=body.tools[0].function.parameters;assert.equal(params.type,'object');assert.doesNotMatch(canonical(params),/\$ref/);
   if(input.phase==='layout'){
    assert.equal(body.max_tokens,16384);
    assert.equal(input.textLayoutRequirements.minimumFontSizeBySlot.product,36);assert.equal(input.textLayoutRequirements.initiallyHiddenSlotsAreFitted,true);assert.match(input.textLayoutRequirements.parentBox,/width AND height/);
    assert.match(input.literalAccessGuidance,/pic\(ctx.asset\("dashboard"\),parent\)/);
    assert.equal(params.properties.path.type,'string');assert.deepEqual(params.properties.path.enum,['scenes/product/index.js']);
    assert.equal(input.scene.brief,(authoredScene??spec.scenes[1]).brief);assert.match(input.phaseTask,/complete original brief/);assert.match(input.phaseTask,/Do not implement choreography/);
    if(fixableCustomPath&&models.includes(stage))assert.ok(input.validationFeedback.issues.some((issue:any)=>issue.code==='CUSTOM_EDIT_PATH_STRING_REQUIRED'&&issue.path==='/toolCalls/0/input/path'));
    if(fixableCustomAsset&&models.includes(stage)){const issue=input.validationFeedback.issues.find((issue:any)=>issue.code==='CUSTOM_SLOT_UNDECLARED');assert.match(issue.sourceLine,/ctx.asset\(key\)/);assert.match(issue.hint,/pic\(ctx.asset\("dashboard"\),parent\)/);}
    value={toolCalls:[{id:'mock-source',name:'edit_file',arguments:'',input:{command:'create',path:fixableCustomPath&&!models.includes(stage)?{module:'scenes/product/index.js'}:'scenes/product/index.js',fileText:(badCustom?fixtureSource.replace('const panel=', 'fetch(\"https://example.com\");const panel='):fixtureSource).replace('power2.out','power1.out')}}]};
    if(fixableCustomAsset&&!models.includes(stage))value.toolCalls[0].input.fileText=value.toolCalls[0].input.fileText.replace('image.src=ctx.asset("dashboard").url;','function load(key){return ctx.asset(key);}image.src=load("dashboard").url;');
   }else{
    assert.equal(body.max_tokens,32768);
    assert.match(input.phase,/^motion-\d+$/);assert.equal(input.scene.brief,(authoredScene??spec.scenes[1]).brief);assert.ok(input.phaseWindow.end>input.phaseWindow.start);assert.match(input.apiNotes,/never override/);assert.match(input.apiNotes,/inside safeInsets after transforms/);
    assert.deepEqual(params.oneOf.map((variant:any)=>variant.properties.command.const),['str_replace','insert']);
    assert.deepEqual(params.required,['command','path','newStr']);assert.deepEqual(params.properties.command.enum,['str_replace','insert']);assert.equal(params.properties.oldStr.type,'string');assert.equal(params.properties.insertLine.type,'integer');assert.equal(params.additionalProperties,false);
    const first=input.phase==='motion-0';assert.match(input.currentSource,first?/power1.out/:/power2.out/);
    assert.match(input.phaseTask,/one atomic edit, not one behavior/);assert.match(input.completionCheck,first?/every event and reading hold in this window/:/All specified content states and required credits must actually become visible/);
    if(first)assert.equal(input.phaseWindow.start,0);else assert.equal(input.phaseWindow.end,spec.scenes[1].end-spec.scenes[1].start);
    value={toolCalls:[{id:'mock-motion',name:'edit_file',arguments:'',input:{command:'str_replace',path:'scenes/product/index.js',oldStr:first?'power1.out':'return {timeline}',newStr:first?'power2.out':'/* tail authored */ return {timeline}'}}]};
    if(emptyCustomMotion&&input.phase==='motion-1'){if(!input.validationFeedback)value.toolCalls[0].input={};else assert.ok(input.validationFeedback.issues.some((issue:any)=>issue.code==='CUSTOM_EDIT_PATH_STRING_REQUIRED'));}
   }}}
  else if(input.task.startsWith('Review')){stage='review';assert.equal(input.frames.length,1);assert.equal(input.frames[0].tiles.length,1);
   if(customScene&&(!reviewToCustom||reviewRound>0)){const params=body.tools.find((entry:any)=>entry.function.name==='edit_file').function.parameters;assert.doesNotMatch(canonical(params),/\$ref/);assert.deepEqual(params.oneOf.map((variant:any)=>variant.properties.command.const),['str_replace','insert']);assert.deepEqual(params.required,['command','path','newStr']);assert.deepEqual(params.properties.command.enum,['str_replace','insert']);}
   const motionCount=motionSamples?(customScene&&!legacyCustomMethod?2:1):0;
   assert.equal(input.motionFrames.length,motionCount);assert.equal(body.messages[1].content.filter((part:any)=>part.type==='image_url').length,1+motionCount+(motionAudit?1:0));
   assert.match(input.mediaLayoutGuidance,/omit textSlot/);
   reviewRequests.push(input);
   const change=alwaysRepair||repair&&reviewRound===0||twoReviewRepairs&&reviewRound<2;reviewRound++;
   const suggestion=clone(fixed);if(alwaysRepair&&reviewRound===3)suggestion.texts.headline.text='An unapplied third suggestion.';
   value=customSourceRepair&&reviewRound===1?{toolCalls:[{id:'mock-source-edit',name:'edit_file',arguments:'',input:{command:'str_replace',path:'scenes/product/index.js',oldStr:'power2.out',newStr:'power3.out'}}]}:change?{toolCalls:[{id:'mock-fix',name:'write_spec',arguments:'',input:{film:suggestion}}]}:submitted;}
  else if(input.task.startsWith('Independently')){stage='coldReview';coldRequests++;assert.equal(body.max_tokens,16384);assert.deepEqual(body.tools.map((entry:any)=>entry.function.name),['submit_cold_review']);assert.deepEqual(body.tools[0].function.parameters,input.responseSchema);assert.deepEqual(input.frames.map((sheet:any)=>sheet.aspect),context.aspects);assert.ok(input.frames.every((sheet:any)=>sheet.tiles.length===1));
   const motionCount=motionSamples?(customScene&&!legacyCustomMethod?2:1):0;
   assert.match(body.tools[0].function.description,/complete cold_review/);assert.equal(input.motionFrames.length,motionCount);assert.equal(body.messages[1].content.filter((part:any)=>part.type==='image_url').length,2+motionCount);
   if(motionSamples){assert.deepEqual(input.motionFrames[0].tiles.map((tile:any)=>tile.frame),[customScene?150:90]);assert.equal(input.motionFrames[0].aspect,context.aspects[0]);
    assert.match(input.motionFrames[0].scope,customScene&&!legacyCustomMethod?/existing_motion_keyposes_not_full_motion_or_audio/:/choreography_arrivals_and_transitions_not_full_motion_or_audio/);
    if(customScene&&!legacyCustomMethod){assert.match(input.motionFrames[1].scope,/selected_custom_events_and_handoffs_not_full_motion_or_audio/);assert.ok(input.motionFrames[1].selection.missing.length);}}
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
   const result=await fn();if(legacyCustomMethod&&name.startsWith('check-custom-scenes-')){const value=parseCanonicalJson(result);assert.ok(value.sourceHash&&value.modules&&value.evidenceKey);assert.equal(value.checked,undefined,'preserve the existing durable payload shape');}return result;},async waitForEvent(){choiceCount++;assert.equal(activeStudio,null);
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
  return{result,error,state,draftApi,models,networkCalls,studioCount,closedCount,choiceCount,activeStudio,progress,specRequests,specInputs,directionInputs,validationFeedback,reviewRequests,frameRepairs,trace,
   reservations:Number(db.prepare('SELECT COUNT(*) AS n FROM cost_reservations').get().n),settlements:Number(db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n),modelStages:db.prepare("SELECT stage FROM cost_reservations WHERE kind='model'").all().map(row=>row.stage),
   renders:db.prepare('SELECT * FROM pipeline_renders').all(),outbox:db.prepare('SELECT * FROM pipeline_outbox').all(),modelBudget:await modelBudgetStatus(env),
   moduleSources:[...objects].filter(([key])=>key.endsWith('/scenes/product/index.js')).map(([,value])=>new TextDecoder().decode(value.bytes)),
   modelReceipts:[...objects].filter(([key])=>key.includes('/model-calls/')&&!key.endsWith('-request-failure.json')).map(([,value])=>parseCanonicalJson(value.bytes)),
   customFailures:[...objects].filter(([key])=>key.includes('/custom-check/')&&key.endsWith('/failure.json')).map(([,value])=>parseCanonicalJson(value.bytes)),
   customFailureImages:[...objects.keys()].filter(key=>/\/(\d+)-(reverse|cold)\.png$/.test(key)),
   requestFailures:[...objects].filter(([key])=>key.endsWith('-request-failure.json')).map(([,value])=>parseCanonicalJson(value.bytes))};
 }finally{Date.now=originalDate;globalThis.fetch=originalFetch;specModel.capabilities.verified=originalVerified;providers.steps.spec=originalSpec;providers.steps.scenes=originalScenes;policy.director.steps.scenes.inputMode=originalSceneMode;policy.director.steps.scenes.effort=originalSceneEffort;db.close();}
}

test('A-C/E/F replay both SSE adapters, three real-protocol still requests and user wait exclusion',async()=>{
 for(const nativeProtocol of [false,true]){
 const r=await fixture({nativeProtocol});assert.ifError(r.error);assert.equal(r.state.status,'succeeded');assert.equal(r.result.publicUseCleared,false);assert.equal(r.result.ownerNormalSpeedReview,'pending');
 assert.match(r.specInputs[0].task,/use trusted blocks/);assert.doesNotMatch(r.specInputs[0].task,/no custom scenes/i);
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
test('component relay reaches review only with observed geometry and a renderer capability probe',async()=>{
 const ready=await fixture({methodWithoutCustom:true,relaySpec:true});assert.ifError(ready.error);
 assert.equal(ready.state.status,'succeeded');assert.ok(ready.trace.includes('relay-preflight'));assert.equal(ready.activeStudio,null);
 const oldRenderer=await fixture({methodWithoutCustom:true,relaySpec:true,oldRelayRenderer:true});
 assert.equal(oldRenderer.error.message,'MOCK_RELAY_UNAVAILABLE');assert.equal(oldRenderer.renders.length,0);assert.ok(!oldRenderer.models.includes('review'));
 const oldScoped=await fixture({methodWithoutCustom:true,relaySpec:true,oldScopedRelayRenderer:true});
 assert.equal(oldScoped.error.message,'MOCK_SCOPED_RELAY_UNAVAILABLE');assert.equal(oldScoped.renders.length,0);assert.ok(!oldScoped.models.includes('review'));
 const oldMethod=await fixture({methodWithoutCustom:true,relaySpec:true,frozenMethodVersion:'1.6.0'});
 assert.equal(oldMethod.error.message,'FILM_SCHEMA_INVALID');assert.ok(!oldMethod.trace.includes('relay-preflight'));assert.equal(oldMethod.renders.length,0);
 const missing=await fixture({methodWithoutCustom:true,relaySpec:true,omitRelayBehavior:true});
 assert.equal(missing.error.message,'FILM_SEMANTICS_INVALID');assert.equal(missing.validationFeedback[0].issues[0].code,'RELAY_COMPONENT_BEHAVIOR_REQUIRED');assert.equal(missing.renders.length,0);
 const old=await fixture({methodWithoutCustom:true,relaySpec:true,omitRelayBehavior:true,frozenMethodVersion:'1.7.1',oldScopedRelayRenderer:true});assert.ifError(old.error);assert.equal(old.state.status,'succeeded');
});
test('review can switch an unnecessary carried component back to its source and rerender',async()=>{
 const r=await fixture({methodWithoutCustom:true,relaySpec:true,relayBehavior:'carry',returnRelayRepair:true,repair:true});
 assert.ifError(r.error);assert.equal(r.state.status,'succeeded');assert.equal(r.result.internalRepairs,1);
 assert.equal(r.result.film.scenes[1].params.componentBehavior,'return-to-source');
 assert.equal(r.models.filter(stage=>stage==='review').length,2);assert.equal(r.renders.length,4);
});
test('authored directions permit custom shots and review can replace a fixed block with one',async()=>{
 const r=await fixture({customScene:true,reviewToCustom:true,repair:true});assert.ifError(r.error);
 assert.match(r.directionInputs[0].task,/skeleton may propose a custom scene/);
 assert.match(r.specInputs[0].task,/use custom scenes when/);assert.doesNotMatch(r.specInputs[0].task,/no custom scenes/i);
 assert.match(r.reviewRequests[0].customSceneRepair,/replace the affected scene with custom/);
 assert.equal(r.result.film.scenes[1].kind,'custom');assert.equal(r.result.internalRepairs,1);
 assert.ok(r.models.includes('scenes'));assert.equal(r.models.filter(stage=>stage==='review').length,2);
 assert.equal(r.renders.length,4);assert.equal(r.result.sceneModules.length,1);assert.equal(r.activeStudio,null);
 const legacy=await fixture({methodWithoutCustom:true,frozenMethodVersion:'1.8.0'});assert.ifError(legacy.error);
 assert.match(legacy.specInputs[0].task,/choose blocks or sandboxed custom scenes/);assert.equal(legacy.reviewRequests[0].customSceneRepair,undefined);
 assert.doesNotMatch(legacy.directionInputs[0].task,/no custom scenes/i);
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
test('low-resolution motion cues reach E with their limits, while older render reports remain usable',async()=>{
 const measured=await fixture({motionAudit:true});assert.ifError(measured.error);
 assert.deepEqual(measured.reviewRequests[0].media.motionAudit.dead,[{from:1,to:3,seconds:2}]);
 assert.deepEqual(measured.reviewRequests[0].auditFrames[0].frames,[30,32,34,36,38,40]);assert.equal(measured.reviewRequests[0].media.motionAudit.inspection.omitted,1);
 assert.match(measured.reviewRequests[0].motionAuditGuidance,/Small UI or pointer motion may be missed/);
 assert.match(measured.reviewRequests[0].motionAuditGuidance,/not an observed defect/);
 const old=await fixture();assert.ifError(old.error);assert.equal(old.reviewRequests[0].motionAuditGuidance,undefined);
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
test('network stream loss reports its transport cause and retains the unknown reservation',async()=>{
 const r=await fixture({networkStreamFailure:true});assert.equal(r.error.message,'MODEL_TRANSPORT_FAILED');assert.equal(r.state.status,'failed');
 assert.equal(parseCanonicalJson(r.outbox.find((row:any)=>row.kind==='operation_failure').payload_json).code,'MODEL_TRANSPORT_FAILED');
 assert.equal(r.networkCalls,1);assert.equal(r.reservations,1);assert.equal(r.settlements,0);assert.equal(r.modelBudget.pending.length,1);
 assert.equal(r.requestFailures[0].code,'MODEL_TRANSPORT_FAILED');assert.equal(r.requestFailures[0].usageStatus,'unknown');
});
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

test('30-minute active limit is restricted to newly frozen internal custom evaluations',()=>{
 const input={environment:'staging',purpose:'evaluation',scope:'internal_eval_only',method:directingMethodPack,hasCustom:true};
 assert.equal(directorActiveLimitMs(input),1800000);
 for(const patch of [{environment:'production'},{purpose:'calibration'},{scope:'customer'},{hasCustom:false},{method:null},
  {method:{...directingMethodPack,version:'1.4.0'}}])assert.equal(directorActiveLimitMs({...input,...patch}),1200000);
});

// These are transport/control-flow checks; pixel quality and isolation are exercised in the container.
test('scene 502 fallback continues the real director workflow with the original unknown reservation',async()=>{
 const r=await fixture({customScene:true,textOnlyScenes:true,scene502:true});assert.ifError(r.error);assert.equal(r.state.status,'succeeded');
 assert.ok(r.trace.includes('claude-scene-502'));assert.ok(r.trace.includes('deepseek-scene-fallback'));
 assert.equal(r.modelBudget.pending.length,1);assert.equal(r.reservations,r.settlements+1);
 assert.ok(r.modelReceipts.some((receipt:any)=>receipt.model==='modelswitch/claude-opus-5-5'&&receipt.result.upstreamStatus===502));
 assert.ok(r.modelReceipts.some((receipt:any)=>receipt.model==='modelswitch/deepseek-v4.1-flash-1017'&&receipt.callId.endsWith('-deepseek-502')));
 assert.match(r.result.sceneProofKey,/custom-check/);assert.ok(r.models.includes('review'));assert.ok(r.models.includes('coldReview'));
});
test('custom D source is scoped and metered, checked in both aspects before review, and E edits rerender without another D call',async()=>{
 const r=await fixture({customScene:true,customSourceRepair:true});assert.ifError(r.error);assert.equal(r.state.status,'succeeded');
 assert.equal(r.models.filter(stage=>stage==='scenes').length,3);assert.ok(r.modelStages.includes('scenes:product'));
 assert.ok(r.modelReceipts.filter((receipt:any)=>receipt.callId.includes('-scene-')).every((receipt:any)=>receipt.requestSettings.effort==='none'&&receipt.requestSettings.toolChoice==='edit_file'));
 assert.equal(r.result.sceneModules.length,1);assert.match(r.result.sceneProofKey,/custom-check/);assert.equal(r.result.directingMethod.version,directingMethodPack.version);
 assert.equal(r.result.internalRepairs,1);assert.equal(r.models.filter(stage=>stage==='review').length,2);assert.ok(r.moduleSources.some(source=>source.includes('power3.out')));
 assert.equal(r.reservations,r.settlements);assert.equal(r.activeStudio,null);
 const corrected=await fixture({customScene:true,fixableCustomPath:true});assert.ifError(corrected.error);assert.equal(corrected.models.filter(stage=>stage==='scenes').length,4);assert.equal(corrected.reservations,corrected.settlements);
 const literal=await fixture({customScene:true,fixableCustomAsset:true});assert.ifError(literal.error);assert.equal(literal.models.filter(stage=>stage==='scenes').length,4);assert.equal(literal.reservations,literal.settlements);
 const empty=await fixture({customScene:true,emptyCustomMotion:true});assert.ifError(empty.error);assert.equal(empty.models.filter(stage=>stage==='scenes').length,4);assert.equal(empty.reservations,empty.settlements);
 const textOnly=await fixture({customScene:true,textOnlyScenes:true});assert.ifError(textOnly.error);assert.equal(textOnly.state.status,'succeeded');assert.ok(textOnly.modelReceipts.filter((receipt:any)=>receipt.callId.includes('-scene-')).every((receipt:any)=>receipt.model==='modelswitch/claude-opus-5-5'&&receipt.requestSettings.toolChoice===null&&receipt.requestSettings.effort==='high'));assert.equal(textOnly.reservations,textOnly.settlements);
 const mode=await fixture({customScene:true,textOnlyScenes:true,sceneInputMode:'automatic-fallback'});assert.equal(mode.error.message,'MODEL_SCENE_INPUT_MODE_INVALID');assert.equal(mode.networkCalls,0);
 const vision=await fixture({customScene:true,textOnlyScenes:true,sceneInputMode:'images'});assert.equal(vision.error.message,'MODEL_VISION_UNAVAILABLE');assert.equal(vision.networkCalls,0);
 const bad=await fixture({customScene:true,badCustom:true});assert.equal(bad.error.message,'CUSTOM_SOURCE_INVALID');assert.equal(bad.renders.length,0);assert.equal(bad.reservations,bad.settlements);
 const unhealthy=await fixture({customScene:true,healthFailure:true});assert.equal(unhealthy.networkCalls,0);assert.equal(unhealthy.reservations,0);
 const legacy=await fixture({customScene:true,legacyCustomMethod:true,legacyHoldMetadata:true});assert.ifError(legacy.error);assert.equal(legacy.result.directingMethod.version,'1.1.0');
});

test('custom preflight retains failed seek pixels and blocking observations before stopping review',async()=>{
 for(const mode of ['reverse','cold']){
  const r=await fixture({customScene:true,legacyCustomMethod:true,customSeekFailure:mode});assert.equal(r.error.message,'CUSTOM_SEEK_MISMATCH');assert.equal(r.state.status,'failed');assert.equal(r.activeStudio,null);assert.equal(r.renders.length,0);assert.ok(!r.models.includes('review'));
  assert.equal(r.customFailures.length,1);const failure=r.customFailures[0];assert.equal(failure.phase,mode);assert.equal(failure.sceneId,'product');assert.equal(failure.aspect,'landscape');assert.equal(failure.modules.length,1);assert.ok(failure.observations.length);
  const mismatch=failure.comparisons.at(-1);assert.equal(mismatch.mode,mode);assert.equal(mismatch.verdict,'RENDER_SEAM_BLOCK');assert.equal(failure.frame,mismatch.frame);assert.equal(mismatch.maxChannelDiff,160);assert.ok(r.customFailureImages.includes(mismatch.actual.key));assert.ok(failure.images.some((image:any)=>image.frame===mismatch.frame));
 }
 const blocked=await fixture({customScene:true,legacyCustomMethod:true,customQaFailure:true});assert.equal(blocked.error.message,'CUSTOM_QA_BLOCK');assert.equal(blocked.activeStudio,null);assert.equal(blocked.renders.length,0);
 assert.equal(blocked.customFailures[0].phase,'forward');assert.equal(blocked.customFailures[0].observations[0].findings[0].code,'text-clipped');assert.equal(blocked.customFailureImages.length,0);
 assert.ok(!blocked.customFailures[0].images.some((image:any)=>image.frame===blocked.customFailures[0].frame),'legacy Q1 stop does not request another frame');
});

test('new custom method repairs one observed scene failure within the original budget',async()=>{
 for(const textOnlyScenes of [false,true]){
  const r=await fixture({customScene:true,textOnlyScenes,customTextMissing:true,fixableFrameFailure:true});assert.ifError(r.error);assert.equal(r.frameRepairs,1);assert.equal(r.state.status,'succeeded');assert.ok(r.models.includes('review'));assert.equal(r.reservations,r.settlements);
  assert.equal(r.customFailures[0].code,'CUSTOM_HOLD_TEXT_MISSING');assert.deepEqual(r.customFailures[0].expectation.missingTextSlots,['product']);assert.ok(r.moduleSources.some((source:string)=>source.includes('runtime repaired')));
 }
 for(const mode of ['reverse','cold']){
  const r=await fixture({customScene:true,customSeekFailure:mode,fixableFrameFailure:true});assert.ifError(r.error);assert.equal(r.frameRepairs,1);assert.equal(r.customFailures[0].code,'CUSTOM_SEEK_MISMATCH');assert.equal(r.customFailures[0].phase,mode);assert.equal(r.activeStudio,null);
 }
 const qa=await fixture({customScene:true,customQaFailure:true,fixableFrameFailure:true});assert.ifError(qa.error);assert.equal(qa.frameRepairs,1);assert.equal(qa.customFailures[0].code,'CUSTOM_QA_BLOCK');
 const persistent=await fixture({customScene:true,customTextMissing:true});assert.equal(persistent.error.message,'CUSTOM_HOLD_TEXT_MISSING');assert.equal(persistent.frameRepairs,1);assert.equal(persistent.renders.length,0);assert.ok(!persistent.models.includes('review'));
 const unchanged=await fixture({customScene:true,customTextMissing:true,unchangedFrameRepair:true});assert.equal(unchanged.error.message,'CUSTOM_SOURCE_INVALID');assert.equal(unchanged.frameRepairs,1);assert.equal(unchanged.renders.length,0);
 const transport=await fixture({customScene:true,customTextMissing:true,repairTransportFailure:true});assert.equal(transport.error.message,'MOCK_REPAIR_TRANSPORT_FAILURE');assert.equal(transport.frameRepairs,1);assert.equal(transport.renders.length,0);assert.ok(transport.reservations>transport.settlements);
 const wrongScene=await fixture({customScene:true,customTextWrongScene:true});assert.equal(wrongScene.error.message,'CUSTOM_HOLD_TEXT_MISSING');assert.equal(wrongScene.frameRepairs,1);assert.equal(wrongScene.renders.length,0);
 const noClose=await fixture({customScene:true,customTextMissing:true,failCustomClose:true});assert.equal(noClose.error.message,'CUSTOM_HOLD_TEXT_MISSING');assert.equal(noClose.error.cause.message,'MOCK_CLEANUP_FAILURE');assert.equal(noClose.frameRepairs,0);assert.equal(noClose.renders.length,0);
 const incompletePlan=await fixture({customScene:true,omitHoldPlanFirst:true});assert.ifError(incompletePlan.error);assert.equal(incompletePlan.specRequests,2);assert.equal(incompletePlan.validationFeedback[0].issues[0].code,'CUSTOM_HOLD_TEXT_REQUIRED');
 const oldRenderer=await fixture({customScene:true,oldScopedObservation:true});assert.equal(oldRenderer.error.message,'RENDER_OBSERVATION_SCOPE_UNAVAILABLE');assert.deepEqual(oldRenderer.models,['facts','assets','directions','spec']);assert.equal(oldRenderer.reservations,4);assert.equal(oldRenderer.settlements,4);assert.equal(oldRenderer.activeStudio,null);
 const blocksOnly=await fixture({methodWithoutCustom:true,oldScopedObservation:true});assert.ifError(blocksOnly.error);assert.equal(blocksOnly.state.status,'succeeded');assert.ok(!blocksOnly.models.includes('scenes'));
 const overlap=await fixture({customScene:true,customSeekFailure:'reverse',customSeekOverlap:true,fixableFrameFailure:true});assert.equal(overlap.error.message,'CUSTOM_SEEK_MISMATCH');assert.equal(overlap.frameRepairs,0);assert.equal(overlap.renders.length,0);
});

test('hardest custom scene is checked before the second is authored, without replacing the final full proof',async()=>{
 const r=await fixture({customScene:true,twoCustom:true});assert.ifError(r.error);
 assert.ok(r.trace.indexOf('probe-studio')>=0&&r.trace.indexOf('probe-studio')<r.trace.indexOf('author-cta'));
 assert.equal(r.result.sceneModules.length,2);assert.match(r.result.sceneProofKey,/custom-check/);assert.doesNotMatch(r.result.sceneProofKey,/custom-probe/);
 const stopped=await fixture({customScene:true,twoCustom:true,customTextMissing:true});
 assert.equal(stopped.error.message,'CUSTOM_HOLD_TEXT_MISSING');assert.ok(stopped.trace.includes('probe-studio'));assert.ok(!stopped.trace.includes('author-cta'));
 assert.equal(stopped.frameRepairs,1);assert.equal(stopped.renders.length,0);assert.equal(stopped.activeStudio,null);
 const frozen=await fixture({customScene:true,twoCustom:true,frozenMethodVersion:'1.2.0'});assert.ifError(frozen.error);
 assert.ok(frozen.trace.includes('author-cta'));assert.ok(!frozen.trace.includes('probe-studio'));assert.equal(frozen.result.directingMethod.version,'1.2.0');
});

test('new method stops before review when a declared asset is hidden or belongs to another scene',async()=>{
 for(const options of [{customAssetMissing:true},{customAssetWrongScene:true}]){
  const r=await fixture({customScene:true,...options});
  assert.equal(r.error.message,'CUSTOM_REQUIRED_ASSET_NOT_VISIBLE');assert.equal(r.state.status,'failed');
  assert.equal(r.renders.length,0);assert.ok(!r.models.includes('review'));assert.equal(r.frameRepairs,0);assert.equal(r.activeStudio,null);
  const failure=r.customFailures[0];assert.equal(failure.frame,190);assert.deepEqual(failure.expectation.missingAssetKeys,['dashboard']);
  assert.ok(failure.images.some((image:any)=>image.frame===190));assert.ok(failure.observations.some((observation:any)=>observation.frame===190));
 }
 const old=await fixture({customScene:true,oldAssetObservation:true});assert.equal(old.error.message,'RENDER_ASSET_OBSERVATION_UNAVAILABLE');
 assert.deepEqual(old.models,['facts','assets','directions','spec']);assert.equal(old.activeStudio,null);assert.equal(old.renders.length,0);
 const plan=await fixture({customScene:true,invalidAssetPlanFirst:true});assert.ifError(plan.error);assert.equal(plan.specRequests,2);
 assert.equal(plan.validationFeedback[0].issues[0].code,'CUSTOM_ASSET_CHECK_INVALID');
 const optional=await fixture({customScene:true,noAssetPlan:true,oldAssetObservation:true});assert.ifError(optional.error);
 const legacy=await fixture({customScene:true,frozenMethodVersion:'1.5.0',customAssetMissing:true});assert.ifError(legacy.error);
 assert.equal(legacy.result.directingMethod.version,'1.5.0');
});

test('new CTA transitions use a non-overlapping fade or cut while frozen methods keep crossfade',async()=>{
 const corrected=await fixture({customScene:true,unsafeCtaFirst:true});assert.ifError(corrected.error);assert.equal(corrected.specRequests,2);
 assert.equal(corrected.validationFeedback[0].issues[0].code,'CTA_TRANSITION_UNSAFE');
 assert.equal(corrected.result.film.scenes[2].transitionIn.type,'fade-through');
 const legacy=await fixture({customScene:true,frozenMethodVersion:'1.5.0'});assert.ifError(legacy.error);
 assert.equal(legacy.result.film.scenes[2].transitionIn.type,'crossfade');
});

test('custom event review identifies its sampled scene and missing frames without claiming full motion',async()=>{
 const r=await fixture({customScene:true,motionSamples:true});assert.ifError(r.error);assert.equal(r.result.cold.verdict,'pass');
 assert.equal(r.reviewRequests[0].motionFrames[1].selection.sceneId,'product');
});
