// Local offline Chromium check for the internal clip port, not a production or
// customer QA claim. No model, downloaded material or unrestricted JS is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {compareSeam,pngPixels} from '@promobento/contracts/seams';

test('original Vox image choreography is seek-stable and Canvas text remains blocked',async()=>{
 const libs=['util','motion','camera','paint','kit','diagram','typo','chart','ui','collage','toon'];
 const contents=libs.map(name=>`import './packages/film-runtime/src/clip/${name}.js';`).join('\n')
  +`\nimport {createClipStage} from './packages/film-runtime/src/clip/stage.js';window.createClipStage=createClipStage;`;
 const bundle=await build({stdin:{contents,resolveDir:process.cwd(),sourcefile:'clip-stage-fixture.js'},bundle:true,write:false,format:'iife',platform:'browser',target:'chrome151'});
 const shim=await build({entryPoints:['packages/film-runtime/src/shim.ts'],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome151'});
 const browser=await chromium.launch({executablePath:process.env.PROMOBENTO_OBSERVATION_CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,chromiumSandbox:true});
 try{for(const [width,height]of [[640,360],[360,640]]){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
  try{const page=await context.newPage();await page.route('**/*',route=>route.abort());
   await page.setContent(`<style>html,body{margin:0}</style><canvas width="${width}" height="${height}"></canvas>`);
   const bootstrap=`U.setStage(${width},${height});const image=color=>{const c=document.createElement('canvas');c.width=160;c.height=100;const g=c.getContext('2d');g.fillStyle=color;g.fillRect(0,0,160,100);return c;};
    const images={a:image('#20cd42'),b:image('#3648e8')},spec={grammar:'y2_vox',duration:8,data:{},cues:[{at:0,kind:'image',image:'a'},{at:3,kind:'image',image:'b'}]};
    window.fixtureStage=createClipStage(spec,{width:${width},height:${height},images});window.paint=t=>fixtureStage.draw(document.querySelector('canvas').getContext('2d'),t);`;
   await page.addScriptTag({content:shim.outputFiles[0].text+'\n'+bundle.outputFiles[0].text+'\n'+bootstrap});
   const cdp=await context.newCDPSession(page),frame=async time=>{
    const value=await cdp.send('Runtime.evaluate',{expression:`window.paint(${time})`,returnByValue:true});
    if(value.exceptionDetails)throw Error(value.exceptionDetails.exception?.description??'CLIP_DRAW_FAILED');
    await cdp.send('Runtime.evaluate',{expression:'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',awaitPromise:true,returnByValue:true});
    // Mac Chrome's visible surface can be shorter than the emulated viewport;
    // capture the complete document for this local visual check. The separate
    // Linux-container test exercises the production from-surface capture path.
    const result=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:true,clip:{x:0,y:0,width,height,scale:1}});
    return Buffer.from(result.data,'base64');
   };
   const first=await frame(1),second=await frame(4),reverse=await frame(1),a=pngPixels(first),b=pngPixels(second);
   assert.deepEqual([a.width,a.height],[width,height]);const pixel=(Math.floor(height/2)*width+Math.floor(width/2))*4;
   const bottom=((height-10)*width+10)*4;assert.ok(a.pixels[bottom]+a.pixels[bottom+1]+a.pixels[bottom+2]<740,'paper background reaches the actual bottom edge');
   assert.ok(a.pixels[pixel+1]>a.pixels[pixel+2]*2,'first approved source is green');
   assert.ok(b.pixels[pixel+2]>b.pixels[pixel+1]*2,'second approved source is blue');
   assert.equal(compareSeam(first,reverse).verdict,'pass');
   const denied=await cdp.send('Runtime.evaluate',{expression:`(()=>{const s=createClipStage({grammar:'y5_kinetic_type',duration:8,data:{},cues:[{at:0,kind:'title',text:'fixture'}]},{width:${width},height:${height}});s.draw(document.querySelector('canvas').getContext('2d'),1);})()`,returnByValue:true});
   assert.match(denied.exceptionDetails?.exception?.description??'',/RUNTIME_TEXT_FORBIDDEN/);
  }finally{await context.close();}
 }}finally{await browser.close();}
});
