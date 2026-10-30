// Actual author-code execution, only inside the existing separate-uid offline browser container.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {filmSession} from '../src/browser.mjs';
import {compareSeam,pngRgba} from '@promobento/contracts/seams';
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
