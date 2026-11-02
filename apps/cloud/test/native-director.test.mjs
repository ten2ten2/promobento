// Offline control-flow evidence. Models and the native container are fixture adapters, not quality/paid-call evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest,sha256Bytes} from '@promobento/contracts/digest';
import {assertNativeProject} from '@promobento/contracts/native-project';
import {sqliteD1} from './fixtures/sqlite.mjs';
import {memoryMedia} from './fixtures/media.mjs';
import {applyProjectPatch,reviewFrameTimes,normalizeTimingEvidence} from '../../../packages/methods/native-authoring.mjs';
import {checkpointWaitSeconds,waitForDurableRender} from '../src/workflow-wait.ts';

const nativeCommit='52467f99c602b76ba86d511d37acdfe93fa1e16e';

test('direction renders replay their checkpointed wait after a 24-hour user-choice pause', async () => {
 const saved=new Map(),steps={async do(name,_options,action){if(!saved.has(name))saved.set(name,await action());return saved.get(name);}};
 const before=await checkpointWaitSeconds(steps,'render-complete-direction-fit',Date.now()+5000,'OPERATION_DEADLINE');
 const replay=await checkpointWaitSeconds(steps,'render-complete-direction-fit',Date.now()-24*60*60_000,'OPERATION_DEADLINE');
 assert.equal(replay,before);
});
test('durable render receipt survives a lost notification, but never accepts a late or blocked result',async()=>{
 const now=Date.now(),deadline=now+30_000,waits=[];
 let status='queued';
 const step={async do(_name,_options,action){return action();},async waitForEvent(_name,options){
  waits.push(options);status='passed';throw Error('NOTIFICATION_LOST');
 },async sleep(){}};
 await waitForDurableRender(step,'render-complete-fixture','native-render-fixture',deadline,async()=>({status,finishedAt:now,code:null}));
 assert.equal(waits.length,1);
 assert.equal(waits[0].type,'native-render-fixture');
 await assert.rejects(waitForDurableRender(step,'render-late','native-render-fixture',deadline,
  async()=>({status:'passed',finishedAt:deadline+1,code:null})),/OPERATION_DEADLINE/);
 await assert.rejects(waitForDurableRender(step,'render-blocked','native-render-fixture',deadline,
  async()=>({status:'blocked',finishedAt:now,code:'RENDER_FAILED'})),/RENDER_FAILED/);
});
test('temporary D1 status outages rearm the durable wait, while a fenced operation fails immediately',async()=>{
 const now=Date.now(),reads=[],waits=[];
 const step={async do(name,_options,action){return action();},async waitForEvent(name){waits.push(name);
  if(waits.length===1)throw Error('SIMULATED_TIMEOUT');return {payload:{status:'passed'}};
 },async sleep(){}};
 await waitForDurableRender(step,'render-outage','native-render-fixture',now+60_000,async()=>{
  reads.push(reads.length);
  if(reads.length===2||reads.length===3)throw Error('Network connection lost.');
  return {status:reads.length<4?'queued':'passed',finishedAt:now,code:null};
 });
 assert.equal(reads.length,4);
 assert.equal(waits.length,2,'a failed status observation is treated as unknown, not as a failed render');
 const fenced={...step,async waitForEvent(){assert.fail('a fenced operation must never wait');}};
 await assert.rejects(waitForDurableRender(fenced,'render-fenced','native-render-fixture',now+60_000,
  async()=>{throw Error('OPERATION_FENCED');}),/OPERATION_FENCED/);
});
const mockModules={
 'cloudflare:workers':'export class WorkflowEntrypoint{constructor(_ctx,env){this.env=env;}}',
 'model-client.ts':`export class ModelJsonOutputError extends Error{};export const modelStep=(...args)=>globalThis.__nativeDirectorFixture.modelStep(...args);`,
 'model-budget.ts':'export async function assertModelBudgetReady(){return {mode:"confirmed"};}',
 'native-project.ts':`export const NATIVE_COMMIT='${nativeCommit}';export const saveNativeProject=(...a)=>globalThis.__nativeDirectorFixture.save(...a);export const loadNativeProject=(...a)=>globalThis.__nativeDirectorFixture.load(...a);export const createNativeRender=(...a)=>globalThis.__nativeDirectorFixture.render(...a);export const getNativeRender=(...a)=>globalThis.__nativeDirectorFixture.getRender(...a);export const checkedNativeBytes=(...a)=>globalThis.__nativeDirectorFixture.bytes(...a);`,
 'director-recovery.ts':`export const directorFailureCode=e=>e.message;export async function directorProgress(){};export async function commitCandidate(env,op,key,resources){globalThis.__nativeDirectorFixture.committedResources=resources;await env.DB.prepare("UPDATE pipeline_operations SET status='succeeded',result_key=? WHERE id=?").bind(key,op.id).run();}export async function failDirector(env,op,code,inside,key){await env.DB.prepare("UPDATE pipeline_operations SET status='failed',result_key=? WHERE id=?").bind(key??code,op.id).run();}`
};
const built=await build({stdin:{contents:'export {OperationWorkflow} from "./apps/cloud/src/director.ts";export {directingMethodPack} from "./packages/methods/directing.ts";',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',target:'node26',plugins:[{name:'offline-native-edges',setup(b){b.onResolve({filter:/.*/},args=>{const name=args.path.split('/').at(-1),key=Object.hasOwn(mockModules,args.path)?args.path:Object.hasOwn(mockModules,name)?name:null;return key?{path:key,namespace:'fixture'}:undefined;});b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mockModules[args.path],loader:'js'}));}}]});
const {OperationWorkflow,directingMethodPack}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=','base64'));
async function fixture(t,{missingEncoded=false,reviewAlwaysRevise=false,dropRenderEvents=false,
 transientRenderStatus=false,parallelDelay=false,measuredSpeech=false,authoredSpeech=false,useAlternative=false,
 jsonMaterial=false,selectVoice=false,invalidRecomposeOnce=false,explicitSameIdAudio=false}={}){
 const {db,DB}=sqliteD1(),{MEDIA}=memoryMedia();t.after(()=>db.close());
 const calls=[],jobs=[],saved=new Map(),renders=new Map(),lostEvents=[],failedReads=[],renderReads=new Map(),eventWaits=new Map();
 const parallel={assets:{active:0,peak:0},directions:{active:0,peak:0}};
 const put=async(key,bytes,mediaType)=>{const sha256=sha256Bytes(bytes);await MEDIA.put(key,bytes,{customMetadata:{sha256},httpMetadata:{contentType:mediaType}});return {name:key.split('/').at(-1),key,sha256,byteLength:bytes.length,mediaType};};
 const putJson=(key,value)=>put(key,new TextEncoder().encode(canonical(value)),'application/json');
 const asset={...await put('evals/fixture/product.png',png,'image/png'),resourceId:'res_product',kind:'image',width:1,height:1};
 await putJson('evals/fixture/evidence.json',{fixture:true});await putJson('evals/fixture/method.json',directingMethodPack);
 db.prepare('INSERT INTO renderer_releases(id,runtime_version,image_digest,environment_key,status) VALUES(?,?,?,?,?)').run('renderer-native',nativeCommit,'sha256:'+'a'.repeat(64),'env','active');
 const env={DB,MEDIA,MODEL_COMPAT_API_KEY:'fixture-only',OPERATIONS:{getByName:()=>({progress:async()=>{}})}};
 const f={
  async bytes(_env,blob){const value=await MEDIA.get(blob.key);assert.ok(value);const bytes=new Uint8Array(await value.arrayBuffer());assert.equal(sha256Bytes(bytes),blob.sha256);return bytes;},
  async save(_env,op,input){
   const project={schemaVersion:'1.0.0',kind:'native_project',entry:'index.html',runtime:{name:'huashu-motion',commit:nativeCommit},composition:input.composition,files:input.files,resources:input.resources,
    ...(input.timingEvidenceRef?{timingEvidenceRef:input.timingEvidenceRef}:{})};
   assertNativeProject(project);
   const revisionId=digest(project),manifest=await putJson('operations/'+op.id+'/native/'+revisionId+'/project.json',project),record={revisionId,manifestKey:manifest.key,project};saved.set(revisionId,record);return record;
  },
  async load(_env,_op,id){assert.ok(saved.has(id),'revision must already exist');return saved.get(id);},
  async render(_env,op,input){
   const project=saved.get(input.revisionId);assert.ok(project);jobs.push({...input,operationId:op.id});
   const outputs=[];for(const [index]of (input.mode==='preview'?input.frames:[0]).entries())outputs.push(await put('renders/'+input.renderId+'/'+index+(input.mode==='preview'?'.png':'.mp4'),png,input.mode==='preview'?'image/png':'video/mp4'));
   if(input.mode==='export'&&!missingEncoded){
    outputs.push({...await put('renders/'+input.renderId+'/review-sheet.jpg',png,'image/jpeg'),name:'review-sheet.jpg'});
    outputs.push({...await put('renders/'+input.renderId+'/motion-sheet.jpg',png,'image/jpeg'),name:'motion-sheet.jpg'});
   }
   renders.set(input.renderId,{status:dropRenderEvents||transientRenderStatus?'queued':'passed',finished_at:Date.now(),result:{outputs,report:{pageErrors:[],previewFrameTimes:input.frames??[],projectHash:input.revisionId,...(input.mode==='export'?{
    reviewSheet:{source:'film.mp4',columns:2,rows:2,frames:[0,150,300,449],times:[0,5,10,449/30]},
    motionReview:{source:'film.mp4',columns:4,rows:3,frames:Array.from({length:12},(_,index)=>Math.round(index*449/11))},
    dynamicQuality:{coverage:'full_video_and_audio_decode',status:'clear',findings:[],ownerNormalSpeedReview:'pending'}
   }:{})}}});return {renderId:input.renderId};
  },
  async getRender(_env,_op,id){const reads=(renderReads.get(id)??0)+1;renderReads.set(id,reads);
   if(transientRenderStatus&&reads===2){failedReads.push(id);throw Error('Network connection lost.');}
   return renders.get(id);
  },
  async modelStep(_env,operationId,_generation,stage,callId,request,validate){
   const payload=parseCanonicalJson(request.messages[0].text),tool=request.tools?.[0]?.name;calls.push({operationId,stage,callId,tool,payload,system:request.system});let value;
   const group=stage==='assets'?'assets':stage==='author'&&callId.includes('-direction-')?'directions':null;
   if(parallelDelay&&group){const state=parallel[group];state.active++;state.peak=Math.max(state.peak,state.active);
    try{await new Promise(resolve=>setTimeout(resolve,3));}finally{state.active--;}}
   if(stage==='facts')value={schemaVersion:'3.0.0',kind:'fact_analysis',factIds:['fact_product'],summary:'The provided product does the described work.'};
   else if(stage==='assets')value={schemaVersion:'3.0.0',kind:'asset_insight',sha256:payload.sha256,promptVersion:'native-asset-v1',model:payload.model,assetKind:'screenshot',description:'A supplied product pixel fixture.',regions:[],dominantColors:['#ffffff'],visibleText:[],visualRoles:['Product evidence']};
   else if(stage==='directions')value={schemaVersion:'3.0.0',kind:'direction_set',cards:['fit','amplify','unexpected'].map((key,index)=>({key,language:index===1?'3d-object':'kinetic-type',palette:[{color:'#ffffff',role:'bg',source:'Product'},{color:'#111111',role:'ink',source:'Product'}],logline:'Show the real product',feel:{route:'continuous',bpm:120,eventsPerBar:4},sound:'A clear landing',risk:'Keep real material legible',usesDepth:index===1,skeleton:[0,1,2].map(i=>({purpose:'Passage '+i,approach:'Native geometry and typography'}))}))};
   else if(stage==='reference')value={schemaVersion:'3.0.0',kind:'reference_analysis',resourceId:payload.reference.resourceId,
    sourceSha256:payload.sourceSha256,sourceFrameCount:payload.sourceFrameCount,sampledFrames:payload.sampledFrames,
    audioStatus:'not_analyzed',summary:{hook:'Visible product hook.',progression:'Source progression.',payoff:'Closing visual.',
      visualSystem:'Product UI.',limitations:'Between-sample motion and all audio were not examined.'},
    moments:[{id:'source-hook',startFrame:0,endFrame:payload.sourceFrameCount,evidenceFrames:payload.sampledFrames,
      visible:'The sampled product appears.',interpretation:null,visibleText:[]}],relationships:[]};
   else if(stage==='script'){
    value={schemaVersion:'3.0.0',kind:'native_script',videoLanguage:'en',durationFrames:450,
    segments:[{id:'title',role:'title',displayText:'PROMO_PROMISE',speechText:null,factIds:['fact_product'],startFrame:0,endFrame:300,timing:{kind:'authored'}},
      {id:'cta',role:'cta',displayText:'Try PromoBento',speechText:null,factIds:[],startFrame:300,endFrame:450,timing:{kind:'authored'}}],
    moments:[{id:'reveal',kind:'reveal',startFrame:0,endFrame:300,segmentIds:['title'],resourceIds:['res_product'],timing:{kind:'authored'}},
      {id:'action',kind:'cta',startFrame:300,endFrame:450,segmentIds:['cta'],resourceIds:[],timing:{kind:'authored'}}]};
   if(measuredSpeech||authoredSpeech){
    const timing=measuredSpeech?{kind:'measured',sourceSha256:payload.timingEvidence[0].sourceSha256,firstWord:0,lastWord:1}:{kind:'authored'};
    value.segments.push({id:'voice',role:'narration',displayText:'Voice over',speechText:'Hello world',factIds:[],startFrame:30,endFrame:60,
      timing});
    value.moments.push({id:'spoken',kind:'demonstration',startFrame:30,endFrame:60,segmentIds:['voice'],
      resourceIds:['res_voice'],timing});
   }
   }
   else if(stage==='selection')value={schemaVersion:'3.0.0',kind:'material_selection',uses:payload.treatment.beats.flatMap(beat=>beat.assetIds.map(assetId=>({
    beatId:beat.id,role:'product_demo',selectedResourceId:assetId,alternativeResourceIds:useAlternative&&assetId==='res_product'?['res_product_new']:[],reason:'This licensed source is needed by the beat.',locked:true})))};
   else{
    let input;
    if(tool==='write_treatment')input={treatment:'The supplied product is the hero; a continuous reveal leads to the CTA.',beats:[{id:'hero',purpose:'Show the product and useful result',startFrame:0,endFrame:450,assetIds:selectVoice?['res_product','res_voice']:['res_product']}],hardestBeat:'hero',reviewFrames:[0,90,240,449]};
    else if(tool==='write_project'){
     const shape=payload.composition,product=payload.materials.find(item=>item.resourceId==='res_product')??payload.materials[0];
     const voice=payload.materials.find(item=>item.resourceId==='res_voice');
     const image=jsonMaterial?'<img data-om-id="product">':`<img data-om-id="product" src="${product.path}">`;
     const audio=(selectVoice||measuredSpeech||authoredSpeech)&&voice?`<audio src="${voice.path}"></audio>`:'';
     const source=`<!doctype html><html><head><script src="vendor/gsap.min.js"></script><script src="vendor/om.js"></script></head><body><div id="film" data-composition-id="film" data-width="${shape.width}" data-height="${shape.height}" data-duration="15" data-fps="30"><h1 data-om-id="title">PROMO_ORIGINAL</h1>${image}${audio}<i>HARD_STAGE</i></div><script>window.__timelines={film:gsap.timeline({paused:true}).to({},{duration:15})};${jsonMaterial?"fetch('src/assets.json').then(r=>r.json()).then(v=>document.querySelector('img').src=v.productPath);":''}</script></body></html>`;
     const html=source.replace('<i>HARD_STAGE</i>','<i>HARD_STAGE</i><p>PROMO_PROMISE</p><p>Try PromoBento</p>');
     input={files:[{path:'index.html',content:invalidRecomposeOnce&&callId.includes('-recompose-')&&!callId.endsWith('-correct')
      ?html.replace('PROMO_PROMISE','OMITTED_PROMISE'):html},
      ...(jsonMaterial?[{path:'src/assets.json',content:JSON.stringify({productPath:product.path})}]:[])],reviewFrames:[90,240],note:'A native fixture, with original source APIs.'};
    }else if(tool==='apply_project_patch'){
     const previouslyRevised=payload.sourceFiles.find(file=>file.path==='index.html')?.content.includes('PROMO_REVISED');
     const target=payload.comments?(previouslyRevised?'PROMO_REVISED':'PROMO_ORIGINAL'):payload.review?'COMPLETE_STAGE':'HARD_STAGE';
     input={baseRevision:payload.baseRevision,edits:[{command:'replace',path:'index.html',oldText:target,newText:payload.comments?(previouslyRevised?'PROMO_REVISED_AGAIN':'PROMO_REVISED'):payload.review?'COMPLETE_STAGE_REPAIRED':'COMPLETE_STAGE'}],reviewFrames:[90,240],note:'Exact native source revision.'};
     const replacement=payload.materials.find(material=>material.resourceId==='res_product_new');
     if(replacement&&payload.comments){const targetFile=jsonMaterial?'src/assets.json':'index.html';
      const oldPath=payload.sourceFiles.find(file=>file.path===targetFile).content.match(/assets\/[a-f0-9]{24}\.png/)[0];
      input.edits.push({command:'replace',path:targetFile,oldText:oldPath,newText:replacement.path});}
     const oldVoicePath=payload.sourceFiles.find(file=>file.path==='index.html')?.content.match(/assets\/[a-f0-9]{24}\.wav/)?.[0];
     const nextVoice=payload.materials.find(material=>material.kind==='audio'
      &&(material.resourceId==='res_voice_new'||explicitSameIdAudio&&material.resourceId==='res_voice')
      &&material.path!==oldVoicePath);
     if(nextVoice&&oldVoicePath&&payload.comments){const oldPath=oldVoicePath;
      input.edits.push({command:'replace',path:'index.html',oldText:oldPath,newText:nextVoice.path});}
     const revisedCopy=payload.script?.segments?.find(segment=>segment.id==='title')?.displayText;
     if(revisedCopy&&revisedCopy!=='PROMO_PROMISE')input.edits.push({command:'replace',path:'index.html',oldText:'PROMO_PROMISE',newText:revisedCopy});
     const revisedCta=payload.script?.segments?.find(segment=>segment.id==='cta')?.displayText;
     if(revisedCta&&revisedCta!=='Try PromoBento')input.edits.push({command:'replace',path:'index.html',oldText:'Try PromoBento',newText:revisedCta});
    }else if(tool==='submit_review')input={verdict:reviewAlwaysRevise?'revise':'pass',issues:reviewAlwaysRevise?[{detail:'Observed title overlap.',frames:[90]}]:[],note:'The supplied fixture frames received this mocked review.'};
    else throw Error('Unexpected fixture tool '+tool);
    value={toolCalls:[{id:'fixture',name:tool,arguments:canonical(input),input}]};
   }
   validate(value);return {value,cached:false};
  }
 };
 globalThis.__nativeDirectorFixture=f;t.after(()=>delete globalThis.__nativeDirectorFixture);
 const create=async(id,extra={},readmittedRights=[],maxMicros=10000000)=>{
  const context={audience:'software',brief:'Show this product.',videoLanguage:'en',durationSeconds:15,fps:30,aspects:['landscape','portrait'],rendererRelease:'renderer-native',facts:[{id:'fact_product',text:'The product does the described work.'}],confirmedFactIds:['fact_product'],resources:[asset],...extra};
  const request=await putJson('evals/fixture/'+id+'.json',context);
  db.prepare('INSERT INTO pipeline_operations(id,workspace_id,project_id,generation,purpose,status,request_hash,max_micros,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,'workspace','project',0,'evaluation','active',id,maxMicros,Date.now());
  db.prepare('INSERT INTO pipeline_contexts(operation_id,request_key,directing_method_key,engine) VALUES(?,?,?,?)').run(id,request.key,'evals/fixture/method.json',extra.legacyEngine?'legacy':'huashu');
  const materials=[...(Array.isArray(context.resources)?context.resources:[]),...(Array.isArray(context.audioSources)?context.audioSources:[]),...readmittedRights];
  for(const resource of materials.filter(value=>value&&typeof value.resourceId==='string'&&typeof value.sha256==='string'))
   db.prepare('INSERT OR IGNORE INTO pipeline_rights(operation_id,resource_id,sha256,license_ref,evidence_key,scope) VALUES(?,?,?,?,?,?)').run(id,resource.resourceId,resource.sha256,'fixture',resource.rightsEvidenceKey??'evals/fixture/evidence.json','internal_eval_only');
  const steps={async do(_name,options,action){return (action??options)();},async waitForEvent(_name,options){
   if(options.type.startsWith('native-render-')){
    const completed=[...renders.entries()].find(([renderId])=>'native-render-'+digest(renderId).slice(0,32)===options.type);
    assert.ok(completed,'render completion must come from a recorded native result');
    if(dropRenderEvents){completed[1].status='passed';lostEvents.push(completed[0]);throw Error('SIMULATED_MISSING_RENDER_EVENT');}
    if(transientRenderStatus){const previous=eventWaits.get(completed[0])??0;eventWaits.set(completed[0],previous+1);
     if(previous===0)throw Error('SIMULATED_HEARTBEAT_TIMEOUT');completed[1].status='passed';}
    return {payload:{renderId:completed[0],status:completed[1].status}};
   }
   assert.equal(options.type,'direction-choice');
   const row=db.prepare('SELECT directions_hash FROM pipeline_contexts WHERE operation_id=?').get(id);
   assert.equal(db.prepare('SELECT status FROM pipeline_operations WHERE id=?').get(id).status,'awaiting_user');
   assert.equal(jobs.filter(job=>job.operationId===id&&job.mode==='preview').length,3,'all three native direction frames exist before choosing');
   const payload={key:'fit',directionsHash:row.directions_hash};
   db.prepare('UPDATE pipeline_contexts SET choice=?,choice_hash=? WHERE operation_id=?').run(payload.key,digest(payload),id);
   return {payload};
  },async sleep(){}};
  return new OperationWorkflow({},env).run({payload:{operationId:id}},steps);
 };
 return {create,calls,jobs,saved,db,env,asset,put,save:f.save,bytes:f.bytes,lostEvents,failedReads,parallel,get committedResources(){return f.committedResources;}};
}

test('director overlaps only independent stages, freezes per-card method language, and waits for all previews',async t=>{
 const f=await fixture(t,{parallelDelay:true});
 const second={...await f.put('evals/fixture/second.png',png,'image/png'),resourceId:'second',kind:'image',width:1,height:1,preview:null};
 const third={...await f.put('evals/fixture/third.png',png,'image/png'),resourceId:'third',kind:'image',width:1,height:1};
 const candidate=await f.create('bounded-stages',{resources:[f.asset,second,third],aspects:['landscape'],audioSources:null});
 assert.equal(candidate.kind,'native_candidate');
 assert.equal(f.parallel.assets.peak,2);assert.equal(f.parallel.directions.peak,2);
 const cardCalls=f.calls.filter(call=>call.stage==='author'&&call.callId.includes('-direction-'));
 assert.equal(cardCalls.length,3);
 for(const call of cardCalls){
  const expected=call.callId.includes('-amplify')?'object-3d/index.html':'kinetic-type/index.html';
  assert.ok(call.system.includes(expected),`${call.callId} uses its own immutable template, not another parallel card's language`);
 }
 const stored=await f.env.MEDIA.get('operations/bounded-stages/direction-previews.json');
 assert.ok(stored);
 const previewSet=parseCanonicalJson(new Uint8Array(await stored.arrayBuffer()));
 assert.deepEqual(previewSet.map(item=>item.direction),['fit','amplify','unexpected']);
});

test('duplicate material entries keep original positions but never start two identical paid asset calls',async t=>{
 const f=await fixture(t,{parallelDelay:true});
 const completed=await f.create('duplicate-materials',{resources:[f.asset,structuredClone(f.asset)],aspects:['landscape']});
 assert.equal(completed.kind,'native_candidate');
 const observations=f.calls.filter(call=>call.stage==='assets');
 assert.equal(observations.length,1,'an identical observation should have one in-flight model call and stable first callId');
 assert.ok(observations[0].callId.endsWith('asset-0'));
 assert.equal(f.parallel.assets.peak,1);
 const directions=f.calls.find(call=>call.stage==='directions');
 assert.equal(directions.payload.insights.length,2,'the downstream stage still receives an ordered insight for each material');
 assert.deepEqual(directions.payload.insights[0],directions.payload.insights[1]);
});

test('the cold-review upper bound admits four aspects and rejects an impossible budget before model work',async t=>{
  const f=await fixture(t);
  // The context keys are the fixed platform presets; the cold-review cost is
  // conservatively based on eight encoded images, not a four-image assumption.
  const configs=JSON.parse(readFileSync('config/platform-presets.json','utf8'));
  const targets=Object.keys(configs.aspectLayouts);
  assert.equal(targets.length,4);
  const candidate=await f.create('four-aspects',{aspects:targets});
  assert.equal(candidate.kind,'native_candidate');
  const prior=f.calls.length;
  await assert.rejects(f.create('four-aspects-low-budget',{aspects:targets},[],100000),
    /MODEL_COLD_REVIEW_BUDGET_INSUFFICIENT/);
  assert.equal(f.calls.length,prior,'no paid stage starts after a failed cold-review preflight');
});

test('source-frame-bound reference analysis informs the film but never grants use of reference footage',async t=>{
 const f=await fixture(t),frame=index=>{
  const bytes=Buffer.alloc(20,index);bytes.write('RIFF',0);bytes.writeUInt32LE(12,4);bytes.write('WEBP',8);return bytes;
 };
 const rawFrames=[frame(1),frame(2)],packBytes=Buffer.concat(rawFrames);
 const original=await f.put('evals/fixture/reference-source.mp4',Buffer.from('original reference movie'),'video/mp4');
 const poster=await f.put('evals/fixture/reference-poster.webp',rawFrames[0],'image/webp');
 const pack=await f.put('evals/fixture/reference-pack.bin',packBytes,'application/octet-stream');
 const manifest={schemaVersion:'3.0.0',kind:'video_frame_manifest',
  source:{sha256:original.sha256,byteLength:original.byteLength,mediaType:'video/mp4'},
  browserVersion:'156.0.8078.74',width:1,height:1,poster:{sha256:poster.sha256,byteLength:poster.byteLength},
  packs:[{sha256:pack.sha256,byteLength:pack.byteLength}],
  frames:rawFrames.map((bytes,index)=>({index,pts:index/30,duration:1/30,pack:0,offset:index*20,byteLength:bytes.length}))};
 const assetManifest=await f.put('evals/fixture/reference-manifest.json',new TextEncoder().encode(canonical(manifest)),'application/json');
 const evidenceKey='evals/fixture/reference-rights.json';
 await f.put(evidenceKey,new TextEncoder().encode(canonical({videoSource:original,preview:poster,
  framePacks:[{key:pack.key,sha256:pack.sha256,byteLength:pack.byteLength}]})),'application/json');
 const reference={...assetManifest,resourceId:'source-reference',kind:'video',width:1,height:1,
  videoFramePacking:'webp-pack-v1',rightsEvidenceKey:evidenceKey,
  framePacks:[{key:pack.key,sha256:pack.sha256,byteLength:pack.byteLength}]};
 const candidate=await f.create('reference-film',{aspects:['landscape'],resources:[f.asset,reference],
  references:[{resourceId:reference.resourceId,purpose:'pacing',notes:'Observe only source frames.'}]});
 assert.equal(candidate.kind,'native_candidate');
 assert.equal(candidate.referenceAnalysisKey!==null,true);
 const analysis=f.calls.find(call=>call.stage==='reference');
 assert.ok(analysis);assert.equal(analysis.payload.sourceSha256,original.sha256);
 assert.deepEqual(analysis.payload.sampledFrames,[0,1]);
 assert.equal(analysis.payload.audioStatus,'not_analyzed');
 const directions=f.calls.find(call=>call.stage==='directions');
 assert.equal(directions.payload.referenceAnalyses[0].audioStatus,'not_analyzed');
 const saved=f.saved.get(candidate.projects[0].revisionId).project;
 assert.ok(saved.resources.some(resource=>resource.resourceId===f.asset.resourceId));
 assert.ok(!saved.resources.some(resource=>resource.resourceId===reference.resourceId),
  'analyzing a source is not licensing its inclusion in the film');
});

test('a failed parallel asset stops in-flight invalid output from starting a paid correction',async t=>{
 const f=await fixture(t),original=globalThis.__nativeDirectorFixture.modelStep;
 let startedSecond,failFirst;
 const secondStarted=new Promise(resolve=>{startedSecond=resolve;}),firstFailed=new Promise(resolve=>{failFirst=resolve;});
 const requested=[];
 globalThis.__nativeDirectorFixture.modelStep=async (...args)=>{
  const stage=args[3],callId=args[4];requested.push(callId);
  if(stage==='assets'&&callId.endsWith('-asset-0')){
   await secondStarted;failFirst();throw Error('ASSET_ZERO_DENIED');
  }
  if(stage==='assets'&&callId.endsWith('-asset-1')){
   startedSecond();await firstFailed;await new Promise(resolve=>setImmediate(resolve));
   args[6]({schemaVersion:'3.0.0',kind:'invalid_asset_insight'});
   assert.fail('the invalid response should be rejected by its validator');
  }
  return original(...args);
 };
 const extra={...await f.put('evals/fixture/extra.png',png,'image/png'),resourceId:'asset_two',kind:'image',width:1,height:1};
 await assert.rejects(f.create('parallel-asset-failure',{resources:[f.asset,extra],aspects:['landscape']}),/ASSET_ZERO_DENIED/);
 assert.ok(requested.some(call=>call.endsWith('-asset-0'))&&requested.some(call=>call.endsWith('-asset-1')),'both initial model calls were dispatched and drained');
 assert.equal(requested.filter(call=>call.endsWith('-asset-1-correct')).length,0,'a failed stage must not authorize another paid correction');
 assert.equal(f.db.prepare("SELECT status FROM pipeline_operations WHERE id='parallel-asset-failure'").get().status,'failed');
});

test('a failed parallel direction does not allow another completed author to start a preview render',async t=>{
 const f=await fixture(t),original=globalThis.__nativeDirectorFixture.modelStep;
 let startedAmplify,failFit;
 const amplifyStarted=new Promise(resolve=>{startedAmplify=resolve;}),fitFailed=new Promise(resolve=>{failFit=resolve;});
 const requested=[];
 globalThis.__nativeDirectorFixture.modelStep=async (...args)=>{
  const stage=args[3],callId=args[4];
  if(stage==='author'&&callId.includes('-direction-')){
   requested.push(callId);
   if(callId.endsWith('-direction-fit')){await amplifyStarted;failFit();throw Error('FIT_AUTHOR_DENIED');}
   if(callId.endsWith('-direction-amplify')){startedAmplify();await fitFailed;await new Promise(resolve=>setImmediate(resolve));}
  }
  return original(...args);
 };
 await assert.rejects(f.create('parallel-direction-failure',{aspects:['landscape']}),/FIT_AUTHOR_DENIED/);
 assert.equal(requested.length,2,'already dispatched author requests are awaited, but the third card never starts');
 assert.equal(f.jobs.filter(job=>job.operationId==='parallel-direction-failure'&&job.mode==='preview').length,0,
  'a completed in-flight author must not start a new preview after a peer has failed');
 assert.equal(f.db.prepare("SELECT status FROM pipeline_operations WHERE id='parallel-direction-failure'").get().status,'failed');
});

test('director completes from durable render receipts when every completion event is lost',async t=>{
 const f=await fixture(t,{dropRenderEvents:true});
 const candidate=await f.create('lost-render-events',{aspects:['landscape']});
 assert.equal(candidate.kind,'native_candidate');
 assert.ok(f.lostEvents.length>=5,'all render stages must pass through a missing event');
 assert.equal(f.db.prepare('SELECT status FROM pipeline_operations WHERE id=?').get('lost-render-events').status,'succeeded');
});

test('director recovers a transient D1 failure on the second heartbeat without redoing paid work',async t=>{
 const f=await fixture(t,{transientRenderStatus:true}),candidate=await f.create('status-outage',{aspects:['landscape']});
 assert.equal(candidate.kind,'native_candidate');
 assert.ok(f.failedReads.length>=5,'each live render experiences a failed D1 observation');
 assert.equal(new Set(f.jobs.map(job=>job.renderId)).size,f.jobs.length,'every render was submitted just once');
 assert.equal(new Set(f.calls.map(call=>call.callId)).size,f.calls.length,'every model call was issued just once');
 assert.equal(f.db.prepare('SELECT status FROM pipeline_operations WHERE id=?').get('status-outage').status,'succeeded');
});

test('native creation renders directions, waits for choice, authors independent aspects and exports; comments patch an immutable base',async t=>{
 const f=await fixture(t),candidate=await f.create('creative-fixture');
 assert.equal(candidate.kind,'native_candidate');assert.equal(candidate.projects.length,2);assert.equal(candidate.renders.length,2);
 assert.equal(candidate.ownerNormalSpeedReview,'pending');
 const shapes=candidate.projects.map(project=>f.saved.get(project.revisionId).project.composition);assert.deepEqual(shapes.map(shape=>[shape.width,shape.height]),[[1920,1080],[1080,1920]]);
 assert.equal(f.jobs.filter(job=>job.mode==='export').length,2);
 const original=candidate.projects[0],before=f.saved.get(original.revisionId),source=before.project.files.find(file=>file.path==='index.html');
 const beforeText=new TextDecoder().decode(await f.bytes(f.env,source));assert.match(beforeText,/COMPLETE_STAGE/);assert.doesNotMatch(beforeText,/PB\.scene/);
 const replacement={...await f.put('evals/fixture/product-new.png',Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQEBAKU1mS0AAAAASUVORK5CYII=','base64')),'image/png'),resourceId:'res_product_new',kind:'image',width:1,height:1};
 const patch=await f.create('patch-fixture',{aspects:['landscape'],resources:[f.asset,replacement],baseRevision:original.revisionId,
  materialReplacements:[{fromResourceId:'res_product',toResourceId:'res_product_new'}],
  comments:[{text:'Change the headline and use the new screenshot.',frame:90,elementId:'title'}]});
 assert.notEqual(patch.projects[0].revisionId,original.revisionId);assert.equal(f.calls.filter(call=>call.operationId==='patch-fixture'&&call.stage==='directions').length,0);
 const changed=f.saved.get(patch.projects[0].revisionId).project.files.find(file=>file.path==='index.html');assert.match(new TextDecoder().decode(await f.bytes(f.env,changed)),/PROMO_REVISED/);
 const revised=f.saved.get(patch.projects[0].revisionId).project;
 assert.ok(revised.files.some(file=>file.sha256===replacement.sha256),'newly admitted media is included in the patched project');
 assert.ok(!revised.files.some(file=>file.sha256===f.asset.sha256),'replaced source bytes cannot be loaded dynamically by the patched project');
 assert.ok(revised.resources.some(resource=>resource.resourceId===f.asset.resourceId),'historical rights obligations remain auditable');
 assert.ok(revised.resources.some(resource=>resource.resourceId===replacement.resourceId&&resource.sha256===replacement.sha256));
 const locked=parseCanonicalJson(await f.bytes(f.env,revised.files.find(file=>file.path==='material-selection.json')));
 assert.equal(locked.uses[0].resourceId,replacement.resourceId);
 assert.equal(locked.uses[0].sha256,replacement.sha256);
 assert.notEqual(locked.selectionHash,parseCanonicalJson(await f.bytes(f.env,before.project.files.find(file=>file.path==='material-selection.json'))).selectionHash);
 assert.ok(patch.scriptImpact.affectedAssetLocks.includes('res_product'));
 assert.equal(parseCanonicalJson(await f.bytes(f.env,revised.files.find(file=>file.path==='script.json'))).moments[0].resourceIds[0],replacement.resourceId);
 assert.equal(new TextDecoder().decode(await f.bytes(f.env,source)),beforeText,'the parent revision remains unchanged');
 const followup=await f.create('replacement-followup',{aspects:['landscape'],resources:[],
  baseRevision:patch.projects[0].revisionId,comments:[{text:'Adjust only the headline layout.',frame:90}]},[f.asset,replacement]);
 const final=f.saved.get(followup.projects[0].revisionId).project;
 assert.ok(final.files.some(file=>file.sha256===replacement.sha256),'later edits keep the current material');
 assert.ok(!final.files.some(file=>file.sha256===f.asset.sha256),'retired material cannot reappear in a later patch');
});

test('a patch cannot silently substitute a source without an explicit replacement lock',async t=>{
 const f=await fixture(t),parent=await f.create('locked-parent',{aspects:['landscape']});
 const replacement={...await f.put('evals/fixture/new.png',Buffer.from('new image'),'image/png'),resourceId:'res_product_new',kind:'image',width:1,height:1};
 await assert.rejects(f.create('unlocked-child',{aspects:['landscape'],resources:[replacement],
  baseRevision:parent.projects[0].revisionId,comments:[{text:'Replace the screenshot.',frame:60}]},[f.asset]),
 /MATERIAL_LOCK_PROJECT_MISMATCH/);
});

test('a previously registered alternative can be promoted without duplicate lock identities',async t=>{
 const f=await fixture(t,{useAlternative:true});
 const alternate={...await f.put('evals/fixture/registered-alternate.png',Buffer.from('alternate screenshot'),'image/png'),
  resourceId:'res_product_new',kind:'image',width:1,height:1};
 const parent=await f.create('registered-alternative-parent',{aspects:['landscape'],resources:[f.asset,alternate]});
 const old=f.saved.get(parent.projects[0].revisionId).project;
 const prior=parseCanonicalJson(await f.bytes(f.env,old.files.find(item=>item.path==='material-selection.json')));
 assert.equal(prior.uses[0].alternatives[0].resourceId,'res_product_new');
 const changed=await f.create('registered-alternative-child',{aspects:['landscape'],resources:[alternate],
  baseRevision:parent.projects[0].revisionId,materialReplacements:[{fromResourceId:'res_product',toResourceId:'res_product_new'}],
  comments:[]},[f.asset]);
 const project=f.saved.get(changed.projects[0].revisionId).project;
 const lock=parseCanonicalJson(await f.bytes(f.env,project.files.find(item=>item.path==='material-selection.json')));
 assert.equal(lock.uses[0].resourceId,'res_product_new');
 assert.equal(lock.uses[0].alternatives[0].resourceId,'res_product');
 assert.ok(project.files.some(item=>item.sha256===alternate.sha256));
});

test('an authorized material replacement may live only in native src/assets.json',async t=>{
 const f=await fixture(t,{jsonMaterial:true});
 const parent=await f.create('json-source-parent',{aspects:['landscape']});
 const alternate={...await f.put('evals/fixture/json-replacement.png',Buffer.from('json screenshot'),'image/png'),
  resourceId:'res_product_new',kind:'image',width:1,height:1};
 const changed=await f.create('json-source-child',{aspects:['landscape'],resources:[alternate],
  baseRevision:parent.projects[0].revisionId,materialReplacements:[{fromResourceId:'res_product',toResourceId:'res_product_new'}],
  comments:[{text:'Use the new product image referenced in JSON.',frame:60}]},[f.asset]);
 const project=f.saved.get(changed.projects[0].revisionId).project;
 const manifest=new TextDecoder().decode(await f.bytes(f.env,project.files.find(item=>item.path==='src/assets.json')));
 assert.equal(JSON.parse(manifest).productPath,'assets/'+alternate.sha256.slice(0,24)+'.png');
 assert.ok(project.files.some(item=>item.sha256===alternate.sha256));
});

test('patches validate the base CTA with its saved Brief, then the edited Script with the new CTA',async t=>{
 const f=await fixture(t),parent=await f.create('cta-parent',{aspects:['landscape'],cta:'Try PromoBento'});
 const changed=await f.create('cta-child',{aspects:['landscape'],resources:[],baseRevision:parent.projects[0].revisionId,
  cta:'Start your free trial',comments:[],scriptEdits:[{segmentId:'cta',field:'displayText',value:'Start your free trial'}]},[f.asset]);
 assert.equal(changed.kind,'native_candidate');
 const project=f.saved.get(changed.projects[0].revisionId).project;
 const updated=parseCanonicalJson(await f.bytes(f.env,project.files.find(item=>item.path==='script.json')));
 assert.equal(updated.segments.find(item=>item.id==='cta').displayText,'Start your free trial');
});

test('measured Script and its authorized media survive a geometry-only child revision',async t=>{
 const f=await fixture(t,{measuredSpeech:true});
 const voice={...await f.put('evals/fixture/voice.wav',Buffer.from('voice fixture'),'audio/wav'),
  resourceId:'res_voice',kind:'audio',durationSeconds:3};
 const evidence={sourceSha256:voice.sha256,durationSeconds:3,
  words:[{text:'Hello',start:1,end:1.5},{text:'world',start:1.5,end:2}]};
 const parent=await f.create('speech-parent',{aspects:['landscape'],audioSources:[voice],timingEvidence:[evidence]});
 const original=f.saved.get(parent.projects[0].revisionId).project;
 assert.ok(original.timingEvidenceRef);
 assert.ok(original.files.some(item=>item.sha256===voice.sha256),'the original Script-referenced voice source remains playable');
 const changed=await f.create('speech-child',{aspects:['landscape'],resources:[],baseRevision:parent.projects[0].revisionId,
  comments:[{text:'Move the headline slightly.',frame:30}]},[f.asset,voice]);
 assert.equal(changed.kind,'native_candidate');
 const next=f.saved.get(changed.projects[0].revisionId).project;
 assert.ok(next.files.some(item=>item.sha256===voice.sha256),'a geometry patch must retain referenced voice bytes');
 const kept=parseCanonicalJson(await f.bytes(f.env,next.files.find(item=>item.path==='script.json')));
 assert.equal(kept.segments.find(item=>item.id==='voice').timing.kind,'measured');
 assert.equal(next.timingEvidenceRef.sha256,original.timingEvidenceRef.sha256);
 assert.equal(parseCanonicalJson(await f.bytes(f.env,next.timingEvidenceRef)).length,1);
 assert.deepEqual(Object.keys(next.timingEvidenceRef).sort(),['byteLength','key','sha256']);
});

test('unused audio and its historical measured evidence cannot poison a later geometry patch',async t=>{
 const f=await fixture(t);
 const unused={...await f.put('evals/fixture/unused-voice.wav',Buffer.from('not used in the film'),'audio/wav'),
  resourceId:'res_unused_voice',kind:'audio',durationSeconds:3};
 const evidence={sourceSha256:unused.sha256,durationSeconds:3,words:[{text:'Unused',start:1,end:2}]};
 const parent=await f.create('unused-timing-parent',{aspects:['landscape'],audioSources:[unused],timingEvidence:[evidence]});
 const original=f.saved.get(parent.projects[0].revisionId).project;
 assert.ok(!original.files.some(item=>item.sha256===unused.sha256));
 assert.equal(original.timingEvidenceRef,undefined,'unused evidence is not stored in the final revision');
 const changed=await f.create('unused-timing-child',{aspects:['landscape'],resources:[],
  baseRevision:parent.projects[0].revisionId,comments:[{text:'Shift the layout a few pixels.',frame:90}]},[f.asset,unused]);
 assert.equal(changed.kind,'native_candidate');
});

test('replacing a measured audio source clears stale word clocks and keeps only retained evidence',async t=>{
 const f=await fixture(t,{measuredSpeech:true,selectVoice:true});
 const voice={...await f.put('evals/fixture/old-timed-voice.wav',Buffer.from('old timed voice'),'audio/wav'),
  resourceId:'res_voice',kind:'audio',durationSeconds:3};
 const first={sourceSha256:voice.sha256,durationSeconds:3,
  words:[{text:'Hello',start:1,end:1.5},{text:'world',start:1.5,end:2}]};
 const parent=await f.create('timed-voice-parent',{aspects:['landscape'],audioSources:[voice],timingEvidence:[first]});
 const alternate={...await f.put('evals/fixture/new-timed-voice.wav',Buffer.from('new timed voice'),'audio/wav'),
  resourceId:'res_voice_new',kind:'audio',durationSeconds:3};
 const second={sourceSha256:alternate.sha256,durationSeconds:3,
  words:[{text:'Hello',start:2,end:2.5},{text:'world',start:2.5,end:3}]};
 const changed=await f.create('timed-voice-child',{aspects:['landscape'],resources:[],audioSources:[alternate],
  timingEvidence:[second],baseRevision:parent.projects[0].revisionId,
  materialReplacements:[{fromResourceId:'res_voice',toResourceId:'res_voice_new'}],comments:[]},[f.asset,voice]);
 const project=f.saved.get(changed.projects[0].revisionId).project;
 const script=parseCanonicalJson(await f.bytes(f.env,project.files.find(item=>item.path==='script.json')));
 assert.equal(script.moments.find(item=>item.id==='spoken').resourceIds[0],alternate.resourceId);
 assert.equal(script.moments.find(item=>item.id==='spoken').timing.kind,'authored');
 assert.equal(script.segments.find(item=>item.id==='voice').timing.kind,'authored');
 assert.ok(!project.files.some(item=>item.sha256===voice.sha256));
 assert.ok(project.files.some(item=>item.sha256===alternate.sha256));
 const retained=parseCanonicalJson(await f.bytes(f.env,project.timingEvidenceRef));
 assert.deepEqual(retained.map(item=>item.sourceSha256),[alternate.sha256]);
});

test('a geometry patch cannot smuggle a different SHA under a Script-only audio resource ID',async t=>{
 const f=await fixture(t,{measuredSpeech:true});
 const voice={...await f.put('evals/fixture/voice-old.wav',Buffer.from('recording A'),'audio/wav'),
  resourceId:'res_voice',kind:'audio',durationSeconds:3};
 const evidence={sourceSha256:voice.sha256,durationSeconds:3,
  words:[{text:'Hello',start:1,end:1.5},{text:'world',start:1.5,end:2}]};
 const parent=await f.create('locked-voice-parent',{aspects:['landscape'],audioSources:[voice],timingEvidence:[evidence]});
 const other={...await f.put('evals/fixture/voice-other.wav',Buffer.from('recording B'),'audio/wav'),
  resourceId:'res_voice',kind:'audio',durationSeconds:3};
 const changed=await f.create('locked-voice-child',{aspects:['landscape'],resources:[],audioSources:[other],
  baseRevision:parent.projects[0].revisionId,comments:[{text:'Move the title 5 pixels.',frame:60}]},[f.asset,voice]);
 const project=f.saved.get(changed.projects[0].revisionId).project;
 assert.ok(project.files.some(item=>item.sha256===voice.sha256));
 assert.ok(!project.files.some(item=>item.sha256===other.sha256),
  'a re-admitted same-ID SHA is not automatically made executable by a Script-only audio reference');
 assert.equal(parseCanonicalJson(await f.bytes(f.env,project.files.find(file=>file.path==='script.json')))
  .segments.find(item=>item.id==='voice').timing.sourceSha256,voice.sha256);
 assert.equal(changed.scriptImpact,null);
});

test('Script-only audio can be explicitly replaced and its obsolete measured clock is retired',async t=>{
 const f=await fixture(t,{measuredSpeech:true});
 const voice={...await f.put('evals/fixture/only-voice.wav',Buffer.from('old voice'),'audio/wav'),
  resourceId:'res_voice',kind:'audio',durationSeconds:3};
 const parent=await f.create('script-only-voice-parent',{aspects:['landscape'],audioSources:[voice],
  timingEvidence:[{sourceSha256:voice.sha256,durationSeconds:3,words:[{text:'Hello',start:1,end:1.5},{text:'world',start:1.5,end:2}]}]});
 const replacement={...await f.put('evals/fixture/only-voice-new.wav',Buffer.from('new voice'),'audio/wav'),
  resourceId:'res_voice_new',kind:'audio',durationSeconds:3};
 const changed=await f.create('script-only-voice-child',{aspects:['landscape'],resources:[],audioSources:[replacement],
  baseRevision:parent.projects[0].revisionId,materialReplacements:[{fromResourceId:'res_voice',toResourceId:'res_voice_new'}],
  comments:[]},[f.asset,voice]);
 const project=f.saved.get(changed.projects[0].revisionId).project;
 assert.ok(!project.files.some(item=>item.sha256===voice.sha256));
 assert.ok(project.files.some(item=>item.sha256===replacement.sha256));
 assert.equal(project.timingEvidenceRef,undefined,'removing the last measured source must clear inherited timing evidence');
 const script=parseCanonicalJson(await f.bytes(f.env,project.files.find(item=>item.path==='script.json')));
 assert.deepEqual(script.moments.find(item=>item.id==='spoken').resourceIds,['res_voice_new']);
 assert.equal(script.segments.find(item=>item.id==='voice').timing.kind,'authored');
 assert.equal(changed.scriptImpact.changed,true);
});

test('an explicit same-ID new-SHA audio replacement is legal, updates executable bytes and retires measured timing',async t=>{
 const f=await fixture(t,{measuredSpeech:true,explicitSameIdAudio:true});
 const voice={...await f.put('evals/fixture/same-id-a.wav',Buffer.from('version A'),'audio/wav'),
  resourceId:'res_voice',kind:'audio',durationSeconds:3};
 const evidence={sourceSha256:voice.sha256,durationSeconds:3,
  words:[{text:'Hello',start:1,end:1.5},{text:'world',start:1.5,end:2}]};
 const parent=await f.create('same-id-a',{aspects:['landscape'],audioSources:[voice],timingEvidence:[evidence]});
 const next={...await f.put('evals/fixture/same-id-b.wav',Buffer.from('version B'),'audio/wav'),
  resourceId:'res_voice',kind:'audio',durationSeconds:3};
 const changed=await f.create('same-id-b',{aspects:['landscape'],resources:[],audioSources:[next],
  baseRevision:parent.projects[0].revisionId,materialReplacements:[{fromResourceId:'res_voice',toResourceId:'res_voice'}],
  comments:[]},[f.asset,voice]);
 const project=f.saved.get(changed.projects[0].revisionId).project;
 assert.ok(!project.files.some(item=>item.sha256===voice.sha256));
 assert.ok(project.files.some(item=>item.sha256===next.sha256));
 assert.equal(project.timingEvidenceRef,undefined);
 const authored=parseCanonicalJson(await f.bytes(f.env,project.files.find(item=>item.path==='script.json')));
 assert.deepEqual(authored.moments.find(item=>item.id==='spoken').resourceIds,['res_voice']);
 assert.equal(authored.segments.find(item=>item.id==='voice').timing.kind,'authored');
 assert.equal(authored.moments.find(item=>item.id==='spoken').timing.kind,'authored');
 assert.equal(changed.scriptImpact.changed,true);
});

test('multi-aspect patch rejects incompatible Script-only audio SHA locks before author calls',async t=>{
 const f=await fixture(t,{authoredSpeech:true});
 const audio={...await f.put('evals/fixture/multi-a.wav',Buffer.from('sound A'),'audio/wav'),
  resourceId:'res_voice',kind:'audio',durationSeconds:3};
 const parent=await f.create('multi-voice-base',{audioSources:[audio]});
 const alt={...await f.put('evals/fixture/multi-b.wav',Buffer.from('sound B'),'audio/wav'),
  resourceId:'res_voice',kind:'audio',durationSeconds:3};
 const original=f.saved.get(parent.projects[1].revisionId).project;
 const originalPath='assets/'+audio.sha256.slice(0,24)+'.wav';
 const alternatePath='assets/'+alt.sha256.slice(0,24)+'.wav';
 const oldHtml=new TextDecoder().decode(await f.bytes(f.env,original.files.find(file=>file.path==='index.html')));
 const html=await f.put('evals/fixture/multi-portrait.html',new TextEncoder().encode(oldHtml.replace(originalPath,alternatePath)),'text/html');
 const revised=await f.save(f.env,{id:'multi-portrait'},
  {composition:original.composition,files:[...original.files.filter(file=>file.path!=='index.html'&&file.path!==originalPath),
   {path:'index.html',key:html.key,sha256:html.sha256,byteLength:html.byteLength,mediaType:html.mediaType},
   {path:alternatePath,key:alt.key,sha256:alt.sha256,byteLength:alt.byteLength,mediaType:alt.mediaType}],
   resources:[...original.resources,{resourceId:'res_voice',sha256:alt.sha256,sourceSha256:alt.sha256,
    sourcePath:alternatePath,kind:'audio',durationSeconds:3}]});
 const before=f.calls.length;
 await assert.rejects(f.create('multi-voice-child',{resources:[],baseRevisions:{landscape:parent.projects[0].revisionId,
  portrait:revised.revisionId},comments:[{text:'Nudge the title.',frame:100}]},[f.asset,audio,alt]),
 /NATIVE_PATCH_PRODUCTION_DOCUMENT_CONFLICT/);
 assert.equal(f.calls.length,before);
});

test('an imported native project without BRIEF.md or Script remains editable',async t=>{
 const f=await fixture(t);
 const html=await f.put('evals/fixture/imported.html',new TextEncoder().encode(
  '<!doctype html><html><body><div data-composition-id="film" data-width="1920" data-height="1080" data-duration="15" data-fps="30"><h1>PROMO_ORIGINAL</h1></div></body></html>'),'text/html');
 const {key,sha256,byteLength,mediaType}=html;
 const imported=await f.save(f.env,{id:'imported-base'},
  {composition:{durationSeconds:15,fps:30,width:1920,height:1080},files:[{path:'index.html',key,sha256,byteLength,mediaType}],resources:[]});
 assert.ok(!imported.project.files.some(file=>file.path==='BRIEF.md'));
 const changed=await f.create('imported-child',{aspects:['landscape'],resources:[],baseRevision:imported.revisionId,
  comments:[{text:'Shift the headline.',frame:30}]});
 assert.equal(changed.kind,'native_candidate');
 assert.equal(changed.scriptKey,null);
 assert.ok(f.saved.get(changed.projects[0].revisionId).project.files.some(file=>file.path==='BRIEF.md'));
});

test('an incomplete recompose is corrected before it can count as a valid model response',async t=>{
 const f=await fixture(t,{invalidRecomposeOnce:true});
 const result=await f.create('recompose-correction',{aspects:['landscape','portrait']});
 assert.equal(result.kind,'native_candidate');
 const attempts=f.calls.filter(call=>call.callId.includes('-recompose-portrait'));
 assert.equal(attempts.length,2);
 assert.match(attempts[1].callId,/-correct$/);
 const project=f.saved.get(result.projects[1].revisionId).project;
 const file=project.files.find(item=>item.path==='index.html');
 assert.match(new TextDecoder().decode(await f.bytes(f.env,file)),/PROMO_PROMISE/);
});

test('candidate submission includes rights inherited from an earlier native revision',async t=>{
 const f=await fixture(t),original=await f.create('candidate-parent',{aspects:['landscape']});
 const patch=await f.create('candidate-child',{aspects:['landscape'],resources:[],baseRevision:original.projects[0].revisionId,
  comments:[{text:'Update the title.',frame:90,elementId:'title'}]},[f.asset]);
 assert.equal(patch.kind,'native_candidate');
 assert.ok(f.committedResources.some(resource=>resource.resourceId===f.asset.resourceId&&resource.sha256===f.asset.sha256),
  'a patch must recheck inherited media rights even when the new request has no resources');
});

test('Script-only user edits preserve locked assets and create a new revision with explicit QA invalidation',async t=>{
 const f=await fixture(t),parent=await f.create('script-parent',{aspects:['landscape']});
 const original=f.saved.get(parent.projects[0].revisionId).project;
 const child=await f.create('script-child',{aspects:['landscape'],resources:[f.asset],baseRevision:parent.projects[0].revisionId,
  comments:[],scriptEdits:[{segmentId:'title',field:'displayText',value:'PROMO_IMPROVED'}]});
 assert.equal(child.kind,'native_candidate');
 assert.equal(child.scriptImpact.changed,true);
 assert.equal(child.scriptImpact.qualityReportsReusable,false);
 assert.deepEqual(child.scriptImpact.segmentIds,['title']);
 assert.deepEqual(child.scriptImpact.affectedAssetLocks,[]);
 assert.equal(child.selectionKey!==null,true);
 assert.equal(child.scriptKey!==null,true);
 assert.equal(child.referenceAnalysisKey,null);
 const next=f.saved.get(child.projects[0].revisionId).project;
 assert.deepEqual(next.resources,original.resources);
 const html=next.files.find(file=>file.path==='index.html');
 const text=new TextDecoder().decode(await f.bytes(f.env,html));assert.match(text,/PROMO_IMPROVED/);
 const scriptDoc=next.files.find(file=>file.path==='script.json');
 const updated=parseCanonicalJson(await f.bytes(f.env,scriptDoc));
 assert.equal(updated.segments[0].displayText,'PROMO_IMPROVED');
 assert.equal(f.calls.filter(call=>call.operationId==='script-child'&&['script','selection','directions'].includes(call.stage)).length,0);
});

test('patching a parent without re-admitting inherited media fails before a paid model call',async t=>{
 const f=await fixture(t),original=await f.create('rights-parent',{aspects:['landscape']});
 const paidCalls=f.calls.length;
 await assert.rejects(f.create('rights-child',{aspects:['landscape'],resources:[],baseRevision:original.projects[0].revisionId,
  comments:[{text:'Update the title.',frame:90,elementId:'title'}]}),/ASSET_RIGHTS_PENDING/);
 assert.equal(f.calls.length,paidCalls,'missing inherited rights must not start another author model call');
 assert.equal(f.db.prepare('SELECT status FROM pipeline_operations WHERE id=?').get('rights-child').status,'failed');
});
test('malformed Director context is rejected before any model or native render work',async t=>{
 const f=await fixture(t);
 const invalid=[
  {facts:[null]},
  {facts:[{id:['fact_product'],text:'Invalid identity'}]},
  {confirmedFactIds:['fact_product','extra_fact']},
  {aspects:[['landscape']]},
  {rendererRelease:['renderer-native']},
  {resources:[null]},
  {resources:[f.asset,{...f.asset,sha256:'b'.repeat(64)}]},
  {resources:[f.asset,{...f.asset,kind:'video'}]},
  {resources:[f.asset],audioSources:[{...f.asset,kind:'audio'}]},
  {audioSources:{toString:null}},
  {audioSources:[{resourceId:'res_audio',sha256:['a'.repeat(64)],key:'evals/audio.wav',byteLength:123}]},
  {baseRevision:'a'.repeat(64),comments:[null]},
 ];
 for(const [index,context] of invalid.entries())
  await assert.rejects(f.create('invalid-context-'+index,context),/DIRECTOR_(?:INPUT|PATCH)_INVALID/);
 assert.equal(f.calls.length,0);
 assert.equal(f.jobs.length,0);
});
test('stale or ambiguous native patches are atomic, and sampled frames obey the exact delivery clock',()=>{
 const files=[{path:'index.html',content:'<h1>One</h1><p>One</p>'}],original=structuredClone(files);
 assert.throws(()=>applyProjectPatch(files,'a'.repeat(64),{baseRevision:'b'.repeat(64),edits:[]}),/NATIVE_REVISION_CONFLICT/);
 assert.throws(()=>applyProjectPatch(files,'a'.repeat(64),{baseRevision:'a'.repeat(64),edits:[{command:'replace',path:'index.html',oldText:'One',newText:'Two'}]}),/NATIVE_PATCH_MATCH_INVALID/);
 assert.throws(()=>applyProjectPatch([{path:'index.html',content:'aaa'}],'a'.repeat(64),{baseRevision:'a'.repeat(64),edits:[{command:'replace',path:'index.html',oldText:'aa',newText:'b'}]}),/NATIVE_PATCH_MATCH_INVALID/);
 assert.deepEqual(files,original);assert.deepEqual(reviewFrameTimes([90,240],15),[0,3,8,449/30]);assert.throws(()=>reviewFrameTimes([450],15),/NATIVE_REVIEW_FRAMES_INVALID/);
 const source={sha256:'a'.repeat(64),kind:'audio',path:'assets/voice.wav',durationSeconds:3},timing={sourceSha256:source.sha256,durationSeconds:3,words:[{text:'Reveal',start:1,end:1.5}]};
 assert.equal(normalizeTimingEvidence([timing],[source])[0].words[0].start,1);
 assert.throws(()=>normalizeTimingEvidence([timing,{...timing,words:[{text:'Different',start:2,end:2.5}]}],[source]),/NATIVE_TIMING_EVIDENCE_INVALID/);
 assert.throws(()=>normalizeTimingEvidence([{...timing,sourceSha256:'b'.repeat(64)}],[source]),/NATIVE_TIMING_EVIDENCE_INVALID/);
 assert.throws(()=>normalizeTimingEvidence([{...timing,durationSeconds:3.1}],[source]),/NATIVE_TIMING_EVIDENCE_INVALID/);
 assert.throws(()=>normalizeTimingEvidence([null],[source]),/NATIVE_TIMING_EVIDENCE_INVALID/);
 assert.throws(()=>normalizeTimingEvidence([{...timing,words:[null]}],[source]),/NATIVE_TIMING_EVIDENCE_INVALID/);
});

test('an export without encoded review evidence never becomes a delivered candidate',async t=>{
 const f=await fixture(t,{missingEncoded:true});
 await assert.rejects(f.create('missing-evidence-fixture',{aspects:['landscape']}),/NATIVE_ENCODED_REVIEW_MISSING/);
 assert.equal(f.db.prepare('SELECT status FROM pipeline_operations WHERE id=?').get('missing-evidence-fixture').status,'failed');
});
test('a repair-limit draft exposes its latest preview through the same renders artifact manifest',async t=>{
 const f=await fixture(t,{reviewAlwaysRevise:true}),result=await f.create('repair-limit-fixture',{aspects:['landscape']});
 assert.equal(result.kind,'native_review_draft');
 const stored=await f.env.MEDIA.get(result.key),draft=parseCanonicalJson(new Uint8Array(await stored.arrayBuffer()));
 assert.equal(draft.renders.at(-1).renderId,draft.preview.renderId);
 assert.ok(draft.renders.at(-1).result.outputs.some(output=>output.mediaType==='image/png'));
 assert.equal(f.db.prepare('SELECT status FROM pipeline_operations WHERE id=?').get('repair-limit-fixture').status,'failed');
});
test('a legacy context is fenced before a new native workflow or failure can modify it',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.create('legacy-fixture',{legacyEngine:true}),/LEGACY_WORKFLOW_REQUIRES_RECONCILIATION/);
 assert.equal(f.calls.length,0);assert.equal(f.jobs.length,0);
 assert.equal(f.db.prepare('SELECT status FROM pipeline_operations WHERE id=?').get('legacy-fixture').status,'active');
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pipeline_workflows').get().n,0);
});
