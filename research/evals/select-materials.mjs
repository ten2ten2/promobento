// A curated selection from already inspected official pages, not an unrestricted website importer.
import {chromium} from 'playwright-core';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
const directory=resolve(process.argv[2]??'artifacts/eval-materials-2026-10-24');
const selectedTopic=process.argv[3];
if(selectedTopic&&!['deepseek','minimax','duolingo','marugoto','hf-llm-course'].includes(selectedTopic))throw Error('CURATED_SELECTION_UNAVAILABLE');
if(!directory.startsWith(resolve('artifacts')+'/'))throw Error('PRIVATE_ARTIFACT_DIRECTORY_REQUIRED');
const capture=parseCanonicalJson(readFileSync(join(directory,'capture.json'))),byId=new Map(capture.assets.map(asset=>[asset.id,asset]));
const profile=mkdtempSync(join(tmpdir(),'promobento-material-selection-'));
const context=await chromium.launchPersistentContext(profile,{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,
 viewport:{width:1600,height:1000},deviceScaleFactor:1,locale:'en-US',timezoneId:'UTC',acceptDownloads:false});
const selected=selectedTopic?parseCanonicalJson(readFileSync(join(directory,'selected.json'))).assets.filter(asset=>asset.topicId!==selectedTopic):[];
const save=()=>writeFileSync(join(directory,'selected.json'),canonical({scope:'internal_eval_only',publicUseCleared:false,assets:selected})+'\n');
const add=(entry,extra)=>{selected.push({...extra,...entry,review:'pending_visual_selection',scope:'internal_eval_only',publicUseCleared:false});save();};
try{
 if(!selectedTopic||selectedTopic==='deepseek'){
 const deepseek=byId.get('deepseek-0'),page=await context.newPage();
 try{
  await page.goto(deepseek.sourceUrl,{waitUntil:'domcontentloaded',timeout:45000});await page.waitForTimeout(3000);
  const clip={x:340,y:402,width:920,height:365},file='deepseek-hero.png';await page.screenshot({path:join(directory,file),clip});
  add({id:'deepseek-hero',topicId:'deepseek',file,width:clip.width,height:clip.height,clip,description:'Official homepage interaction area and Chat/API/Harness entry points; announcement with unconfirmed cost/speed claims excluded.'},{sourceUrl:deepseek.sourceUrl});
 }finally{await page.close();}}
 const downloads=[
  {id:'minimax-interface',topicId:'minimax',sourceId:'minimax-1',image:asset=>asset.alt==='MiniMax Code desktop interface preview',description:'Official desktop preview, not a captured personal account.'},
  ...[['duolingo-translate','6-exerciseTypes.png','Translation exercise'],['duolingo-listen','7-exerciseTypes.png','Listening exercise'],['duolingo-speak','8-exerciseTypes.png','Speaking exercise'],['duolingo-path','9-pathUnit.png','Official example learning path']].map(([id,suffix,description])=>({id,topicId:'duolingo',sourceId:'duolingo-0',image:asset=>asset.src.endsWith(suffix),description})),
  {id:'marugoto-interface',topicId:'marugoto',sourceId:'marugoto-0',image:asset=>asset.src.endsWith('/img_tab_first_01.png'),description:'Official Minato and Marugoto course interface examples; no real-person portrait.'}
 ];
 for(const item of downloads){
  if(selectedTopic&&selectedTopic!==item.topicId)continue;
  const source=byId.get(item.sourceId),asset=source.images.find(item.image);if(!asset)throw Error('SELECTED_OFFICIAL_IMAGE_MISSING');
  const response=await fetch(asset.src,{signal:AbortSignal.timeout(30000)});
  if(!response.ok||!response.headers.get('content-type')?.startsWith('image/png'))throw Error('SELECTED_IMAGE_DOWNLOAD_FAILED');
  const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>8<<20||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('SELECTED_IMAGE_INVALID');
  const file=item.id+'.png';writeFileSync(join(directory,file),bytes);
  add({id:item.id,topicId:item.topicId,file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),description:item.description},
   {sourceUrl:source.sourceUrl,imageUrl:asset.src,alt:asset.alt});console.log(item.id);
 }
 if(!selectedTopic||selectedTopic==='hf-llm-course'){
 const hf=byId.get('hf-llm-course-0'),course=await context.newPage();
 try{
  await course.goto(hf.sourceUrl,{waitUntil:'domcontentloaded',timeout:45000});
  const diagram=course.locator('img[alt="Brief overview of the chapters of the course."]').first();
  await diagram.scrollIntoViewIfNeeded();await diagram.evaluate(image=>image.decode());
  const imageUrl=new URL(await diagram.getAttribute('src'),hf.sourceUrl).href,original=hf.images.find(image=>image.src===imageUrl);
  if(!original)throw Error('COURSE_DIAGRAM_IDENTITY_MISMATCH');
  await course.setViewportSize({width:original.width,height:original.height});
  const svg=await fetch(imageUrl,{signal:AbortSignal.timeout(20000)});if(!svg.ok)throw Error('COURSE_DIAGRAM_UNAVAILABLE');
  const svgBytes=Buffer.from(await svg.arrayBuffer());
  if(svgBytes.length>8<<20||!svgBytes.toString('utf8').trimStart().startsWith('<svg'))throw Error('COURSE_DIAGRAM_INVALID');
  // The source host serves SVG as text/plain. Render it as an inert image, not a source-code page.
  await course.setContent('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"><style>html,body{margin:0;padding:0;background:white}img{display:block}</style><img src="data:image/svg+xml;base64,'+svgBytes.toString('base64')+'">');
  await course.locator('img').evaluate(image=>image.decode());
  const file='hf-course-outline.png';await course.screenshot({path:join(directory,file),fullPage:false});
  const bytes=readFileSync(join(directory,file));
  const licenseSource='https://raw.githubusercontent.com/huggingface/course/main/LICENSE',license=await fetch(licenseSource,{signal:AbortSignal.timeout(20000)});
  if(!license.ok)throw Error('COURSE_LICENSE_UNAVAILABLE');const licenseText=await license.text();
  if(!licenseText.includes('Apache License')||licenseText.length>32000)throw Error('COURSE_LICENSE_INVALID');
  const licenseFile='hf-course-apache-2.0.txt';writeFileSync(join(directory,licenseFile),licenseText);
  add({id:'hf-course-outline',topicId:'hf-llm-course',file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),
   description:'Course-authored curriculum diagram rasterized at its original dimensions; no embedded video, author portrait or testimonial.'},{sourceUrl:hf.sourceUrl,imageUrl,
   attribution:'Hugging Face Course contributors; course repository Apache-2.0 notice retained. Screenshot rasterization only; original diagram unaltered.',licenseSource,licenseFile});
 }finally{await course.close();}}
}finally{await context.close();rmSync(profile,{recursive:true,force:true});save();}
