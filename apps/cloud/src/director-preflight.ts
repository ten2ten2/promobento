import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest} from '@promobento/contracts/digest';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {validate as validObservation} from '@promobento/contracts/validators/frame-observation';
import platform from '../../../config/platform-presets.json';
import {operation,rights,immutableJson,immutableBytes} from './store.ts';
import type {PipelineEnv,Operation,Json} from './pipeline-types.ts';

const cacheMs=10*60000;
/** Probe the actual image, Chromium sandbox and broker/R2 before a paid model request. */
export async function directorEnvironment(env:PipelineEnv,op:Operation,context:Json,resources:Json[],deadlineAt:number,customScenes=false,sceneScopedObservation=false,assetScopedObservation=false,fadeThrough=false,componentRelay=false){
 if(sceneScopedObservation&&!customScenes||assetScopedObservation&&!sceneScopedObservation||componentRelay&&(customScenes||fadeThrough))throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
 await operation(env,op.id,op.generation);await rights(env,op,resources);
 const release=await env.DB.prepare("SELECT * FROM renderer_releases WHERE id=? AND status='active'").bind(context.rendererRelease).first<Json>();
 if(!release||release.runtime_version!==context.runtimeVersion||release.image_digest!==await env.SHARDS.getByName('release-metadata').imageDigest())throw Error('RENDER_ENVIRONMENT_MISMATCH');
 const coordinator=env.COORDINATOR.getByName('global-v1'),cacheKey=digest({release:release.id,image:release.image_digest,runtime:release.runtime_version,environment:release.environment_key,...(customScenes?{customScenes:true}:{}),...(sceneScopedObservation?{sceneScopedObservation:true}:{}),...(assetScopedObservation?{assetScopedObservation:true}:{}),...(fadeThrough?{fadeThrough:true}:{}),...(componentRelay?{componentRelay:true}:{})});
 const cached=parseCanonicalJson(await coordinator.rendererHealth(cacheKey)) as Json|null;
 if(cached&&cached.checkedAt<=Date.now()&&Date.now()-cached.checkedAt<cacheMs)return;
 if(Date.now()>=deadlineAt)throw Error('OPERATION_DEADLINE');
 const font=context.fonts?.[0];if(!font)throw Error('DIRECTOR_INPUT_INVALID');
 const film:Json={schemaVersion:'3.0.0',specVersion:'film-v1',audience:context.audience,durationSeconds:15,fps:30,totalFrames:450,
  style:{palette:{roles:{bg:'#101712',ink:'#f4f8ee',accent:'#d9fa73'},sources:{bg:'preflight',ink:'preflight',accent:'preflight'}},
   type:{display:{fontId:font.fontId,weight:font.weight},text:{fontId:font.fontId,weight:font.weight},scale:'regular'},
   motion:{language:'continuous-take',energy:1,easing:'expo-out',transitions:'tight'}},
  audio:{music:{kind:'none'},sfx:[],captions:'off',mute:true},assets:{},texts:{headline:{text:'Render health check',role:'headline',factIds:[]}},
  scenes:[{id:'health',start:0,end:450,kind:'block',block:'hook-title@1',params:{textSlot:'headline'},purpose:'Private renderer health probe.'}],
  treatment:{message:'Private renderer health probe.',hook:'Readiness only.',energyCurve:[{frame:0,level:1},{frame:449,level:1}],continuity:'Single trusted block.'}};
 const sources:Record<string,string>={},asset=assetScopedObservation||componentRelay?context.resources.find((item:Json)=>['image','svg'].includes(item.kind)):undefined;
 if(assetScopedObservation&&!asset)throw Error('RENDER_ASSET_OBSERVATION_UNAVAILABLE');
 if(componentRelay&&!asset)throw Error('RENDER_COMPONENT_RELAY_UNAVAILABLE');
 const healthEnd=fadeThrough?240:450;
 if(customScenes){
  if(asset)film.assets.health={resourceId:asset.resourceId};
  film.scenes=[{id:'health',start:0,end:healthEnd,kind:'custom',module:'scenes/health/index.js',brief:'Private custom runtime health probe.',purpose:'Private renderer health probe.',
   params:{textSlots:['headline'],assetKeys:asset?['health']:[],events:[],readingHolds:[{start:30,end:healthEnd}],...(asset?{assetChecks:[{frame:45,assetKeys:['health']}]}:{})}}];
  sources['scenes/health/index.js']='PB.scene("health",ctx=>{const panel=document.createElement("div");Object.assign(panel.style,{position:"absolute",left:"10%",top:"30%",width:"80%",height:"40%"});ctx.root.append(panel);ctx.text("headline").mount(panel);'+
   (asset?'const img=document.createElement("img");img.src=ctx.asset("health").url;Object.assign(img.style,{position:"absolute",left:"10%",top:"5%",width:"15%",height:"20%",objectFit:"contain"});ctx.root.append(img);':'')+
   `const timeline=gsap.timeline({paused:true});timeline.to({}, {duration:${healthEnd/30}});return {timeline};});`;
 }
 if(componentRelay){
  film.assets.health={resourceId:asset.resourceId,roi:[{x:.2,y:.2,width:.4,height:.4}]};
  film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'component-relay@1',
   params:{textSlot:'headline',focus:'roi:0',beatFrames:6,items:[{assetKey:'health'},{assetKey:'health'}]},purpose:'Probe component relay support.'}];
 }
 if(fadeThrough){film.scenes[0].end=healthEnd;film.scenes.push({id:'health-end',start:healthEnd-8,end:450,kind:'block',block:'hook-title@1',params:{textSlot:'headline'},
  transitionIn:{type:'fade-through',frames:8},purpose:'Check the supported fade-through transition.'});}
 const taskId='health-'+crypto.randomUUID(),source=await immutableJson(env,`operations/${op.id}/health/${taskId}/film.json`,film),modules=[];
 for(const [path,text]of Object.entries(sources))modules.push({...await immutableBytes(env,`operations/${op.id}/health/${taskId}/${path}`,new TextEncoder().encode(text),'text/javascript'),name:path});
 const aspect='landscape',layout=platform.aspectLayouts.landscape;
 const task={schemaVersion:'3.0.0',kind:'render_task',mode:'studio',instance:'standard-3',taskId,generation:op.generation,
  deadlineAt:Math.min(deadlineAt,Date.now()+90000),imageDigest:release.image_digest,
  job:{schemaVersion:'3.0.0',kind:'render_job',renderId:taskId,operationId:op.id,candidateId:taskId,sourceHash:filmSourceHash(canonical(film),sources),
   runtimeVersion:context.runtimeVersion,rendererRelease:release.id,aspectId:aspect,durationSeconds:15,totalFrames:450,quality:'still',frames:[45],
   renderProfile:{sampleCount:1,shutterAngle:0,sampling:'centered-box-v1',edgePolicy:'clamp-v1'},resources},
  options:{target:{aspect,width:layout.width,height:layout.height,safeInsets:layout.safeInsets,fps:30,totalFrames:450},seed:context.seed,
   fonts:context.fonts,resources:asset?[{resourceId:asset.resourceId,kind:asset.kind,width:asset.width,height:asset.height,licenseRef:asset.licenseRef,rightsCleared:true}]:[],
   confirmedFactIds:[],initTimeoutMs:30000,frameTimeoutMs:5000,...(assetScopedObservation?{observeAssets:true}:{})},
  inputs:[{...source,name:'film'},...modules,...(asset?[{name:'resource:'+asset.resourceId,key:asset.key,sha256:asset.sha256,byteLength:asset.byteLength}]:[])]};
 const owner=env.OPERATIONS.getByName(op.id);
 let failed=false;
 try{
  const ready=parseCanonicalJson(await owner.studio(op.id,canonical(task))) as Json;
  if(ready.status!=='ready')throw Error('RENDER_PREFLIGHT_FAILED');
  const frame=await owner.frame(op.id,45);if(!frame.ok)throw Error('RENDER_PREFLIGHT_FAILED');
  const bytes=new Uint8Array(await frame.arrayBuffer());
  if(bytes.length<8||![137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))throw Error('RENDER_PREFLIGHT_FAILED');
  if(sceneScopedObservation){
   const response=await owner.checkFrame(op.id,45);if(!response.ok)throw Error('RENDER_PREFLIGHT_FAILED');
   const checked=parseCanonicalJson(await response.text()) as Json,observation=checked.observation;
   if(!validObservation(observation)||observation.renderId!==taskId||observation.aspectId!==aspect||observation.frame!==45
     ||!observation.texts.some((text:Json)=>text.sceneId==='health'&&text.slotId==='headline'))throw Error('RENDER_OBSERVATION_SCOPE_UNAVAILABLE');
   if(assetScopedObservation&&(!Array.isArray(observation.assets)||!observation.assets.some((item:Json)=>item.sceneId==='health'&&item.resourceId===asset.resourceId&&item.visibility==='visible')))
    throw Error('RENDER_ASSET_OBSERVATION_UNAVAILABLE');
  }
  await operation(env,op.id,op.generation);
 }catch(error){failed=true;throw error;}
 finally{try{await owner.closeStudio();}catch(error){if(!failed)throw error;}}
 // A stop failure cannot create a healthy cache entry; it retains the lease for cleanup.
 await coordinator.rememberRendererHealth(cacheKey,canonical({checkedAt:Date.now(),release:release.id,imageDigest:release.image_digest,taskId}));
}
