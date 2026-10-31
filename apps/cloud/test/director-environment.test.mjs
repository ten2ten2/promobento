import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {assertRenderTask} from '@promobento/contracts/render';
import {validate as validFilm} from '@promobento/contracts/validators/film';
import {sqliteD1} from './fixtures/sqlite.mjs';
import {memoryMedia} from './fixtures/media.mjs';
import {pageOptions} from '../../../packages/film-runtime/test/fixture.mjs';
import {generateFilmPage} from '../../../packages/film-runtime/src/page.ts';
import platform from '../../../config/platform-presets.json' with {type:'json'};
const preflight=await build({entryPoints:['apps/cloud/src/director-preflight.ts'],bundle:true,write:false,platform:'node',format:'esm',target:'node26'});
const{directorEnvironment}=await import('data:text/javascript;base64,'+Buffer.from(preflight.outputFiles[0].text).toString('base64'));

test('image/sandbox/broker preflight caches only stopped successful probes for ten minutes and fences changed images',async t=>{
 const{db,DB}=sqliteD1();t.after(()=>db.close());const{objects,MEDIA}=memoryMedia();let probes=0,closes=0,badFrame=false,stopFails=false;
 const op={id:'health-operation',generation:0},image='sha256:'+'a'.repeat(64);
 db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(op.id,'workspace','project',0,'evaluation','active','request',1000000,Date.now(),null,null);
 db.prepare('INSERT INTO renderer_releases VALUES(?,?,?,?,?)').run('health-release',image,'film-runtime-v1','evals/health/environment.json','active');
 const cache=new Map(),context={audience:'software',runtimeVersion:'film-runtime-v1',rendererRelease:'health-release',seed:'health',fonts:pageOptions('landscape',platform.aspectLayouts.landscape).fonts};
 const env={DB,MEDIA,SHARDS:{getByName(){return{async imageDigest(){return image;}};}},COORDINATOR:{getByName(){return{
  async rendererHealth(key){return cache.get(key)??'null';},async rememberRendererHealth(key,value){cache.set(key,value);}
 };}},OPERATIONS:{getByName(){return{
  async studio(_id,text){probes++;const{generation,imageDigest,deadlineAt,...task}=parseCanonicalJson(text);assertRenderTask({...task,brokerToken:'fixture-non-secret-token'});
   assert.equal(validFilm(parseCanonicalJson(objects.get(task.inputs[0].key).bytes)),true);return canonical({status:'ready'});},
  async frame(){return new Response(new Uint8Array(badFrame?[0]:[137,80,78,71,13,10,26,10]));},
  async closeStudio(){closes++;if(stopFails)throw Error('STOP_UNAVAILABLE');}
 };}}};
 await directorEnvironment(env,op,context,[],Date.now()+60000);await directorEnvironment(env,op,context,[],Date.now()+60000);
 assert.equal(probes,1);assert.equal(closes,1);assert.equal(cache.size,1);
 for(const[key,value]of cache){const record=parseCanonicalJson(value);record.checkedAt-=600001;cache.set(key,canonical(record));}
 await directorEnvironment(env,op,context,[],Date.now()+60000);assert.equal(probes,2);assert.equal(closes,2);
 cache.clear();badFrame=true;stopFails=true;
 await assert.rejects(directorEnvironment(env,op,context,[],Date.now()+60000),/RENDER_PREFLIGHT_FAILED/);assert.equal(cache.size,0);
 badFrame=false;await assert.rejects(directorEnvironment(env,op,context,[],Date.now()+60000),/STOP_UNAVAILABLE/);assert.equal(cache.size,0);
 db.prepare("UPDATE renderer_releases SET image_digest=?").run('sha256:'+'b'.repeat(64));
 await assert.rejects(directorEnvironment(env,op,context,[],Date.now()+60000),/RENDER_ENVIRONMENT_MISMATCH/);assert.equal(probes,4);
});

