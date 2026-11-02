// A curated selection from already inspected official pages, not an unrestricted website importer.
import {chromium} from 'playwright-core';
import {readFileSync,mkdtempSync,rmSync,existsSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseCanonicalJson} from '@promobento/contracts/canonical';
import {evaluationChromeExecutable} from './chrome.mjs';
import {privateExisting} from './private-path.mjs';
import {downloadApprovedImage} from './capture-approved-web-images.mjs';
import {downscaleSelectedPng,stageSelectedFile,commitSelectedMaterials} from './selected-image.mjs';
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
const previous=selectedStat?parseCanonicalJson(readFileSync(privateExisting(selectionFile,'file'))):null;
const selected=[],stagedFiles=new Map();
const add=(entry,extra)=>selected.push({...extra,...entry,review:'pending_visual_selection',scope:'internal_eval_only',publicUseCleared:false});
// Never navigate an untrusted image as a document or run its scripts while resizing.
const rasterize=async(context,bytes,width,height)=>{
 const page=await context.newPage();
 try{
  await page.route('**/*',route=>route.abort());
  await page.setContent('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:">');
  const data=Buffer.from(bytes).toString('base64');
  const encoded=await page.evaluate(async({data,width,height})=>{
   const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();
   const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('SELECTED_IMAGE_DOWNSCALE_INVALID');
   ctx.drawImage(img,0,0,width,height);
   return canvas.toDataURL('image/png').split(',')[1];
  },{data,width,height});
  return Buffer.from(encoded,'base64');
 }finally{await page.close();}
};
let browserVersion;
const selectedBrowserVersion=async context=>{
 if(browserVersion)return browserVersion;
 if(context.browser()){browserVersion=context.browser().version();return browserVersion;}
 const page=await context.newPage();
 try{browserVersion=await page.evaluate(()=>navigator.userAgent);return browserVersion;}
 finally{await page.close();}
};
const profile=mkdtempSync(join(tmpdir(),'promobento-material-selection-'));
let context;
try{
 context=await chromium.launchPersistentContext(profile,{executablePath:evaluationChromeExecutable,headless:true,
  viewport:{width:1600,height:1000},deviceScaleFactor:1,locale:'en-US',timezoneId:'UTC',acceptDownloads:false});
 if(!selectedTopic||selectedTopic==='deepseek'){
 const deepseek=capturedSource('deepseek-0'),page=await context.newPage();
 try{
  await page.goto(deepseek.sourceUrl,{waitUntil:'domcontentloaded',timeout:45000});await page.waitForTimeout(3000);
  const clip={x:340,y:402,width:920,height:365};
  const file=stageSelectedFile(stagedFiles,'deepseek-hero',await page.screenshot({type:'png',clip}),'png');
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
  const normalized=await downscaleSelectedPng(bytes,{rasterize:(source,width,height)=>rasterize(context,source,width,height),browser:await selectedBrowserVersion(context)});
  const file=stageSelectedFile(stagedFiles,item.id,normalized.bytes,'png');
  const derivation=normalized.derivation?{...normalized.derivation,originalFile:stageSelectedFile(stagedFiles,item.id+'-source',normalized.original,'png')}:undefined;
  add({id:item.id,topicId:item.topicId,file,width:normalized.width,height:normalized.height,description:item.description,
    ...(derivation?{derivation}:{})},{sourceUrl:source.sourceUrl,imageUrl:asset.src,alt:asset.alt});console.log(item.id);
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
  const bytes=await course.screenshot({type:'png',fullPage:false});
  const file=stageSelectedFile(stagedFiles,'hf-course-outline',bytes,'png');
  const licenseSource='https://raw.githubusercontent.com/huggingface/course/main/LICENSE';
  const licenseText=(await downloadApprovedImage(licenseSource,{accept:'text/plain',maxBytes:32000,timeoutMs:20000})).toString('utf8');
  if(!licenseText.includes('Apache License'))throw Error('COURSE_LICENSE_INVALID');
  const licenseFile=stageSelectedFile(stagedFiles,'hf-license',Buffer.from(licenseText,'utf8'),'txt');
  add({id:'hf-course-outline',topicId:'hf-llm-course',file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),
   description:'Course-authored curriculum diagram rasterized at its original dimensions; no embedded video, author portrait or testimonial.'},{sourceUrl:hf.sourceUrl,imageUrl,
   attribution:'Hugging Face Course contributors; course repository Apache-2.0 notice retained. Screenshot rasterization only; original diagram unaltered.',licenseSource,licenseFile});
 }finally{await course.close();}}
}finally{
 try{await context?.close();}finally{
  rmSync(profile,{recursive:true,force:true});
 }
}
commitSelectedMaterials(directory,previous,selectedTopic,selected,stagedFiles);
