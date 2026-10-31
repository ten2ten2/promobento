import './object-studio.ts';
import {AmbientLight,BoxGeometry,Color,DirectionalLight,Group,Mesh,MeshBasicMaterial,MeshStandardMaterial,
  PerspectiveCamera,PlaneGeometry,Scene,SRGBColorSpace,Texture,WebGLRenderer} from 'three';
import {easeOut} from '../../film-runtime/src/motion.ts';
import {blockEvents} from './events.mjs';
import '../../film-runtime/src/types.ts';

// Original geometry. No branded device model, remote loader, shadow map or post-processing.
window.PB.defineBlock<{assetKey:string;textSlot?:string}>({id:'device-3d',version:'1.0.0',build(ctx,params){
 const asset=ctx.asset(params.assetKey);if(asset.kind==='video')throw Error('DEVICE_TEXTURE_IMAGE_REQUIRED');
 const safe=document.createElement('div'),wide=ctx.target.aspect==='landscape',hasText=Boolean(params.textSlot);
 const inset=ctx.target.safeInsets;
 Object.assign(safe.style,{position:'absolute',left:inset.left*100+'%',right:inset.right*100+'%',top:inset.top*100+'%',bottom:inset.bottom*100+'%'});ctx.root.append(safe);
 if(params.textSlot){
  const title=document.createElement('div');Object.assign(title.style,{position:'absolute',left:'0',top:wide?'22%':'0',width:wide?'36%':'100%',height:wide?'65%':'25%'});
  safe.append(title);ctx.text(params.textSlot).mount(title,{maxLines:4});
 }
 const stage=document.createElement('div');Object.assign(stage.style,{position:'absolute',left:wide&&hasText?'39%':'0',top:!wide&&hasText?'29%':'0',width:wide&&hasText?'61%':'100%',height:!wide&&hasText?'71%':'100%'});safe.append(stage);
 const canvas=document.createElement('canvas');canvas.dataset.pbWebgl='device-3d';Object.assign(canvas.style,{display:'block',width:'100%',height:'100%'});stage.append(canvas);
 const renderer=new WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true});
 renderer.setPixelRatio(1);renderer.setSize(Math.round(stage.clientWidth),Math.round(stage.clientHeight),false);renderer.outputColorSpace=SRGBColorSpace;
 const gl=renderer.getContext();if(asset.width>gl.getParameter(gl.MAX_TEXTURE_SIZE)||asset.height>gl.getParameter(gl.MAX_TEXTURE_SIZE)){
  renderer.dispose();throw Error('DEVICE_TEXTURE_TOO_LARGE');
 }
 let disposed=false,lost=false,shaderFailed=false;
 const onLost=(event:Event)=>{event.preventDefault();lost=true;};canvas.addEventListener('webglcontextlost',onLost);
 renderer.debug.onShaderError=()=>{shaderFailed=true;};
 const scene=new Scene(),group=new Group();scene.add(group);
 const camera=new PerspectiveCamera(35,stage.clientWidth/stage.clientHeight,.1,100);
 const width=3.8*Math.min(1,asset.width/asset.height),height=width*asset.height/asset.width;
 // Fit the entire screenshot rather than cropping product content or facts.
 const distance=Math.max((height+.9)/2,((width+.5)/2)/camera.aspect)/Math.tan(35*Math.PI/360)*1.35;
 camera.position.set(0,-.12,distance);camera.lookAt(0,-.12,0);
 const image=document.createElement('img');image.src=asset.url;image.alt='';
 const texture=new Texture(image);texture.colorSpace=SRGBColorSpace;
 const bodyGeometry=new BoxGeometry(width+.18,height+.18,.14),screenGeometry=new PlaneGeometry(width,height);
 const stemGeometry=new BoxGeometry(.14,.42,.12),footGeometry=new BoxGeometry(.95,.07,.62);
 const bodyMaterial=new MeshStandardMaterial({color:new Color(ctx.style.palette.bg??'#19211b'),metalness:.4,roughness:.35});
 const edgeMaterial=new MeshStandardMaterial({color:new Color(ctx.style.palette.accent??'#d9fa73'),metalness:.35,roughness:.4});
 const screenMaterial=new MeshBasicMaterial({map:texture});
 const body=new Mesh(bodyGeometry,bodyMaterial),screen=new Mesh(screenGeometry,screenMaterial);
 screen.position.z=.081;group.add(body,screen);
 const stem=new Mesh(stemGeometry,edgeMaterial),foot=new Mesh(footGeometry,bodyMaterial);
 stem.position.set(0,-height/2-.23,-.015);foot.position.set(0,-height/2-.47,.03);group.add(stem,foot);
 scene.add(new AmbientLight(0xffffff,2));
 const key=new DirectionalLight(0xffffff,3);key.position.set(-3,5,6);scene.add(key);
 const rim=new DirectionalLight(ctx.style.palette.accent??'#d9fa73',2);rim.position.set(4,2,-3);scene.add(rim);
 const draw=(time:number)=>{
  if(disposed)throw Error('WEBGL_DISPOSED');if(lost||gl.isContextLost())throw Error('WEBGL_CONTEXT_LOST');
  const p=easeOut(time/.8);group.rotation.set(-.055,-.11-(1-p)*.19+Math.sin(time*.35)*.035,0);
  group.position.y=(1-p)*.16+Math.sin(time*.5)*.025;
  renderer.render(scene,camera);if(shaderFailed)throw Error('WEBGL_SHADER_COMPILE_FAILED');
 };
 const dispose=()=>{
  if(disposed)return;disposed=true;canvas.removeEventListener('webglcontextlost',onLost);
  for(const geometry of[bodyGeometry,screenGeometry,stemGeometry,footGeometry])geometry.dispose();
  for(const material of[bodyMaterial,edgeMaterial,screenMaterial])material.dispose();texture.dispose();renderer.dispose();renderer.forceContextLoss();
 };
 const ready=image.decode().then(()=>{if(disposed)return;texture.needsUpdate=true;draw(0);}).catch(error=>{dispose();throw error;});
 return{ready,render:draw,dispose,events:blockEvents('device-3d',ctx.frames,params),regions:[{regionId:'product',boxAt(){
  const box=stage.getBoundingClientRect(),root=ctx.root.getBoundingClientRect();
  return{x:box.x-root.x,y:box.y-root.y,width:box.width,height:box.height};
 }}]};
}});