test('scene-scoped observation is probed before models without changing the legacy cache contract',async t=>{
 const{db,DB}=sqliteD1();t.after(()=>db.close());const{MEDIA}=memoryMedia();let probes=0,closes=0,taskId,oldRenderer=false;
 const op={id:'health-operation',generation:0},image='sha256:'+'a'.repeat(64),cache=new Map();
 db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(op.id,'workspace','project',0,'evaluation','active','request',1000000,Date.now(),null,null);
 db.prepare('INSERT INTO renderer_releases VALUES(?,?,?,?,?)').run('health-release',image,'film-runtime-v1','evals/health/environment.json','active');
 const context={audience:'software',runtimeVersion:'film-runtime-v1',rendererRelease:'health-release',seed:'health',fonts:pageOptions('landscape',platform.aspectLayouts.landscape).fonts};
 const env={DB,MEDIA,SHARDS:{getByName(){return{async imageDigest(){return image;}};}},COORDINATOR:{getByName(){return{async rendererHealth(key){return cache.get(key)??'null';},async rememberRendererHealth(key,value){cache.set(key,value);}};}},OPERATIONS:{getByName(){return{
  async studio(_id,text){const task=parseCanonicalJson(text);taskId=task.taskId;probes++;return canonical({status:'ready'});},async frame(){return new Response(new Uint8Array([137,80,78,71,13,10,26,10]));},
  async checkFrame(_id,frame){const text={slotId:'headline',...(!oldRenderer?{sceneId:'health'}:{}),text:'Render health check',box:{x:10,y:10,width:100,height:40},fonts:[{family:'fixture',glyphCount:1}],fallbackUsed:false,missingGlyphs:0,contrastRatio:5,insideSafeArea:true,clipped:false,covered:false};return Response.json({observation:{schemaVersion:'3.0.0',kind:'frame_observation',renderId:taskId,aspectId:'landscape',frame,texts:[text],regions:[],findings:[]}});},
  async closeStudio(){closes++;}
 };}}};
 await directorEnvironment(env,op,context,[],Date.now()+60000,true);await directorEnvironment(env,op,context,[],Date.now()+60000,true,true);await directorEnvironment(env,op,context,[],Date.now()+60000,true,true);
 assert.equal(probes,2);assert.equal(closes,2);assert.equal(cache.size,2);
 cache.clear();oldRenderer=true;await assert.rejects(directorEnvironment(env,op,context,[],Date.now()+60000,true,true),/RENDER_OBSERVATION_SCOPE_UNAVAILABLE/);assert.equal(cache.size,0);assert.equal(closes,3);
 await directorEnvironment(env,op,context,[],Date.now()+60000,true);assert.equal(probes,4,'older methods still work on the old renderer');
});

