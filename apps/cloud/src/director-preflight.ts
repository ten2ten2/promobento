import {directorResourceOptions,directorResourceInputs} from './director-video.ts';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest} from '@promobento/contracts/digest';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {validate as validObservation} from '@promobento/contracts/validators/frame-observation';
import platform from '../../../config/platform-presets.json';
import {operation,rights,immutableJson,immutableBytes} from './store.ts';
import type {PipelineEnv,Operation,Json} from './pipeline-types.ts';

const cacheMs=10*60000;
/** Probe the actual image, Chromium sandbox and broker/R2 before a paid model request. */
export async function directorEnvironment(env:PipelineEnv,op:Operation,context:Json,resources:Json[],deadlineAt:number,customScenes=false,sceneScopedObservation=false,assetScopedObservation=false,fadeThrough=false,componentRelay=false,componentBehavior=false,objectStudio=false,customStudio:boolean|'v2'|'v3'=false,packedVideo=false,voxClip:boolean|'highlight'=false,canvasTitle?:{fontId:string;weight:number;style?:string;text:string;factIds:string[];pages?:Array<{text:string;factIds:string[]}>},whiteboard=false,keynote:boolean|'highlight'=false){
 if(sceneScopedObservation&&!customScenes||assetScopedObservation&&!sceneScopedObservation||componentRelay&&(customScenes||fadeThrough)||componentBehavior&&!componentRelay||objectStudio&&(customScenes||componentRelay||fadeThrough||customStudio)||customStudio&&(customScenes||componentRelay||fadeThrough)||packedVideo&&(customScenes||fadeThrough||componentRelay||objectStudio||customStudio)||voxClip&&(customScenes||fadeThrough||componentRelay||objectStudio||customStudio||packedVideo))throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
 if(canvasTitle&&(customScenes||sceneScopedObservation||assetScopedObservation||fadeThrough||componentRelay||objectStudio||customStudio||packedVideo||voxClip))throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
 if(whiteboard&&(canvasTitle||customScenes||sceneScopedObservation||assetScopedObservation||fadeThrough||componentRelay||objectStudio||customStudio||packedVideo||voxClip))throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
 if(keynote&&(whiteboard||canvasTitle||customScenes||sceneScopedObservation||assetScopedObservation||fadeThrough||componentRelay||objectStudio||customStudio||packedVideo||voxClip))throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
 await operation(env,op.id,op.generation);await rights(env,op,resources);
 const packedAsset=packedVideo?context.resources.find((item:Json)=>item.videoFramePacking==='webp-pack-v1'):undefined;
 if(packedVideo&&!packedAsset)throw Error('RENDER_VIDEO_ASSET_UNAVAILABLE');
 const voxAsset=voxClip?context.resources.find((item:Json)=>['image','svg'].includes(item.kind)):undefined;
 if(voxClip&&!voxAsset)throw Error('RENDER_VOX_ASSET_UNAVAILABLE');
 const boardAsset=whiteboard?context.resources.find((item:Json)=>['image','svg'].includes(item.kind)):undefined;
 if(whiteboard&&!boardAsset)throw Error('RENDER_WHITEBOARD_ASSET_UNAVAILABLE');
 const keynoteAsset=keynote?context.resources.find((item:Json)=>['image','svg'].includes(item.kind)):undefined;
 if(keynote&&!keynoteAsset)throw Error('RENDER_KEYNOTE_ASSET_UNAVAILABLE');
 const release=await env.DB.prepare("SELECT * FROM renderer_releases WHERE id=? AND status='active'").bind(context.rendererRelease).first<Json>();
 if(!release||release.runtime_version!==context.runtimeVersion||release.image_digest!==await env.SHARDS.getByName('release-metadata').imageDigest())throw Error('RENDER_ENVIRONMENT_MISMATCH');
 const coordinator=env.COORDINATOR.getByName('global-v1'),cacheKey=digest({release:release.id,image:release.image_digest,runtime:release.runtime_version,environment:release.environment_key,...(customScenes?{customScenes:true}:{}),...(sceneScopedObservation?{sceneScopedObservation:true}:{}),...(assetScopedObservation?{assetScopedObservation:true}:{}),...(fadeThrough?{fadeThrough:true}:{}),...(componentRelay?{componentRelay:true}:{}),...(componentBehavior?{componentBehavior:true}:{}),...(objectStudio?{objectStudio:true}:{}),...(customStudio?{customStudio}:{}),...(packedVideo?{packedVideo:packedAsset.sha256}: {}),...(voxClip?{voxClip:voxAsset.sha256,...(voxClip==='highlight'?{voxHighlight:true}:{})}:{}),...(canvasTitle?{canvasTitle}:{}),...(whiteboard?{whiteboard:boardAsset.sha256}:{}),...(keynote?{keynote:keynoteAsset.sha256,...(keynote==='highlight'?{keynoteHighlight:true}:{})}:{})});
 const cached=parseCanonicalJson(await coordinator.rendererHealth(cacheKey)) as Json|null;
 if(cached&&cached.checkedAt<=Date.now()&&Date.now()-cached.checkedAt<cacheMs)return;
 if(Date.now()>=deadlineAt)throw Error('OPERATION_DEADLINE');
 const font=canvasTitle?context.fonts?.find((face:Json)=>face.fontId===canvasTitle.fontId&&face.weight===canvasTitle.weight&&(face.style??'normal')===(canvasTitle.style??'normal')):context.fonts?.[0];if(!font)throw Error('DIRECTOR_INPUT_INVALID');
 const film:Json={schemaVersion:'3.0.0',specVersion:'film-v1',audience:context.audience,durationSeconds:15,fps:30,totalFrames:450,
  style:{palette:{roles:{bg:'#101712',ink:'#f4f8ee',accent:'#d9fa73'},sources:{bg:'preflight',ink:'preflight',accent:'preflight'}},
   type:{display:{fontId:font.fontId,weight:font.weight},text:{fontId:font.fontId,weight:font.weight},scale:'regular'},
   motion:{language:'continuous-take',energy:1,easing:'expo-out',transitions:'tight'}},
  audio:{music:{kind:'none'},sfx:[],captions:'off',mute:true},assets:{},texts:{headline:{text:'Render health check',role:'headline',factIds:[]}},
  scenes:[{id:'health',start:0,end:450,kind:'block',block:'hook-title@1',params:{textSlot:'headline'},purpose:'Private renderer health probe.'}],
  treatment:{message:'Private renderer health probe.',hook:'Readiness only.',energyCurve:[{frame:0,level:1},{frame:449,level:1}],continuity:'Single trusted block.'}};
 const sources:Record<string,string>={},asset=packedVideo?packedAsset:voxClip?voxAsset:whiteboard?boardAsset:keynote?keynoteAsset:assetScopedObservation||componentRelay||objectStudio||customStudio?context.resources.find((item:Json)=>['image','svg'].includes(item.kind)):undefined;
 if(assetScopedObservation&&!asset)throw Error('RENDER_ASSET_OBSERVATION_UNAVAILABLE');
 if(componentRelay&&!asset)throw Error('RENDER_COMPONENT_RELAY_UNAVAILABLE');
 if((objectStudio||customStudio)&&!asset)throw Error('RENDER_STUDIO_ASSET_UNAVAILABLE');
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
   params:{textSlot:'headline',focus:'roi:0',beatFrames:6,...(componentBehavior?{componentBehavior:'return-to-source'}:{}),items:[{assetKey:'health'},{assetKey:'health'}]},purpose:'Probe component relay support.'}];
 }
 if(objectStudio){
  film.assets.health={resourceId:asset.resourceId};
  film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'object-studio@1',params:{assetKey:'health'},purpose:'Probe original studio support.'}];
 }
 if(customStudio){
  film.assets.health={resourceId:asset.resourceId};if(customStudio==='v3')film.assets['health-panel']={resourceId:asset.resourceId};
  film.scenes=[{id:'health',start:0,end:450,kind:'custom',runtime3D:customStudio==='v3'?'om3-studio-v3':customStudio==='v2'?'om3-studio-v2':'om3-studio-v1',module:'scenes/health/index.js',brief:'Private 3D runtime probe.',purpose:'Probe custom studio support.',
   params:{textSlots:[],assetKeys:customStudio==='v3'?['health','health-panel']:['health'],events:[],readingHolds:[{start:30,end:450,visibleTextSlots:[]}]}}];
  sources['scenes/health/index.js']=`PB.scene("health",ctx=>{const studio=ctx.OM3.studio("health"${customStudio==='v3'?', ["health-panel"]':''});const timeline=gsap.timeline({paused:true});ctx.OM.clockAfter(timeline,t=>studio.render({yaw:0,pitch:0,distanceScale:1${customStudio==='v2'||customStudio==='v3'?',objectYaw:15,objectScale:1':''}${customStudio==='v3'?',panels:[{x:2,scale:.5,visible:true}]':''}}),15);return {timeline};});`;
 }
 if(packedVideo){
  film.assets.health={resourceId:asset.resourceId};
  film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'continuous-focus@1',params:{assetKey:'health'},purpose:'Probe packed source video.'}];
 }
 if(voxClip){
  film.assets.health={resourceId:asset.resourceId,...(voxClip==='highlight'?{roi:[{x:.2,y:.2,width:.4,height:.4}]}:{})};
  film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'vox-clip@1',params:{intervalFrames:voxClip==='highlight'?120:90,items:[{assetKey:'health',...(voxClip==='highlight'?{focus:'roi:0'}:{})},{assetKey:'health'}]},purpose:'Probe original Vox image choreography.'}];
 }
 if(keynote){
  film.assets.health={resourceId:asset.resourceId,...(keynote==='highlight'?{roi:[{x:.2,y:.2,width:.4,height:.4}]}:{})};
  film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'keynote-clip@1',params:{items:[{assetKey:'health',...(keynote==='highlight'?{focus:'roi:0'}:{})},{assetKey:'health'}],intervalFrames:120},purpose:'Probe original screenshot slide choreography.'}];
 }
 if(whiteboard){
  film.assets.health={resourceId:asset.resourceId};
  film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'whiteboard-clip@1',params:{assetKey:'health',textSlot:'headline'},purpose:'Probe original whiteboard image reveal.'}];
 }
 if(canvasTitle){
  if(canvasTitle.pages){
   if(canvasTitle.pages.length<2||canvasTitle.pages.length>3)throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
   film.texts=Object.fromEntries(canvasTitle.pages.map((page,index)=>['headline-'+index,{text:page.text,role:'headline',factIds:page.factIds}]));
   film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'canvas-sequence@1',params:{items:canvasTitle.pages.map((_,index)=>({textSlot:'headline-'+index,startFrame:index*120}))},purpose:'Probe each bound Canvas title page and font.'}];
  }else{
   film.texts.headline={text:canvasTitle.text,role:'headline',factIds:canvasTitle.factIds};
   film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'canvas-title@1',params:{textSlot:'headline'},purpose:'Probe actual bound Canvas title and font.'}];
  }
 }
 if(fadeThrough){film.scenes[0].end=healthEnd;film.scenes.push({id:'health-end',start:healthEnd-8,end:450,kind:'block',block:'hook-title@1',params:{textSlot:'headline'},
  transitionIn:{type:'fade-through',frames:8},purpose:'Check the supported fade-through transition.'});}
 const taskId='health-'+crypto.randomUUID(),source=await immutableJson(env,`operations/${op.id}/health/${taskId}/film.json`,film),modules=[];
 for(const [path,text]of Object.entries(sources))modules.push({...await immutableBytes(env,`operations/${op.id}/health/${taskId}/${path}`,new TextEncoder().encode(text),'text/javascript'),name:path});
 const aspect='landscape',layout=platform.aspectLayouts.landscape,probeFrame=packedVideo?Math.min(45,asset.videoFrames.length-1):voxClip==='highlight'?84:voxClip?135:whiteboard?105:keynote==='highlight'?84:keynote?165:45;
 const probeFrames=canvasTitle?.pages?canvasTitle.pages.map((_,index)=>45+index*120):[probeFrame];
 const task={schemaVersion:'3.0.0',kind:'render_task',mode:'studio',instance:objectStudio||customStudio?'standard-4':'standard-3',taskId,generation:op.generation,
  deadlineAt:Math.min(deadlineAt,Date.now()+90000),imageDigest:release.image_digest,
  job:{schemaVersion:'3.0.0',kind:'render_job',renderId:taskId,operationId:op.id,candidateId:taskId,sourceHash:filmSourceHash(canonical(film),sources),
   runtimeVersion:context.runtimeVersion,rendererRelease:release.id,aspectId:aspect,durationSeconds:15,totalFrames:450,quality:'still',frames:probeFrames,
   renderProfile:{sampleCount:1,shutterAngle:0,sampling:'centered-box-v1',edgePolicy:'clamp-v1'},resources},
  options:{target:{aspect,width:layout.width,height:layout.height,safeInsets:layout.safeInsets,fps:30,totalFrames:450},seed:context.seed,
   fonts:context.fonts,resources:asset?directorResourceOptions([asset]):[],
   confirmedFactIds:canvasTitle?(context.confirmedFactIds??[]):[],initTimeoutMs:objectStudio||customStudio?60000:30000,frameTimeoutMs:objectStudio||customStudio?10000:5000,...(assetScopedObservation?{observeAssets:true}:{})},
  inputs:[{...source,name:'film'},...modules,...(asset?directorResourceInputs([asset]):[])]};
 const owner=env.OPERATIONS.getByName(op.id);
 let failed=false;
 try{
  const ready=parseCanonicalJson(await owner.studio(op.id,canonical(task))) as Json;
  if(ready.status!=='ready'||(objectStudio||customStudio)&&(!Array.isArray(ready.webgl)||!ready.webgl.length))throw Error('RENDER_PREFLIGHT_FAILED');
  for(const [index,frameIndex] of probeFrames.entries()){
   const frame=await owner.frame(op.id,frameIndex);if(!frame.ok)throw Error('RENDER_PREFLIGHT_FAILED');
   const bytes=new Uint8Array(await frame.arrayBuffer());
   if(bytes.length<8||![137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))throw Error('RENDER_PREFLIGHT_FAILED');
   if(sceneScopedObservation||canvasTitle||whiteboard){
    const response=await owner.checkFrame(op.id,frameIndex);if(!response.ok)throw Error('RENDER_PREFLIGHT_FAILED');
    const checked=parseCanonicalJson(await response.text()) as Json,observation=checked.observation;
    const slotId=canvasTitle?.pages?'headline-'+index:'headline',text=canvasTitle?.pages?.[index]?.text??canvasTitle?.text;
    if(!validObservation(observation)||observation.renderId!==taskId||observation.aspectId!==aspect||observation.frame!==frameIndex
      ||!observation.texts.some((item:Json)=>item.sceneId==='health'&&item.slotId===slotId))throw Error('RENDER_OBSERVATION_SCOPE_UNAVAILABLE');
    if((canvasTitle||whiteboard)&&(!observation.texts.some((item:Json)=>item.sceneId==='health'&&item.slotId===slotId&&item.text===(text??'Render health check')&&!item.clipped&&!item.covered&&!item.fallbackUsed)
      ||observation.findings.some((finding:Json)=>finding.severity==='BLOCK')))throw Error('RENDER_CANVAS_TEXT_UNAVAILABLE');
    if(assetScopedObservation&&(!Array.isArray(observation.assets)||!observation.assets.some((item:Json)=>item.sceneId==='health'&&item.resourceId===asset.resourceId&&item.visibility==='visible')))
     throw Error('RENDER_ASSET_OBSERVATION_UNAVAILABLE');
   }
  }
  await operation(env,op.id,op.generation);
 }catch(error){failed=true;throw error;}
 finally{try{await owner.closeStudio();}catch(error){if(!failed)throw error;}}
 // A stop failure cannot create a healthy cache entry; it retains the lease for cleanup.
 await coordinator.rememberRendererHealth(cacheKey,canonical({checkedAt:Date.now(),release:release.id,imageDigest:release.image_digest,taskId}));
}
