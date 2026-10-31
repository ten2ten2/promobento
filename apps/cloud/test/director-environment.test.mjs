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
   if(film.scenes[0].block==='object-studio@1'||film.scenes[0].runtime3D==='om3-studio-v1'){assert.equal(task.instance,'standard-4');assert.equal(task.options.initTimeoutMs,60000);return canonical({status:'ready',webgl:oldRenderer?[]:[{renderer:'fixture'}]});}
   assert.equal(task.instance,'standard-3');return canonical({status:'ready'});},
  async frame(){return new Response(new Uint8Array([137,80,78,71,13,10,26,10]));},async closeStudio(){closes++;}
 };}}};
 const check=()=>directorEnvironment(env,op,context,[],Date.now()+60000,false,false,false,false,false,false,true);
 await check();await check();assert.equal(probes,1);assert.equal(closes,1);
 const custom=()=>directorEnvironment(env,op,context,[],Date.now()+60000,false,false,false,false,false,false,false,true);
 await custom();await custom();assert.equal(probes,2);assert.equal(cache.size,2);
 cache.clear();oldRenderer=true;await assert.rejects(custom(),/RENDER_PREFLIGHT_FAILED/);assert.equal(cache.size,0);
 await directorEnvironment(env,op,context,[],Date.now()+60000);assert.equal(probes,4,'an unsupported new studio does not disable old scenes');
});

test('Canvas title preflight requires an actual readable observation for the exact font and text',async t=>{
 const{db,DB}=sqliteD1();t.after(()=>db.close());const{objects,MEDIA}=memoryMedia(),image='sha256:'+'a'.repeat(64),cache=new Map();
 const op={id:'health-operation',generation:0};db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(op.id,'workspace','project',0,'evaluation','active','request',1000000,Date.now(),null,null);
 db.prepare('INSERT INTO renderer_releases VALUES(?,?,?,?,?)').run('health-release',image,'film-runtime-v1','evals/health/environment.json','active');
 const context={audience:'software',runtimeVersion:'film-runtime-v1',rendererRelease:'health-release',seed:'health',fonts:pageOptions('landscape',platform.aspectLayouts.landscape).fonts,confirmedFactIds:['confirmed-number']};
 let probes=0,closes=0,taskId,film,blocked=false;
 const env={DB,MEDIA,SHARDS:{getByName(){return{async imageDigest(){return image;}};}},COORDINATOR:{getByName(){return{async rendererHealth(key){return cache.get(key)??'null';},async rememberRendererHealth(key,value){cache.set(key,value);}};}},OPERATIONS:{getByName(){return{
  async studio(_id,text){const task=parseCanonicalJson(text);taskId=task.taskId;film=parseCanonicalJson(objects.get(task.inputs[0].key).bytes);probes++;assert.equal(film.scenes[0].block,'canvas-title@1');generateFilmPage(canonical(film),task.options);return canonical({status:'ready'});},
  async frame(){return new Response(new Uint8Array([137,80,78,71,13,10,26,10]));},
  async checkFrame(_id,frame){const text={slotId:'headline',sceneId:'health',text:film.texts.headline.text,box:{x:10,y:10,width:100,height:40},fonts:[{family:'fixture',glyphCount:1}],fallbackUsed:false,missingGlyphs:0,contrastRatio:5,insideSafeArea:true,clipped:blocked,covered:false};return Response.json({observation:{schemaVersion:'3.0.0',kind:'frame_observation',renderId:taskId,aspectId:'landscape',frame,texts:[text],regions:[],findings:blocked?[{code:'text-clipped',severity:'BLOCK',slotId:'headline'}]:[]}});},
  async closeStudio(){closes++;}
 };}}};
 const check=(text,factIds=[])=>directorEnvironment(env,op,context,[],Date.now()+60000,false,false,false,false,false,false,false,false,false,false,{...context.fonts[0],text,factIds});
 await check('HELLO');await check('HELLO');assert.equal(probes,1);
 blocked=true;await assert.rejects(check('WORLD'),/RENDER_CANVAS_TEXT_UNAVAILABLE/);assert.equal(cache.size,1);
 blocked=false;await check('WORLD');assert.equal(probes,3);assert.equal(closes,3);assert.equal(cache.size,2);
 await check('Model 2',['confirmed-number']);assert.equal(probes,4,'numeric text retains its confirmed fact binding');
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