test('original 3D studio is probed only when requested, on a WebGL instance, before rendering',async t=>{
 const{db,DB}=sqliteD1();t.after(()=>db.close());const{objects,MEDIA}=memoryMedia();const image='sha256:'+'a'.repeat(64),cache=new Map();
 const op={id:'health-operation',generation:0};db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(op.id,'workspace','project',0,'evaluation','active','request',1000000,Date.now(),null,null);
 db.prepare('INSERT INTO renderer_releases VALUES(?,?,?,?,?)').run('health-release',image,'film-runtime-v1','evals/health/environment.json','active');
 const resource={resourceId:'res_fixture_dashboard',kind:'image',width:64,height:64,licenseRef:'fixture',key:'evals/fixture/image.png',sha256:'a'.repeat(64),byteLength:123};
 const context={audience:'software',runtimeVersion:'film-runtime-v1',rendererRelease:'health-release',seed:'health',fonts:pageOptions('landscape',platform.aspectLayouts.landscape).fonts,resources:[resource]};
 let oldRenderer=false,probes=0,closes=0;
 const env={DB,MEDIA,SHARDS:{getByName(){return{async imageDigest(){return image;}};}},COORDINATOR:{getByName(){return{async rendererHealth(key){return cache.get(key)??'null';},async rememberRendererHealth(key,value){cache.set(key,value);}};}},OPERATIONS:{getByName(){return{
  async studio(_id,text){const{generation,imageDigest,deadlineAt,...task}=parseCanonicalJson(text);probes++;assertRenderTask({...task,brokerToken:'fixture-non-secret-token'});
   const film=parseCanonicalJson(objects.get(task.inputs[0].key).bytes);
   if(film.scenes[0].block==='vox-clip@1'&&film.scenes[0].params.items[0].focus){assert.deepEqual(task.job.frames,[84]);assert.equal(film.scenes[0].params.intervalFrames,120);assert.deepEqual(film.assets.health.roi,[{x:.2,y:.2,width:.4,height:.4}]);}
   if(film.scenes[0].block==='object-studio@1'||['om3-studio-v1','om3-studio-v2','om3-studio-v3'].includes(film.scenes[0].runtime3D)){assert.equal(task.instance,'standard-4');assert.equal(task.options.initTimeoutMs,60000);
    if(film.scenes[0].runtime3D==='om3-studio-v2'){const module=task.inputs.find(item=>item.name==='scenes/health/index.js');assert.match(new TextDecoder().decode(objects.get(module.key).bytes),/objectYaw:15,objectScale:1/);}
    if(film.scenes[0].runtime3D==='om3-studio-v3'){const module=task.inputs.find(item=>item.name==='scenes/health/index.js');assert.match(new TextDecoder().decode(objects.get(module.key).bytes),/panels:\[\{x:2,scale:\.5,visible:true\}\]/);assert.deepEqual(film.scenes[0].params.assetKeys,['health','health-panel']);}
    return canonical({status:'ready',webgl:oldRenderer?[]:[{renderer:'fixture'}]});}
   assert.equal(task.instance,'standard-3');return canonical({status:'ready'});},
  async frame(){return new Response(new Uint8Array([137,80,78,71,13,10,26,10]));},async closeStudio(){closes++;}
 };}}};
 const check=()=>directorEnvironment(env,op,context,[],Date.now()+60000,false,false,false,false,false,false,true);
 await check();await check();assert.equal(probes,1);assert.equal(closes,1);
 const custom=()=>directorEnvironment(env,op,context,[],Date.now()+60000,false,false,false,false,false,false,false,true);
 await custom();await custom();assert.equal(probes,2);assert.equal(cache.size,2);
 const motion=()=>directorEnvironment(env,op,context,[],Date.now()+60000,false,false,false,false,false,false,false,'v2');
 await motion();await motion();assert.equal(probes,3);assert.equal(cache.size,3);
 const panels=()=>directorEnvironment(env,op,context,[],Date.now()+60000,false,false,false,false,false,false,false,'v3');
 await panels();await panels();assert.equal(probes,4);assert.equal(cache.size,4);
 const vox=()=>directorEnvironment(env,op,context,[],Date.now()+60000,false,false,false,false,false,false,false,false,false,true);
 const marked=()=>directorEnvironment(env,op,context,[],Date.now()+60000,false,false,false,false,false,false,false,false,false,'highlight');
 await vox();await marked();await marked();assert.equal(probes,6);assert.equal(cache.size,6);
 cache.clear();oldRenderer=true;await assert.rejects(custom(),/RENDER_PREFLIGHT_FAILED/);assert.equal(cache.size,0);
 await directorEnvironment(env,op,context,[],Date.now()+60000);assert.equal(probes,8,'an unsupported new studio does not disable old scenes');
});

