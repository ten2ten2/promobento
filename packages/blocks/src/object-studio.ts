import {createTrustedWebGL,releaseTrustedWebGL} from './private-webgl.ts';
// Adapted from huashu-motion@52467f99 runtime/three/om-three.js and templates/object-3d.
// Copyright (c) 2026 Huashu, MIT; see ../NOTICE.md. Product pixels come only from ctx.asset.
import {ACESFilmicToneMapping,CanvasTexture,Color,DirectionalLight,DoubleSide,EquirectangularReflectionMapping,
  Group,Mesh,MeshBasicMaterial,MeshPhysicalMaterial,MeshStandardMaterial,PerspectiveCamera,PlaneGeometry,
  PMREMGenerator,Scene,Shape,ShapeGeometry,SRGBColorSpace,Texture,WebGLRenderer} from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {blockEvents} from './events.mjs';
import type {SceneContext,StudioView} from '../../../contracts/film-runtime.d.ts';
import '../../film-runtime/src/types.ts';

function studioSky(){
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;
 const g=canvas.getContext('2d');if(!g)throw Error('STUDIO_CANVAS_UNAVAILABLE');
 const sky=g.createLinearGradient(0,0,0,512);sky.addColorStop(0,'#9a9a9a');sky.addColorStop(.48,'#5a5a5a');sky.addColorStop(.52,'#1b1b1b');sky.addColorStop(1,'#050505');
 g.fillStyle=sky;g.fillRect(0,0,1024,512);
 for(const [x,y,w,h,a]of [[180,90,220,120,1],[640,120,160,90,.75],[470,20,120,40,.5]]){
  const box=g.createRadialGradient(x!+w!/2,y!+h!/2,0,x!+w!/2,y!+h!/2,Math.max(w!,h!)/1.4);
  box.addColorStop(0,`rgba(255,255,255,${a})`);box.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=box;g.fillRect(x!-w!,y!-h!,w!*3,h!*3);
 }
 const texture=new CanvasTexture(canvas);texture.mapping=EquirectangularReflectionMapping;texture.colorSpace=SRGBColorSpace;return texture;
}
function sweepGeometry(){
 // Extend the foreground without moving the original curved backdrop. At
 // portrait aspect and longer camera distances, the old floor ended in frame.
 const width=300,front=130,depth=front+15,radius=8,wall=60,length=depth+Math.PI*radius/2+wall,geo=new PlaneGeometry(width,length,1,600),p=geo.attributes.position!;
 for(let i=0;i<p.count;i++){
  const s=p.getY(i)+length/2;let y,z;
  if(s<=depth){y=0;z=front-s;}
  else if(s<=depth+Math.PI*radius/2){const a=(s-depth)/radius;y=radius-radius*Math.cos(a);z=-15-radius*Math.sin(a);}
  else{y=radius+s-depth-Math.PI*radius/2;z=-15-radius;}
  p.setXYZ(i,p.getX(i),y-2.4,z-2);
 }
 geo.computeVertexNormals();return geo;
}
function roundedPlane(width:number,height:number,radius:number){
 const s=new Shape(),x=-width/2,y=-height/2,r=radius;
 s.moveTo(x+r,y);s.lineTo(x+width-r,y);s.quadraticCurveTo(x+width,y,x+width,y+r);s.lineTo(x+width,y+height-r);
 s.quadraticCurveTo(x+width,y+height,x+width-r,y+height);s.lineTo(x+r,y+height);s.quadraticCurveTo(x,y+height,x,y+height-r);
 s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);
 const geometry=new ShapeGeometry(s,16),p=geometry.attributes.position!,uv=geometry.attributes.uv!;
 for(let i=0;i<p.count;i++)uv.setXY(i,(p.getX(i)-x)/width,(p.getY(i)-y)/height);
 return geometry;
}
function createObjectStudio(ctx:SceneContext,params:{assetKey:string;textSlot?:string;objectMotion?:boolean;panelKeys?:readonly string[];panelFocus?:Readonly<Record<string,string>>}){
 const asset=ctx.asset(params.assetKey),panelAssets=(params.panelKeys??[]).map(key=>ctx.asset(key));
 if([asset,...panelAssets].some(item=>item.kind==='video'))throw Error('DEVICE_TEXTURE_IMAGE_REQUIRED');
 const panelRois=panelAssets.map((screen,index)=>{
  const focus=params.panelFocus?.[params.panelKeys![index]!];if(!focus)return undefined;
  const roi=screen.roi[Number(focus.slice(4))];
  if(!roi||![roi.x,roi.y,roi.width,roi.height].every(Number.isFinite)||roi.x<0||roi.y<0||roi.width<=0||roi.height<=0||roi.x+roi.width>1||roi.y+roi.height>1)throw Error('CUSTOM_3D_PANEL_ROI_INVALID');
  return roi;
 });
 const safe=document.createElement('div'),inset=ctx.target.safeInsets,wide=ctx.target.aspect==='landscape',hasText=Boolean(params.textSlot);
 const stage=document.createElement('div');Object.assign(stage.style,{position:'absolute',inset:'0'});ctx.root.append(stage);
 const canvas=document.createElement('canvas');canvas.dataset.pbWebgl='object-studio';Object.assign(canvas.style,{display:'block',width:'100%',height:'100%'});stage.append(canvas);
 Object.assign(safe.style,{position:'absolute',left:inset.left*100+'%',right:inset.right*100+'%',top:inset.top*100+'%',bottom:inset.bottom*100+'%',pointerEvents:'none'});ctx.root.append(safe);
 if(params.textSlot){const title=document.createElement('div');Object.assign(title.style,{position:'absolute',left:'0',top:'0',width:wide?'44%':'100%',height:wide?'28%':'18%',padding:'16px',background:ctx.style.palette.bg});safe.append(title);ctx.text(params.textSlot).mount(title,{maxLines:3,maxFontSize:72});}
 const context=createTrustedWebGL(canvas);let renderer:WebGLRenderer;
 try{renderer=new WebGLRenderer({canvas,context,alpha:false,antialias:true,preserveDrawingBuffer:true});}
 catch(error){releaseTrustedWebGL(canvas);context.getExtension('WEBGL_lose_context')?.loseContext();throw error;}
 renderer.setPixelRatio(1);renderer.setSize(Math.round(stage.clientWidth),Math.round(stage.clientHeight),false);renderer.outputColorSpace=SRGBColorSpace;
 renderer.toneMapping=ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=true;
 const gl=renderer.getContext();if([asset,...panelAssets].some(item=>item.width>gl.getParameter(gl.MAX_TEXTURE_SIZE)||item.height>gl.getParameter(gl.MAX_TEXTURE_SIZE))){renderer.dispose();renderer.forceContextLoss();releaseTrustedWebGL(canvas);throw Error('DEVICE_TEXTURE_TOO_LARGE');}
 let disposed=false,lost=false,shaderFailed=false;const onLost=(event:Event)=>{event.preventDefault();lost=true;};canvas.addEventListener('webglcontextlost',onLost);renderer.debug.onShaderError=()=>{shaderFailed=true;};
 try{
 const scene=new Scene();scene.background=new Color(ctx.style.palette.bg??'#19211b');
 const sky=studioSky(),pmrem=new PMREMGenerator(renderer),environment=pmrem.fromEquirectangular(sky);scene.environment=environment.texture;
 const sweep=new Mesh(sweepGeometry(),new MeshStandardMaterial({color:ctx.style.palette.bg??'#19211b',roughness:.85,side:DoubleSide}));sweep.receiveShadow=true;scene.add(sweep);
 const key=new DirectionalLight('#ffffff',2.2);key.position.set(4.8,8,5.6);key.castShadow=true;key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-8,right:8,top:8,bottom:-8,near:.1,far:48});key.shadow.bias=-.0004;key.shadow.normalBias=.02;
 const rim=new DirectionalLight('#ffffff',1.2);rim.position.set(-6.4,4,-8);scene.add(key,rim);
 const makeDevice=(screen:typeof asset,roi?:{x:number;y:number;width:number;height:number})=>{
  const imageWidth=screen.width*(roi?.width??1),imageHeight=screen.height*(roi?.height??1);
  const width=3.8*Math.min(1,imageWidth/imageHeight),height=width*imageHeight/imageWidth,bezel=.08,depth=.12,radius=Math.min(.12,(Math.min(width,height)+2*bezel)/2-.001);
  const device=new Group(),bodyGeometry=new RoundedBoxGeometry(width+2*bezel,height+2*bezel,depth,6,Math.min(radius,depth/2-.001));
  const bodyMaterial=new MeshPhysicalMaterial({color:ctx.style.palette.bg??'#19211b',roughness:.35,metalness:.7,clearcoat:1,clearcoatRoughness:.15});
  const body=new Mesh(bodyGeometry,bodyMaterial);body.castShadow=true;body.receiveShadow=true;device.add(body);
  const image=document.createElement('img');image.src=screen.url;image.alt='';const texture=new Texture(image);texture.colorSpace=SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  if(roi){texture.repeat.set(roi.width,roi.height);texture.offset.set(roi.x,1-roi.y-roi.height);}
  const faceGeometry=roundedPlane(width,height,Math.max(0,radius-bezel)),faceMaterial=new MeshBasicMaterial({map:texture,toneMapped:false});
  const face=new Mesh(faceGeometry,faceMaterial);face.position.z=depth/2+.002;device.add(face);scene.add(device);
  return{screen,device,width,height,bezel,image,texture,bodyGeometry,bodyMaterial,faceGeometry,faceMaterial};
 };
 const main=makeDevice(asset),panels=panelAssets.map((screen,index)=>makeDevice(screen,panelRois[index])),devices=[main,...panels],{device,width,height,bezel}=main;
 // Additional screens start hidden; each seek must state exactly which belong in this shot.
 for(const panel of panels)panel.device.visible=false;
 const camera=new PerspectiveCamera(30,stage.clientWidth/stage.clientHeight,.05,400);
 const distance=Math.max((height+2*bezel)/2,((width+2*bezel)/2)/camera.aspect)/Math.tan(30*Math.PI/360)*1.25;
 const duration=(ctx.frames.end-ctx.frames.start)/30;
 const draw=(time:number)=>{
  if(disposed)throw Error('WEBGL_DISPOSED');if(lost||gl.isContextLost())throw Error('WEBGL_CONTEXT_LOST');
  const p=Math.min(1,Math.max(0,time/Math.min(1.8,duration))),e=1-Math.pow(1-p,3),yaw=(-30+18*e+Math.sin(time*.3)*3)*Math.PI/180;
  const targetX=wide&&hasText?-width*.42:0,targetY=!wide&&hasText?height*.28:0;
  camera.position.set(targetX+Math.sin(yaw)*distance,targetY+Math.sin(.1)*distance,Math.cos(yaw)*distance);camera.lookAt(targetX,targetY,0);
  renderer.render(scene,camera);if(shaderFailed)throw Error('WEBGL_SHADER_COMPILE_FAILED');
 };
 const renderView=(view:StudioView)=>{
  const objectKeys=['objectYaw','objectPitch','objectRoll','objectScale'];
  if(!view||typeof view!=='object'||Array.isArray(view)||Object.keys(view).some(key=>!['yaw','pitch','distanceScale','targetX','targetY',...(params.objectMotion?objectKeys:[]),...(params.panelKeys?['panels']:[])].includes(key)))throw Error('STUDIO_VIEW_INVALID');
  const yaw=view.yaw??0,pitch=view.pitch??0,scale=view.distanceScale??1,targetX=view.targetX??0,targetY=view.targetY??0;
  const objectYaw=view.objectYaw??0,objectPitch=view.objectPitch??0,objectRoll=view.objectRoll??0,objectScale=view.objectScale??1;
  if(![yaw,pitch,scale,targetX,targetY,objectYaw,objectPitch,objectRoll,objectScale].every(Number.isFinite)||Math.abs(yaw)>70||Math.abs(pitch)>45||scale<.8||scale>3||Math.abs(targetX)>4||Math.abs(targetY)>4
   ||Math.abs(objectYaw)>180||Math.abs(objectPitch)>180||Math.abs(objectRoll)>180||objectScale<.5||objectScale>1.5)throw Error('STUDIO_VIEW_INVALID');
  if(params.panelKeys){
   if(view.panels!==undefined&&(!Array.isArray(view.panels)||view.panels.length!==panels.length))throw Error('STUDIO_VIEW_INVALID');
   for(const [index,panel]of panels.entries()){
    const pose=view.panels===undefined?{}:view.panels[index];
    if(!pose||typeof pose!=='object'||Array.isArray(pose)||Object.keys(pose).some(key=>!['x','y','z','yaw','pitch','roll','scale','visible'].includes(key)))throw Error('STUDIO_VIEW_INVALID');
    const x=pose.x??0,y=pose.y??0,z=pose.z??0,py=pose.yaw??0,pp=pose.pitch??0,pr=pose.roll??0,ps=pose.scale??.5,visible=pose.visible??false;
    if(![x,y,z,py,pp,pr,ps].every(Number.isFinite)||Math.abs(x)>4||Math.abs(y)>4||Math.abs(z)>4||Math.abs(py)>180||Math.abs(pp)>180||Math.abs(pr)>180
      ||ps<.25||ps>1.5||typeof visible!=='boolean')throw Error('STUDIO_VIEW_INVALID');
    panel.device.position.set(x,y,z);panel.device.rotation.set(pp*Math.PI/180,py*Math.PI/180,pr*Math.PI/180);panel.device.scale.setScalar(ps);panel.device.visible=visible;
   }
  }
  if(disposed)throw Error('WEBGL_DISPOSED');if(lost||gl.isContextLost())throw Error('WEBGL_CONTEXT_LOST');
  const y=yaw*Math.PI/180,p=pitch*Math.PI/180,d=distance*scale;
  device.rotation.set(objectPitch*Math.PI/180,objectYaw*Math.PI/180,objectRoll*Math.PI/180);device.scale.setScalar(objectScale);
  camera.position.set(targetX+Math.sin(y)*Math.cos(p)*d,targetY+Math.sin(p)*d,Math.cos(y)*Math.cos(p)*d);camera.lookAt(targetX,targetY,0);
  renderer.render(scene,camera);if(shaderFailed)throw Error('WEBGL_SHADER_COMPILE_FAILED');
 };
 const dispose=()=>{if(disposed)return;disposed=true;canvas.removeEventListener('webglcontextlost',onLost);
  for(const part of devices){part.bodyGeometry.dispose();part.bodyMaterial.dispose();part.faceGeometry.dispose();part.faceMaterial.dispose();part.texture.dispose();}
  sweep.geometry.dispose();sweep.material.dispose();environment.dispose();sky.dispose();pmrem.dispose();key.dispose();rim.dispose();renderer.dispose();renderer.forceContextLoss();releaseTrustedWebGL(canvas);};
 const ready=Promise.all(devices.map(async part=>{await part.image.decode();if(part.image.naturalWidth!==part.screen.width||part.image.naturalHeight!==part.screen.height)throw Error('ASSET_DIMENSIONS_MISMATCH');part.texture.needsUpdate=true;})).then(()=>{if(!disposed)draw(0);}).catch(error=>{dispose();throw error;});
 return{ready,render:draw,renderView,dispose,events:blockEvents('object-studio',ctx.frames,params),regions:[{regionId:'product',boxAt(){const box=stage.getBoundingClientRect(),root=ctx.root.getBoundingClientRect();return{x:box.x-root.x,y:box.y-root.y,width:box.width,height:box.height};}}]};
 }catch(error){canvas.removeEventListener('webglcontextlost',onLost);renderer.dispose();renderer.forceContextLoss();releaseTrustedWebGL(canvas);throw error;}
}
window.PB.defineBlock<{assetKey:string;textSlot?:string}>({id:'object-studio',version:'1.0.1',build:createObjectStudio});
// One-time handoff to the trusted engine; custom scene code never receives the factory.
Object.defineProperty(window,'__pbTakeStudioFactory',{configurable:true,value:()=>{
 delete window.__pbTakeStudioFactory;return createObjectStudio;
}});
