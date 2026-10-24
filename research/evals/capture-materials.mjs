// Public, logged-out source capture for the six owner-approved internal topics. No model calls or Docker.
import {chromium} from 'playwright-core';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';

const root=new URL('../../',import.meta.url),topics=parseCanonicalJson(readFileSync(new URL('topics.json',import.meta.url)));
const selected=process.argv[3],directory=resolve(process.argv[2]??'artifacts/eval-materials-2026-10-24');
if(selected&&!topics.topics.some(topic=>topic.id===selected&&topic.countsTowardGate!==false))throw Error('EVAL_TOPIC_INVALID');
if(!directory.startsWith(resolve('artifacts')+'/'))throw Error('PRIVATE_ARTIFACT_DIRECTORY_REQUIRED');
if(topics.rights.scope!=='internal_eval_only'||topics.factConfirmation.confirmedBy!=='owner')throw Error('INTERNAL_SOURCE_APPROVAL_REQUIRED');
mkdirSync(directory,{recursive:true});
const reportPath=join(directory,selected?`capture-${selected}.json`:'capture.json');
if(existsSync(reportPath))throw Error('CAPTURE_REPORT_ALREADY_EXISTS');
const profile=mkdtempSync(join(tmpdir(),'promobento-public-capture-'));
const context=await chromium.launchPersistentContext(profile,{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 headless:true,...(selected==='ielts-ready'?{args:['--disable-http2']}:{}),viewport:{width:1600,height:1000},deviceScaleFactor:1,locale:'en-US',timezoneId:'UTC',acceptDownloads:false});
const report={scope:'private_internal_eval_source_capture_not_public_license',browser:context.browser().version(),capturedAt:new Date().toISOString(),assets:[]};
const save=()=>writeFileSync(reportPath,canonical(report)+'\n');
try{
 for(const topic of topics.topics.filter(topic=>topic.countsTowardGate!==false&&(!selected||topic.id===selected))){
  const card=parseCanonicalJson(readFileSync(new URL(topic.factCard,root)));
  if(card.status!=='confirmed_for_s1_eval'||card.confirmation.confirmedBy!=='owner'||card.rights.scope!=='internal_eval_only'||card.rights.publicUseCleared!==false)throw Error('TOPIC_APPROVAL_REQUIRED');
  for(const[sourceIndex,source]of card.assetSources.entries()){
   // Press resources are not primary lesson/product material. No account/login interactions or downloads.
   if(source.kind==='press_resources')continue;
   const id=topic.id+'-'+sourceIndex,file=id+'.png';if(existsSync(join(directory,file)))throw Error('CAPTURE_ALREADY_EXISTS');
   const page=await context.newPage();let entry;
   try{
    const response=await page.goto(source.url,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(3000);
    await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,5000))]));
    const url=page.url(),expected=new URL(source.url),actual=new URL(url);
    if(actual.protocol!=='https:'||actual.hostname!==expected.hostname)throw Error('SOURCE_REDIRECT_REVIEW_REQUIRED');
    await page.screenshot({path:join(directory,file),fullPage:false,timeout:15000});
    const content=await page.evaluate(()=>({text:document.body.innerText.slice(0,7000),images:[...document.images].filter(image=>image.width>180&&image.height>100).slice(0,30).map(image=>({src:image.currentSrc,alt:image.alt,width:image.naturalWidth,height:image.naturalHeight,box:(()=>{const r=image.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})()}))}));
    entry={id,topicId:topic.id,sourceUrl:source.url,finalUrl:url,httpStatus:response?.status()??null,title:await page.title(),file,width:1600,height:1000,
     intendedCapture:source.capture,rightsDecision:'research/evals/topics.json#/rights',scope:'internal_eval_only',publicUseCleared:false,review:'pending_visual_selection',...content};
   }catch(error){entry={id,topicId:topic.id,sourceUrl:source.url,status:'capture_failed',error:String(error.message??error)};}
   finally{await page.close();}
   report.assets.push(entry);save();console.log(canonical({id:entry.id,status:entry.status??entry.review,title:entry.title??null}));
  }
 }
}finally{await context.close();rmSync(profile,{recursive:true,force:true});save();}