test('Canvas title preflight requires an actual readable observation for the exact font and text',async t=>{
 const{db,DB}=sqliteD1();t.after(()=>db.close());const{objects,MEDIA}=memoryMedia(),image='sha256:'+'a'.repeat(64),cache=new Map();
 const op={id:'health-operation',generation:0};db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(op.id,'workspace','project',0,'evaluation','active','request',1000000,Date.now(),null,null);
 db.prepare('INSERT INTO renderer_releases VALUES(?,?,?,?,?)').run('health-release',image,'film-runtime-v1','evals/health/environment.json','active');
 const context={audience:'software',runtimeVersion:'film-runtime-v1',rendererRelease:'health-release',seed:'health',fonts:pageOptions('landscape',platform.aspectLayouts.landscape).fonts,confirmedFactIds:['confirmed-number']};
 let probes=0,closes=0,taskId,film,blocked=false,blockedFrame=-1;
 const env={DB,MEDIA,SHARDS:{getByName(){return{async imageDigest(){return image;}};}},COORDINATOR:{getByName(){return{async rendererHealth(key){return cache.get(key)??'null';},async rememberRendererHealth(key,value){cache.set(key,value);}};}},OPERATIONS:{getByName(){return{
  async studio(_id,text){const task=parseCanonicalJson(text);taskId=task.taskId;film=parseCanonicalJson(objects.get(task.inputs[0].key).bytes);probes++;assert.ok(['canvas-title@1','canvas-sequence@1','canvas-number@1'].includes(film.scenes[0].block));if(film.scenes[0].block==='canvas-sequence@1')assert.deepEqual(task.job.frames,[45,165]);if(film.scenes[0].block==='canvas-number@1')assert.deepEqual(task.job.frames,[0,45]);if(film.scenes[0].params.highlightFrame!==undefined)assert.deepEqual(task.job.frames,[45,film.scenes[0].params.highlightFrame+24]);generateFilmPage(canonical(film),task.options);return canonical({status:'ready'});},
  async frame(){return new Response(new Uint8Array([137,80,78,71,13,10,26,10]));},
  async checkFrame(_id,frame){const slotId=film.scenes[0].block==='canvas-sequence@1'?(frame<120?'headline-0':'headline-1'):'headline',bad=blocked||frame===blockedFrame;const text={slotId,sceneId:'health',text:film.texts[slotId].text,box:{x:10,y:10,width:100,height:40},fonts:[{family:'fixture',glyphCount:1}],fallbackUsed:false,missingGlyphs:0,contrastRatio:5,insideSafeArea:true,clipped:bad,covered:false};return Response.json({observation:{schemaVersion:'3.0.0',kind:'frame_observation',renderId:taskId,aspectId:'landscape',frame,texts:[text],regions:[],findings:bad?[{code:'text-clipped',severity:'BLOCK',slotId:'headline'}]:[]}});},
  async closeStudio(){closes++;}
 };}}};
 const check=(text,factIds=[])=>directorEnvironment(env,op,context,[],Date.now()+60000,false,false,false,false,false,false,false,false,false,false,{...context.fonts[0],text,factIds});
 await check('HELLO');await check('HELLO');assert.equal(probes,1);
 blocked=true;await assert.rejects(check('WORLD'),/RENDER_CANVAS_TEXT_UNAVAILABLE/);assert.equal(cache.size,1);
 blocked=false;await check('WORLD');assert.equal(probes,3);assert.equal(closes,3);assert.equal(cache.size,2);
 await check('Model 2',['confirmed-number']);assert.equal(probes,4,'numeric text retains its confirmed fact binding');
 const palette={bg:'#f9f9f9',ink:'#101010',accent:'#ff5a36'};
 const highlight=()=>directorEnvironment(env,op,context,[],Date.now()+60000,false,false,false,false,false,false,false,false,false,false,{...context.fonts[0],text:'HELLO',factIds:[],highlightFrame:45,palette});
 blockedFrame=69;await assert.rejects(highlight(),/RENDER_CANVAS_TEXT_UNAVAILABLE/);blockedFrame=-1;
 await highlight();assert.deepEqual(film.style.palette.roles,palette);await highlight();assert.equal(probes,6,'the exact highlighted title has its own renderer probe and rejected marker frames are not cached');
 palette.bg='#eeeeee';await highlight();assert.equal(probes,7,'a changed palette cannot reuse an earlier highlight probe');
 const number=()=>directorEnvironment(env,op,context,[],Date.now()+60000,false,false,false,false,false,false,false,false,false,false,{...context.fonts[0],text:'123',factIds:['confirmed-number'],number:true});
 await number();assert.equal(film.texts.headline.role,'number');assert.equal(probes,8);
 const pages=[{text:'HELLO',factIds:['confirmed-number']},{text:'WORLD',factIds:['confirmed-number']}];
 const sequence=()=>directorEnvironment(env,op,context,[],Date.now()+60000,false,false,false,false,false,false,false,false,false,false,{...context.fonts[0],...pages[0],pages});
 await sequence();await sequence();assert.equal(probes,9,'sequence preflights each actual page once per exact input');
 blocked=true;pages[1]={...pages[1],text:'OTHER'};await assert.rejects(sequence(),/RENDER_CANVAS_TEXT_UNAVAILABLE/);

});

