import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {observeProduct} from './product-observation.mjs';

test('approved page observation records real logo, images, colours and type without treating URLs as permission',async()=>{
 const browser=await chromium.launch({executablePath:process.env.PROMOBENTO_OBSERVATION_CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,chromiumSandbox:true});
 try{
  const page=await browser.newPage({viewport:{width:800,height:600}});
  await page.route('**/*',route=>route.abort());
  await page.setContent(`<html><head><link rel="icon" href="https://example.test/favicon.png"><style>
  body{margin:0;background:rgb(10,20,30);font-family:Arial;color:rgb(240,240,240)}button{background:rgb(0,120,0)}
  img.hero{width:300px;height:150px}#hidden{display:none;color:red}</style></head><body><h1>Product</h1>
  <a class="brand"><img alt="Acme" src="https://example.test/logo.png"><svg width="24" height="24"></svg></a><img class="hero" alt="Exercise" src="https://example.test/exercise.png">
  <video src="https://example.test/product.mp4" poster="https://example.test/poster.png"></video>
  <button>Start</button><p id="hidden">not visible</p><aside>We use cookies <button>Reject all</button></aside></body></html>`);
  const result=await observeProduct(page);
  assert.ok(result.logos.some(item=>item.src==='https://example.test/favicon.png'));
  assert.ok(result.logos.some(item=>item.src==='https://example.test/logo.png'));
  const inline=result.logos.find(item=>item.kind==='inline-svg');assert.ok(inline?.selector);
  assert.equal(await page.locator(inline.selector).count(),1);
  assert.ok(result.videos.some(item=>item.src==='https://example.test/product.mp4'));
  assert.ok(result.images.some(item=>item.src==='https://example.test/exercise.png'&&item.alt==='Exercise'));
  assert.ok(result.colours.some(item=>item.role==='ground'&&item.value==='rgb(10, 20, 30)'));
  assert.ok(result.colours.some(item=>item.role==='accent'&&item.value==='rgb(0, 120, 0)'));
  assert.ok(result.fonts.some(item=>item.family==='Arial'));assert.ok(result.pageHeight>=600);
  assert.equal(result.cookieNoticeVisible,true);
  assert.ok(!result.colours.some(item=>item.value==='rgb(255, 0, 0)'));
 }finally{await browser.close();}
});
