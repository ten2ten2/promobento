// Actual author-code execution, only inside the existing separate-uid offline browser container.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {execFileSync} from 'node:child_process';
import {canonical} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {admitPackedVideos} from '../src/video-input.mjs';
import {filmSession} from '../src/browser.mjs';
import {renderShard} from '../src/shard.mjs';
import {captureApprovedLocalVideo,verifyVideoSelections} from '../../../research/evals/approved-video.mjs';
import {captureApprovedArtwork,captureApprovedInlineArtwork,verifyArtworkSelections} from '../../../research/evals/approved-artwork.mjs';
import {prepareMaterialSelection} from '../../../research/evals/prepare-material-selection.mjs';
import {observeProduct} from '../../../research/evals/product-observation.mjs';
import {assertCanvasTextFrameDigests} from '@promobento/contracts/canvas-text';
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
  // The DOM still spells the approved slot when a nested span is transparent.
  // Actual CDP must reject that frame rather than relying on the parent's box.
  const hiddenTextSource=source.replace("ctx.text('product').mount(heading);",
   "const slot=ctx.text('product').mount(heading),piece=document.createElement('span');slot.append(piece);piece.append(slot.firstChild);piece.style.opacity='0';");
  const hiddenTextOptions={...options,customSources:{'scenes/product/index.js':hiddenTextSource}};
  const hiddenText=await filmSession({raw:JSON.stringify(film),options:hiddenTextOptions,browserVersion:lock.browser.version,font,resource:()=>original,killBrowser});
  try{await hiddenText.frame(90,{format:'png'});const observation=await hiddenText.observe('nested-text-check',90);
   assert.ok(observation.texts.some(text=>text.slotId==='product'&&text.clipped));
   assert.ok(observation.findings.some(finding=>finding.code==='text-clipped'&&finding.severity==='BLOCK'));
  }finally{await hiddenText.close();}report.nestedText='transparent_bound_glyphs_blocked_by_actual_cdp';
  for(const [attack,expected]of [
   ["heading.firstChild.firstChild.nodeValue='Unconfirmed claim';",/CUSTOM_TEXT_MISMATCH/],
   ["heading.append('Unbound claim');",/CUSTOM_TEXT_UNBOUND/],
   ["const x=document.createElement('div');x['text'+'Content']='Escaped claim';ctx.root.parentNode.append(x);",/CUSTOM_TEXT_UNBOUND/],
   ["const x=document.createElement('div');x['text'+'Content']='Escaped claim';ctx.root.parentNode.parentNode.append(x);",/CUSTOM_TEXT_UNBOUND/],
   ["const x=document.createElement('div');x['text'+'Content']='Escaped claim';ctx.root.parentNode.lastElementChild.append(x);",/CUSTOM_TEXT_UNBOUND/]
  ]){
   const attackSource=source.replace("wrap.style.opacity=t<2?'0':'1';",`if(t>0){${attack}}wrap.style.opacity=t<2?'0':'1';`);
   const attackOptions={...options,customSources:{'scenes/product/index.js':attackSource}};
   const attackSession=await filmSession({raw:JSON.stringify(film),options:attackOptions,browserVersion:lock.browser.version,font,resource:()=>original,killBrowser});
   try{await assert.rejects(attackSession.frame(45,{format:'png'}),expected);}finally{await attackSession.close().catch(()=>{});}
  }
  const crossTextSource=source.replace("wrap.style.opacity=t<2?'0':'1';",
   "if(t>0){ctx.root.parentNode.lastElementChild.querySelector('span').firstChild.nodeValue='Cross-scene claim';}wrap.style.opacity=t<2?'0':'1';");
  const crossText=await filmSession({raw:JSON.stringify(film),options:{...options,customSources:{'scenes/product/index.js':crossTextSource}},browserVersion:lock.browser.version,font,resource:()=>original,killBrowser});
  try{await assert.rejects(crossText.frame(236,{format:'png'}),/CUSTOM_TEXT_MISMATCH/);}finally{await crossText.close().catch(()=>{});}
  report.everyFrameText='changed_unbound_escaped_and_cross_scene_dom_text_blocked_before_capture';
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
  // The original clip cue resolver is exposed inside the sandbox, not evaluated by the Worker.
  const cueFixture=customFixture(),cueOptions=pageOptions('landscape',rules.aspectLayouts.landscape);
  cueOptions.fonts=options.fonts;cueOptions.customSources=cueFixture.sources;
  cueOptions.customSources['scenes/product/index.js']=cueOptions.customSources['scenes/product/index.js'].replace('const w=',`const cue=ctx.CLIP.cues.prepare({duration:15,cues:[{at:1,kind:'point',word:'缓存'}]}, {words:[{word:'缓',start:.4,end:.7},{word:'存',start:.7,end:1}]});if(cue.spec.cues[0].at!==.4)throw Error('CLIP_CUE_BINDING_FAILED');const w=`);
  const cueSession=await filmSession({raw:JSON.stringify(cueFixture.film),options:cueOptions,browserVersion:lock.browser.version,font,resource:()=>{throw Error('UNEXPECTED_RESOURCE');},killBrowser});
  try{await cueSession.frame(45,{format:'png'});}finally{await cueSession.close();}report.clipCues='original_narration_anchor_inside_sandbox';

  // Packed video crosses the same broker-facing admission as the controller and is
  // decoded by the real isolated Chromium runtime in forward and reverse order.
  const solidPng=(red,green,blue)=>{const pixels=new Uint8Array(64*64*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=red;pixels[i+1]=green;pixels[i+2]=blue;pixels[i+3]=255;}return pngRgba(64,64,pixels);};
  const greenPng=solidPng(10,220,20),bluePng=solidPng(10,30,220),webpFromPng=png=>execFileSync('ffmpeg',['-v','error','-i','pipe:0','-c:v','libwebp','-lossless','1','-f','webp','pipe:1'],{input:png});
  const voxFilm=filmFixture();voxFilm.assets.dashboard.roi=[{x:.2,y:.2,width:.4,height:.4}];
  voxFilm.scenes=[{id:'vox',kind:'block',block:'vox-clip@1',start:0,end:450,params:{intervalFrames:120,items:[{assetKey:'dashboard',focus:'roi:0'},{assetKey:'dashboard'}]},purpose:'Mark an observed source region without cropping the page.'}];
  for(const aspect of ['landscape','portrait']){
   const voxOptions=pageOptions(aspect,rules.aspectLayouts[aspect]);voxOptions.fonts=options.fonts;voxOptions.resources[0].width=64;voxOptions.resources[0].height=64;
   const focused=await filmSession({raw:JSON.stringify(voxFilm),options:voxOptions,browserVersion:lock.browser.version,font,resource:()=>greenPng,killBrowser});
   let marked;try{marked=await focused.frame(84,{format:'png'});await focused.frame(150,{format:'png'});const reverse=await focused.frame(84,{format:'png'});
    assert.notEqual(compareSeam(marked,reverse).verdict,'RENDER_SEAM_BLOCK');writeFileSync(`${output}/vox-focus-${aspect}.png`,marked);
   }finally{await focused.close();}
   const plainFilm=structuredClone(voxFilm);delete plainFilm.scenes[0].params.items[0].focus;
   const plain=await filmSession({raw:JSON.stringify(plainFilm),options:voxOptions,browserVersion:lock.browser.version,font,resource:()=>greenPng,killBrowser});
   try{const unmarked=await plain.frame(84,{format:'png'});assert.ok(compareSeam(marked,unmarked).diffPixelPct>.01,'original highlight produces visible pixels');
    writeFileSync(`${output}/vox-plain-${aspect}.png`,unmarked);
   }finally{await plain.close();}
  }
  report.voxHighlight='observed_source_roi_context_preserved_landscape_portrait_reverse';
  const greenWebp=webpFromPng(greenPng),blueWebp=webpFromPng(bluePng),parts=[],frames=[];let offset=0;
  for(let i=0;i<60;i++){const frame=i<30?greenWebp:blueWebp;frames.push({index:i,pts:i/30,duration:1/30,pack:0,offset,byteLength:frame.length});parts.push(frame);offset+=frame.length;}
  const pack=Buffer.concat(parts),ref=bytes=>({sha256:sha256Bytes(bytes),byteLength:bytes.length});
  const packedManifest={schemaVersion:'3.0.0',kind:'video_frame_manifest',source:{...ref(Buffer.from('synthetic-video')),mediaType:'video/webm'},browserVersion:lock.browser.version,width:64,height:64,poster:ref(greenPng),packs:[ref(pack)],frames};
  const manifest=Buffer.from(canonical(packedManifest)),id='res_fixture_dashboard',data=new Map([['resource:'+id,manifest],['poster:'+id,greenPng],['framepack:'+id+':0',pack]]);
  const objects=new Map([...data].map(([name,bytes])=>[name,{name,...ref(bytes)}]));
  const packedFilm=filmFixture();packedFilm.scenes=[{id:'focus',start:0,end:450,kind:'block',block:'continuous-focus@1',params:{assetKey:'dashboard'},purpose:'Check source video frames in the real renderer.'}];
  for(const aspect of ['landscape','portrait']){
   const packedOptions=pageOptions(aspect,rules.aspectLayouts[aspect]);packedOptions.fonts=options.fonts;packedOptions.resources=[{...packedOptions.resources[0],kind:'video',width:64,height:64,videoFramePacking:'webp-pack-v1',videoFrames:frames.map(({index,pts,duration})=>({index,pts,duration}))}];
   const readers=await admitPackedVideos({job:{resources:[{resourceId:id,kind:'video',sha256:sha256Bytes(manifest)}]},options:packedOptions},objects,async name=>data.get(name));
   const packedSession=await filmSession({raw:JSON.stringify(packedFilm),options:packedOptions,browserVersion:lock.browser.version,font,resource:()=>readers.get(id).poster(),videoFrame:(_,index)=>readers.get(id).frame(index),killBrowser});
   try{const first=await packedSession.frame(0,{format:'png'}),later=await packedSession.frame(45,{format:'png'}),reverse=await packedSession.frame(0,{format:'png'});
    const a=pngPixels(first),b=pngPixels(later),at=((Math.floor(a.height/2)*a.width)+Math.floor(a.width/2))*4;
    assert.ok(a.pixels[at+1]>150&&a.pixels[at+2]<100,`${aspect} first source frame is green`);assert.ok(b.pixels[at+2]>150&&b.pixels[at+1]<100,`${aspect} later source frame is blue`);
    assert.notEqual(compareSeam(first,reverse).verdict,'RENDER_SEAM_BLOCK');writeFileSync(`${output}/packed-video-${aspect}-0.png`,first);writeFileSync(`${output}/packed-video-${aspect}-45.png`,later);
   }finally{await packedSession.close();}
  }
  report.packedVideo='source_bound_webp_frames_landscape_portrait_forward_and_reverse';

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
  const handoff=await open('landscape',"const d=ctx.root['owner'+'Document'],v=d['default'+'View'];if(typeof v['__pbTake'+'CanvasText']!=='undefined')throw Error('CANVAS_TEXT_CAPABILITY_LEAKED')");
  try{await handoff.frame(36,{format:'png'});}finally{await handoff.close();}
  const clipShapes=await open('landscape',"ctx.CLIP.TY.marker(drawing,20,20,100,30,.5,'#ffffff')");
  try{await clipShapes.frame(36,{format:'png'});report.clipShapes='available';}finally{await clipShapes.close();}
  const canvasFilm=filmFixture();canvasFilm.assets={};canvasFilm.texts={headline:{text:'HELLO',role:'headline',factIds:[]}};
  canvasFilm.scenes=[{id:'title',kind:'block',block:'canvas-title@1',start:0,end:450,params:{textSlot:'headline'},purpose:'Original bound Canvas title fixture.'}];
  for(const aspect of ['landscape','portrait']){
   const canvasOptions=pageOptions(aspect,rules.aspectLayouts[aspect]);canvasOptions.resources=[];canvasOptions.fonts=multiOptions.fonts;
   const canvasSession=await filmSession({raw:JSON.stringify(canvasFilm),options:canvasOptions,browserVersion:lock.browser.version,font,resource:()=>{throw Error('UNEXPECTED_RESOURCE');},killBrowser});
   try{const first=await canvasSession.frame(45,{format:'png'}),observation=await canvasSession.observe('canvas-title-check',45);
    assert.ok(observation.texts.some(text=>text.slotId==='headline'&&text.text==='HELLO'&&!text.clipped&&!text.fallbackUsed));
    assert.ok(!observation.findings.some(finding=>finding.severity==='BLOCK'),JSON.stringify(observation));
    await canvasSession.frame(90,{format:'png'});const reverse=await canvasSession.frame(45,{format:'png'});
    assert.equal(compareSeam(first,reverse).verdict,'pass');writeFileSync(`${output}/canvas-title-${aspect}.png`,first);
   }finally{await canvasSession.close();}
  }
  report.canvasTitle='bound_original_canvas_text_checked_against_actual_frame_landscape_portrait_reverse';
  // A wrapped title still consists only of the frozen text, including on the
  // first encoded frame and after a reverse seek; inspect both real line boxes.
  const wrappedFilm=structuredClone(canvasFilm);wrappedFilm.texts.headline.text='LEARN A LITTLE EVERY DAY';
  for(const aspect of ['landscape','portrait']){
   const options=pageOptions(aspect,rules.aspectLayouts[aspect]);options.resources=[];options.fonts=multiOptions.fonts;
   const session=await filmSession({raw:JSON.stringify(wrappedFilm),options,browserVersion:lock.browser.version,font,resource:()=>{throw Error('UNEXPECTED_RESOURCE');},killBrowser});
   try{
    await session.frame(0,{format:'png'});assert.equal(session.canvasTextTrace(0)[0].boxes.length,wrappedFilm.texts.headline.text.replace(/\s/g,'').length);
    const first=await session.frame(45,{format:'png'}),trace=session.canvasTextTrace(45)[0],observation=await session.observe('canvas-wrap-check',45);
    assert.ok(Math.max(...trace.boxes.map(box=>box.y))-Math.min(...trace.boxes.map(box=>box.y))>trace.fontSize*.7,'the original title occupies two lines');
    assert.ok(observation.texts.some(text=>text.slotId==='headline'&&text.text===wrappedFilm.texts.headline.text&&!text.clipped&&!text.fallbackUsed));
    assert.ok(!observation.findings.some(finding=>finding.severity==='BLOCK'),JSON.stringify(observation));
    await session.frame(90,{format:'png'});assert.equal(compareSeam(first,await session.frame(45,{format:'png'})).verdict,'pass');
    writeFileSync(`${output}/canvas-wrapped-${aspect}.png`,first);
   }finally{await session.close();}
  }
  report.canvasWrapped='two_lines_bound_from_first_frame_checked_against_actual_pixels_landscape_portrait';
  // Original y5's wipe changes pages; each captured frame and hold must bind
  // the actual active title, including cold and reverse seeks across the cut.
  const sequenceFilm=structuredClone(canvasFilm);
  sequenceFilm.texts={first:{text:'HELLO',role:'headline',factIds:['first']},second:{text:'WORLD',role:'headline',factIds:['second']}};
  sequenceFilm.scenes[0].block='canvas-sequence@1';sequenceFilm.scenes[0].params={items:[{textSlot:'first',startFrame:0},{textSlot:'second',startFrame:120}]};
  for(const aspect of ['landscape','portrait']){
   const options=pageOptions(aspect,rules.aspectLayouts[aspect]);options.resources=[];options.fonts=multiOptions.fonts;options.confirmedFactIds=['first','second'];
   const sequence=await filmSession({raw:JSON.stringify(sequenceFilm),options,browserVersion:lock.browser.version,font,resource:()=>{throw Error('UNEXPECTED_RESOURCE');},killBrowser});
   try{
    const first=await sequence.frame(45,{format:'png'});let observation=await sequence.observe('sequence-check',45);
    assert.ok(observation.texts.some(text=>text.slotId==='first'&&text.text==='HELLO'&&!text.clipped&&!text.fallbackUsed));
    assert.ok(!observation.findings.some(finding=>finding.severity==='BLOCK'),JSON.stringify(observation));
    for(const frame of [110,115,119,120,121,165]){const png=await sequence.frame(frame,{format:'png'});
     assert.equal(sequence.canvasTextTrace(frame)[0].slotId,frame<120?'first':'second');
     if(frame===115)writeFileSync(`${output}/canvas-sequence-${aspect}-wipe.png`,png);}
    observation=await sequence.observe('sequence-check',165);
    assert.ok(observation.texts.some(text=>text.slotId==='second'&&text.text==='WORLD'&&!text.clipped&&!text.fallbackUsed));
    assert.ok(!observation.findings.some(finding=>finding.severity==='BLOCK'),JSON.stringify(observation));
    writeFileSync(`${output}/canvas-sequence-${aspect}.png`,await sequence.capturePng(165));
    const reverse=await sequence.frame(45,{format:'png'});assert.equal(compareSeam(first,reverse).verdict,'pass');
   }finally{await sequence.close();}
  }
  report.canvasSequence='two_fact_bound_pages_actual_frames_and_reverse_landscape_portrait';

  // Exercise the unmodified y3 image-reveal grammar with a real bound DOM
  // headline; do not admit any Canvas-authored text or infer product actions.
  const boardFilm=filmFixture();boardFilm.texts={headline:{text:'HELLO',role:'headline',factIds:[]}};
  boardFilm.scenes=[{id:'board',start:0,end:450,kind:'block',block:'whiteboard-clip@1',params:{assetKey:'dashboard',textSlot:'headline'},purpose:'Original whiteboard image reveal.'}];
  for(const aspect of ['landscape','portrait','feed','square']){
   const options=pageOptions(aspect,rules.aspectLayouts[aspect]);options.fonts=multiOptions.fonts;options.resources[0].width=2;options.resources[0].height=2;
   const board=await filmSession({raw:JSON.stringify(boardFilm),options,browserVersion:lock.browser.version,font,resource:()=>original,killBrowser});
   try{const early=await board.frame(15,{format:'png'}),frame=await board.frame(105,{format:'png'}),pixels=pngPixels(frame);let green=0;
    writeFileSync(`${output}/whiteboard-clip-${aspect}-reveal.png`,early);writeFileSync(`${output}/whiteboard-clip-${aspect}.png`,frame);
    let minX=pixels.width,minY=pixels.height,maxX=0,maxY=0;
    for(let y=0;y<pixels.height;y++)for(let x=0;x<pixels.width;x++){const i=(y*pixels.width+x)*4;if(pixels.pixels[i]<100&&pixels.pixels[i+1]>120&&pixels.pixels[i+2]<100){green++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}}
    assert.ok(green>pixels.width*pixels.height*.05,'the real image is a visible, substantial subject');
    const safe=options.target.safeInsets;assert.ok(minX>=pixels.width*safe.left-2&&minY>=pixels.height*safe.top-2&&maxX<=pixels.width*(1-safe.right)+2&&maxY<=pixels.height*(1-safe.bottom)+2,'the real image stays within platform safe insets');
    const observation=await board.observe('whiteboard-check',105),headline=observation.texts.find(text=>text.slotId==='headline'&&text.text==='HELLO'&&!text.clipped&&!text.fallbackUsed);
    assert.ok(headline);assert.ok(!observation.findings.some(finding=>finding.severity==='BLOCK'),JSON.stringify(observation));
    const box=headline.box;let overlap=0;
    for(let y=Math.max(0,Math.floor(box.y));y<Math.min(pixels.height,Math.ceil(box.y+box.height));y++)for(let x=Math.max(0,Math.floor(box.x));x<Math.min(pixels.width,Math.ceil(box.x+box.width));x++){
     const i=(y*pixels.width+x)*4;if(pixels.pixels[i]<100&&pixels.pixels[i+1]>120&&pixels.pixels[i+2]<100)overlap++;
    }
    assert.equal(overlap,0,'the actual source image must not cover its headline');
    assert.notEqual(compareSeam(early,frame).verdict,'pass','original reveal must actually move');
    const reverse=await board.frame(15,{format:'png'});assert.equal(compareSeam(early,reverse).verdict,'pass');
   }finally{await board.close();}
  }
  report.whiteboardClip='original_y3_image_reveal_bound_dom_text_four_aspects_reverse';

  // Each original t2 screenshot card uses its own admitted image; an outgoing
  // exercise must actually disappear rather than follow the next screen.
  const keynoteFilm=filmFixture();keynoteFilm.assets.other={resourceId:'res_fixture_other'};
  keynoteFilm.scenes=[{id:'keynote',start:0,end:450,kind:'block',block:'keynote-clip@1',params:{items:[{assetKey:'dashboard'},{assetKey:'other'}],intervalFrames:120},purpose:'Two real screenshot states.'}];
  const magenta=solidPng(235,10,235),keynoteGreen=solidPng(10,220,10);
  for(const aspect of ['landscape','portrait']){
   const options=pageOptions(aspect,rules.aspectLayouts[aspect]);options.fonts=multiOptions.fonts;options.resources[0].width=64;options.resources[0].height=64;
   options.resources.push({...options.resources[0],resourceId:'res_fixture_other'});
   const keynote=await filmSession({raw:JSON.stringify(keynoteFilm),options,browserVersion:lock.browser.version,font,resource:id=>id==='res_fixture_other'?keynoteGreen:magenta,killBrowser});let settled;
   try{const cold=await keynote.frame(165,{format:'png'}),first=await keynote.frame(60,{format:'png'}),transition=await keynote.frame(126,{format:'png'}),second=await keynote.frame(165,{format:'png'});
    writeFileSync(`${output}/keynote-clip-${aspect}-cold.png`,cold);writeFileSync(`${output}/keynote-clip-${aspect}-first.png`,first);writeFileSync(`${output}/keynote-clip-${aspect}-handoff.png`,transition);writeFileSync(`${output}/keynote-clip-${aspect}-second.png`,second);
    const seekDifference=compareSeam(cold,second);
    assert.notEqual(seekDifference.verdict,'RENDER_SEAM_BLOCK',`${aspect} cold and sequential seeks must match within the established seam tolerance: ${JSON.stringify(seekDifference)}`);
    const count=png=>{const p=pngPixels(png);let magentaPixels=0,greenPixels=0;for(let i=0;i<p.pixels.length;i+=4){
     if(p.pixels[i]>180&&p.pixels[i+1]<80&&p.pixels[i+2]>180)magentaPixels++;
     if(p.pixels[i]<80&&p.pixels[i+1]>180&&p.pixels[i+2]<80)greenPixels++;
    }return{magentaPixels,greenPixels};};
    const a=count(first),b=count(second);assert.ok(a.magentaPixels>1000,`${aspect} first original state is visible`);
    assert.ok(b.greenPixels>1000,`${aspect} second original state is visible`);
    assert.equal(b.magentaPixels,0,`${aspect} the previous image is absent after handoff`);
    assert.ok(compareSeam(first,second).diffPixelPct>.1);const reverse=await keynote.frame(60,{format:'png'});
    assert.notEqual(compareSeam(first,reverse).verdict,'RENDER_SEAM_BLOCK');
    settled=second;
   }finally{await keynote.close();}
   const blue=solidPng(10,10,235),changed=await filmSession({raw:JSON.stringify(keynoteFilm),options,browserVersion:lock.browser.version,font,resource:id=>id==='res_fixture_other'?keynoteGreen:blue,killBrowser});
   try{await changed.frame(165,{format:'png'});await changed.frame(60,{format:'png'});await changed.frame(126,{format:'png'});const changedSecond=await changed.frame(165,{format:'png'});
    writeFileSync(`${output}/keynote-clip-${aspect}-changed.png`,changedSecond);
    const difference=compareSeam(settled,changedSecond);
    assert.notEqual(difference.verdict,'RENDER_SEAM_BLOCK',`${aspect} replacing the previous exercise must not change the settled next screen beyond the established seam tolerance: ${JSON.stringify(difference)}`);
   }finally{await changed.close();}
  }
  report.keynoteClip='two_separate_original_screens_handoff_reverse_landscape_portrait';
  // The highlight is tied to the first source's actual ROI. It must be visible
  // without dimming the rest of the image and disappear with that source.
  const focusFilm=structuredClone(keynoteFilm);focusFilm.scenes[0].params.items[0].focus='roi:0';
  for(const aspect of ['landscape','portrait']){
   const options=pageOptions(aspect,rules.aspectLayouts[aspect]);options.fonts=multiOptions.fonts;options.resources[0].width=64;options.resources[0].height=64;
   options.resources.push({...options.resources[0],resourceId:'res_fixture_other'});
   const capture=async film=>{const session=await filmSession({raw:JSON.stringify(film),options,browserVersion:lock.browser.version,font,resource:id=>id==='res_fixture_other'?keynoteGreen:magenta,killBrowser});
    try{return[await session.frame(84,{format:'png'}),await session.frame(165,{format:'png'})];}finally{await session.close();}};
   const plain=await capture(keynoteFilm),focused=await capture(focusFilm);
   assert.ok(compareSeam(plain[0],focused[0]).diffPixelPct>.01,`${aspect} original ROI highlight changes the first page`);
   const countMagenta=png=>{const p=pngPixels(png).pixels;let count=0;for(let i=0;i<p.length;i+=4)if(p[i]>180&&p[i+1]<80&&p[i+2]>180)count++;return count;};
   assert.ok(countMagenta(focused[0])>countMagenta(plain[0])*.85,`${aspect} the page around the ROI remains visible`);
   assert.notEqual(compareSeam(plain[1],focused[1]).verdict,'RENDER_SEAM_BLOCK',`${aspect} the old ROI does not follow the next page`);
   writeFileSync(`${output}/keynote-focus-${aspect}.png`,focused[0]);
  }
  report.keynoteFocus='observed_source_region_emphasis_retains_context_and_leaves_before_next_page';

  // A prior authored scene may edit its own handles, but cannot change which
  // admitted image, ROI or style a later trusted scene receives.
  const poisonFilm=filmFixture();poisonFilm.assets.other={resourceId:'res_fixture_other'};
  poisonFilm.scenes=[{id:'poison',start:0,end:120,kind:'custom',module:'scenes/poison/index.js',params:{textSlots:['headline'],assetKeys:['dashboard'],events:[],readingHolds:[{start:0,end:120,visibleTextSlots:[]}]},purpose:'Test scene-local handles.',brief:'Keep later scenes unchanged.'},
   {id:'keynote',start:120,end:360,kind:'block',block:'keynote-clip@1',params:{items:[{assetKey:'dashboard'},{assetKey:'other'}],intervalFrames:120},purpose:'Two source states.'},
   {id:'hook',start:360,end:450,kind:'block',block:'hook-title@1',params:{textSlot:'headline'},purpose:'Bound final title.'}];
  const poisonBase=`PB.scene('poison',ctx=>{const a=ctx.asset('dashboard');MUTATE
   const box=document.createElement('div');Object.assign(box.style,{position:'absolute',width:'100%',height:'50%',opacity:'0'});ctx.root.append(box);
   const label=ctx.text('headline').mount(box);ASSERT
   const timeline=gsap.timeline({paused:true});timeline.to({},{duration:4});return {timeline};});`;
  const poisonSource=poisonBase.replace('MUTATE',"a.url='/r/res_fixture_other';a.roi[0].x=0;ctx.style.palette.bg='#ff00ff';ctx.style.palette.ink='#112233';ctx.style.type.display.fontId='forged';ctx.CLIP.U.setStage(20,20);ctx.CLIP.UI.mesh=()=>{};ctx.CLIP.MO.springHz=()=>0;if(ctx.asset('dashboard').url!=='/r/res_fixture_other'||ctx.CLIP.MO.springHz()!==0)throw Error('SCENE_LOCAL_MUTATION_LOST');")
   .replace('ASSERT',"if(label.style.color!=='rgb(17, 34, 51)')throw Error('SCENE_LOCAL_STYLE_LOST');");
  const poisonOptions=pageOptions('landscape',rules.aspectLayouts.landscape);poisonOptions.fonts=multiOptions.fonts;poisonOptions.resources[0].width=64;poisonOptions.resources[0].height=64;
  poisonOptions.resources.push({...poisonOptions.resources[0],resourceId:'res_fixture_other'});
  const shot=async source=>{const session=await filmSession({raw:JSON.stringify(poisonFilm),options:{...poisonOptions,customSources:{'scenes/poison/index.js':source}},browserVersion:lock.browser.version,font,
    resource:id=>id==='res_fixture_other'?magenta:keynoteGreen,killBrowser});
   try{return[await session.frame(165,{format:'png'}),await session.frame(405,{format:'png'})];}finally{await session.close();}};
  const attacked=await shot(poisonSource),clean=await shot(poisonBase.replace('MUTATE','').replace('ASSERT',''));
  for(let i=0;i<attacked.length;i++)assert.notEqual(compareSeam(attacked[i],clean[i]).verdict,'RENDER_SEAM_BLOCK','a previous scene cannot change a later trusted image, style or helpers');
  report.sceneLocalHandles='same_scene_mutation_preserved_no_cross_scene_asset_style_or_helper_poison';

  const iconFilm=filmFixture();iconFilm.assets={};iconFilm.texts={one:{text:'ONE',role:'headline',factIds:[]},two:{text:'TWO',role:'headline',factIds:[]},three:{text:'THREE',role:'headline',factIds:[]}};
  const iconGroups=[['person','cat','network'],['bulb','cross','stack'],['gear','clock','chart']];
  iconFilm.scenes=iconGroups.map((group,index)=>({id:'icons-'+index,start:index*150,end:(index+1)*150,kind:'block',block:'drawn-steps@1',
   params:{items:group.map((icon,i)=>({icon,textSlot:['one','two','three'][i]}))},purpose:'Original hand-drawn icon fixture.'}));
  for(const aspect of ['landscape','portrait']){
   const options=pageOptions(aspect,rules.aspectLayouts[aspect]);options.resources=[];options.fonts=multiOptions.fonts;
   const icons=await filmSession({raw:JSON.stringify(iconFilm),options,browserVersion:lock.browser.version,font,resource:()=>{throw Error('UNEXPECTED_RESOURCE');},killBrowser});
   try{for(const [index,frame] of [90,240,390].entries()){
    const png=await icons.frame(frame,{format:'png'}),observation=await icons.observe('drawn-icon-check',frame);
    assert.ok(!observation.findings.some(finding=>finding.severity==='BLOCK'),JSON.stringify(observation));
    assert.ok(['one','two','three'].every(slot=>observation.texts.some(text=>text.slotId===slot&&!text.clipped)));
    writeFileSync(`${output}/drawn-icons-${aspect}-${index}.png`,png);
   }}finally{await icons.close();}
  }
  report.drawnIcons='nine_original_y3_motifs_actual_landscape_and_portrait';



  // Exercise the production encoder path, not just the in-browser trace: every
  // encoded frame must survive in the receipt-bound trace file.
  const shardOptions=pageOptions('landscape',rules.aspectLayouts.landscape);shardOptions.resources=[];shardOptions.fonts=multiOptions.fonts;
  const shardJob={renderId:'canvas-trace-check',aspectId:'landscape',quality:'final',totalFrames:450,
   renderProfile:{sampleCount:1,shutterAngle:0}},shard={index:0,start:30,end:60},shardDir=`${output}/canvas-trace-shard`;
  const receipt=await renderShard({job:shardJob,shard,raw:JSON.stringify(canvasFilm),options:shardOptions,font,
   resource:()=>{throw Error('UNEXPECTED_RESOURCE');},directory:shardDir,browserVersion:lock.browser.version,
   imageDigest:process.env.PROMOBENTO_TEST_IMAGE_DIGEST,encoding:rules.encodingProfiles.mp4_h264_1080_v1,threads:2,killBrowser});
  const traceBytes=readFileSync(`${shardDir}/frame-digests.json`),records=JSON.parse(traceBytes);
  assert.equal(sha256Bytes(traceBytes),receipt.outputs.frameDigests);assertCanvasTextFrameDigests(canvasFilm,shard,'final',records);
  const shardObservations=JSON.parse(readFileSync(`${shardDir}/observations.json`));
  assert.ok(shardObservations.some(item=>item.frame===45&&item.texts.some(text=>text.text==='HELLO')));
  assert.ok(shardObservations.every(item=>!item.findings.some(finding=>finding.severity==='BLOCK')));
  report.canvasTitleShard='receipt_bound_trace_for_every_encoded_frame_and_actual_reading_hold';

  const seqOptions=pageOptions('landscape',rules.aspectLayouts.landscape);seqOptions.resources=[];seqOptions.fonts=multiOptions.fonts;seqOptions.confirmedFactIds=['first','second'];
  const seqShard={index:0,start:105,end:135},seqDir=`${output}/canvas-sequence-shard`;
  const seqReceipt=await renderShard({job:shardJob,shard:seqShard,raw:JSON.stringify(sequenceFilm),options:seqOptions,font,
   resource:()=>{throw Error('UNEXPECTED_RESOURCE');},directory:seqDir,browserVersion:lock.browser.version,
   imageDigest:process.env.PROMOBENTO_TEST_IMAGE_DIGEST,encoding:rules.encodingProfiles.mp4_h264_1080_v1,threads:2,killBrowser});
  const seqBytes=readFileSync(`${seqDir}/frame-digests.json`),seqRecords=JSON.parse(seqBytes);
  assert.equal(sha256Bytes(seqBytes),seqReceipt.outputs.frameDigests);assertCanvasTextFrameDigests(sequenceFilm,seqShard,'final',seqRecords);
  assert.ok(seqRecords.every(record=>record.canvasText[0].slotId===(record.frame<120?'first':'second')));
  report.canvasSequenceShard='receipt_bound_traces_across_original_wipe';

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
  // v2 moves the real screen object independently from its fixed camera, while
  // v1 continues rejecting those additional view fields.
  const movingFilm=structuredClone(customStudioFilm);movingFilm.scenes[0].runtime3D='om3-studio-v2';
  const movingSource=customStudioSource.replace('studio.render({yaw:view.yaw})','studio.render({yaw:0,distanceScale:1.5,objectYaw:view.yaw,objectRoll:8,objectScale:1.1})');
  const movingOptions=pageOptions('landscape',rules.aspectLayouts.landscape);movingOptions.fonts=multiOptions.fonts;movingOptions.resources[0].width=64;movingOptions.resources[0].height=64;
  movingOptions.customSources={'scenes/custom-studio/index.js':movingSource};movingOptions.initTimeoutMs=60000;movingOptions.frameTimeoutMs=10000;
  const moving=await filmSession({raw:JSON.stringify(movingFilm),options:movingOptions,browserVersion:lock.browser.version,expectedWebglRenderer:lock.webgl.renderer,font,resource:()=>image,killBrowser});
  try{const first=await moving.frame(15,{format:'png'}),later=await moving.frame(60,{format:'png'}),reverse=await moving.frame(15,{format:'png'});
   assert.ok(compareSeam(first,later).diffPixelPct>.1,'screen object moves while camera stays fixed');
   for(const png of [first,later]){const frame=pngPixels(png);let minX=frame.width,minY=frame.height,maxX=0,maxY=0;
    for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++){const i=(y*frame.width+x)*4;
     if(frame.pixels[i]<60&&frame.pixels[i+1]>150&&frame.pixels[i+2]<60){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}}
    assert.ok(minX>0&&minY>0&&maxX<frame.width-1&&maxY<frame.height-1,'the synthetic product image stays inside the frame');
   }
   assert.notEqual(compareSeam(first,reverse).verdict,'RENDER_SEAM_BLOCK');writeFileSync(`${output}/object-motion-15.png`,first);writeFileSync(`${output}/object-motion-60.png`,later);
  }finally{await moving.close();}
  const v1Object=await filmSession({raw:JSON.stringify(customStudioFilm),options:movingOptions,browserVersion:lock.browser.version,expectedWebglRenderer:lock.webgl.renderer,font,resource:()=>image,killBrowser});
  try{await assert.rejects(v1Object.frame(15),/STUDIO_VIEW_INVALID/);}finally{await v1Object.close();}
  const invalidOptions={...movingOptions,customSources:{'scenes/custom-studio/index.js':movingSource.replace('objectYaw:view.yaw','objectYaw:181')}};
  const invalid=await filmSession({raw:JSON.stringify(movingFilm),options:invalidOptions,browserVersion:lock.browser.version,expectedWebglRenderer:lock.webgl.renderer,font,resource:()=>image,killBrowser});
  try{await assert.rejects(invalid.frame(15),/STUDIO_VIEW_INVALID/);}finally{await invalid.close();}
  report.studioObjectMotion='independent_rotation_scale_reverse_and_v1_compatibility';

  // v3 controls independently declared screens. A panel must disappear as soon
  // as its frame-local visibility says so, and reverse seeks restore it exactly.
  const panelsFilm=structuredClone(customStudioFilm);panelsFilm.scenes[0].runtime3D='om3-studio-v3';
  panelsFilm.assets.other={resourceId:'res_fixture_other'};panelsFilm.scenes[0].params.assetKeys=['dashboard','other'];
  const panelsSource=`PB.scene('custom-studio',ctx=>{
   const studio=ctx.OM3.studio('dashboard',['other']),view={x:2},timeline=gsap.timeline({paused:true});
   timeline.to(view,{x:-2,duration:2,ease:'none'},0);
   ctx.OM.clockAfter(timeline,t=>studio.render(t<3?{yaw:0,distanceScale:2,panels:[{x:view.x,z:1,scale:.55,visible:true}]}:{yaw:0,distanceScale:2}),15);return {timeline};});`;
  const other=solidPng(220,10,10);
  for(const aspect of ['landscape','portrait']){
   const options=pageOptions(aspect,rules.aspectLayouts[aspect]);options.fonts=multiOptions.fonts;options.resources[0].width=64;options.resources[0].height=64;
   options.resources.push({...options.resources[0],resourceId:'res_fixture_other'});options.customSources={'scenes/custom-studio/index.js':panelsSource};options.initTimeoutMs=60000;options.frameTimeoutMs=10000;
   const session=await filmSession({raw:JSON.stringify(panelsFilm),options,browserVersion:lock.browser.version,expectedWebglRenderer:lock.webgl.renderer,font,
    resource:id=>id==='res_fixture_other'?other:image,killBrowser});
   try{const first=await session.frame(15,{format:'png'}),later=await session.frame(60,{format:'png'}),hidden=await session.frame(120,{format:'png'});
    writeFileSync(`${output}/om3-panels-${aspect}-15.png`,first);writeFileSync(`${output}/om3-panels-${aspect}-60.png`,later);writeFileSync(`${output}/om3-panels-${aspect}-hidden.png`,hidden);
    const count=png=>{const p=pngPixels(png);let red=0,green=0;for(let i=0;i<p.pixels.length;i+=4){
     if(p.pixels[i]>150&&p.pixels[i+1]<60&&p.pixels[i+2]<60)red++;
     if(p.pixels[i]<60&&p.pixels[i+1]>150&&p.pixels[i+2]<60)green++;
    }return{red,green};};
    const visible=count(first),absent=count(hidden);assert.ok(visible.red>1000&&visible.green>1000,`${aspect} both separately cleared screen pixels are visible`);
    if(aspect==='portrait'){
     const frame=pngPixels(first),at=(Math.floor(frame.height*.9)*frame.width+Math.floor(frame.width*.5))*4;
     assert.ok(frame.pixels[at]>30&&frame.pixels[at+1]>30, 'the portrait studio floor extends to the bottom rather than ending in frame');
    }
    assert.equal(absent.red,0,`${aspect} hidden panel does not carry into the next state`);assert.ok(absent.green>1000);
    assert.ok(compareSeam(first,later).diffPixelPct>.05,'independent panel moves');
    const reverse=await session.frame(15,{format:'png'});assert.notEqual(compareSeam(first,reverse).verdict,'RENDER_SEAM_BLOCK');
   }finally{await session.close();}
  }
  const badPanels={...movingOptions,resources:[...movingOptions.resources,{...movingOptions.resources[0],resourceId:'res_fixture_other'}],
   customSources:{'scenes/custom-studio/index.js':panelsSource.replace('scale:.55','scale:2')}};
  const invalidPanels=await filmSession({raw:JSON.stringify(panelsFilm),options:badPanels,browserVersion:lock.browser.version,expectedWebglRenderer:lock.webgl.renderer,font,resource:id=>id==='res_fixture_other'?other:image,killBrowser});
  try{await assert.rejects(invalidPanels.frame(15),/STUDIO_VIEW_INVALID/);}finally{await invalidPanels.close();}
  const nullPanelsOptions={...badPanels,customSources:{'scenes/custom-studio/index.js':panelsSource.replace('panels:[{x:view.x,z:1,scale:.55,visible:true}]','panels:[null]')}};
  const nullPanels=await filmSession({raw:JSON.stringify(panelsFilm),options:nullPanelsOptions,browserVersion:lock.browser.version,expectedWebglRenderer:lock.webgl.renderer,font,resource:id=>id==='res_fixture_other'?other:image,killBrowser});
  try{await assert.rejects(nullPanels.frame(15),/STUDIO_VIEW_INVALID/);}finally{await nullPanels.close();}
  const oldPanelOptions={...movingOptions,customSources:{'scenes/custom-studio/index.js':movingSource.replace('objectYaw:view.yaw','panels:[],objectYaw:view.yaw')}};
  const oldPanel=await filmSession({raw:JSON.stringify(movingFilm),options:oldPanelOptions,browserVersion:lock.browser.version,expectedWebglRenderer:lock.webgl.renderer,font,resource:()=>image,killBrowser});
  try{await assert.rejects(oldPanel.frame(15),/STUDIO_VIEW_INVALID/);}finally{await oldPanel.close();}
  report.studioPanels='v3_independent_bound_screens_hide_and_reverse_landscape_portrait';

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
  // Exercise the real approval, decode, review and rebuild paths in the
  // separate-uid browser, using only original synthetic files.
  const previousCwd=process.cwd(),mediaTest=mkdtempSync(`${output}/media-test-`);process.chdir(mediaTest);
  try{
   mkdirSync('artifacts/source',{recursive:true});const sourceDir=`${mediaTest}/artifacts/source`;
   const movPath=`${sourceDir}/demo.mov`,animatedPath=`${sourceDir}/animated.gif`,avifPath=`${sourceDir}/still.avif`;
   execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=0x16c930:s=96x64:r=30:d=2','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',movPath]);
   execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc=size=32x32:rate=2:duration=1','-y',animatedPath]);
   execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=0x16c930:s=32x32','-frames:v','1','-c:v','libaom-av1','-still-picture','1','-y',avifPath]);
   const rgba=Uint8Array.from({length:4*4*4},(_,i)=>i%4===3?255:i%4===1?200:20),iconImage=Buffer.from(pngRgba(4,4,rgba));
   const icns=Buffer.alloc(16+iconImage.length);icns.write('icns');icns.writeUInt32BE(icns.length,4);icns.write('ic07',8);icns.writeUInt32BE(iconImage.length+8,12);iconImage.copy(icns,16);
   writeFileSync(`${sourceDir}/icon.icns`,icns);writeFileSync(`${sourceDir}/still.gif`,Buffer.from('R0lGODlhAQABAPAAAP8AAP///yH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==','base64'));
   const card={topicId:'fixture',status:'confirmed_for_s1_eval',confirmation:{confirmedBy:'owner',scope:'s1-first-internal-evaluation'},rights:{scope:'internal_eval_only',publicUseCleared:false},assetSources:[{kind:'local_project_media',url:'local://fixture'}],materialApprovals:{}};
   const makeEntry=(id,sourceFile)=>{const sourceUrl='local://fixture',bytes=readFileSync(`${sourceDir}/${sourceFile}`);
    card.materialApprovals[id]={status:'approved',approvedBy:'owner',scope:'internal_eval_only',storage:'staging_R2',publicUseCleared:false,approvedOn:'2026-10-31',basis:'Original synthetic fixture.',sourceFile,sourceUrl,sha256:sha256Bytes(bytes)};
    return{id,sourceFile,sourceUrl,description:'Original synthetic fixture.',approvalRef:`research/evals/fact-cards/fixture.json#/materialApprovals/${id}`};};
   const videoEntry=makeEntry('fixture-video','demo.mov'),artEntries=[makeEntry('fixture-icon','icon.icns'),makeEntry('fixture-gif','still.gif'),makeEntry('fixture-avif','still.avif')],animated=makeEntry('fixture-animation','animated.gif');
   const videoOut=`${mediaTest}/artifacts/video`,video=await captureApprovedLocalVideo({sourceDir,outputDir:videoOut,card,entries:[videoEntry]});
   const artOut=`${mediaTest}/artifacts/art`,art=await captureApprovedArtwork({sourceDir,outputDir:artOut,card,entries:artEntries});
   await assert.rejects(captureApprovedArtwork({sourceDir,outputDir:`${mediaTest}/artifacts/animated`,card,entries:[animated]}),/ARTWORK_ANIMATION_UNSUPPORTED/);
   for(const asset of [...video.assets,...art.assets]){asset.review='approved_for_internal_eval_by_codex';asset.reviewedAt='2026-10-31';}
   const cardPath=`${mediaTest}/artifacts/card.json`;writeFileSync(cardPath,canonical(card));const topics={factConfirmation:{confirmedBy:'owner'},topics:[{id:'fixture',factCard:cardPath}]};
   const verifiedVideo=(await verifyVideoSelections(videoOut,video,topics)).get('fixture-video');
   assert.equal(verifiedVideo.manifest.source.mediaType,'video/quicktime');assert.equal(verifiedVideo.manifest.source.sha256,sha256Bytes(readFileSync(movPath)));
   assert.equal(verifiedVideo.manifest.frames.length,60);const pixels=pngPixels(verifiedVideo.poster),at=(32*pixels.width+48)*4;
   assert.ok(pixels.pixels[at+1]>150&&pixels.pixels[at+2]<100,'QuickTime poster preserves the decoded source image');
   const verifiedArt=await verifyArtworkSelections(artOut,art,topics);assert.equal(verifiedArt.size,3);
   const decoded=pngPixels(readFileSync(`${artOut}/fixture-icon.png`));assert.deepEqual([decoded.width,decoded.height],[4,4]);assert.ok(decoded.pixels[1]>150&&decoded.pixels[0]<60);
   const pageUrl='https://example.com/product',svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" id="mark" width="10" height="10"><rect width="10" height="10" fill="#22aa44"/></svg>');
   const observationBrowser=await chromium.connectOverCDP('http://127.0.0.1:9222');let selector;
   try{const context=await observationBrowser.newContext();try{await context.route('**/*',route=>route.abort());const page=await context.newPage();
     await page.setContent(`<header class="brand">${svg}</header>`);selector=(await observeProduct(page)).logos.find(item=>item.kind==='inline-svg')?.selector;
     assert.ok(selector);assert.equal(await page.locator(selector).count(),1);
    }finally{await context.close();}}finally{await observationBrowser.close();}
   const html=Buffer.from(`<!doctype html><html><body><header class="brand">${svg}</header><script>document.querySelector('#mark').setAttribute('width','999')</script></body></html>`);
   const inlineCard={topicId:'fixture',status:'confirmed_for_s1_eval',confirmation:{confirmedBy:'owner',scope:'s1-first-internal-evaluation'},rights:{scope:'internal_eval_only',publicUseCleared:false},
    assetSources:[{kind:'official_product_page',url:pageUrl}],materialApprovals:{'fixture-inline':{status:'approved',approvedBy:'owner',scope:'internal_eval_only',storage:'staging_R2',publicUseCleared:false,
     approvedOn:'2026-10-31',basis:'Approved synthetic inline icon.',sourceUrl:pageUrl,selector,sha256:sha256Bytes(svg)}}};
   const inlineEntry={id:'fixture-inline',sourceUrl:pageUrl,selector,description:'Synthetic inline icon.',approvalRef:'research/evals/fact-cards/fixture.json#/materialApprovals/fixture-inline'};let downloads=0;
   const download=async(url,options)=>{downloads++;assert.equal(url,pageUrl);assert.equal(options.accept,'text/html');return html;};
   await assert.rejects(captureApprovedInlineArtwork({outputDir:`${mediaTest}/artifacts/inline-denied`,card:inlineCard,entries:[inlineEntry,{...inlineEntry,id:'unapproved',approvalRef:'research/evals/fact-cards/fixture.json#/materialApprovals/unapproved'}],download}),/MATERIAL_EXPLICIT_APPROVAL_REQUIRED/);
   assert.equal(downloads,0,'all rights are checked before the first page request');
   await assert.rejects(captureApprovedInlineArtwork({outputDir:`${mediaTest}/artifacts/inline-changed`,card:inlineCard,entries:[inlineEntry],download:async()=>Buffer.from(html.toString().replace('width="10"','width="11"'))}),/ARTWORK_APPROVAL_IDENTITY_MISMATCH/);
   const inlineOut=`${mediaTest}/artifacts/inline`,inline=await captureApprovedInlineArtwork({outputDir:inlineOut,card:inlineCard,entries:[inlineEntry],download});
   assert.equal(downloads,1);assert.deepEqual(readFileSync(`${inlineOut}/fixture-inline.source.svg`),svg);
   inline.assets[0].review='approved_for_internal_eval_by_codex';inline.assets[0].reviewedAt='2026-10-31';
   const inlineCardPath=`${mediaTest}/artifacts/inline-card.json`;writeFileSync(inlineCardPath,canonical(inlineCard));const inlineTopics={factConfirmation:{confirmedBy:'owner'},topics:[{id:'fixture',factCard:inlineCardPath}]};
   const verifiedInline=await verifyArtworkSelections(inlineOut,inline,inlineTopics);
   assert.equal(prepareMaterialSelection(inlineOut,inline,inlineTopics,{verifiedArtwork:verifiedInline})[0].asset.derivation.selector,selector);
   const tampered=structuredClone(inline);tampered.assets[0].derivation.selector='#other';
   assert.throws(()=>prepareMaterialSelection(inlineOut,tampered,inlineTopics,{verifiedArtwork:verifiedInline}),/ARTWORK_VERIFICATION_REQUIRED/);
  }finally{process.chdir(previousCwd);rmSync(mediaTest,{recursive:true,force:true});}
  report.quicktimeIntake='isolated_actual_mov_decode_source_identity_and_30fps_frame_pack';
  report.icnsIntake='isolated_actual_png_icon_payload_decode';
  report.staticArtworkIntake='isolated_gif_avif_and_animated_gif_rejected';
  report.inlineSvgIntake='approved_static_page_selector_exact_source_bytes_and_rebuild';
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
