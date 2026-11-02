// A curated selection from already inspected official pages, not an unrestricted website importer.
import {chromium} from 'playwright-core';
import {readFileSync,mkdtempSync,rmSync,existsSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {evaluationChromeExecutable} from './chrome.mjs';
import {privateExisting,writePrivateFile} from './private-path.mjs';
import {downloadApprovedImage} from './capture-approved-web-images.mjs';
import {imageHeader} from './image-header.mjs';
const directory=privateExisting(process.argv[2]??'artifacts/eval-materials-2026-10-24');
const selectedTopic=process.argv[3];
if(selectedTopic&&!['deepseek','minimax','duolingo','marugoto','hf-llm-course'].includes(selectedTopic))throw Error('CURATED_SELECTION_UNAVAILABLE');
const topicCapture=selectedTopic?join(directory,`capture-${selectedTopic}.json`):null;
const selectionFile=join(directory,'selected.json');
const selectedStat=lstatSync(selectionFile,{throwIfNoEntry:false});
if(selectedStat&&(selectedStat.isSymbolicLink()||!selectedStat.isFile()))throw Error('PRIVATE_SELECTION_PATH_INVALID');
const captureFile=topicCapture&&existsSync(topicCapture)?topicCapture:join(directory,'capture.json');
const capture=parseCanonicalJson(readFileSync(privateExisting(captureFile,'file'))),byId=new Map(capture.assets.map(asset=>[asset.id,asset]));
const root=new URL('../../',import.meta.url),topics=parseCanonicalJson(readFileSync(new URL('topics.json',import.meta.url)));
const cards=new Map(topics.topics.filter(topic=>topic.countsTowardGate!==false).map(topic=>[topic.id,parseCanonicalJson(readFileSync(new URL(topic.factCard,root)))]));
const capturedSource=id=>{
 const match=/^(.+)-(\d+)$/.exec(id),asset=byId.get(id),card=cards.get(match?.[1]);
 if(!asset||!card||asset.sourceUrl!==card.assetSources?.[Number(match[2])]?.url)throw Error('CAPTURE_SOURCE_MISMATCH');
 return asset;
};
const sourceIds={deepseek:['deepseek-0'],minimax:['minimax-1'],duolingo:['duolingo-0'],marugoto:['marugoto-0'],'hf-llm-course':['hf-llm-course-0']};
for(const id of selectedTopic?sourceIds[selectedTopic]:Object.values(sourceIds).flat())capturedSource(id);
const selected=selectedTopic&&selectedStat?parseCanonicalJson(readFileSync(privateExisting(selectionFile,'file'))).assets.filter(asset=>asset.topicId!==selectedTopic):[];
const save=()=>writePrivateFile(selectionFile,canonical({scope:'internal_eval_only',publicUseCleared:false,assets:selected})+'\n');
const add=(entry,extra)=>{selected.push({...extra,...entry,review:'pending_visual_selection',scope:'internal_eval_only',publicUseCleared:false});save();};
const profile=mkdtempSync(join(tmpdir(),'promobento-material-selection-'));
let context;
try{
 context=await chromium.launchPersistentContext(profile,{executablePath:evaluationChromeExecutable,headless:true,
  viewport:{width:1600,height:1000},deviceScaleFactor:1,locale:'en-US',timezoneId:'UTC',acceptDownloads:false});
 if(!selectedTopic||selectedTopic==='deepseek'){
 const deepseek=capturedSource('deepseek-0'),page=await context.newPage();
 try{
  await page.goto(deepseek.sourceUrl,{waitUntil:'domcontentloaded',timeout:45000});await page.waitForTimeout(3000);
  const clip={x:340,y:402,width:920,height:365},file='deepseek-hero.png';
  writePrivateFile(join(directory,file),await page.screenshot({type:'png',clip}));
  add({id:'deepseek-hero',topicId:'deepseek',file,width:clip.width,height:clip.height,clip,description:'Official homepage interaction area and Chat/API/Harness entry points; announcement with unconfirmed cost/speed claims excluded.'},{sourceUrl:deepseek.sourceUrl});
 }finally{await page.close();}}
 const downloads=[
  {id:'minimax-interface',topicId:'minimax',sourceId:'minimax-1',image:asset=>asset.alt==='MiniMax Code desktop interface preview',description:'Official desktop preview, not a captured personal account.'},
  ...[['duolingo-translate','6-exerciseTypes.png','Translation exercise'],['duolingo-listen','7-exerciseTypes.png','Listening exercise'],['duolingo-speak','8-exerciseTypes.png','Speaking exercise'],['duolingo-path','9-pathUnit.png','Official example learning path']].map(([id,suffix,description])=>({id,topicId:'duolingo',sourceId:'duolingo-0',image:asset=>asset.src.endsWith(suffix),description})),
  {id:'marugoto-interface',topicId:'marugoto',sourceId:'marugoto-0',image:asset=>asset.src.endsWith('/img_tab_first_01.png'),description:'Official Minato and Marugoto course interface examples; no real-person portrait.'}
 ];
 for(const item of downloads){
  if(selectedTopic&&selectedTopic!==item.topicId)continue;
  const source=capturedSource(item.sourceId),asset=source.images.find(item.image);if(!asset)throw Error('SELECTED_OFFICIAL_IMAGE_MISSING');
  const bytes=await downloadApprovedImage(asset.src,{accept:'image/png',maxBytes:8<<20,timeoutMs:30000});
  const {width,height,mediaType}=imageHeader(bytes);
  if(mediaType!=='image/png'||width>4096||height>4096)throw Error('SELECTED_IMAGE_INVALID');
  const file=item.id+'.png';writePrivateFile(join(directory,file),bytes);
  add({id:item.id,topicId:item.topicId,file,width,height,description:item.description},
   {sourceUrl:source.sourceUrl,imageUrl:asset.src,alt:asset.alt});console.log(item.id);
 }
 if(!selectedTopic||selectedTopic==='hf-llm-course'){
 const hf=capturedSource('hf-llm-course-0'),course=await context.newPage();
 try{
  await course.goto(hf.sourceUrl,{waitUntil:'domcontentloaded',timeout:45000});
  const diagram=course.locator('img[alt="Brief overview of the chapters of the course."]').first();
  await diagram.scrollIntoViewIfNeeded();await diagram.evaluate(image=>image.decode());
  const imageUrl=new URL(await diagram.getAttribute('src'),hf.sourceUrl).href,original=hf.images.find(image=>image.src===imageUrl);
  if(!original)throw Error('COURSE_DIAGRAM_IDENTITY_MISMATCH');
  await course.setViewportSize({width:original.width,height:original.height});
  const svgBytes=await downloadApprovedImage(imageUrl,{accept:'image/svg+xml,text/plain',maxBytes:8<<20,timeoutMs:20000});
  if(!svgBytes.toString('utf8').trimStart().startsWith('<svg'))throw Error('COURSE_DIAGRAM_INVALID');
  // The source host serves SVG as text/plain. Render it as an inert image, not a source-code page.
  await course.setContent('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"><style>html,body{margin:0;padding:0;background:white}img{display:block}</style><img src="data:image/svg+xml;base64,'+svgBytes.toString('base64')+'">');
  await course.locator('img').evaluate(image=>image.decode());
  const file='hf-course-outline.png',bytes=await course.screenshot({type:'png',fullPage:false});
  writePrivateFile(join(directory,file),bytes);
  const licenseSource='https://raw.githubusercontent.com/huggingface/course/main/LICENSE';
  const licenseText=(await downloadApprovedImage(licenseSource,{accept:'text/plain',maxBytes:32000,timeoutMs:20000})).toString('utf8');
  if(!licenseText.includes('Apache License'))throw Error('COURSE_LICENSE_INVALID');
  const licenseFile='hf-course-apache-2.0.txt';writePrivateFile(join(directory,licenseFile),licenseText);
  add({id:'hf-course-outline',topicId:'hf-llm-course',file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),
   description:'Course-authored curriculum diagram rasterized at its original dimensions; no embedded video, author portrait or testimonial.'},{sourceUrl:hf.sourceUrl,imageUrl,
   attribution:'Hugging Face Course contributors; course repository Apache-2.0 notice retained. Screenshot rasterization only; original diagram unaltered.',licenseSource,licenseFile});
 }finally{await course.close();}}
}finally{
 try{await context?.close();}finally{
  rmSync(profile,{recursive:true,force:true});
  if(context)save();
 }
}
