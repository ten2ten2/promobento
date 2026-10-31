// Actual author-code execution, only inside the existing separate-uid offline browser container.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {filmSession} from '../src/browser.mjs';
import {compareSeam,pngPixels,pngRgba} from '@promobento/contracts/seams';
import {filmFixture,pageOptions} from '../../../packages/film-runtime/test/fixture.mjs';
import {customFixture} from '../../../packages/film-runtime/test/custom-fixture.mjs';
if(process.platform!=='linux'||process.getuid()!==10001||process.env.PROMOBENTO_BROWSER_TEST_CONTAINER!=='1')throw Error('BROWSER_TEST_REQUIRES_ISOLATED_CI_CONTAINER');
const rules=JSON.parse(readFileSync('config/platform-presets.json')),lock=JSON.parse(readFileSync('apps/render-container/environment.lock.json')),catalog=JSON.parse(readFileSync('/opt/fonts/catalog.json'));
const output='/work/film-runtime';mkdirSync(output,{recursive:true});
const mode=process.env.PROMOBENTO_RUNTIME_CASE??'custom',report={scope:'sandboxed_custom_DOM_SVG_Canvas_GSAP_not_cloud_or_owner_quality',mode,aspects:[],attacks:[],passed:false};
const file=mode==='custom'?'report.json':mode==='custom-guards'?'guards.json':mode==='custom-assets'?'asset-check.json':mode==='custom-loop'?'fault-loop.json':mode==='custom-init-loop'?'fault-init-loop.json':'fault-memory.json';
const font=face=>readFileSync('/opt/fonts/'+catalog.fonts.find(item=>item.fontId===face.fontId&&item.weight===face.weight).file);
const killBrowser=async()=>{const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');const cdp=await browser.newBrowserCDPSession();await cdp.send('Browser.close').catch(()=>{});};
async function open(aspect,attack,initialization=false,legacy=false){
 const {film,sources}=legacy?{film:filmFixture(),sources:{}}:customFixture(),options=pageOptions(aspect,rules.aspectLayouts[aspect]);
 if(legacy){film.assets={};film.scenes=[{...film.scenes[0],end:450}];options.resources=[];}
 options.fonts=options.fonts.map(face=>{const installed=catalog.fonts.find(item=>item.fontId===face.fontId&&item.weight===face.weight);return{...face,licenseRef:installed.licenseRef,codePoints:installed.codePoints};});
 if(attack)sources['scenes/product/index.js']=initialization?sources['scenes/product/index.js'].replace('const w=',attack+';const w='):sources['scenes/product/index.js'].replace('const a=Math.min',`if(t>0){${attack}} const a=Math.min`);
 options.customSources=sources;options.frameTimeoutMs=3000;options.initTimeoutMs=mode==='custom-init-loop'?2000:10000;
 return filmSession({raw:JSON.stringify(film),options,browserVersion:lock.browser.version,font,resource:()=>{throw Error('UNEXPECTED_RESOURCE');},killBrowser});
}
try{
 if(mode==='custom-assets'){
  const film=filmFixture(),options=pageOptions('landscape',rules.aspectLayouts.landscape);
  film.scenes=[{id:'product',kind:'custom',module:'scenes/product/index.js',start:0,end:240,purpose:'Check an original image and heading.',brief:'Show the image after the initial hold.',
   params:{textSlots:['product'],assetKeys:['dashboard'],events:[],readingHolds:[{start:30,end:110}],assetChecks:[{frame:45,assetKeys:['dashboard']},{frame:90,assetKeys:['dashboard']}]}},
   {...film.scenes[2],start:232,transitionIn:{type:'fade-through',frames:8}}];
  const source=`PB.scene('product',ctx=>{
   const heading=document.createElement('div');Object.assign(heading.style,{position:'absolute',left:'8%',top:'30%',width:'38%',height:'30%'});ctx.root.append(heading);ctx.text('product').mount(heading);
   const wrap=document.createElement('div'),img=document.createElement('img');Object.assign(wrap.style,{position:'absolute',left:'60%',top:'20%',width:'25%',height:'55%'});img.src=ctx.asset('dashboard').url;Object.assign(img.style,{width:'100%',height:'100%'});wrap.append(img);ctx.root.append(wrap);
   const timeline=gsap.timeline({paused:true});ctx.OM.clock(timeline,t=>{wrap.style.opacity=t<2?'0':'1';},8);return {timeline};});`;
  options.fonts=options.fonts.map(face=>{const installed=catalog.fonts.find(item=>item.fontId===face.fontId&&item.weight===face.weight);return{...face,licenseRef:installed.licenseRef,codePoints:installed.codePoints};});
  options.customSources={'scenes/product/index.js':source};options.observeAssets=true;
  const original=pngRgba(2,2,Uint8Array.from([0,180,0,255,0,180,0,255,0,180,0,255,0,180,0,255]));
  const session=await filmSession({raw:JSON.stringify(film),options,browserVersion:lock.browser.version,font,resource:()=>original,killBrowser});
  try{
   for(const [frame,visibility]of [[45,'hidden'],[90,'visible']]){
    await session.frame(frame,{format:'png'});const observation=await session.observe('asset-check',frame);
    assert.equal(observation.assets.find(asset=>asset.sceneId==='product'&&asset.resourceId==='res_fixture_dashboard')?.visibility,visibility,JSON.stringify(observation.assets));
   }
   for(const frame of [232,234,236,238,240]){
    writeFileSync(`${output}/fade-through-${frame}.png`,await session.frame(frame,{format:'png'}));
    const observation=await session.observe('asset-check',frame),outgoing=observation.texts.some(text=>text.slotId==='product'),incoming=observation.texts.some(text=>text.slotId==='cta');
    assert.ok(!outgoing||!incoming,`Outgoing and CTA text overlap at frame ${frame}`);
    if(frame===236)assert.ok(!outgoing&&incoming);
   }
   report.assetObservation='hidden_then_visible';report.fadeThrough='no_cross_scene_text_overlap';report.sandbox=session.sandbox;
  }finally{await session.close();}
  // Approved JPEG and WebP bytes must decode through the same asset broker as PNG.
  const jpeg=Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAL/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCAA5IH/9k=','base64'),webp=Buffer.from('UklGRjoAAABXRUJQVlA4IC4AAADQAQCdASoCAAMAAUAmJaACdLoB+AADsAD+rhf/NgVzXPv9/+8+fufP3Pn/CAAA','base64');
  const tiff=Buffer.alloc(26);tiff.write('II');tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);tiff.writeUInt16LE(1,8);
  tiff.writeUInt16LE(0x112,10);tiff.writeUInt16LE(3,12);tiff.writeUInt32LE(1,14);tiff.writeUInt16LE(6,18);
  const exif=Buffer.concat([Buffer.from('Exif\0\0'),tiff]),segment=Buffer.alloc(4);segment[0]=255;segment[1]=0xe1;segment.writeUInt16BE(exif.length+2,2);
  const rotated=Buffer.concat([jpeg.subarray(0,2),segment,exif,jpeg.subarray(2)]);
  for(const [format,bytes,width,height] of [['jpeg',jpeg,2,3],['webp',webp,2,3],['jpeg-rotated',rotated,3,2]]){
   const checkedSource=source.replace('img.src=ctx.asset(\'dashboard\').url;',`img.src=ctx.asset('dashboard').url;ctx.OM.ready(img.decode().then(()=>{if(img.naturalWidth!==${width}||img.naturalHeight!==${height})throw Error('IMAGE_ORIENTATION_MISMATCH');}));`);
   const encodedOptions={...options,resources:options.resources.map(resource=>({...resource,width,height})),customSources:{'scenes/product/index.js':checkedSource}};
   const encodedSession=await filmSession({raw:JSON.stringify(film),options:encodedOptions,browserVersion:lock.browser.version,font,resource:()=>bytes,killBrowser});
   try{const frame=pngPixels(await encodedSession.frame(90,{format:'png'}));let green=0;for(let i=0;i<frame.pixels.length;i+=4)if(frame.pixels[i]<100&&frame.pixels[i+1]>120&&frame.pixels[i+2]<100)green++;
    assert.ok(green>frame.width*frame.height*.01,`${format} actual image pixels visible`);
    const checked=await encodedSession.observe('format-test',90);assert.equal(checked.assets.find(asset=>asset.resourceId==='res_fixture_dashboard')?.visibility,'visible');
   }finally{await encodedSession.close();}
  }
  report.originalImageFormats='jpeg_webp_and_exif_orientation_broker_decode_and_visibility';
  // Reproduce the 3D aisle's zero-sized perspective origin and full-frame transparent
  // pointer-free overlay with original synthetic pixels, never real user footage.
  const perspectiveFilm=filmFixture(),perspectiveOptions=pageOptions('landscape',rules.aspectLayouts.landscape);
  perspectiveFilm.scenes=[{id:'product',kind:'custom',module:'scenes/product/index.js',start:0,end:240,purpose:'Observe a perspective image.',brief:'Exercise transparent and painted overlays.',
   params:{textSlots:['product'],assetKeys:['dashboard'],events:[],readingHolds:[{start:30,end:110}],assetChecks:[45,90,120,150].map(frame=>({frame,assetKeys:['dashboard']}))}},
   {...perspectiveFilm.scenes[2],start:232,transitionIn:{type:'fade-through',frames:8}}];
  const perspectiveSource=`PB.scene('product',ctx=>{
   const stage=document.createElement('div'),world=document.createElement('div'),img=document.createElement('img'),hidden=document.createElement('div'),front=document.createElement('div'),child=document.createElement('div'),label=document.createElement('div');
   Object.assign(stage.style,{position:'absolute',inset:'0',overflow:'hidden',perspective:'1100px'});ctx.root.append(stage);
   Object.assign(world.style,{position:'absolute',left:'50%',top:'40%',width:'0',height:'0',transformStyle:'preserve-3d'});stage.append(world);
   img.src=ctx.asset('dashboard').url;Object.assign(img.style,{position:'absolute',left:'-150px',top:'-250px',width:'300px',height:'500px',transform:'translate3d(-200px,0,-200px) rotateY(30deg)'});world.append(img);
   // An invisible later sibling is still hit-testable in Chromium; it must not conceal
   // the image, while a genuinely painted layer above it must remain unverified.
   Object.assign(hidden.style,{position:'absolute',inset:'0',background:'black',opacity:'0'});stage.append(hidden);
   Object.assign(front.style,{position:'absolute',inset:'0',pointerEvents:'none'});ctx.root.append(front);
   Object.assign(child.style,{position:'absolute',left:'0',top:'0',width:'100%',height:'100%'});front.append(child);
   Object.assign(label.style,{position:'absolute',left:'5%',top:'5%',width:'30%',height:'10%',opacity:'0'});ctx.root.append(label);ctx.text('product').mount(label);
   const timeline=gsap.timeline({paused:true});ctx.OM.clock(timeline,t=>{const f=t*30;front.style.backgroundColor=f>=90&&f<120?'rgb(0,0,0)':'transparent';img.style.opacity=f>=120&&f<150?'0':'1';child.style.backgroundColor=f>=150?'rgb(0,0,0)':'transparent';},8);return {timeline};});`;
  perspectiveOptions.fonts=perspectiveOptions.fonts.map(face=>{const installed=catalog.fonts.find(item=>item.fontId===face.fontId&&item.weight===face.weight);return{...face,licenseRef:installed.licenseRef,codePoints:installed.codePoints};});
  perspectiveOptions.customSources={'scenes/product/index.js':perspectiveSource};perspectiveOptions.observeAssets=true;
  const perspective=await filmSession({raw:JSON.stringify(perspectiveFilm),options:perspectiveOptions,browserVersion:lock.browser.version,font,resource:()=>original,killBrowser});
  try{
   for(const [frame,visibility] of [[45,'visible'],[90,'unverified'],[120,'hidden'],[150,'unverified']]){
    const png=await perspective.frame(frame,{format:'png'});if(frame===45||frame===90)writeFileSync(`${output}/asset-perspective-${frame}.png`,png);
    const observation=await perspective.observe('perspective-asset-check',frame);
    assert.equal(observation.assets.find(asset=>asset.sceneId==='product'&&asset.resourceId==='res_fixture_dashboard')?.visibility,visibility,JSON.stringify({frame,assets:observation.assets}));
   }
   report.perspectiveAssetObservation='transparent_visible_opaque_unverified_hidden_descendant_unverified';
  }finally{await perspective.close();}
  // Original template selectors commonly reuse #world. Both scenes are built before
  // either is drawn; the second camera must not change the first scene's world.
  const multiFilm=filmFixture(),multiOptions=pageOptions('landscape',rules.aspectLayouts.landscape);
  multiFilm.assets={};multiFilm.scenes=['first','second'].map((id,index)=>({id,kind:'custom',module:`scenes/${id}/index.js`,
   start:index*225,end:(index+1)*225,purpose:'Scene-local camera fixture.',brief:'Two worlds with the same template ID.',
   params:{textSlots:[],assetKeys:[],events:[],readingHolds:[{start:0,end:225}]}}));
  multiOptions.resources=[];multiOptions.fonts=multiOptions.fonts.map(face=>{const installed=catalog.fonts.find(item=>item.fontId===face.fontId&&item.weight===face.weight);return{...face,licenseRef:installed.licenseRef,codePoints:installed.codePoints};});
  multiOptions.customSources=Object.fromEntries(['first','second'].map((id,index)=>[`scenes/${id}/index.js`,`PB.scene('${id}',ctx=>{
   const world=document.createElement('div'),panel=document.createElement('div');world.id='world';
   Object.assign(world.style,{position:'absolute',left:'0',top:'0',width:'100%',height:'100%'});ctx.root.append(world);
   Object.assign(panel.style,{position:'absolute',left:'25%',top:'25%',width:'50%',height:'50%',background:'${index?'rgb(0,0,255)':'rgb(255,0,0)'}'});world.append(panel);
   ctx.OM.camera('#world').set({zoom:${index?2:1}});const timeline=gsap.timeline({paused:true});timeline.to({}, {duration:7.5});return {timeline};});`]));
  const multi=await filmSession({raw:JSON.stringify(multiFilm),options:multiOptions,browserVersion:lock.browser.version,font,resource:()=>{throw Error('UNEXPECTED_RESOURCE');},killBrowser});
  try{
   for(const [frame,color] of [[30,[16,23,18]],[255,[0,0,255]]]){
    const png=await multi.frame(frame,{format:'png'}),{width,height,pixels}=pngPixels(png),at=(Math.floor(height*.15)*width+Math.floor(width*.15))*4;
    assert.deepEqual([...pixels.subarray(at,at+3)],color,`scene-local camera at frame ${frame}`);
   }
   report.sceneLocalCamera='duplicate_world_ids_isolated';
  }finally{await multi.close();}
  const scopedFilm=filmFixture(),scopedOptions=pageOptions('landscape',rules.aspectLayouts.landscape);
  scopedFilm.assets={};scopedFilm.scenes=['first','second'].map((id,index)=>({id,kind:'custom',module:`scenes/${id}/index.js`,
   start:index*225,end:(index+1)*225,purpose:'Scene-local GSAP selector fixture.',brief:'Two worlds with the same template ID.',
   params:{gsapScope:'scene',textSlots:[],assetKeys:[],events:[],readingHolds:[{start:0,end:225}]}}));
  scopedOptions.resources=[];scopedOptions.fonts=multiOptions.fonts;
  scopedOptions.customSources=Object.fromEntries(['first','second'].map((id,index)=>[`scenes/${id}/index.js`,`PB.scene('${id}',ctx=>{
   const panel=document.createElement('div');panel.id='same';Object.assign(panel.style,{position:'absolute',left:'25%',top:'25%',width:'50%',height:'50%',background:'${index?'rgb(0,0,255)':'rgb(255,0,0)'}'});ctx.root.append(panel);
   gsap.set('#same',{backgroundColor:'${index?'rgb(0,0,255)':'rgb(255,0,0)'}'});const timeline=gsap.timeline({paused:true});${index?"timeline.to('#same',{x:200,duration:1},0);":''}timeline.to({}, {duration:7.5},0);return {timeline};});`]));
  // The opt-in is new; an old film that omitted it retains document-wide selectors.
  for(const [scope,expected] of [['scene',[255,0,0]],['legacy',[0,0,255]]]){
   if(scope==='legacy')for(const scene of scopedFilm.scenes)delete scene.params.gsapScope;
   const session=await filmSession({raw:JSON.stringify(scopedFilm),options:scopedOptions,browserVersion:lock.browser.version,font,resource:()=>{throw Error('UNEXPECTED_RESOURCE');},killBrowser});
   try{
    const png=await session.frame(30,{format:'png'}),{width,height,pixels}=pngPixels(png),at=(Math.floor(height*.5)*width+Math.floor(width*.5))*4;
    assert.deepEqual([...pixels.subarray(at,at+3)],expected,`${scope} GSAP selector`);
    await session.frame(255,{format:'png'});
    const firstAgain=pngPixels(await session.frame(30,{format:'png'})),side=(Math.floor(firstAgain.height*.5)*firstAgain.width+Math.floor(firstAgain.width*.26))*4;
    assert.deepEqual([...firstAgain.pixels.subarray(side,side+3)],scope==='scene'?[255,0,0]:[16,23,18],`${scope} GSAP timeline selector`);
   }finally{await session.close();}
  }
  report.gsapSelectors='scene_opt_in_and_legacy_preserved';
  const spaceFilm=filmFixture(),spaceOptions=pageOptions('landscape',rules.aspectLayouts.landscape);
  spaceFilm.assets={};spaceFilm.scenes=[{id:'world',kind:'custom',module:'scenes/world/index.js',start:0,end:450,
   purpose:'Multiple original spatial camera moves.',brief:'Exercise the timeline and its unrelated tween.',
   params:{textSlots:[],assetKeys:[],events:[],readingHolds:[{start:0,end:450}]}}];
  spaceOptions.resources=[];spaceOptions.fonts=multiOptions.fonts;
  spaceOptions.customSources={'scenes/world/index.js':`PB.scene('world',ctx=>{
   const world=document.createElement('div'),panel=document.createElement('div');ctx.root.append(world);world.append(panel);
   Object.assign(panel.style,{position:'absolute',left:'30%',top:'30%',width:'40%',height:'40%',background:'rgb(255,0,0)'});
   const timeline=gsap.timeline({paused:true});timeline.to(panel,{x:80,duration:2},0);
   const camera=ctx.OM.space(world).set({flat:true});camera.to(timeline,0,{yaw:20,duration:1});camera.to(timeline,1,{yaw:-20,duration:1});
   if(timeline.getChildren().length!==2)throw Error('CAMERA_DRIVER_INVALID');timeline.to({}, {duration:15},0);return {timeline};});`};
  const space=await filmSession({raw:JSON.stringify(spaceFilm),options:spaceOptions,browserVersion:lock.browser.version,font,resource:()=>{throw Error('UNEXPECTED_RESOURCE');},killBrowser});
  try{
   const first=await space.frame(15,{format:'png'}),later=await space.frame(45,{format:'png'}),reverse=await space.frame(15,{format:'png'});
   assert.notDeepEqual(first,later,'spatial camera and panel actually move');
   assert.notEqual(compareSeam(first,reverse).verdict,'RENDER_SEAM_BLOCK');
   report.spatialCamera='multiple_moves_one_driver_and_reverse_seek';
  }finally{await space.close();}
  // CLIP is trusted library code, but its text helpers must not bypass the scene's
  // fact-bound DOM slots, including via a detached OffscreenCanvas.
  for(const [name,attack] of [
   ['clip-canvas-text',"ctx.CLIP.TY.text(drawing,'unbound claim',100,100)"],
   ['clip-offscreen-text',"const x=new OffscreenCanvas(200,200).getContext('2d');ctx.CLIP.TY.text(x,'unbound claim',100,100)"]
  ]){
   const session=await open('landscape',attack);
   try{await assert.rejects(session.frame(36),/RUNTIME_TEXT_FORBIDDEN/);report.attacks.push({name,blocked:true});}
   finally{await session.close().catch(()=>{});}
  }
  const clipShapes=await open('landscape',"ctx.CLIP.TY.marker(drawing,20,20,100,30,.5,'#ffffff')");
  try{await clipShapes.frame(36,{format:'png'});report.clipShapes='available';}finally{await clipShapes.close();}
  const rigFilm=filmFixture(),rigOptions=pageOptions('portrait',rules.aspectLayouts.portrait);
  rigFilm.assets={};rigFilm.scenes=[{id:'rig',kind:'custom',module:'scenes/rig/index.js',start:0,end:450,
   purpose:'Absolute-time camera path.',brief:'Move a real staged shape with the upstream camera rig.',
   params:{textSlots:[],assetKeys:[],events:[],readingHolds:[{start:0,end:450}]}}];
  rigOptions.resources=[];rigOptions.fonts=multiOptions.fonts;
  rigOptions.customSources={'scenes/rig/index.js':`PB.scene('rig',ctx=>{
   const world=document.createElement('div'),back=document.createElement('div'),panel=document.createElement('div');ctx.root.append(world);world.append(back,panel);
   Object.assign(back.style,{position:'absolute',left:'15%',top:'22%',width:'20%',height:'25%',background:'rgb(0,100,255)',transform:'translateZ(-300px)'});
   Object.assign(panel.style,{position:'absolute',left:'35%',top:'35%',width:'30%',height:'30%',background:'rgb(255,0,0)'});
   const W=ctx.target.width,H=ctx.target.height,camera=ctx.OM.space(world),rig=ctx.OM.cameraRig.create([{id:'reveal',start:0,end:15,keys:[
    {at:0,position:[W/2,H/2,H*5/3],target:[W/2,H/2,0],fov:35},
    {at:4,position:[W/2+W*2,H/2,H*5/6],target:[W/2,H/2,0],fov:35,ease:'linear'}]}]);
   const timeline=gsap.timeline({paused:true});ctx.OM.clock(timeline,t=>camera.set({...rig.sample(t)}),15);return {timeline};});`};
  const rig=await filmSession({raw:JSON.stringify(rigFilm),options:rigOptions,browserVersion:lock.browser.version,font,resource:()=>{throw Error('UNEXPECTED_RESOURCE');},killBrowser});
  try{
   const first=await rig.frame(30,{format:'png'}),later=await rig.frame(90,{format:'png'}),reverse=await rig.frame(30,{format:'png'});
   assert.ok(compareSeam(first,later).diffPixelPct>2,'original rig visibly moves the spatial camera');
   assert.notEqual(compareSeam(first,reverse).verdict,'RENDER_SEAM_BLOCK');
   writeFileSync(`${output}/camera-rig-portrait-30.png`,first);writeFileSync(`${output}/camera-rig-portrait-90.png`,later);
   report.originalCameraRig='portrait_absolute_time_motion_and_reverse_seek';
  }finally{await rig.close();}
  const readyFilm=filmFixture(),readyOptions=pageOptions('landscape',rules.aspectLayouts.landscape);
  readyFilm.assets={};readyFilm.scenes=[{id:'ready',kind:'custom',module:'scenes/ready/index.js',start:0,end:450,
   purpose:'Wait for scene setup.',brief:'A registered asynchronous change must appear in the first frame.',
   params:{textSlots:[],assetKeys:[],events:[],readingHolds:[{start:0,end:450}]}}];
  readyFilm.audio.music={kind:'procedural',style:'mallet',bpm:120};
  readyOptions.resources=[];readyOptions.fonts=multiOptions.fonts;
  readyOptions.customSources={'scenes/ready/index.js':`PB.scene('ready',ctx=>{
   if(ctx.OM.beat(2)!==1||ctx.OM.beat(2,60)!==2||ctx.beats[1]!==15)throw Error('BEAT_FIXTURE_FAILED');
   const panel=document.createElement('div');Object.assign(panel.style,{position:'absolute',inset:'0',background:'rgb(255,0,0)'});ctx.root.append(panel);
   const first=Promise.resolve().then(()=>{let next=Promise.resolve();for(let i=0;i<25;i++)next=next.then(()=>{});
    ctx.OM.ready(next.then(()=>{panel.style.background='rgb(0,0,255)';}));});ctx.OM.ready(first);
   const timeline=gsap.timeline({paused:true});timeline.to({}, {duration:15});return {timeline};});`};
  const ready=await filmSession({raw:JSON.stringify(readyFilm),options:readyOptions,browserVersion:lock.browser.version,font,resource:()=>{throw Error('UNEXPECTED_RESOURCE');},killBrowser});
  try{
   const {width,height,pixels}=pngPixels(await ready.frame(0,{format:'png'})),at=(Math.floor(height*.5)*width+Math.floor(width*.5))*4;
   assert.deepEqual([...pixels.subarray(at,at+3)],[0,0,255],'nested ready completes before first frame');
  }finally{await ready.close();}
  const rejectedOptions={...readyOptions,customSources:{'scenes/ready/index.js':`PB.scene('ready',ctx=>{
   ctx.OM.ready(Promise.reject(Error('READY_FIXTURE_FAILED')));const timeline=gsap.timeline({paused:true});timeline.to({}, {duration:15});return {timeline};});`}};
  let unexpected;
  try{await assert.rejects(async()=>{unexpected=await filmSession({raw:JSON.stringify(readyFilm),options:rejectedOptions,browserVersion:lock.browser.version,font,resource:()=>{throw Error('UNEXPECTED_RESOURCE');},killBrowser});},/READY_FIXTURE_FAILED/);}
  finally{await unexpected?.close();}
  const late=await open('landscape','ctx.OM.ready(Promise.resolve())');
  try{await assert.rejects(late.frame(36),/CUSTOM_READY_CLOSED/);}finally{await late.close().catch(()=>{});}
  report.sceneReady='nested_setup_waited_rejection_and_late_registration_blocked';report.musicBeat='frozen_bpm_and_explicit_override';
  const soundFilm=structuredClone(readyFilm);soundFilm.scenes[0].params.sourceSfx=true;soundFilm.audio.music.bpm=124;
  const soundOptions={...readyOptions,customSources:{'scenes/ready/index.js':`PB.scene('ready',ctx=>{
   const panel=document.createElement('div');Object.assign(panel.style,{position:'absolute',left:'10%',top:'30%',width:'20%',height:'30%',background:'rgb(255,0,0)'});ctx.root.append(panel);
   const timeline=gsap.timeline({paused:true});timeline.to(panel,{x:300,duration:1},ctx.OM.sfx('whoosh',ctx.OM.beat(1),{gain:.5}));timeline.to({}, {duration:15},0);return {timeline};});`}};
  const sound=await filmSession({raw:JSON.stringify(soundFilm),options:soundOptions,browserVersion:lock.browser.version,font,resource:()=>{throw Error('UNEXPECTED_RESOURCE');},killBrowser});
  try{
   const before=await sound.frame(15,{format:'png'}),after=await sound.frame(30,{format:'png'});
   assert.ok(compareSeam(before,after).diffPixelPct>2,'registered sound time drives a visible timeline movement');
   assert.equal(sound.plan.customSfx.ready[0].frame,14);assert.equal(sound.plan.customSfx.ready[0].sample,23226);assert.equal(sound.plan.customSfx.ready[0].seconds,60/124);assert.equal(sound.plan.customSfx.ready[0].gain,.5);
  }finally{await sound.close();}
  for(const [declaration,expected] of [
   ["if(false)ctx.OM.sfx('whoosh',.5);",/CUSTOM_SFX_NOT_EXECUTED/],
   ["const fn=ctx.OM.sfx;fn('whoosh',.5);",/CUSTOM_SFX_UNDECLARED/]
  ]){
   const opts={...soundOptions,customSources:{'scenes/ready/index.js':`PB.scene('ready',ctx=>{${declaration}const timeline=gsap.timeline({paused:true});timeline.to({}, {duration:15});return {timeline};});`}};
   let unexpectedSound;
   try{await assert.rejects(async()=>{unexpectedSound=await filmSession({raw:JSON.stringify(soundFilm),options:opts,browserVersion:lock.browser.version,font,resource:()=>{throw Error('UNEXPECTED_RESOURCE');},killBrowser});},expected);}
   finally{await unexpectedSound?.close();}
  }
  report.sourceSfx='timeline_anchor_and_unexecuted_or_dynamic_rejected';
  // The original OM3 film draws after later timeline tweens. Exercise the same
  // ordering with synthetic Canvas pixels, without granting custom WebGL access.
  const clockFilm=structuredClone(readyFilm);clockFilm.audio={music:{kind:'none'},sfx:[],captions:'off',mute:true};
  const clockOptions={...readyOptions,customSources:{'scenes/ready/index.js':`PB.scene('ready',ctx=>{
   const canvas=document.createElement('canvas');canvas.width=400;canvas.height=100;
   Object.assign(canvas.style,{position:'absolute',left:'0',top:'0',width:'400px',height:'100px'});ctx.root.append(canvas);
   const g=canvas.getContext('2d'),state={x:0},tl=gsap.timeline({paused:true});
   ctx.OM.clockAfter(tl,t=>{g.clearRect(0,0,400,100);g.fillStyle='rgb(255,0,0)';g.fillRect(Math.round(state.x),0,20,20);},15);
   tl.to(state,{x:100,duration:1,ease:'none'},0);return {timeline:tl};});`}};
  const clock=await filmSession({raw:JSON.stringify(clockFilm),options:clockOptions,browserVersion:lock.browser.version,font,resource:()=>{throw Error('UNEXPECTED_RESOURCE');},killBrowser});
  try{
   const red=(p,x)=>{const at=(10*p.width+x)*4;return [...p.pixels.subarray(at,at+3)];};
   const first=await clock.frame(15,{format:'png'}),half=pngPixels(first);assert.deepEqual(red(half,55),[255,0,0]);assert.notDeepEqual(red(half,5),[255,0,0]);
   const end=pngPixels(await clock.frame(30,{format:'png'}));assert.deepEqual(red(end,105),[255,0,0]);
   const reverse=await clock.frame(15,{format:'png'});assert.notEqual(compareSeam(first,reverse).verdict,'RENDER_SEAM_BLOCK');
  }finally{await clock.close();}
  const failingOptions={...clockOptions,customSources:{'scenes/ready/index.js':`PB.scene('ready',ctx=>{
   const tl=gsap.timeline({paused:true});ctx.OM.clockAfter(tl,t=>{throw Error('CLOCK_DRAW_FAILED');},15);return {timeline:tl};});`}};
  const failing=await filmSession({raw:JSON.stringify(clockFilm),options:failingOptions,browserVersion:lock.browser.version,font,resource:()=>{throw Error('UNEXPECTED_RESOURCE');},killBrowser});
  try{await assert.rejects(failing.frame(15),/CLOCK_DRAW_FAILED/);}finally{await failing.close().catch(()=>{});}
  report.afterSeekClock='all_tweens_before_canvas_draw_reverse_seek_and_failure';
  // Original OM3 studio primitives with an engineering-only, cleared synthetic image.
  // Check actual WebGL pixels in both layouts and repeat a backwards seek.
  const studioFilm=filmFixture();studioFilm.scenes=[{id:'studio',kind:'block',block:'object-studio@1',start:0,end:450,params:{assetKey:'dashboard',textSlot:'product'},purpose:'Render the original studio around a cleared synthetic screen.'}];
  const rgba=new Uint8Array(64*64*4);for(let i=0;i<rgba.length;i+=4){rgba[i]=10;rgba[i+1]=220;rgba[i+2]=20;rgba[i+3]=255;}
  const image=pngRgba(64,64,rgba);
  for(const aspect of ['landscape','portrait']){
   const studioOptions=pageOptions(aspect,rules.aspectLayouts[aspect]);studioOptions.fonts=multiOptions.fonts;studioOptions.resources[0].width=64;studioOptions.resources[0].height=64;
   studioOptions.initTimeoutMs=60000;studioOptions.frameTimeoutMs=10000;
   const session=await filmSession({raw:JSON.stringify(studioFilm),options:studioOptions,browserVersion:lock.browser.version,expectedWebglRenderer:lock.webgl.renderer,font,resource:()=>image,killBrowser});
   try{
    const first=await session.frame(15,{format:'png'}),later=await session.frame(90,{format:'png'}),reverse=await session.frame(15,{format:'png'});
    const pixels=pngPixels(later);let green=0;for(let i=0;i<pixels.pixels.length;i+=4)if(pixels.pixels[i]<60&&pixels.pixels[i+1]>150&&pixels.pixels[i+2]<60)green++;
    assert.ok(green>pixels.width*pixels.height*.02,`${aspect} real screen texture visible: ${green}`);
    assert.ok(compareSeam(first,later).diffPixelPct>.1,`${aspect} studio camera moves`);
    const check=await session.observe('studio-test',15);assert.ok(check.texts.some(text=>text.slotId==='product'&&!text.clipped));assert.ok(!check.findings.some(finding=>finding.severity==='BLOCK'),JSON.stringify(check.findings));
    assert.notEqual(compareSeam(first,reverse).verdict,'RENDER_SEAM_BLOCK',`${aspect} backwards seek`);
    writeFileSync(`${output}/object-studio-${aspect}-15.png`,first);writeFileSync(`${output}/object-studio-${aspect}-90.png`,later);
   }finally{await session.close();}
  }
  report.originalStudio='landscape_portrait_real_texture_camera_and_reverse_seek';
  // Custom scene receives a bounded stage handle, never raw Three.js. The asset
  // handle is deliberately poisoned after setup: the stage must retain trusted bytes.
  const customStudioFilm=filmFixture();customStudioFilm.scenes=[{id:'custom-studio',kind:'custom',runtime3D:'om3-studio-v1',module:'scenes/custom-studio/index.js',start:0,end:450,
   params:{textSlots:[],assetKeys:['dashboard'],events:[],readingHolds:[{start:30,end:450,visibleTextSlots:[]}]},purpose:'Test bounded authored studio.',brief:'Move the camera around the admitted product image.'}];
  const customStudioSource=`PB.scene('custom-studio',ctx=>{
   const exposed=ctx.asset('dashboard');exposed.url='/r/res_forged';exposed.width=1;
   const studio=ctx.OM3.studio('dashboard'),view={yaw:-40},timeline=gsap.timeline({paused:true});
   timeline.to(view,{yaw:40,duration:2,ease:'none'},0);ctx.OM.clockAfter(timeline,t=>studio.render({yaw:view.yaw}),15);return {timeline};});`;
  for(const aspect of ['landscape','portrait']){
   const studioOptions=pageOptions(aspect,rules.aspectLayouts[aspect]);studioOptions.fonts=multiOptions.fonts;studioOptions.resources[0].width=64;studioOptions.resources[0].height=64;
   studioOptions.customSources={'scenes/custom-studio/index.js':customStudioSource};studioOptions.initTimeoutMs=60000;studioOptions.frameTimeoutMs=10000;
   const authored=await filmSession({raw:JSON.stringify(customStudioFilm),options:studioOptions,browserVersion:lock.browser.version,expectedWebglRenderer:lock.webgl.renderer,font,resource:()=>image,killBrowser});
   try{const first=await authored.frame(15,{format:'png'}),later=await authored.frame(60,{format:'png'}),reverse=await authored.frame(15,{format:'png'});
    const pixels=pngPixels(later);let green=0;for(let i=0;i<pixels.pixels.length;i+=4)if(pixels.pixels[i]<60&&pixels.pixels[i+1]>150&&pixels.pixels[i+2]<60)green++;
    assert.ok(green>pixels.width*pixels.height*.02,`${aspect} trusted texture survives poisoned author handle`);
    assert.ok(compareSeam(first,later).diffPixelPct>.1,`${aspect} authored camera moves`);
    assert.notEqual(compareSeam(first,reverse).verdict,'RENDER_SEAM_BLOCK',`${aspect} authored reverse seek`);
    writeFileSync(`${output}/custom-studio-${aspect}-15.png`,first);writeFileSync(`${output}/custom-studio-${aspect}-60.png`,later);
   }finally{await authored.close();}
  }
  // A previous 2D scene cannot poison the 3D scene's admitted asset or dimensions.
  const crossFilm=structuredClone(customStudioFilm),customScene=crossFilm.scenes[0];customScene.start=225;customScene.params.readingHolds=[{start:30,end:225,visibleTextSlots:[]}];
  crossFilm.scenes.unshift({id:'poison',kind:'custom',module:'scenes/poison/index.js',start:0,end:225,params:{textSlots:[],assetKeys:['dashboard'],events:[],readingHolds:[{start:0,end:225,visibleTextSlots:[]}]},purpose:'Check scene isolation.',brief:'Alter only an author-visible handle.'});
  const crossOptions=pageOptions('landscape',rules.aspectLayouts.landscape);crossOptions.fonts=multiOptions.fonts;crossOptions.resources[0].width=64;crossOptions.resources[0].height=64;crossOptions.initTimeoutMs=60000;crossOptions.frameTimeoutMs=10000;
  crossOptions.customSources={'scenes/poison/index.js':`PB.scene('poison',ctx=>{const a=ctx.asset('dashboard');a.url='/r/res_forged';a.width=1;const timeline=gsap.timeline({paused:true});timeline.to({},{duration:7.5});return {timeline};});`,
   'scenes/custom-studio/index.js':customStudioSource.replace('),15);return', '),7.5);return')};
  const cross=await filmSession({raw:JSON.stringify(crossFilm),options:crossOptions,browserVersion:lock.browser.version,expectedWebglRenderer:lock.webgl.renderer,font,resource:()=>image,killBrowser});
  try{const pixels=pngPixels(await cross.frame(285,{format:'png'}));let green=0;for(let i=0;i<pixels.pixels.length;i+=4)if(pixels.pixels[i]<60&&pixels.pixels[i+1]>150&&pixels.pixels[i+2]<60)green++;
   assert.ok(green>pixels.width*pixels.height*.02,'previous scene cannot replace the admitted 3D image');
  }finally{await cross.close();}
  for(const [draw,expected]of [['studio.render({yaw:90})',/STUDIO_VIEW_INVALID/],['again(\'dashboard\')',/CUSTOM_3D_STUDIO_CLOSED/]]){
   const studioOptions=pageOptions('landscape',rules.aspectLayouts.landscape);studioOptions.fonts=multiOptions.fonts;studioOptions.resources[0].width=64;studioOptions.resources[0].height=64;
   studioOptions.initTimeoutMs=60000;studioOptions.frameTimeoutMs=10000;studioOptions.customSources={'scenes/custom-studio/index.js':`PB.scene('custom-studio',ctx=>{
    const studio=ctx.OM3.studio('dashboard'),again=ctx.OM3.studio,timeline=gsap.timeline({paused:true});
    ctx.OM.clockAfter(timeline,t=>{${draw};},15);return {timeline};});`};
   const rejected=await filmSession({raw:JSON.stringify(customStudioFilm),options:studioOptions,browserVersion:lock.browser.version,expectedWebglRenderer:lock.webgl.renderer,font,resource:()=>image,killBrowser});
   try{await assert.rejects(rejected.frame(30),expected);}finally{await rejected.close();}
  }
  report.customStudio='bounded_camera_cleared_texture_poison_resistance_reverse_and_failure';
  // A computed/aliased getContext call must not expose a raw WebGL context,
  // including the private canvas of an otherwise authorized studio.
  for(const attack of [
   "const c=document.createElement('canvas');const get=c.getContext;get.call(c,'webgl2')",
   "const c=new OffscreenCanvas(8,8);const get=c.getContext;get.call(c,'webgl2')"
  ])await assert.rejects(open('landscape',attack,true),/RUNTIME_WEBGL_FORBIDDEN/);
  const rawOptions=pageOptions('landscape',rules.aspectLayouts.landscape);rawOptions.fonts=multiOptions.fonts;rawOptions.resources[0].width=64;rawOptions.resources[0].height=64;rawOptions.initTimeoutMs=60000;rawOptions.frameTimeoutMs=10000;
  rawOptions.customSources={'scenes/custom-studio/index.js':`PB.scene('custom-studio',ctx=>{const studio=ctx.OM3.studio('dashboard');
   const c=ctx.root.querySelector('canvas'),get=c.getContext;get.call(c,'webgl2');const timeline=gsap.timeline({paused:true});timeline.to({},{duration:15});return {timeline};});`};
  let rawSession;try{await assert.rejects(async()=>{rawSession=await filmSession({raw:JSON.stringify(customStudioFilm),options:rawOptions,browserVersion:lock.browser.version,expectedWebglRenderer:lock.webgl.renderer,font,resource:()=>image,killBrowser});},/RUNTIME_WEBGL_FORBIDDEN/);}finally{await rawSession?.close();}
  const legacyFilm=filmFixture();legacyFilm.scenes=[{id:'legacy-device',kind:'block',block:'device-3d@1',start:0,end:450,params:{assetKey:'dashboard'},purpose:'Check the existing trusted 3D entry point.'}];
  const legacyOptions=pageOptions('landscape',rules.aspectLayouts.landscape);legacyOptions.fonts=multiOptions.fonts;legacyOptions.resources[0].width=64;legacyOptions.resources[0].height=64;legacyOptions.initTimeoutMs=60000;legacyOptions.frameTimeoutMs=10000;
  const legacyStudio=await filmSession({raw:JSON.stringify(legacyFilm),options:legacyOptions,browserVersion:lock.browser.version,expectedWebglRenderer:lock.webgl.renderer,font,resource:()=>image,killBrowser});
  try{const frame=pngPixels(await legacyStudio.frame(30,{format:'png'}));let green=0;for(let i=0;i<frame.pixels.length;i+=4)if(frame.pixels[i]<60&&frame.pixels[i+1]>150&&frame.pixels[i+2]<60)green++;assert.ok(green>frame.width*frame.height*.02,'existing device-3d still renders its cleared screen');}
  finally{await legacyStudio.close();}
  report.webglGuard='aliased_onscreen_offscreen_and_studio_context_blocked_legacy_device_retained';
 }else if(mode==='custom-init-loop'){
  const started=performance.now();await assert.rejects(open('landscape','for(;;){}',true),/INIT_TIMEOUT|Timeout|Target.*closed/i);
  report.fault={bounded:true,elapsedMs:Math.round(performance.now()-started),hostDeadlineMs:2000,reason:'INIT_TIMEOUT'};assert.ok(report.fault.elapsedMs<6000);
 }else if(!['custom','custom-guards'].includes(mode)){
  const attack=mode==='custom-loop'?'for(;;){}':'const retained=[];for(;;){retained.push(new Uint8Array(64*1024*1024));}';
  const session=await open('landscape',attack),started=performance.now();
  let failure;
  try{await assert.rejects(session.frame(36),error=>{failure=error.message;return /FRAME_TIMEOUT|RENDER_PAGE_CRASHED|Target.*closed|disconnected/i.test(failure)||(mode==='custom-memory'&&/Array buffer allocation failed|out of memory/i.test(failure));});}
  finally{await session.close().catch(()=>{});}
  report.fault={bounded:true,elapsedMs:Math.round(performance.now()-started),hostDeadlineMs:3000,reason:failure.split('\n')[0]};
  assert.ok(report.fault.elapsedMs<6000,'Fault cleanup exceeded its host bound');
 }else{
  const trusted=await open('landscape',null,false,true);
  try{writeFileSync(`${output}/trusted-block.png`,await trusted.frame(36,{format:'png'}));const qa=await trusted.observe('trusted-block-compatibility',36);assert.equal(qa.findings.filter(item=>item.severity==='BLOCK').length,0,JSON.stringify(qa));assert.equal(qa.texts.length,2);report.trustedBlockCompatibility={passed:true,frame:36};}finally{await trusted.close();}
  const frames=[0,18,36,80,126,180,270,330,449];
  for(const aspect of mode==='custom-guards'?['landscape']:Object.keys(rules.aspectLayouts)){
   const session=await open(aspect),baseline=new Map(),comparisons=[];
   try{
    for(const frame of frames){const png=await session.frame(frame,{format:'png'});baseline.set(frame,png);writeFileSync(`${output}/custom-${aspect}-${frame}.png`,png);
     if([80,180,330].includes(frame)){const qa=await session.observe('custom-fixture',frame);assert.equal(qa.findings.filter(item=>item.severity==='BLOCK').length,0,JSON.stringify(qa));assert.equal(qa.texts.length,1);}}
    for(const frame of [...frames].reverse()){const png=await session.frame(frame,{format:'png'}),result=compareSeam(baseline.get(frame),png);if(result.verdict==='RENDER_SEAM_BLOCK'){writeFileSync(`${output}/failure-${aspect}-${frame}.png`,png);report.failure={aspect,frame,...result};}assert.notEqual(result.verdict,'RENDER_SEAM_BLOCK',JSON.stringify({aspect,frame,...result}));comparisons.push({frame,mode:'reverse',...result});}
   }finally{await session.close();}
   for(const frame of frames){const cold=await open(aspect);try{const result=compareSeam(baseline.get(frame),await cold.frame(frame,{format:'png'}));assert.notEqual(result.verdict,'RENDER_SEAM_BLOCK');comparisons.push({frame,mode:'cold',...result});}finally{await cold.close();}}
   report.aspects.push({aspect,comparisons,separateUidSandbox:true});
  }
  // Intentionally obfuscated direct accesses pass Q0, proving runtime enforcement is independent.
  const prefix="const d=ctx.root['owner'+'Document'],v=d['default'+'View'];";
  for(const [name,attack,expected]of [
   ['network',"v['f'+'etch']('https://example.com')",/RUNTIME_NETWORK_FORBIDDEN/],
   ['storage',"v['local'+'Storage'].getItem('x')",/RUNTIME_STORAGE_FORBIDDEN/],
   ['iframe',"d['create'+'Element']('iframe')",/RUNTIME_IFRAME_FORBIDDEN/],
   ['timer',"v['set'+'Timeout'](()=>{},1)",/RUNTIME_TIMER_FORBIDDEN/],
   ['dynamic-code',"v['Fun'+'ction']('return 1')()",/RUNTIME_EVAL_FORBIDDEN/],
   ['eval',"v['e'+'val']('1+1')",/RUNTIME_EVAL_FORBIDDEN/],
   ['async-constructor',"const fn=async()=>{};fn['con'+'structor']('return 1')()",/RUNTIME_EVAL_FORBIDDEN/],
   ['generator-constructor',"const fn=function*(){};fn['con'+'structor']('yield 1')()",/RUNTIME_EVAL_FORBIDDEN/],
   ['async-generator-constructor',"const fn=async function*(){};fn['con'+'structor']('yield 1')()",/RUNTIME_EVAL_FORBIDDEN/]
  ]){
   const session=await open('landscape',prefix+attack+';');try{await assert.rejects(session.frame(36),expected);report.attacks.push({name,blocked:true});}finally{await session.close().catch(()=>{});}
  }
 }
 report.passed=true;
}finally{writeFileSync(output+'/'+file,JSON.stringify(report,null,2)+'\n');}
