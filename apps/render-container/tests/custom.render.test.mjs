// Actual author-code execution, only inside the existing separate-uid offline browser container.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {filmSession} from '../src/browser.mjs';
import {compareSeam} from '@promobento/contracts/seams';
import {filmFixture,pageOptions} from '../../../packages/film-runtime/test/fixture.mjs';
import {customFixture} from '../../../packages/film-runtime/test/custom-fixture.mjs';
if(process.platform!=='linux'||process.getuid()!==10001||process.env.PROMOBENTO_BROWSER_TEST_CONTAINER!=='1')throw Error('BROWSER_TEST_REQUIRES_ISOLATED_CI_CONTAINER');
const rules=JSON.parse(readFileSync('config/platform-presets.json')),lock=JSON.parse(readFileSync('apps/render-container/environment.lock.json')),catalog=JSON.parse(readFileSync('/opt/fonts/catalog.json'));
const output='/work/film-runtime';mkdirSync(output,{recursive:true});
const mode=process.env.PROMOBENTO_RUNTIME_CASE??'custom',report={scope:'sandboxed_custom_DOM_SVG_Canvas_GSAP_not_cloud_or_owner_quality',mode,aspects:[],attacks:[],passed:false};
const file=mode==='custom'?'report.json':mode==='custom-guards'?'guards.json':mode==='custom-loop'?'fault-loop.json':mode==='custom-init-loop'?'fault-init-loop.json':'fault-memory.json';
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
 if(mode==='custom-init-loop'){
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
