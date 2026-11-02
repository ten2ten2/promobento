// Offline control-flow evidence. Models and the native container are fixture adapters, not quality/paid-call evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest,sha256Bytes} from '@promobento/contracts/digest';
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
async function fixture(t,{missingEncoded=false,reviewAlwaysRevise=false,dropRenderEvents=false,transientRenderStatus=false,parallelDelay=false}={}){
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
   const project={schemaVersion:'1.0.0',kind:'native_project',entry:'index.html',runtime:{name:'huashu-motion',commit:nativeCommit},composition:input.composition,files:input.files,resources:input.resources};
   const revisionId=digest(project),manifest=await putJson('operations/'+op.id+'/native/'+revisionId+'/project.json',project),record={revisionId,manifestKey:manifest.key,project};saved.set(revisionId,record);return record;
  },
  async load(_env,_op,id){assert.ok(saved.has(id),'revision must already exist');return saved.get(id);},
  async render(_env,op,input){
   const project=saved.get(input.revisionId);assert.ok(project);jobs.push({...input,operationId:op.id});
   const outputs=[];for(const [index]of (input.mode==='preview'?input.frames:[0]).entries())outputs.push(await put('renders/'+input.renderId+'/'+index+(input.mode==='preview'?'.png':'.mp4'),png,input.mode==='preview'?'image/png':'video/mp4'));
   if(input.mode==='export'&&!missingEncoded)outputs.push({...await put('renders/'+input.renderId+'/review-sheet.jpg',png,'image/jpeg'),name:'review-sheet.jpg'});
   renders.set(input.renderId,{status:dropRenderEvents||transientRenderStatus?'queued':'passed',finished_at:Date.now(),result:{outputs,report:{pageErrors:[],previewFrameTimes:input.frames??[],projectHash:input.revisionId,...(input.mode==='export'?{reviewSheet:{source:'film.mp4',columns:2,rows:2,frames:[0,150,300,449],times:[0,5,10,449/30]}}:{})}}});return {renderId:input.renderId};
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
   else{
    let input;
    if(tool==='write_treatment')input={treatment:'The supplied product is the hero; a continuous reveal leads to the CTA.',beats:[{id:'hero',purpose:'Show the product and useful result',startFrame:0,endFrame:450,assetIds:['res_product']}],hardestBeat:'hero',reviewFrames:[0,90,240,449]};
    else if(tool==='write_project'){
     const shape=payload.composition,source=`<!doctype html><html><head><script src="vendor/gsap.min.js"></script><script src="vendor/om.js"></script></head><body><div id="film" data-composition-id="film" data-width="${shape.width}" data-height="${shape.height}" data-duration="15" data-fps="30"><h1 data-om-id="title">PROMO_ORIGINAL</h1><img data-om-id="product" src="${payload.materials[0].path}"><i>HARD_STAGE</i></div><script>window.__timelines={film:gsap.timeline({paused:true}).to({},{duration:15})};</script></body></html>`;
     input={files:[{path:'index.html',content:source}],reviewFrames:[90,240],note:'A native fixture, with original source APIs.'};
    }else if(tool==='apply_project_patch'){
     const target=payload.comments?'PROMO_ORIGINAL':payload.review?'COMPLETE_STAGE':'HARD_STAGE';
     input={baseRevision:payload.baseRevision,edits:[{command:'replace',path:'index.html',oldText:target,newText:payload.comments?'PROMO_REVISED':payload.review?'COMPLETE_STAGE_REPAIRED':'COMPLETE_STAGE'}],reviewFrames:[90,240],note:'Exact native source revision.'};
     const replacement=payload.materials.find(material=>material.resourceId==='res_product_new');
     if(replacement){const oldPath=payload.sourceFiles.find(file=>file.path==='index.html').content.match(/src="(assets\/[^\"]+\.png)"/)[1];input.edits.push({command:'replace',path:'index.html',oldText:oldPath,newText:replacement.path});}
    }else if(tool==='submit_review')input={verdict:reviewAlwaysRevise?'revise':'pass',issues:reviewAlwaysRevise?[{detail:'Observed title overlap.',frames:[90]}]:[],note:'The supplied fixture frames received this mocked review.'};
    else throw Error('Unexpected fixture tool '+tool);
    value={toolCalls:[{id:'fixture',name:tool,arguments:canonical(input),input}]};
   }
   validate(value);return {value,cached:false};
  }
 };
 globalThis.__nativeDirectorFixture=f;t.after(()=>delete globalThis.__nativeDirectorFixture);
 const create=async(id,extra={},readmittedRights=[])=>{
  const context={audience:'software',brief:'Show this product.',videoLanguage:'en',durationSeconds:15,fps:30,aspects:['landscape','portrait'],rendererRelease:'renderer-native',facts:[{id:'fact_product',text:'The product does the described work.'}],confirmedFactIds:['fact_product'],resources:[asset],...extra};
  const request=await putJson('evals/fixture/'+id+'.json',context);
  db.prepare('INSERT INTO pipeline_operations(id,workspace_id,project_id,generation,purpose,status,request_hash,max_micros,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,'workspace','project',0,'evaluation','active',id,10000000,Date.now());
  db.prepare('INSERT INTO pipeline_contexts(operation_id,request_key,directing_method_key,engine) VALUES(?,?,?,?)').run(id,request.key,'evals/fixture/method.json',extra.legacyEngine?'legacy':'huashu');
  for(const resource of [...context.resources,...(context.audioSources??[]),...readmittedRights])db.prepare('INSERT INTO pipeline_rights(operation_id,resource_id,sha256,license_ref,evidence_key,scope) VALUES(?,?,?,?,?,?)').run(id,resource.resourceId,resource.sha256,'fixture','evals/fixture/evidence.json','internal_eval_only');
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
 return {create,calls,jobs,saved,db,env,asset,put,bytes:f.bytes,lostEvents,failedReads,parallel,get committedResources(){return f.committedResources;}};
}

test('director overlaps only independent stages, freezes per-card method language, and waits for all previews',async t=>{
 const f=await fixture(t,{parallelDelay:true});
 const second={...await f.put('evals/fixture/second.png',png,'image/png'),resourceId:'second',kind:'image',width:1,height:1};
 const third={...await f.put('evals/fixture/third.png',png,'image/png'),resourceId:'third',kind:'image',width:1,height:1};
 const candidate=await f.create('bounded-stages',{resources:[f.asset,second,third],aspects:['landscape']});
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
 const patch=await f.create('patch-fixture',{aspects:['landscape'],resources:[f.asset,replacement],baseRevision:original.revisionId,comments:[{text:'Change the headline and use the new screenshot.',frame:90,elementId:'title'}]});
 assert.notEqual(patch.projects[0].revisionId,original.revisionId);assert.equal(f.calls.filter(call=>call.operationId==='patch-fixture'&&call.stage==='directions').length,0);
 const changed=f.saved.get(patch.projects[0].revisionId).project.files.find(file=>file.path==='index.html');assert.match(new TextDecoder().decode(await f.bytes(f.env,changed)),/PROMO_REVISED/);
 const revised=f.saved.get(patch.projects[0].revisionId).project;
 assert.ok(revised.files.some(file=>file.sha256===replacement.sha256),'newly admitted media is included in the patched project');
 assert.ok(revised.files.some(file=>file.sha256===f.asset.sha256),'unchanged source media remains available');
 assert.ok(revised.resources.some(resource=>resource.resourceId===replacement.resourceId&&resource.sha256===replacement.sha256));
 assert.equal(new TextDecoder().decode(await f.bytes(f.env,source)),beforeText,'the parent revision remains unchanged');
});

test('candidate submission includes rights inherited from an earlier native revision',async t=>{
 const f=await fixture(t),original=await f.create('candidate-parent',{aspects:['landscape']});
 const patch=await f.create('candidate-child',{aspects:['landscape'],resources:[],baseRevision:original.projects[0].revisionId,
  comments:[{text:'Update the title.',frame:90,elementId:'title'}]},[f.asset]);
 assert.equal(patch.kind,'native_candidate');
 assert.ok(f.committedResources.some(resource=>resource.resourceId===f.asset.resourceId&&resource.sha256===f.asset.sha256),
  'a patch must recheck inherited media rights even when the new request has no resources');
});

test('patching a parent without re-admitting inherited media fails before a paid model call',async t=>{
 const f=await fixture(t),original=await f.create('rights-parent',{aspects:['landscape']});
 const paidCalls=f.calls.length;
 await assert.rejects(f.create('rights-child',{aspects:['landscape'],resources:[],baseRevision:original.projects[0].revisionId,
  comments:[{text:'Update the title.',frame:90,elementId:'title'}]}),/ASSET_RIGHTS_PENDING/);
 assert.equal(f.calls.length,paidCalls,'missing inherited rights must not start another author model call');
 assert.equal(f.db.prepare('SELECT status FROM pipeline_operations WHERE id=?').get('rights-child').status,'failed');
});
test('stale or ambiguous native patches are atomic, and sampled frames obey the exact delivery clock',()=>{
 const files=[{path:'index.html',content:'<h1>One</h1><p>One</p>'}],original=structuredClone(files);
 assert.throws(()=>applyProjectPatch(files,'a'.repeat(64),{baseRevision:'b'.repeat(64),edits:[]}),/NATIVE_REVISION_CONFLICT/);
 assert.throws(()=>applyProjectPatch(files,'a'.repeat(64),{baseRevision:'a'.repeat(64),edits:[{command:'replace',path:'index.html',oldText:'One',newText:'Two'}]}),/NATIVE_PATCH_MATCH_INVALID/);
 assert.throws(()=>applyProjectPatch([{path:'index.html',content:'aaa'}],'a'.repeat(64),{baseRevision:'a'.repeat(64),edits:[{command:'replace',path:'index.html',oldText:'aa',newText:'b'}]}),/NATIVE_PATCH_MATCH_INVALID/);
 assert.deepEqual(files,original);assert.deepEqual(reviewFrameTimes([90,240],15),[0,3,8,449/30]);assert.throws(()=>reviewFrameTimes([450],15),/NATIVE_REVIEW_FRAMES_INVALID/);
 const source={sha256:'a'.repeat(64),kind:'audio',path:'assets/voice.wav',durationSeconds:3},timing={sourceSha256:source.sha256,durationSeconds:3,words:[{text:'Reveal',start:1,end:1.5}]};
 assert.equal(normalizeTimingEvidence([timing],[source])[0].words[0].start,1);
 assert.throws(()=>normalizeTimingEvidence([{...timing,sourceSha256:'b'.repeat(64)}],[source]),/NATIVE_TIMING_EVIDENCE_INVALID/);
 assert.throws(()=>normalizeTimingEvidence([{...timing,durationSeconds:3.1}],[source]),/NATIVE_TIMING_EVIDENCE_INVALID/);
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
