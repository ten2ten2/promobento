import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {generateFilmPage} from '../../../packages/film-runtime/dist/page.mjs';
import {parseCanonicalJson} from '../../../packages/contracts/index.mjs';
import {audioSamples} from './audio-samples.mjs';
import {mediaFixture} from './media-fixture.mjs';
import {filmFixture,pageOptions} from '../../../packages/film-runtime/test/fixture.mjs';
import {reviewPng} from '../src/review-pixels.mjs';

if(process.platform!=='linux'||process.getuid()!==10001||process.env.PROMOBENTO_BROWSER_TEST_CONTAINER!=='1')
  throw Error('BROWSER_TEST_REQUIRES_ISOLATED_CI_CONTAINER');
const root=new URL('../../../',import.meta.url),read=path=>readFileSync(new URL(path,root));
const rules=parseCanonicalJson(read('config/platform-presets.json'));
const lock=parseCanonicalJson(read('apps/render-container/environment.lock.json'));
const output='/work/film-runtime';mkdirSync(output,{recursive:true});
const journeyOnly=process.env.PROMOBENTO_JOURNEY_ONLY==='1',runtimeOnly=process.env.PROMOBENTO_RUNTIME_ONLY==='1'||journeyOnly;
const reviewOnly=process.env.PROMOBENTO_RUNTIME_CASE==='review';
const showcaseOnly=process.env.PROMOBENTO_RUNTIME_CASE==='showcase';
const layoutOnly=process.env.PROMOBENTO_RUNTIME_CASE==='layout';
const typographyOnly=process.env.PROMOBENTO_RUNTIME_CASE==='typography';
const openingOnly=process.env.PROMOBENTO_RUNTIME_CASE==='opening';
const relayOnly=process.env.PROMOBENTO_RUNTIME_CASE==='relay';
const journeyBeatsOnly=process.env.PROMOBENTO_RUNTIME_CASE==='journey-beats';
const focusedRuntime=journeyOnly||reviewOnly||showcaseOnly||typographyOnly||openingOnly||relayOnly||journeyBeatsOnly;
const report={status:'running',scope:journeyOnly?'trusted_css_3d_journey_seek_history_only':runtimeOnly?'trusted_2d_four_aspect_seek_layout_bridge_only':'trusted_block_runtime_not_G1_or_product_qa',browser:lock.browser.version,controllerUid:process.getuid(),aspects:{},checks:[]};
if(reviewOnly)report.scope='four_aspect_review_capture_only';
if(showcaseOnly)report.scope='four_aspect_showcase_seek_history_only';
if(layoutOnly)report.scope='four_aspect_ordinary_runtime_and_closing_layout_only';
if(typographyOnly)report.scope='four_aspect_grouped_opening_and_text_only_grid_layout';
if(openingOnly)report.scope='four_aspect_grouped_opening_motion_only';
if(relayOnly)report.scope='four_aspect_brand_relay_motion_and_beat_landings_only';
if(journeyBeatsOnly)report.scope='four_aspect_beat_journey_handoffs_and_reading_only';
const pages=new Map();
for(const [aspect,layout]of Object.entries(rules.aspectLayouts))pages.set('/'+aspect+'.html',generateFilmPage(JSON.stringify(filmFixture()),pageOptions(aspect,layout)));
for(const [aspect,layout]of Object.entries(rules.aspectLayouts)){
  const film=filmFixture();film.scenes.at(-1).params.logoKey='dashboard';
  pages.set('/closing-logo-'+aspect+'.html',generateFilmPage(JSON.stringify(film),pageOptions(aspect,layout)));
}
const typography=filmFixture();
typography.texts={...typography.texts,
  features:{text:'Useful things.',role:'label',factIds:[]},modules:{text:'Learn by doing.',role:'label',factIds:[]},
  first:{text:'A clear start.',role:'headline',factIds:[]},'first-detail':{text:'Make the important point first.',role:'body',factIds:[]},
  second:{text:'Real material.',role:'headline',factIds:[]},'second-detail':{text:'Show what people came for.',role:'body',factIds:[]},
  third:{text:'One next step.',role:'headline',factIds:[]},'third-detail':{text:'Keep the action close.',role:'body',factIds:[]},
  fourth:{text:'A little momentum.',role:'headline',factIds:[]}};
const copyItems=[{textSlot:'first',subtitleSlot:'first-detail'},{textSlot:'second',subtitleSlot:'second-detail'},
  {textSlot:'third',subtitleSlot:'third-detail'},{textSlot:'fourth'}];
