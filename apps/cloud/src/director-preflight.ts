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
export async function directorEnvironment(env:PipelineEnv,op:Operation,context:Json,resources:Json[],deadlineAt:number,customScenes:boolean|'grapheme'=false,sceneScopedObservation=false,assetScopedObservation=false,fadeThrough=false,componentRelay=false,componentBehavior=false,objectStudio=false,customStudio:boolean|'v2'|'v3'|'v4'|'v5'|'v6'=false,packedVideo=false,voxClip:boolean|'highlight'=false,canvasTitle?:{fontId:string;weight:number;style?:string;text:string;factIds:string[];number?:boolean;highlightFrame?:number;palette?:Record<string,string>;pages?:Array<{text:string;factIds:string[]}>;pairs?:Array<{text:string;factIds:string[];subtitle:{fontId:string;weight:number;style?:string;text:string;factIds:string[]}}>;subtitle?:{fontId:string;weight:number;style?:string;text:string;factIds:string[]}},whiteboard=false,keynote:boolean|'highlight'=false,planet?:{display:{fontId:string;weight:number;style?:string};textFace:{fontId:string;weight:number;style?:string};center:{text:string;factIds:string[]};items:Array<{text:string;factIds:string[]}>},uiSpace=false,blank?:{display:{fontId:string;weight:number;style?:string};textFace:{fontId:string;weight:number;style?:string};items:Array<{text:string;factIds:string[]}>},notes?:{font:{fontId:string;weight:number;style?:string};title:{text:string;factIds:string[]};items:Array<{text:string;role:string;factIds:string[];icon:string;subtitle?:{text:string;role:string;factIds:string[]}}>},finance?:{font:{fontId:string;weight:number;style?:string};title:{text:string;factIds:string[]};unit:{text:string;factIds:string[]};source:{text:string;factIds:string[]};items:Array<{label:{text:string;factIds:string[]};value:{text:string;factIds:string[]};evidenceId:string}>},math?:{font:{fontId:string;weight:number;style?:string};title:{text:string;factIds:string[]};equation:{text:string;role:string;factIds:string[]};items:Array<{text:string;role:string;factIds:string[]}>},depth?:{display:{fontId:string;weight:number;style?:string};textFace:{fontId:string;weight:number;style?:string};center:{text:string;factIds:string[]};outer:Array<{text:string;factIds:string[]}>;inner:Array<{text:string;factIds:string[]}>;enterIndex:number;evidenceIds:string[]},voxStory?:{font:{fontId:string;weight:number;style?:string};title:{text:string;role:string;factIds:string[]};items:Array<{caption:{text:string;role:string;factIds:string[]};note:{text:string;role:string;factIds:string[]};focus:boolean}>}){
 if(sceneScopedObservation&&!customScenes||assetScopedObservation&&!sceneScopedObservation||componentRelay&&(customScenes||fadeThrough)||componentBehavior&&!componentRelay||objectStudio&&(customScenes||componentRelay||fadeThrough||customStudio)||customStudio&&(customScenes||componentRelay||fadeThrough)||packedVideo&&(customScenes||fadeThrough||componentRelay||objectStudio||customStudio)||voxClip&&(customScenes||fadeThrough||componentRelay||objectStudio||customStudio||packedVideo))throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
 if(canvasTitle&&(customScenes||sceneScopedObservation||assetScopedObservation||fadeThrough||componentRelay||objectStudio||customStudio||packedVideo||voxClip))throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
 if(whiteboard&&(canvasTitle||customScenes||sceneScopedObservation||assetScopedObservation||fadeThrough||componentRelay||objectStudio||customStudio||packedVideo||voxClip))throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
 if(keynote&&(whiteboard||canvasTitle||customScenes||sceneScopedObservation||assetScopedObservation||fadeThrough||componentRelay||objectStudio||customStudio||packedVideo||voxClip))throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
 if(planet&&(keynote||whiteboard||canvasTitle||customScenes||sceneScopedObservation||assetScopedObservation||fadeThrough||componentRelay||objectStudio||customStudio||packedVideo||voxClip))throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
 if(uiSpace&&(planet||keynote||whiteboard||canvasTitle||customScenes||sceneScopedObservation||assetScopedObservation||fadeThrough||componentRelay||objectStudio||customStudio||packedVideo||voxClip))throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
 if(blank&&(uiSpace||planet||keynote||whiteboard||canvasTitle||customScenes||sceneScopedObservation||assetScopedObservation||fadeThrough||componentRelay||objectStudio||customStudio||packedVideo||voxClip))throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
 if(notes&&(blank||uiSpace||planet||keynote||whiteboard||canvasTitle||customScenes||sceneScopedObservation||assetScopedObservation||fadeThrough||componentRelay||objectStudio||customStudio||packedVideo||voxClip))throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
 if(finance&&(notes||blank||uiSpace||planet||keynote||whiteboard||canvasTitle||customScenes||sceneScopedObservation||assetScopedObservation||fadeThrough||componentRelay||objectStudio||customStudio||packedVideo||voxClip))throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
 if(math&&(finance||notes||blank||uiSpace||planet||keynote||whiteboard||canvasTitle||customScenes||sceneScopedObservation||assetScopedObservation||fadeThrough||componentRelay||objectStudio||customStudio||packedVideo||voxClip))throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
 if(depth&&(math||finance||notes||blank||uiSpace||planet||keynote||whiteboard||canvasTitle||customScenes||sceneScopedObservation||assetScopedObservation||fadeThrough||componentRelay||objectStudio||customStudio||packedVideo||voxClip))throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
 if(voxStory&&(depth||math||finance||notes||blank||uiSpace||planet||keynote||whiteboard||canvasTitle||customScenes||sceneScopedObservation||assetScopedObservation||fadeThrough||componentRelay||objectStudio||customStudio||packedVideo||voxClip))throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
 await operation(env,op.id,op.generation);await rights(env,op,resources);
 const packedAsset=packedVideo?context.resources.find((item:Json)=>item.videoFramePacking==='webp-pack-v1'):undefined;
 if(packedVideo&&!packedAsset)throw Error('RENDER_VIDEO_ASSET_UNAVAILABLE');
 const voxAsset=voxClip?context.resources.find((item:Json)=>['image','svg'].includes(item.kind)):undefined;
 if(voxClip&&!voxAsset)throw Error('RENDER_VOX_ASSET_UNAVAILABLE');
 const storyAsset=voxStory?context.resources.find((item:Json)=>['image','svg'].includes(item.kind)):undefined;
 if(voxStory&&!storyAsset)throw Error('RENDER_VOX_ASSET_UNAVAILABLE');
 const boardAsset=whiteboard?context.resources.find((item:Json)=>['image','svg'].includes(item.kind)):undefined;
 if(whiteboard&&!boardAsset)throw Error('RENDER_WHITEBOARD_ASSET_UNAVAILABLE');
 const keynoteAsset=keynote?context.resources.find((item:Json)=>['image','svg'].includes(item.kind)):undefined;
 if(keynote&&!keynoteAsset)throw Error('RENDER_KEYNOTE_ASSET_UNAVAILABLE');
 const uiSpaceAsset=uiSpace?context.resources.find((item:Json)=>['image','svg'].includes(item.kind)):undefined;
 if(uiSpace&&!uiSpaceAsset)throw Error('RENDER_UI_SPACE_ASSET_UNAVAILABLE');
 const release=await env.DB.prepare("SELECT * FROM renderer_releases WHERE id=? AND status='active'").bind(context.rendererRelease).first<Json>();
 if(!release||release.runtime_version!==context.runtimeVersion||release.image_digest!==await env.SHARDS.getByName('release-metadata').imageDigest())throw Error('RENDER_ENVIRONMENT_MISMATCH');
 const coordinator=env.COORDINATOR.getByName('global-v1'),cacheKey=digest({release:release.id,image:release.image_digest,runtime:release.runtime_version,environment:release.environment_key,...(customScenes?{customScenes}:{}),...(sceneScopedObservation?{sceneScopedObservation:true}:{}),...(assetScopedObservation?{assetScopedObservation:true}:{}),...(fadeThrough?{fadeThrough:true}:{}),...(componentRelay?{componentRelay:true}:{}),...(componentBehavior?{componentBehavior:true}:{}),...(objectStudio?{objectStudio:true}:{}),...(customStudio?{customStudio}:{}),...(packedVideo?{packedVideo:packedAsset.sha256}: {}),...(voxClip?{voxClip:voxAsset.sha256,...(voxClip==='highlight'?{voxHighlight:true}:{})}:{}),...(canvasTitle?{canvasTitle}:{}),...(whiteboard?{whiteboard:boardAsset.sha256}:{}),...(keynote?{keynote:keynoteAsset.sha256,...(keynote==='highlight'?{keynoteHighlight:true}:{})}:{}),...(planet?{planet}:{}),...(uiSpace?{uiSpace:uiSpaceAsset.sha256}:{}),...(blank?{blank}:{}),...(notes?{notes}:{}),...(finance?{finance}:{}),...(math?{math}:{}),...(depth?{depth}:{}),...(voxStory?{voxStory,storyAsset:storyAsset.sha256}:{})});
 const cached=parseCanonicalJson(await coordinator.rendererHealth(cacheKey)) as Json|null;
 if(cached&&cached.checkedAt<=Date.now()&&Date.now()-cached.checkedAt<cacheMs)return;
 if(Date.now()>=deadlineAt)throw Error('OPERATION_DEADLINE');
 const requiredFace=canvasTitle??planet?.display??blank?.display??notes?.font??finance?.font??math?.font??depth?.display??voxStory?.font;
 const font=requiredFace?context.fonts?.find((face:Json)=>face.fontId===requiredFace.fontId&&face.weight===requiredFace.weight&&(face.style??'normal')===(requiredFace.style??'normal')):context.fonts?.[0];if(!font)throw Error('DIRECTOR_INPUT_INVALID');
 const film:Json={schemaVersion:'3.0.0',specVersion:'film-v1',audience:context.audience,durationSeconds:15,fps:30,totalFrames:450,
  style:{palette:{roles:{bg:'#101712',ink:'#f4f8ee',accent:'#d9fa73'},sources:{bg:'preflight',ink:'preflight',accent:'preflight'}},
   type:{display:{fontId:font.fontId,weight:font.weight},text:{fontId:font.fontId,weight:font.weight},scale:'regular'},
   motion:{language:'continuous-take',energy:1,easing:'expo-out',transitions:'tight'}},
  audio:{music:{kind:'none'},sfx:[],captions:'off',mute:true},assets:{},texts:{headline:{text:'Render health check',role:'headline',factIds:[]}},
  scenes:[{id:'health',start:0,end:450,kind:'block',block:'hook-title@1',params:{textSlot:'headline'},purpose:'Private renderer health probe.'}],
  treatment:{message:'Private renderer health probe.',hook:'Readiness only.',energyCurve:[{frame:0,level:1},{frame:449,level:1}],continuity:'Single trusted block.'}};
 if(canvasTitle?.palette)film.style.palette.roles=canvasTitle.palette;
 const sources:Record<string,string>={},asset=packedVideo?packedAsset:voxClip?voxAsset:voxStory?storyAsset:whiteboard?boardAsset:keynote?keynoteAsset:uiSpace?uiSpaceAsset:customStudio==='v6'?context.resources.find((item:Json)=>['image','svg'].includes(item.kind)&&item.width*item.height<=12_000_000):assetScopedObservation||componentRelay||objectStudio||customStudio?context.resources.find((item:Json)=>['image','svg'].includes(item.kind)):undefined;
 if(assetScopedObservation&&!asset)throw Error('RENDER_ASSET_OBSERVATION_UNAVAILABLE');
 if(componentRelay&&!asset)throw Error('RENDER_COMPONENT_RELAY_UNAVAILABLE');
 if((objectStudio||customStudio)&&!asset)throw Error('RENDER_STUDIO_ASSET_UNAVAILABLE');
 const healthEnd=fadeThrough?240:450;
 if(customScenes){
  if(asset)film.assets.health={resourceId:asset.resourceId};
  film.scenes=[{id:'health',start:0,end:healthEnd,kind:'custom',...(customScenes==='grapheme'?{runtimeText:'grapheme-v1'}:{}),module:'scenes/health/index.js',brief:'Private custom runtime health probe.',purpose:'Private renderer health probe.',
   params:{textSlots:['headline'],assetKeys:asset?['health']:[],events:[],readingHolds:[{start:30,end:healthEnd}],...(asset?{assetChecks:[{frame:45,assetKeys:['health']}]}:{})}}];
  sources['scenes/health/index.js']='PB.scene("health",ctx=>{const panel=document.createElement("div");Object.assign(panel.style,{position:"absolute",left:"10%",top:"30%",width:"80%",height:"40%"});ctx.root.append(panel);'+(customScenes==='grapheme'?'const title=ctx.text("headline").mount(panel,{split:"graphemes"});if(!title.querySelector(".pb-grapheme"))throw Error("TEXT_SPLIT_UNAVAILABLE");':'ctx.text("headline").mount(panel);')+
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
  const multi=customStudio==='v3'||customStudio==='v4'||customStudio==='v5'||customStudio==='v6',focused=customStudio==='v4'||customStudio==='v5'||customStudio==='v6';
  film.assets.health={resourceId:asset.resourceId};if(multi)film.assets['health-panel']={resourceId:asset.resourceId,...(focused?{roi:[{x:.2,y:.2,width:.4,height:.4}]}:{})};
  film.scenes=[{id:'health',start:0,end:450,kind:'custom',runtime3D:customStudio==='v6'?'om3-studio-v6':customStudio==='v5'?'om3-studio-v5':customStudio==='v4'?'om3-studio-v4':customStudio==='v3'?'om3-studio-v3':customStudio==='v2'?'om3-studio-v2':'om3-studio-v1',module:'scenes/health/index.js',brief:'Private 3D runtime probe.',purpose:'Probe custom studio support.',
   params:{textSlots:[],assetKeys:multi?['health','health-panel']:['health'],...(focused?{panelFocus:{'health-panel':'roi:0'}}:{}),events:[],readingHolds:[{start:30,end:450,visibleTextSlots:[]}]}}];
  sources['scenes/health/index.js']=`PB.scene("health",ctx=>{const studio=ctx.OM3.studio("health"${multi?', ["health-panel"]':''});const timeline=gsap.timeline({paused:true});ctx.OM.clockAfter(timeline,t=>studio.render({yaw:0,pitch:0,distanceScale:1${customStudio==='v2'||multi?',objectYaw:15,objectScale:1':''}${multi?`,panels:[{x:2,scale:.5,visible:true${customStudio==='v5'||customStudio==='v6'?',opacity:.5':''}}]`:''}}),15);return {timeline};});`;
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
 if(uiSpace){
  film.assets.health={resourceId:asset.resourceId,roi:[{x:.2,y:.2,width:.4,height:.4}]};
  film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'ui-space-clip@1',params:{assetKey:'health',focuses:['roi:0']},purpose:'Probe spatial screenshot staging.'}];
 }
 if(voxStory){
  if(voxStory.items.length<2||voxStory.items.length>3)throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
  const same={fontId:font.fontId,weight:font.weight,...(font.style?{style:font.style}:{})};film.style.type.display=same;film.style.type.text=same;
  if(voxStory.items.length===3){film.durationSeconds=30;film.totalFrames=900;film.treatment.energyCurve[1].frame=899;}
  film.assets.health={resourceId:asset.resourceId,roi:[{x:.2,y:.2,width:.4,height:.4}]};
  film.texts={headline:voxStory.title};
  const items=voxStory.items.map((item,index)=>{const textSlot='caption-'+index,subtitleSlot='note-'+index;
   film.texts[textSlot]=item.caption;film.texts[subtitleSlot]=item.note;
   return{assetKey:'health',textSlot,subtitleSlot,...(item.focus?{focus:'roi:0'}:{})};});
  film.scenes=[{id:'health',start:0,end:film.totalFrames,kind:'block',block:'vox-story@1',params:{textSlot:'headline',items},purpose:'Probe the original bound Vox collage.'}];
 }
 if(depth){
  if(depth.outer.length<2||depth.outer.length>3||depth.inner.length<2||depth.inner.length>3)throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
  const body=context.fonts?.find((face:Json)=>face.fontId===depth.textFace.fontId&&face.weight===depth.textFace.weight&&(face.style??'normal')===(depth.textFace.style??'normal'));
  if(!body)throw Error('DIRECTOR_INPUT_INVALID');
  film.style.type.display={fontId:font.fontId,weight:font.weight,...(font.style?{style:font.style}:{})};film.style.type.text={fontId:body.fontId,weight:body.weight,...(body.style?{style:body.style}:{})};
  film.texts={headline:{...depth.center,role:'headline'},...Object.fromEntries(depth.outer.map((item,index)=>['outer-'+index,{...item,role:'label'}])),...Object.fromEntries(depth.inner.map((item,index)=>['inner-'+index,{...item,role:'label'}]))};
  film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'planet-depth@1',params:{textSlot:'headline',items:depth.outer.map((_,index)=>({textSlot:'outer-'+index})),inner:depth.inner.map((_,index)=>({textSlot:'inner-'+index})),enterIndex:depth.enterIndex,evidenceIds:depth.evidenceIds},purpose:'Probe bound original constellation dive.'}];
 }
 if(math){
  if(math.items.length<1||math.items.length>3)throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
  const same={fontId:font.fontId,weight:font.weight,...(font.style?{style:font.style}:{})};film.style.type.display=same;film.style.type.text=same;
  film.texts={headline:{...math.title,role:'headline'},equation:{...math.equation}};
  const items=math.items.map((item,index)=>{const id='point-'+index;film.texts[id]={...item};return{textSlot:id};});
  film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'math-notes@1',params:{textSlot:'headline',equation:{textSlot:'equation'},items},purpose:'Probe bound original mathematical notes.'}];
 }
 if(finance){
  if(finance.items.length<2||finance.items.length>4)throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
  const same={fontId:font.fontId,weight:font.weight,...(font.style?{style:font.style}:{})};film.style.type.display=same;film.style.type.text=same;
  film.texts={headline:{...finance.title,role:'headline'},unit:{...finance.unit,role:'body'},source:{...finance.source,role:'label'}};
  const items=finance.items.map((item,index)=>{const label='label-'+index,value='value-'+index;
   film.texts[label]={...item.label,role:'label'};film.texts[value]={...item.value,role:'number'};return{textSlot:label,value:{textSlot:value},evidenceId:item.evidenceId};});
  film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'finance-bars@1',params:{textSlot:'headline',subtitleSlot:'unit',source:{textSlot:'source'},items},purpose:'Probe bound original finance bars.'}];
 }
 if(notes){
  if(notes.items.length<1||notes.items.length>3)throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
  const same={fontId:font.fontId,weight:font.weight,...(font.style?{style:font.style}:{})};film.style.type.display=same;film.style.type.text=same;
  film.texts={headline:{text:notes.title.text,role:'headline',factIds:notes.title.factIds}};
  const items=notes.items.map((item,index)=>{
   const textSlot='note-'+index;film.texts[textSlot]={text:item.text,role:item.role,factIds:item.factIds};
   if(!item.subtitle)return{textSlot,icon:item.icon};
   const subtitleSlot='caption-'+index;film.texts[subtitleSlot]={text:item.subtitle.text,role:item.subtitle.role,factIds:item.subtitle.factIds};
   return{textSlot,subtitleSlot,icon:item.icon};
  });
  film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'whiteboard-notes@1',params:{textSlot:'headline',items},purpose:'Probe original bound whiteboard notes.'}];
 }
 if(blank){
  if(blank.items.length<5||blank.items.length>6)throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
  const body=context.fonts?.find((face:Json)=>face.fontId===blank.textFace.fontId&&face.weight===blank.textFace.weight&&(face.style??'normal')===(blank.textFace.style??'normal'));
  if(!body)throw Error('DIRECTOR_INPUT_INVALID');
  film.style.type.display={fontId:font.fontId,weight:font.weight,...(font.style?{style:font.style}:{})};
  film.style.type.text={fontId:body.fontId,weight:body.weight,...(body.style?{style:body.style}:{})};
  const roles=['headline','body','number','label','headline','label'];
  film.texts=Object.fromEntries(blank.items.map((item,index)=>['blank-'+index,{text:item.text,role:roles[index],factIds:item.factIds}]));
  film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'blank-clip@1',params:{items:blank.items.map((_,index)=>({textSlot:'blank-'+index}))},purpose:'Probe bound original blank template.'}];
 }
 if(planet){
  if(planet.items.length<2||planet.items.length>3)throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
  const body=context.fonts?.find((face:Json)=>face.fontId===planet.textFace.fontId&&face.weight===planet.textFace.weight&&(face.style??'normal')===(planet.textFace.style??'normal'));
  if(!body)throw Error('DIRECTOR_INPUT_INVALID');
  film.style.type.display={fontId:font.fontId,weight:font.weight,...(font.style?{style:font.style}:{})};
  film.style.type.text={fontId:body.fontId,weight:body.weight,...(body.style?{style:body.style}:{})};
  film.texts={headline:{text:planet.center.text,role:'headline',factIds:planet.center.factIds},...Object.fromEntries(planet.items.map((item,index)=>['point-'+index,{text:item.text,role:'label',factIds:item.factIds}]))};
  film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'planet-clip@1',params:{textSlot:'headline',items:planet.items.map((_,index)=>({textSlot:'point-'+index}))},purpose:'Probe original fact-bound constellation and text.'}];
 }
 if(canvasTitle){
  if(canvasTitle.pairs){
   if(canvasTitle.pages||canvasTitle.subtitle||canvasTitle.number||canvasTitle.highlightFrame!==undefined||canvasTitle.pairs.length<2||canvasTitle.pairs.length>3)throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
   const first=canvasTitle.pairs[0]!.subtitle,body=context.fonts?.find((face:Json)=>face.fontId===first.fontId&&face.weight===first.weight&&(face.style??'normal')===(first.style??'normal'));
   if(!body||canvasTitle.pairs.some(pair=>pair.subtitle.fontId!==first.fontId||pair.subtitle.weight!==first.weight||(pair.subtitle.style??'normal')!==(first.style??'normal')))throw Error('DIRECTOR_INPUT_INVALID');
   film.style.type.text={fontId:body.fontId,weight:body.weight,...(body.style?{style:body.style}:{})};
   film.texts=Object.fromEntries(canvasTitle.pairs.flatMap((pair,index)=>[['headline-'+index,{text:pair.text,role:'headline',factIds:pair.factIds}],['supporting-'+index,{text:pair.subtitle.text,role:'body',factIds:pair.subtitle.factIds}]]));
   film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'canvas-subtitle-sequence@1',params:{items:canvasTitle.pairs.map((_,index)=>({textSlot:'headline-'+index,subtitleSlot:'supporting-'+index,startFrame:index*120}))},purpose:'Probe each bound Canvas title and supporting sentence.'}];
  }else if(canvasTitle.subtitle){
   if(canvasTitle.pages||canvasTitle.number||canvasTitle.highlightFrame!==undefined)throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
   const body=context.fonts?.find((face:Json)=>face.fontId===canvasTitle.subtitle!.fontId&&face.weight===canvasTitle.subtitle!.weight&&(face.style??'normal')===(canvasTitle.subtitle!.style??'normal'));
   if(!body)throw Error('DIRECTOR_INPUT_INVALID');film.style.type.text={fontId:body.fontId,weight:body.weight,...(body.style?{style:body.style}:{})};
   film.texts.headline={text:canvasTitle.text,role:'headline',factIds:canvasTitle.factIds};film.texts.supporting={text:canvasTitle.subtitle.text,role:'body',factIds:canvasTitle.subtitle.factIds};
   film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'canvas-subtitle@1',params:{textSlot:'headline',subtitleSlot:'supporting'},purpose:'Probe both exact bound texts and fonts.'}];
  }else if(canvasTitle.number){
   if(canvasTitle.pages||canvasTitle.highlightFrame!==undefined)throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
   film.texts.headline={text:canvasTitle.text,role:'number',factIds:canvasTitle.factIds};
   film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'canvas-number@1',params:{textSlot:'headline'},purpose:'Probe the exact fact-bound number and its counting frames.'}];
  }else if(canvasTitle.pages){
   if(canvasTitle.pages.length<2||canvasTitle.pages.length>3)throw Error('DIRECTOR_PREFLIGHT_SCOPE_INVALID');
   film.texts=Object.fromEntries(canvasTitle.pages.map((page,index)=>['headline-'+index,{text:page.text,role:'headline',factIds:page.factIds}]));
   film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'canvas-sequence@1',params:{items:canvasTitle.pages.map((_,index)=>({textSlot:'headline-'+index,startFrame:index*120}))},purpose:'Probe each bound Canvas title page and font.'}];
  }else{
   film.texts.headline={text:canvasTitle.text,role:'headline',factIds:canvasTitle.factIds};
   film.scenes=[{id:'health',start:0,end:450,kind:'block',block:'canvas-title@1',params:{textSlot:'headline',...(canvasTitle.highlightFrame===undefined?{}:{highlightFrame:canvasTitle.highlightFrame})},purpose:'Probe actual bound Canvas title and font.'}];
  }
 }
 if(fadeThrough){film.scenes[0].end=healthEnd;film.scenes.push({id:'health-end',start:healthEnd-8,end:450,kind:'block',block:'hook-title@1',params:{textSlot:'headline'},
  transitionIn:{type:'fade-through',frames:8},purpose:'Check the supported fade-through transition.'});}
 const taskId='health-'+crypto.randomUUID(),source=await immutableJson(env,`operations/${op.id}/health/${taskId}/film.json`,film),modules=[];
 for(const [path,text]of Object.entries(sources))modules.push({...await immutableBytes(env,`operations/${op.id}/health/${taskId}/${path}`,new TextEncoder().encode(text),'text/javascript'),name:path});
 const aspect='landscape',layout=platform.aspectLayouts.landscape,probeFrame=uiSpace?60:planet?54+(planet.items.length-1)*15:packedVideo?Math.min(45,asset.videoFrames.length-1):voxClip==='highlight'?84:voxClip?135:whiteboard?105:keynote==='highlight'?84:keynote?165:45;
 const probeFrames=voxStory?[45,...voxStory.items.flatMap((_,index)=>[135+180*index,210+180*index])]:depth?[90,180+(depth.inner.length-1)*15+39]:math?[90,...math.items.map((_,index)=>165+90*index)]:finance?[120]:notes?[45,...notes.items.map((_,index)=>150+120*index)]:blank?[75,150,225]:canvasTitle?.pairs?canvasTitle.pairs.map((_,index)=>45+index*120):canvasTitle?.pages?canvasTitle.pages.map((_,index)=>45+index*120):canvasTitle?.number?[0,45]:canvasTitle?.highlightFrame!==undefined?[45,canvasTitle.highlightFrame+24]:[probeFrame];
 const task={schemaVersion:'3.0.0',kind:'render_task',mode:'studio',instance:objectStudio||customStudio?'standard-4':'standard-3',taskId,generation:op.generation,
  deadlineAt:Math.min(deadlineAt,Date.now()+90000),imageDigest:release.image_digest,
  job:{schemaVersion:'3.0.0',kind:'render_job',renderId:taskId,operationId:op.id,candidateId:taskId,sourceHash:filmSourceHash(canonical(film),sources),
   runtimeVersion:context.runtimeVersion,rendererRelease:release.id,aspectId:aspect,durationSeconds:film.durationSeconds,totalFrames:film.totalFrames,quality:'still',frames:probeFrames,
   renderProfile:{sampleCount:1,shutterAngle:0,sampling:'centered-box-v1',edgePolicy:'clamp-v1'},resources},
  options:{target:{aspect,width:layout.width,height:layout.height,safeInsets:layout.safeInsets,fps:30,totalFrames:film.totalFrames},seed:context.seed,
   fonts:context.fonts,resources:asset?directorResourceOptions([asset]):[],
   confirmedFactIds:canvasTitle||planet||blank||notes||finance||math||depth||voxStory?(context.confirmedFactIds??[]):[],initTimeoutMs:objectStudio||customStudio?60000:30000,frameTimeoutMs:objectStudio||customStudio?10000:5000,...(assetScopedObservation?{observeAssets:true}:{})},
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
   if(voxStory||sceneScopedObservation||canvasTitle&&!canvasTitle.number||canvasTitle?.number&&frameIndex>=30||whiteboard||planet){
    const response=await owner.checkFrame(op.id,frameIndex);if(!response.ok)throw Error('RENDER_PREFLIGHT_FAILED');
    const checked=parseCanonicalJson(await response.text()) as Json,observation=checked.observation;
    if(voxStory){const expected=index===0?{slotId:'headline',value:voxStory.title}:index%2?{slotId:'caption-'+Math.floor(index/2),value:voxStory.items[Math.floor(index/2)]!.caption}:{slotId:'note-'+(index/2-1),value:voxStory.items[index/2-1]!.note};
     if(!validObservation(observation)||observation.renderId!==taskId||observation.aspectId!==aspect||observation.frame!==frameIndex||!observation.texts.some((item:Json)=>item.sceneId==='health'&&item.slotId===expected.slotId&&item.text===expected.value.text&&!item.clipped&&!item.covered&&!item.fallbackUsed)||observation.findings.some((finding:Json)=>finding.severity==='BLOCK'))throw Error('RENDER_VOX_TEXT_UNAVAILABLE');
     continue;}
    const slotId=canvasTitle?.pages||canvasTitle?.pairs?'headline-'+index:'headline',text=canvasTitle?.pairs?.[index]?.text??canvasTitle?.pages?.[index]?.text??canvasTitle?.text;
    if(!validObservation(observation)||observation.renderId!==taskId||observation.aspectId!==aspect||observation.frame!==frameIndex
      ||!observation.texts.some((item:Json)=>item.sceneId==='health'&&item.slotId===slotId))throw Error('RENDER_OBSERVATION_SCOPE_UNAVAILABLE');
    if((canvasTitle||whiteboard||customScenes==='grapheme')&&(!observation.texts.some((item:Json)=>item.sceneId==='health'&&item.slotId===slotId&&item.text===(text??'Render health check')&&!item.clipped&&!item.covered&&!item.fallbackUsed)
      ||observation.findings.some((finding:Json)=>finding.severity==='BLOCK')))throw Error(customScenes==='grapheme'?'RENDER_TEXT_SPLIT_UNAVAILABLE':'RENDER_CANVAS_TEXT_UNAVAILABLE');
    const subtitle=canvasTitle?.pairs?.[index]?.subtitle??canvasTitle?.subtitle,subtitleSlot=canvasTitle?.pairs?'supporting-'+index:'supporting';
    if(subtitle&&!observation.texts.some((item:Json)=>item.sceneId==='health'&&item.slotId===subtitleSlot&&item.text===subtitle.text&&!item.clipped&&!item.covered&&!item.fallbackUsed))throw Error('RENDER_CANVAS_TEXT_UNAVAILABLE');
    if(planet){const expected=[{slotId:'headline',text:planet.center.text},...planet.items.map((item,index)=>({slotId:'point-'+index,text:item.text}))];
     if(expected.some(value=>!observation.texts.some((item:Json)=>item.sceneId==='health'&&item.slotId===value.slotId&&item.text===value.text&&!item.clipped&&!item.covered&&!item.fallbackUsed))
       ||observation.findings.some((finding:Json)=>finding.severity==='BLOCK'))throw Error('RENDER_PLANET_TEXT_UNAVAILABLE');}
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