test('studio ownership is persisted before execute; cancelled or failed startup cannot lose its cleanup handle',async t=>{
 const{outputFiles}=await build({entryPoints:['apps/cloud/src/compute.ts'],bundle:true,write:false,platform:'node',format:'esm',target:'node26',plugins:[{
  name:'do-fixture',setup(build){build.onResolve({filter:/^cloudflare:workers$/},()=>({path:'do',namespace:'fixture'}));
   build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'class Entrypoint {constructor(ctx,env){this.ctx=ctx;this.env=env;}} export class DurableObject extends Entrypoint {} export class WorkerEntrypoint extends Entrypoint {}',loader:'js'}));}
 }]});
 const{OperationDO}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
 const{db,DB}=sqliteD1();t.after(()=>db.close());db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('studio-operation','workspace','project',0,'evaluation','active','request',1000000,Date.now(),null,null);
 const values=new Map(),storage={get:async key=>values.get(key),put:async(key,value)=>values.set(key,value),delete:async key=>values.delete(key),
  transactionSync:fn=>fn(),kv:{get:key=>values.get(key),delete:key=>values.delete(key)}};
 let finish,started;const entered=new Promise(resolve=>started=resolve),waiting=new Promise(resolve=>finish=resolve);let stops=0,failStop=false;
 const env={DB,SHARDS:{getByName(){return{async execute(){assert.ok(values.get('studio'));started();return waiting;},async stopAndSettle(){stops++;if(failStop)throw Error('STOP_UNAVAILABLE');}};}}};
 const owner=new OperationDO({storage},env),task=canonical({taskId:'studio-test',generation:0,job:{operationId:'studio-operation'}});
 const pending=owner.studio('studio-operation',task);await entered;
 db.prepare("UPDATE pipeline_operations SET generation=1,status='cancelled'").run();await owner.closeStudio();finish(canonical({status:'ready'}));
 await assert.rejects(pending,/OPERATION_FENCED/);assert.equal(values.has('studio'),false);assert.equal(stops,2);
 db.prepare("UPDATE pipeline_operations SET generation=0,status='active'").run();
 env.SHARDS.getByName=()=>({async execute(){throw Error('START_FAILED');},async stopAndSettle(){if(failStop)throw Error('STOP_UNAVAILABLE');}});
 failStop=true;await assert.rejects(owner.studio('studio-operation',task),/START_FAILED/);assert.equal(values.get('studio').taskId,'studio-test');
 failStop=false;await owner.closeStudio();assert.equal(values.has('studio'),false);
});

test('original whiteboard preflight uses the exact cleared image and readable actual heading',async t=>{
 const{db,DB}=sqliteD1();t.after(()=>db.close());const{objects,MEDIA}=memoryMedia(),image='sha256:'+'a'.repeat(64),cache=new Map();
 const op={id:'whiteboard-operation',generation:0};db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(op.id,'workspace','project',0,'evaluation','active','request',1000000,Date.now(),null,null);
 db.prepare('INSERT INTO renderer_releases VALUES(?,?,?,?,?)').run('health-release',image,'film-runtime-v1','evals/health/environment.json','active');
 const resource={resourceId:'res_fixture_dashboard',kind:'image',width:64,height:64,licenseRef:'fixture',key:'evals/fixture/image.png',sha256:'a'.repeat(64),byteLength:123};
 const context={audience:'software',runtimeVersion:'film-runtime-v1',rendererRelease:'health-release',seed:'health',fonts:pageOptions('landscape',platform.aspectLayouts.landscape).fonts,resources:[resource]};
 let taskId,probes=0,blocked=false;
 const env={DB,MEDIA,SHARDS:{getByName(){return{async imageDigest(){return image;}};}},COORDINATOR:{getByName(){return{async rendererHealth(key){return cache.get(key)??'null';},async rememberRendererHealth(key,value){cache.set(key,value);}};}},OPERATIONS:{getByName(){return{
  async studio(_id,text){const task=parseCanonicalJson(text);taskId=task.taskId;probes++;const film=parseCanonicalJson(objects.get(task.inputs[0].key).bytes);
   assert.equal(film.scenes[0].block,'whiteboard-clip@1');assert.equal(film.assets.health.resourceId,resource.resourceId);assert.deepEqual(task.job.frames,[105]);generateFilmPage(canonical(film),task.options);return canonical({status:'ready'});},
  async frame(){return new Response(new Uint8Array([137,80,78,71,13,10,26,10]));},
  async checkFrame(_id,frame){return Response.json({observation:{schemaVersion:'3.0.0',kind:'frame_observation',renderId:taskId,aspectId:'landscape',frame,texts:[{slotId:'headline',sceneId:'health',text:'Render health check',box:{x:10,y:10,width:100,height:40},fonts:[{family:'fixture',glyphCount:5}],fallbackUsed:false,missingGlyphs:0,contrastRatio:5,insideSafeArea:true,clipped:blocked,covered:false}],regions:[],findings:blocked?[{code:'text-clipped',severity:'BLOCK',slotId:'headline'}]:[]}});},
  async closeStudio(){}
 };}}};
 const check=()=>directorEnvironment(env,op,context,[],Date.now()+60000,false,false,false,false,false,false,false,false,false,false,undefined,true);
 await check();await check();assert.equal(probes,1);
 resource.sha256='b'.repeat(64);blocked=true;await assert.rejects(check(),/RENDER_CANVAS_TEXT_UNAVAILABLE/);assert.equal(probes,2);
});