typography.scenes=[typography.scenes[0],
  {...typography.scenes[1],id:'features',block:'feature-grid@1',params:{textSlot:'features',items:copyItems}},
  {...typography.scenes[2],id:'modules',block:'curriculum@1',params:{textSlot:'modules',items:copyItems.slice(0,3)}}];
for(const [aspect,layout]of Object.entries(rules.aspectLayouts))
  pages.set('/typography-'+aspect+'.html',generateFilmPage(JSON.stringify(typography),pageOptions(aspect,layout)));
const relay=filmFixture();
relay.texts={...relay.texts,first:{text:'Coding',role:'headline',factIds:[]},second:{text:'Work',role:'headline',factIds:[]},third:{text:'Media',role:'headline',factIds:[]}};
relay.assets.mark={resourceId:'res_fixture_mark'};
relay.scenes=[{id:'relay',kind:'block',block:'feature-grid@1',start:0,end:450,params:{logoKey:'mark',beatFrames:18,
  items:['first','second','third'].map(textSlot=>({textSlot}))},purpose:'One original mark moves between roles on a beat grid.'}];
for(const [aspect,layout]of Object.entries(rules.aspectLayouts)){
  const options=pageOptions(aspect,layout);
  options.resources.push({resourceId:'res_fixture_mark',kind:'image',width:168,height:168,licenseRef:'fixture-original-mark',rightsCleared:true});
  pages.set('/relay-'+aspect+'.html',generateFilmPage(JSON.stringify(relay),options));
}
// A real director repair put a shard boundary inside the push into ui-journey.
const journeyBeats=filmFixture();
journeyBeats.texts={...journeyBeats.texts,first:{text:'Start a timer.',role:'headline',factIds:[]},
  second:{text:'Hold to pause.',role:'headline',factIds:[]},third:{text:'Make it smile.',role:'headline',factIds:[]}};
journeyBeats.scenes=[{id:'journey',kind:'block',block:'ui-journey@1',start:0,end:450,params:{beatFrames:18,
  items:['first','second','third'].map(textSlot=>({textSlot,assetKey:'dashboard'}))},purpose:'Exercise beat-timed image handoffs.'}];
for(const [aspect,layout]of Object.entries(rules.aspectLayouts))
  pages.set('/journey-beats-'+aspect+'.html',generateFilmPage(JSON.stringify(journeyBeats),pageOptions(aspect,layout)));
// Keep those timings with original engineering material, not the private product screenshot.
const journey=filmFixture();
// Match the real failure's raster format/resolution, not just an SVG with broad flat shapes.
const bitmapPixels=new Uint8Array(2200*1400*4);
for(let y=0;y<1400;y++)for(let x=0;x<2200;x++){
  const line=x%97<2||y%113<2,detail=x>360&&y>260&&y<1160&&y%32<12;
  const rgb=line?[48,88,70]:detail?[(x%12<6?100:210),188,150]:x<300?[217,226,211]:[237,241,232];
  const at=(y*2200+x)*4;bitmapPixels.set([...rgb,255],at);
}
const journeyBitmap=execFileSync('ffmpeg',['-v','error','-f','rawvideo','-pixel_format','rgba','-video_size','2200x1400','-i','pipe:0',
  '-frames:v','1','-f','image2pipe','-c:v','png','pipe:1'],{input:bitmapPixels,maxBuffer:16<<20});
journey.assets.dashboard.resourceId='res_fixture_journey';
journey.scenes=[
  {...journey.scenes[0],end:66},
  {...journey.scenes[1],start:58,end:156,transitionIn:{type:'crossfade',frames:8}},
  {id:'journey',start:146,end:450,kind:'block',block:'ui-journey@1',params:{items:[
    {assetKey:'dashboard',textSlot:'intro'},{assetKey:'dashboard',textSlot:'product'}]},
    transitionIn:{type:'push',frames:10},purpose:'Exercise a cold shard boundary during a CSS-3D interface journey.'}
];
const showcase=filmFixture();showcase.assets.dashboard.resourceId='res_fixture_journey';
showcase.scenes=[{...showcase.scenes[0],end:66},
  {...showcase.scenes[1],start:60,end:150,transitionIn:{type:'crossfade',frames:6}},
  {...showcase.scenes[1],id:'chips',start:140,end:215,transitionIn:{type:'push',frames:10}},
  {...showcase.scenes[2],start:205,transitionIn:{type:'crossfade',frames:10}}];
