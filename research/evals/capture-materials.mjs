// Public, logged-out source capture for the six owner-approved internal topics. No model calls or Docker.
import {chromium} from 'playwright-core';
import {readFileSync,lstatSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {observeProduct,mergeProductObservations} from './product-observation.mjs';
import {capturePageOptions,capturePageScreens} from './capture-page.mjs';
import {evaluationChromeExecutable} from './chrome.mjs';
import {privateWritableDirectory,writePrivateFile} from './private-path.mjs';

const root=new URL('../../',import.meta.url),topics=parseCanonicalJson(readFileSync(new URL('topics.json',import.meta.url)));
const selected=process.argv[3],{grab:enhanced,maxShots}=capturePageOptions(process.argv.slice(4)),directory=privateWritableDirectory(process.argv[2]??'artifacts/eval-materials-2026-10-24');
if(enhanced&&!selected)throw Error('EVAL_TOPIC_INVALID');
if(selected&&!topics.topics.some(topic=>topic.id===selected&&topic.countsTowardGate!==false))throw Error('EVAL_TOPIC_INVALID');
if(topics.rights.scope!=='internal_eval_only'||topics.factConfirmation.confirmedBy!=='owner')throw Error('INTERNAL_SOURCE_APPROVAL_REQUIRED');
mkdirSync(directory,{recursive:true});
const reportPath=join(directory,selected?`capture-${selected}.json`:'capture.json');
if(lstatSync(reportPath,{throwIfNoEntry:false}))throw Error('CAPTURE_REPORT_ALREADY_EXISTS');
const profile=mkdtempSync(join(tmpdir(),'promobento-public-capture-'));
let context;
const report={scope:'private_internal_eval_source_capture_not_public_license',browser:null,capturedAt:new Date().toISOString(),assets:[]};
const save=()=>writePrivateFile(reportPath,canonical(report)+'\n');
try{
 context=await chromium.launchPersistentContext(profile,{executablePath:evaluationChromeExecutable,
  headless:true,...(enhanced?{chromiumSandbox:true}:{}),...(selected==='ielts-ready'?{args:['--disable-http2']}:{}),viewport:{width:1600,height:1000},deviceScaleFactor:1,locale:'en-US',timezoneId:'UTC',acceptDownloads:false});
 report.browser=context.browser().version();
 for(const topic of topics.topics.filter(topic=>topic.countsTowardGate!==false&&(!selected||topic.id===selected))){
  const card=parseCanonicalJson(readFileSync(new URL(topic.factCard,root)));
  if(card.status!=='confirmed_for_s1_eval'||card.confirmation.confirmedBy!=='owner'||card.rights.scope!=='internal_eval_only'||card.rights.publicUseCleared!==false)throw Error('TOPIC_APPROVAL_REQUIRED');
  if(card.materialLicenseReview?.status==='permission_required'){
   report.assets.push({id:topic.id+'-rights',topicId:topic.id,status:'license_pending',sourceUrl:card.materialLicenseReview.termsUrl,error:'MATERIAL_SOURCE_PERMISSION_REQUIRED'});
   save();console.log(canonical({topicId:topic.id,status:'license_pending'}));continue;
  }
  for(const[sourceIndex,source]of card.assetSources.entries()){
   // Press resources are not primary lesson/product material. No account/login interactions or downloads.
   if(source.kind==='press_resources')continue;
   const id=topic.id+'-'+sourceIndex,file=id+'.png';if(lstatSync(join(directory,file),{throwIfNoEntry:false}))throw Error('CAPTURE_ALREADY_EXISTS');
   const page=await context.newPage();let entry;
   try{
    const response=await page.goto(source.url,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(3000);
    await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,5000))]));
    const url=page.url(),expected=new URL(source.url),actual=new URL(url);
    if(actual.protocol!=='https:'||actual.hostname!==expected.hostname)throw Error('SOURCE_REDIRECT_REVIEW_REQUIRED');
    writePrivateFile(join(directory,file),await page.screenshot({type:'png',fullPage:false,timeout:15000}),{exclusive:true});
    let content=enhanced?await observeProduct(page):await page.evaluate(()=>({text:document.body.innerText.slice(0,7000),images:[...document.images].filter(image=>image.width>180&&image.height>100).slice(0,30).map(image=>({src:image.currentSrc,alt:image.alt,width:image.naturalWidth,height:image.naturalHeight,box:(()=>{const r=image.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})()}))}));
    let screenshots=[{file,y:0}],missingBelow=false;
    if(enhanced){
     // No automatic asset downloads: observed URLs and screenshots are candidates only.
     const observations=[{...content,viewY:0}];
     const captures=await capturePageScreens(page,{maxShots,firstFile:file,async save(index,y){
      const next=id+'-'+String(index+1).padStart(2,'0')+'.png';if(lstatSync(join(directory,next),{throwIfNoEntry:false}))throw Error('CAPTURE_ALREADY_EXISTS');
      writePrivateFile(join(directory,next),await page.screenshot({type:'png',fullPage:false,timeout:15000}),{exclusive:true});observations.push({...await observeProduct(page),viewY:y});return next;
     }});screenshots=captures.screenshots;missingBelow=captures.missingBelow;
     await page.evaluate(()=>window.scrollTo(0,0));observations.push({...await observeProduct(page),viewY:0});content=mergeProductObservations(observations);
    }
    entry={id,topicId:topic.id,sourceUrl:source.url,finalUrl:url,httpStatus:response?.status()??null,title:await page.title(),file,width:1600,height:1000,
     intendedCapture:source.capture,rightsDecision:'research/evals/topics.json#/rights',scope:'internal_eval_only',publicUseCleared:false,review:'pending_visual_selection',...(enhanced?{screenshots,observationScope:'page_metadata_not_asset_permission',missing:[...(missingBelow?['page continues below the last captured viewport']:[]),...(content.candidateCapExceeded?['more than 200 candidates for at least one media category']:[]),...(content.cssVariablesTruncated?['CSS variable observation limit reached']:[]),...(content.cssRulesUnavailable?['some stylesheet rules are unavailable']:[]),...(content.cookieNoticeVisible?['cookie notice may cover part of screenshots']:[])]}:{}),...content};
   }catch(error){entry={id,topicId:topic.id,sourceUrl:source.url,status:'capture_failed',error:String(error.message??error)};}
   finally{await page.close();}
   report.assets.push(entry);save();console.log(canonical({id:entry.id,status:entry.status??entry.review,title:entry.title??null}));
  }
 }
}finally{try{await context?.close();}finally{rmSync(profile,{recursive:true,force:true});save();}}