test('keynote preflight binds the cleared image and separately probes the original highlight',async t=>{
 const{db,DB}=sqliteD1();t.after(()=>db.close());const{objects,MEDIA}=memoryMedia(),image='sha256:'+'a'.repeat(64),cache=new Map();
 const op={id:'keynote-operation',generation:0};db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(op.id,'workspace','project',0,'evaluation','active','request',1000000,Date.now(),null,null);
 db.prepare('INSERT INTO renderer_releases VALUES(?,?,?,?,?)').run('health-release',image,'film-runtime-v1','evals/health/environment.json','active');
 const resource={resourceId:'res_fixture_dashboard',kind:'image',width:64,height:64,licenseRef:'fixture',key:'evals/fixture/image.png',sha256:'a'.repeat(64),byteLength:123};
 const context={audience:'software',runtimeVersion:'film-runtime-v1',rendererRelease:'health-release',seed:'health',fonts:pageOptions('landscape',platform.aspectLayouts.landscape).fonts,resources:[resource]};
 let probes=0,expectedFrame=165;
 const env={DB,MEDIA,SHARDS:{getByName(){return{async imageDigest(){return image;}};}},COORDINATOR:{getByName(){return{async rendererHealth(key){return cache.get(key)??'null';},async rememberRendererHealth(key,value){cache.set(key,value);}};}},OPERATIONS:{getByName(){return{
  async studio(_id,text){const task=parseCanonicalJson(text);probes++;const film=parseCanonicalJson(objects.get(task.inputs[0].key).bytes);
   assert.equal(film.scenes[0].block,'keynote-clip@1');assert.equal(film.assets.health.resourceId,resource.resourceId);
   expectedFrame=film.scenes[0].params.items[0].focus?84:165;assert.deepEqual(task.job.frames,[expectedFrame]);
   if(expectedFrame===84)assert.deepEqual(film.assets.health.roi,[{x:.2,y:.2,width:.4,height:.4}]);
   generateFilmPage(canonical(film),task.options);return canonical({status:'ready'});},
  async frame(_id,frame){assert.equal(frame,expectedFrame);return new Response(new Uint8Array([137,80,78,71,13,10,26,10]));},async closeStudio(){}
 };}}};
 const check=()=>directorEnvironment(env,op,context,[],Date.now()+60000,false,false,false,false,false,false,false,false,false,false,undefined,false,true);
 const marked=()=>directorEnvironment(env,op,context,[],Date.now()+60000,false,false,false,false,false,false,false,false,false,false,undefined,false,'highlight');
 await check();await check();await marked();await marked();assert.equal(probes,2);resource.sha256='b'.repeat(64);await check();await marked();assert.equal(probes,4);
});