for(const [name,film]of Object.entries({journey,showcase}))for(const [aspect,layout]of Object.entries(rules.aspectLayouts)){
  const options=pageOptions(aspect,layout);options.resources=[{...options.resources[0],resourceId:'res_fixture_journey',width:2200,height:1400}];
  pages.set('/'+name+'-'+aspect+'.html',generateFilmPage(JSON.stringify(film),options));
}
const thirty=filmFixture(),thirtyOptions=pageOptions('landscape',rules.aspectLayouts.landscape);
thirty.durationSeconds=30;thirty.totalFrames=900;thirty.scenes.at(-1).end=900;thirtyOptions.target.totalFrames=900;
pages.set('/thirty.html',generateFilmPage(JSON.stringify(thirty),thirtyOptions));
const oversized=filmFixture();oversized.texts.headline.text='W'.repeat(400);
pages.set('/oversized.html',generateFilmPage(JSON.stringify(oversized),pageOptions('portrait',rules.aspectLayouts.portrait)));
const server=http.createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  const page=pages.get(path);
  if(page){res.writeHead(200,{'content-type':'text/html; charset=utf-8','content-security-policy':page.csp}).end(page.html);return;}
  if(/^\/runtime\/(shim|engine|gsap|compat|blocks|blocks-3d|boot)\.js$/.test(path)){
    res.writeHead(200,{'content-type':'text/javascript'}).end(read('packages/film-runtime/dist/browser/'+path.split('/').at(-1)));return;
  }
  if(path==='/f/geist-sans/600-normal.woff2'){res.writeHead(200,{'content-type':'font/woff2'}).end(readFileSync('/opt/fonts/geist-sans-600.woff2'));return;}
  if(path==='/r/res_fixture_dashboard'){res.writeHead(200,{'content-type':'image/svg+xml'}).end(read('apps/render-container/tests/product.svg'));return;}
  if(path==='/r/res_fixture_mark'){res.writeHead(200,{'content-type':'image/svg+xml'}).end('<svg xmlns="http://www.w3.org/2000/svg" width="168" height="168" viewBox="0 0 168 168"><circle cx="84" cy="84" r="78" fill="#d9fa73"/><path d="M45 88L72 115L125 55" fill="none" stroke="#101712" stroke-width="16"/></svg>');return;}
  if(path==='/r/res_fixture_journey'){res.writeHead(200,{'content-type':'image/png'}).end(journeyBitmap);return;}
  res.writeHead(404).end();
});
await new Promise(resolve=>server.listen(8090,'127.0.0.1',resolve));
const browser=await chromium.connectOverCDP('http://127.0.0.1:9222',{timeout:60000});
assert.ok(browser.version().includes(lock.browser.version));
const context=browser.contexts()[0],shim=read('packages/film-runtime/dist/browser/shim.js').toString();
const externalRequests=[];
const rgba=buffer=>execFileSync('ffmpeg',['-v','error','-i','pipe:0','-f','rawvideo','-pix_fmt','rgba','pipe:1'],{input:buffer,maxBuffer:32<<20});
function compare(a,b,label){
  if(a.equals(b))return{maxChannelDiff:0,diffPixelPct:0};
  const x=rgba(a),y=rgba(b);assert.equal(x.length,y.length);
  let max=0,pixels=0;
  for(let i=0;i<x.length;i+=4){const d=Math.max(...[0,1,2,3].map(j=>Math.abs(x[i+j]-y[i+j])));max=Math.max(max,d);if(d)pixels++;}
  const share=pixels/(x.length/4)*100;
  if(max>2||share>.1){
    writeFileSync(`${output}/${label}-expected.png`,a);writeFileSync(`${output}/${label}-actual.png`,b);
  }
  assert.ok(max<=2&&share<=.1,`${label}: pixel regression: max=${max}, changed=${share}%`);
  return{maxChannelDiff:max,diffPixelPct:share};
}
async function open(aspect,path='/'+aspect+'.html',expectReady=true){
  const page=await context.newPage(),cdp=await context.newCDPSession(page),layout=rules.aspectLayouts[aspect];
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:layout.width,height:layout.height,deviceScaleFactor:1,mobile:false});
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:shim});
  page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith('http://127.0.0.1:8090/'))externalRequests.push(request.url());});
  await page.goto('http://127.0.0.1:8090'+path,{waitUntil:'load'});
  await page.waitForFunction(()=>window.__omReady||window.__omBootFailed,null,{timeout:40000});
  const error=await page.evaluate(()=>window.__omBootFailed);
  if(!expectReady){assert.match(error,/TEXT_FIT_FAILED/);return{page,cdp};}
  assert.equal(error,undefined);
  const plan=pages.get(path).plan;
  const envelope={protocolVersion:'3.0.0',sessionId:'browser-test',revisionId:'revision-test',aspectId:aspect};
  let sequence=1;
  await page.evaluate(input=>window.__omEngine.init(input),{...envelope,requestId:'init',sequence,command:'init',mode:'trusted_render',pixelScale:1,
    manifestHash:plan.manifestHash,frameCount:plan.spec.totalFrames,width:layout.width,height:layout.height,fps:30,seed:plan.seed,
    renderProfile:{sampleCount:1,shutterAngle:0,sampling:'centered-box-v1',edgePolicy:'clamp-v1'}});
  return{page,cdp,envelope,next:()=>++sequence,upcoming:()=>sequence+1,
    seek:async frameIndex=>page.evaluate(input=>window.__omEngine.seekFrame(input),{...envelope,requestId:'seek-'+sequence,sequence:++sequence,command:'seek',frameIndex}),
    capture:async()=>Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png',optimizeForSpeed:true})).data,'base64')};
}
async function checkLayout(handle,aspect){
  const layout=rules.aspectLayouts[aspect];
  const visible=await handle.page.evaluate(()=>[...document.querySelectorAll('[data-pb-slot]')].filter(el=>getComputedStyle(el).visibility==='visible'&&el.getClientRects().length).map(el=>{
    const r=el.getBoundingClientRect(),style=getComputedStyle(el);
    return{slot:el.dataset.pbSlot,scene:el.closest('section[data-scene]').dataset.scene,x:r.x,y:r.y,width:r.width,height:r.height,fontSize:parseFloat(style.fontSize),role:el.dataset.pbSlot==='cta'?'cta':'other'};
  }));
  assert.ok(visible.length>0);
  await handle.cdp.send('DOM.enable');await handle.cdp.send('CSS.enable');
  const {root:doc}=await handle.cdp.send('DOM.getDocument');
  for(const text of visible){
    assert.ok(text.x>=layout.width*layout.safeInsets.left-2&&text.y>=layout.height*layout.safeInsets.top-2,JSON.stringify(text));
    assert.ok(text.x+text.width<=layout.width*(1-layout.safeInsets.right)+2&&text.y+text.height<=layout.height*(1-layout.safeInsets.bottom)+2,JSON.stringify(text));
    assert.ok(text.fontSize>=(text.role==='cta'?(aspect==='landscape'?28:32):(aspect==='landscape'?32:36)));
    const {nodeId}=await handle.cdp.send('DOM.querySelector',{nodeId:doc.nodeId,selector:'section[data-scene="'+text.scene+'"] [data-pb-slot="'+text.slot+'"]'});
    const {fonts}=await handle.cdp.send('CSS.getPlatformFontsForNode',{nodeId});
    assert.ok(fonts.length>0&&fonts.every(font=>font.isCustomFont),JSON.stringify(fonts));
  }
}
const textPaintState=handle=>handle.page.evaluate(()=>[...document.querySelectorAll('[data-pb-slot]')].filter(el=>getComputedStyle(el).visibility==='visible').map(el=>{
  const ancestors=[];
  for(let node=el;node&&node.id!=='film';node=node.parentElement){
    const style=getComputedStyle(node),box=node.getBoundingClientRect();
    ancestors.push({tag:node.tagName,transform:style.transform,opacity:style.opacity,willChange:style.willChange,
      box:{x:box.x,y:box.y,width:box.width,height:box.height}});
  }
  return{slot:el.dataset.pbSlot,ancestors};
}));
async function compareFrame(handle,baseline,states,frame,label){
  const png=await handle.capture();
  try{return compare(baseline.get(frame),png,label);}
  catch(error){writeFileSync(`${output}/${label}-state.json`,JSON.stringify({expected:states.get(frame),actual:await textPaintState(handle)},null,2));throw error;}
}
try{
  if(runtimeOnly){
    report.media={status:'not_run',reason:'runtime_only'};
    report.programStyleSamples={status:'not_run',reason:'runtime_only'};
  }else{
    report.media=await mediaFixture(output,rules,lock);
    report.programStyleSamples=await audioSamples(output+'/audio-samples');
  }
  for(const aspect of focusedRuntime?[]:Object.keys(rules.aspectLayouts)){
    const handle=await open(aspect),baseline=new Map(),states=new Map(),checks=[];
    report.aspects[aspect]={status:'running',comparisons:checks};
    await assert.rejects(handle.page.evaluate(input=>window.__omEngine.seekFrame(input),
      {...handle.envelope,requestId:'init',sequence:handle.upcoming(),command:'seek',frameIndex:0}),/INVALID_SESSION/);
    await assert.rejects(handle.page.evaluate(input=>window.__omEngine.seekFrame(input),
      {...handle.envelope,sessionId:'wrong-session',requestId:'wrong',sequence:handle.upcoming(),command:'seek',frameIndex:0}),/INVALID_SESSION/);
    const frames=[0,12,45,120,132,165,330,342,375];
    for(const frame of frames){
      const ready=await handle.seek(frame);assert.equal(ready.frameIndex,frame);assert.equal(ready.aspectId,aspect);
      const png=await handle.capture();baseline.set(frame,png);writeFileSync(`${output}/${aspect}-${frame}.png`,png);
      states.set(frame,await textPaintState(handle));
      if([45,165,375].includes(frame))await checkLayout(handle,aspect);
    }
    for(const frame of [...frames].reverse()){await handle.seek(frame);checks.push({frame,mode:'reverse',...await compareFrame(handle,baseline,states,frame,`${aspect}-${frame}-reverse`)});}
    for(const frame of frames){const cold=await open(aspect);await cold.seek(frame);checks.push({frame,mode:'cold',...await compareFrame(cold,baseline,states,frame,`${aspect}-${frame}-cold`)});await cold.page.close();}
    await handle.seek(375);
    const closing=await handle.page.evaluate(()=>{const a=document.querySelector('[data-pb-slot="cta"]').getBoundingClientRect(),b=document.querySelector('[data-pb-slot="url"]').getBoundingClientRect();return{gap:b.top-a.bottom};});
    assert.ok(closing.gap>=20&&closing.gap<=48,JSON.stringify(closing));
    const time=await handle.page.evaluate(()=>({date:Date.now(),constructed:new Date().getTime(),performance:performance.now(),origin:performance.timeOrigin,random:Math.random(),targetKeys:Object.keys(window.__omTarget)}));
    assert.equal(time.date,12500);assert.equal(time.constructed,12500);assert.equal(time.performance,12500);assert.equal(time.origin,0);
    assert.ok(!time.targetKeys.includes('targetId'));
    await handle.seek(375);assert.equal(await handle.page.evaluate(()=>Math.random()),time.random);
    const forbidden=await handle.page.evaluate(()=>{
      const check=fn=>{try{fn();return'ALLOWED';}catch(error){return error.message;}};
      return[check(()=>setTimeout(()=>{},1)),check(()=>fetch('https://example.com')),check(()=>localStorage.getItem('x')),
        check(()=>document.createElement('iframe')),check(()=>new Worker('x')),check(()=>crypto.getRandomValues(new Uint8Array(1)))];
    });
    assert.deepEqual(forbidden,['RUNTIME_TIMER_FORBIDDEN','RUNTIME_NETWORK_FORBIDDEN','RUNTIME_STORAGE_FORBIDDEN','RUNTIME_IFRAME_FORBIDDEN','RUNTIME_WORKER_FORBIDDEN','RUNTIME_RANDOM_FORBIDDEN']);
    const point=await handle.page.evaluate(()=>{const r=document.querySelector('[data-pb-slot="cta"]').getBoundingClientRect();return{x01:(r.x+r.width/2)/window.__omTarget.width,y01:(r.y+r.height/2)/window.__omTarget.height};});
    const hit=await handle.page.evaluate(input=>window.__omEngine.inspect(input),{...handle.envelope,requestId:'inspect',sequence:handle.next(),command:'inspect',frameIndex:375,...point});
    assert.equal(hit.hit.regionId,'cta');
    const urlPoint=await handle.page.evaluate(()=>{const r=document.querySelector('[data-pb-slot="url"]').getBoundingClientRect();return{x01:(r.x+r.width/2)/window.__omTarget.width,y01:(r.y+r.height/2)/window.__omTarget.height};});
    const urlHit=await handle.page.evaluate(input=>window.__omEngine.inspect(input),{...handle.envelope,requestId:'inspect-url',sequence:handle.next(),command:'inspect',frameIndex:375,...urlPoint});
    assert.equal(urlHit.hit.regionId,'url');
    await assert.rejects(handle.seek(450),/FRAME_OUT_OF_RANGE/);
    await handle.page.evaluate(input=>window.__omEngine.dispose(input),{...handle.envelope,requestId:'dispose',sequence:handle.next(),command:'dispose'});
    await assert.rejects(handle.seek(0),/INVALID_SESSION/);
    report.aspects[aspect]={status:'passed',frames:frames.length,comparisons:checks,clock:true,forbiddenApis:true,textSafeAreaAndCustomFont:true,hitTest:true,dispose:true};
    await handle.page.close();
  }
  if(!journeyOnly&&!reviewOnly&&!showcaseOnly&&!relayOnly&&!journeyBeatsOnly){
    report.typography=[];
    for(const aspect of Object.keys(rules.aspectLayouts)){
      const path='/typography-'+aspect+'.html',handle=await open(aspect,path),frames=openingOnly?[0,12]:[0,12,45,165,375],baseline=new Map(),states=new Map(),comparisons=[];
      for(const frame of frames){
        await handle.seek(frame);await checkLayout(handle,aspect);
        const boxes=await handle.page.evaluate(frame=>{
          const rect=el=>{const r=el.getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height};};
          if(frame<120){const title=rect(document.querySelector('[data-pb-slot="headline"]')),detail=rect(document.querySelector('[data-pb-slot="intro"]'));return{subtitleGap:detail.top-title.bottom};}
          const scene=document.querySelector(`section[data-scene="${frame===165?'features':'modules'}"]`),heading=rect(scene.querySelector(`[data-pb-slot="${frame===165?'features':'modules'}"]`));
          const title=scene.querySelector('[data-pb-slot="first"]'),grid=title.parentElement.parentElement.parentElement;
          return{headingGap:rect(grid).top-heading.bottom,cards:[...grid.children].map(card=>{
            const slots=[...card.querySelectorAll('[data-pb-slot]')].map(rect);
            return{card:rect(card),slots,border:parseFloat(getComputedStyle(card).borderTopWidth)};
          })};
        },frame);
        if(frame<120)assert.ok(boxes.subtitleGap>=24&&boxes.subtitleGap<=40,JSON.stringify(boxes));
        else{
          assert.ok(Math.abs(boxes.headingGap-32)<1,JSON.stringify(boxes));
          for(const {card,slots,border}of boxes.cards){
            assert.equal(border,0);assert.ok(slots.every(slot=>slot.top>=card.top&&slot.bottom<=card.bottom+2),JSON.stringify({card,slots}));
            if(slots.length===2)assert.ok(slots[1].top-slots[0].bottom>=19,JSON.stringify(slots));
          }
        }
        const png=await handle.capture();baseline.set(frame,png);states.set(frame,await textPaintState(handle));
        writeFileSync(`${output}/typography-${aspect}-${frame}.png`,png);
      }
      for(const frame of [...frames].reverse()){
        await handle.seek(frame);comparisons.push({frame,mode:'reverse',...await compareFrame(handle,baseline,states,frame,`typography-${aspect}-${frame}-reverse`)});
      }
      await handle.page.close();
      for(const frame of frames){
        const cold=await open(aspect,path);await cold.seek(frame);
        comparisons.push({frame,mode:'cold',...await compareFrame(cold,baseline,states,frame,`typography-${aspect}-${frame}-cold`)});await cold.page.close();
      }
      report.typography.push({aspect,comparisons,textSafeAreaAndCustomFont:true,groupedHeadings:true,subtitleGap:true});
    }
  }
  if(relayOnly||!focusedRuntime){
    report.relay=[];
    for(const aspect of Object.keys(rules.aspectLayouts)){
      const path='/relay-'+aspect+'.html',handle=await open(aspect,path),frames=[0,15,24,33,42,51,89],baseline=new Map(),states=new Map(),comparisons=[];
      for(const frame of frames){
        await handle.seek(frame);
        const pose=await handle.page.evaluate(()=>{
          const image=document.querySelector('section[data-scene="relay"] img'),rect=image.getBoundingClientRect();
          return{decoded:image.complete&&image.naturalWidth===168,x:rect.x,y:rect.y,width:rect.width,height:rect.height,
            transform:getComputedStyle(image).transform,cards:[...image.parentElement.children].filter(el=>el!==image).map(el=>{
              const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};
            })};
        });
        assert.equal(pose.decoded,true);
        if([15,33,51,89].includes(frame)){
          assert.equal(pose.transform,'none');
          const index=frame===15?0:frame===33?1:2,card=pose.cards[index];
          assert.ok(Math.abs(pose.x-card.x-8)<1,JSON.stringify(pose));
          if(aspect==='landscape')assert.ok(Math.abs(pose.y-card.y)<1,JSON.stringify(pose));
          else assert.ok(Math.abs(pose.y+pose.height/2-card.y-card.height/2)<1,JSON.stringify(pose));
        }
        if(frame===89)await checkLayout(handle,aspect);
        const png=await handle.capture();baseline.set(frame,png);states.set(frame,await textPaintState(handle));
        writeFileSync(`${output}/relay-${aspect}-${frame}.png`,png);
      }
      for(const frame of [...frames].reverse()){
        await handle.seek(frame);comparisons.push({frame,mode:'reverse',...await compareFrame(handle,baseline,states,frame,`relay-${aspect}-${frame}-reverse`)});
      }
      await handle.page.close();
      for(const frame of frames){
        const cold=await open(aspect,path);await cold.seek(frame);
        comparisons.push({frame,mode:'cold',...await compareFrame(cold,baseline,states,frame,`relay-${aspect}-${frame}-cold`)});await cold.page.close();
      }
      report.relay.push({aspect,comparisons,decodedLogo:true,exactLandings:true,textSafeAreaAndCustomFont:true});
    }
  }
  if(journeyBeatsOnly||!focusedRuntime){
    report.journeyBeats=[];
    for(const aspect of Object.keys(rules.aspectLayouts)){
      const path='/journey-beats-'+aspect+'.html',handle=await open(aspect,path),frames=[0,9,27,63,81,117,135,161],baseline=new Map(),states=new Map(),comparisons=[];
      // Warm through every source frame, rather than comparing only sparse seeks.
      for(let frame=0;frame<=161;frame++){
        await handle.seek(frame);
        if(!frames.includes(frame))continue;
        if([27,81,135].includes(frame)){
          await checkLayout(handle,aspect);
          const slots=await handle.page.evaluate(()=>[...document.querySelectorAll('[data-pb-slot]')].filter(el=>getComputedStyle(el).visibility==='visible').map(el=>el.dataset.pbSlot));
          assert.deepEqual(slots,[["first"],["second"],["third"]][[27,81,135].indexOf(frame)]);
        }
        const png=await handle.capture();baseline.set(frame,png);states.set(frame,await textPaintState(handle));
        writeFileSync(`${output}/journey-beats-${aspect}-${frame}.png`,png);
      }
      for(const frame of [...frames].reverse()){
        await handle.seek(frame);comparisons.push({frame,mode:'reverse',...await compareFrame(handle,baseline,states,frame,`journey-beats-${aspect}-${frame}-reverse`)});
      }
      await handle.page.close();
      for(const frame of frames){
        const cold=await open(aspect,path);await cold.seek(frame);
        comparisons.push({frame,mode:'cold',...await compareFrame(cold,baseline,states,frame,`journey-beats-${aspect}-${frame}-cold`)});await cold.page.close();
      }
      report.journeyBeats.push({aspect,comparisons,allThreeReadingStates:true,textSafeAreaAndCustomFont:true});
    }
  }
  for(const name of layoutOnly||typographyOnly||openingOnly||relayOnly||journeyBeatsOnly?[]:showcaseOnly?['showcase']:journeyOnly?['journey']:['journey','showcase']){
  report[name]={scope:'push_boundary_and_moving_3d_panel_forward_reverse_cold_at_final_and_review_scale',comparisons:[]};
  for(const aspect of Object.keys(rules.aspectLayouts))for(const scale of reviewOnly?[.5]:[1,.5]){
    const path='/'+name+'-'+aspect+'.html',handle=await open(aspect,path),layout=rules.aspectLayouts[aspect];
    const capture=async view=>{
      const png=Buffer.from((await view.cdp.send('Page.captureScreenshot',{format:'png',optimizeForSpeed:true,fromSurface:true,
        captureBeyondViewport:false,clip:{x:0,y:0,width:layout.width,height:layout.height,scale:1}})).data,'base64');
      const output=scale===.5?reviewPng(png):png;
      assert.equal(output.readUInt32BE(16),layout.width*scale);assert.equal(output.readUInt32BE(20),layout.height*scale);return output;
    };
    assert.deepEqual(await handle.page.evaluate(()=>({width:window.__omTarget.width,height:window.__omTarget.height,ratio:window.devicePixelRatio})),
      {width:layout.width,height:layout.height,ratio:1});
    const frames=[149,185,299],baseline=new Map();
    // Match review's full-size JPEG capture history; PNG is only for the lossless probes.
    for(let frame=0;frame<=frames.at(-1);frame++){
      if(frame%2===0||frames.includes(frame)){
        await handle.seek(frame);
        if(frames.includes(frame)){
          const png=await capture(handle);baseline.set(frame,png);writeFileSync(`${output}/${name}-${aspect}-${scale}-${frame}.png`,png);
        }else await handle.cdp.send('Page.captureScreenshot',{format:'jpeg',quality:92,optimizeForSpeed:true,fromSurface:true,
          captureBeyondViewport:false,clip:{x:0,y:0,width:layout.width,height:layout.height,scale:1}});
      }
    }
    for(const frame of [...frames].reverse()){
      await handle.seek(frame);const png=await capture(handle);
      report[name].comparisons.push({aspect,scale,frame,mode:'reverse',...compare(baseline.get(frame),png,`${name}-${aspect}-${scale}-${frame}-reverse`)});
    }
    await handle.page.close();
    for(const frame of frames){
      const cold=await open(aspect,path);await cold.seek(frame);
      report[name].comparisons.push({aspect,scale,frame,mode:'cold',...compare(baseline.get(frame),await capture(cold),`${name}-${aspect}-${scale}-${frame}-cold`)});
      await cold.page.close();
    }
  }
  }
  if(!focusedRuntime){
    report.closingLogos=[];
    for(const aspect of Object.keys(rules.aspectLayouts)){
      const logo=await open(aspect,'/closing-logo-'+aspect+'.html');await logo.seek(375);await checkLayout(logo,aspect);
      const boxes=await logo.page.evaluate(()=>{const image=document.querySelector('section[data-scene="cta"] img').getBoundingClientRect(),cta=document.querySelector('[data-pb-slot="cta"]').getBoundingClientRect(),url=document.querySelector('[data-pb-slot="url"]').getBoundingClientRect();return{imageBottom:image.bottom,titleTop:cta.top,titleBottom:cta.bottom,urlTop:url.top};});
      assert.ok(boxes.titleTop-boxes.imageBottom>=31&&boxes.urlTop-boxes.titleBottom>=20,JSON.stringify(boxes));
      writeFileSync(`${output}/closing-logo-${aspect}.png`,await logo.capture());report.closingLogos.push({aspect,boxes});await logo.page.close();
    }
    const failure=await open('portrait','/oversized.html',false);await failure.page.close();report.checks.push('TEXT_FIT_FAILED');
    const long=await open('landscape','/thirty.html');await long.seek(899);await assert.rejects(long.seek(900),/FRAME_OUT_OF_RANGE/);
    writeFileSync(output+'/landscape-30s-899.png',await long.capture());await long.page.close();report.checks.push('30-second frame bounds');
  }
  if(typographyOnly){const failure=await open('portrait','/oversized.html',false);await failure.page.close();report.checks.push('oversized text fails');}
  const renderers=readdirSync('/proc').filter(name=>/^\d+$/.test(name)).flatMap(pid=>{
    try{const cmd=readFileSync(`/proc/${pid}/cmdline`,'utf8');if(!cmd.includes('--type=renderer'))return[];
      const status=readFileSync(`/proc/${pid}/status`,'utf8');return[{pid:Number(pid),uid:Number(status.match(/^Uid:\s+(\d+)/m)?.[1]),
        seccomp:Number(status.match(/^Seccomp:\s+(\d+)/m)?.[1]),noNewPrivs:Number(status.match(/^NoNewPrivs:\s+(\d+)/m)?.[1]),
        pidNamespaceDepth:status.match(/^NSpid:\s+(.+)$/m)?.[1].trim().split(/\s+/).length??0}];}catch{return[];}
  });
  assert.ok(renderers.length>0);assert.ok(renderers.every(item=>item.uid===10002&&item.seccomp===2&&item.noNewPrivs===1&&item.pidNamespaceDepth>=2),JSON.stringify(renderers));
  report.sandbox=renderers;assert.deepEqual(externalRequests,[]);report.network='docker --network none; no external page requests';
  for(const name of ['journey','showcase'])if(report[name])report.checks.push(`four-aspect ${name} forward/reverse/cold seeks`);
  if(report.typography)report.checks.push(openingOnly?'four-aspect grouped opening frame 0/12 forward/reverse/cold seeks':'four-aspect grouped opening, text-only features and curriculum forward/reverse/cold seeks');
  if(report.relay)report.checks.push('four-aspect brand relay forward/reverse/cold seeks and exact beat landings');
  if(report.journeyBeats)report.checks.push('four-aspect beat journey continuous/reverse/cold seeks and all reading states');
  if(!focusedRuntime)report.checks.push('four-aspect forward/reverse/cold seeks','virtual clock/random reset','protocol frame bounds and disposal','oversized text fails');
  report.status='passed';
  writeFileSync(output+'/report.json',JSON.stringify(report,null,2)+'\n');
  writeFileSync(output+'/environment-packages.txt',readFileSync('/opt/environment-packages.txt'));
  console.log(JSON.stringify(report,null,2));
}catch(error){
  report.status='failed';report.failure=String(error.stack??error);
  writeFileSync(output+'/report.json',JSON.stringify(report,null,2)+'\n');
  throw error;
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
