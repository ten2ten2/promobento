import test from 'node:test';
import assert from 'node:assert/strict';
import {observe} from '../src/observe.mjs';

function observation(size,weight,background){
  const strings=[],s=value=>{let index=strings.indexOf(value);if(index<0){index=strings.length;strings.push(value);}return index;};
  const snapshot={strings,documents:[{nodes:{parentIndex:[-1,0,1],nodeType:[1,1,3],nodeValue:[s(''),s(''),s('Text')],
    backendNodeId:[100,101,102],attributes:[[],[s('data-pb-slot'),s('label')],[]]},
    layout:{nodeIndex:[0,1],bounds:[[0,0,1920,1080],[50,50,100,40]],styles:[]}}]};
  const cdp={async send(method,input){
    if(method==='DOMSnapshot.captureSnapshot'){
      const values={'font-size':size+'px','font-weight':String(weight),'font-family':'\"PB-test\"','font-style':'normal',color:'rgb(255, 255, 255)',
        'background-color':'rgba(0, 0, 0, 0)',visibility:'visible',display:'block',opacity:'1',overflow:'visible'};
      snapshot.documents[0].layout.styles=[input.computedStyles.map(name=>s(name==='background-color'?background:values[name])),input.computedStyles.map(name=>s(values[name]))];
      return snapshot;
    }
    if(method==='DOM.pushNodesByBackendIdsToFrontend')return{nodeIds:[1]};
    if(method==='CSS.getPlatformFontsForNode')return{fonts:[{familyName:'Test',isCustomFont:true,glyphCount:4}]};
    if(method==='DOM.getNodeForLocation')return{backendNodeId:101};
    return{};
  }};
  const face={fontId:'test',weight:600,style:'normal'},plan={target:{aspect:'landscape',width:1920,height:1080,safeInsets:{top:0,bottom:0,left:0,right:0}},
    fonts:[{...face,codePoints:[...'Text'].map(c=>c.codePointAt(0))}],spec:{scenes:[],texts:{label:{role:'body'}},style:{type:{text:face}}}};
  return observe(cdp,plan,'render-test',45);
}

test('CDP font size and weight select the original 3:1 large / 4.5:1 ordinary contrast gates without rounding',async()=>{
  for(const[size,weight,background,large,blocked]of[
    [24,600,'rgb(47, 140, 255)',true,false], // Actual MiniMax failure: 3.3248:1, large body-role text.
    [23.99,600,'rgb(47, 140, 255)',false,true],
    [19,700,'rgb(47, 140, 255)',true,false],
    [19,600,'rgb(47, 140, 255)',false,true],
    [32,600,'rgb(170, 170, 170)',true,true],
    [16,600,'rgb(119, 119, 119)',false,true], // 4.478:1 must not round up to 4.5.
    [16,600,'rgb(118, 118, 118)',false,false]
  ]){
    const result=await observation(size,weight,background);
    assert.equal(result.texts[0].largeText,large);
    assert.equal(result.findings.some(f=>f.code==='low-contrast'),blocked);
    assert.ok(result.findings.every(f=>f.code==='low-contrast'));
  }
});

async function nestedTextObservation({opacity='1',transparent=false,outside=false,clippedByChild=false,missingLayout=false,nestedFallback=false,nestedMissingFont=false,nestedColor,nestedFamily,grapheme=false,missingFontNode=false}={}){
 const strings=[],s=value=>{let i=strings.indexOf(value);if(i<0){i=strings.length;strings.push(value);}return i;};
 const nodes={parentIndex:[-1,0,1,1,3],nodeType:[1,1,3,1,3],nodeValue:['','','Te','','xt'].map(s),backendNodeId:[100,101,102,103,104],
  attributes:[grapheme?[s('data-scene'),s('product')]:[],[s('data-pb-slot'),s('label')],[],[],[]]};
 const layout={nodeIndex:missingLayout?[0,1,3]:[0,1,3,4],bounds:[[0,0,1920,1080],[50,50,100,40],[90,50,clippedByChild?5:30,40],
  ...(missingLayout?[]:[[outside?2000:90,50,30,40]])],styles:[]};
 const cdp={async send(method,input){
  if(method==='DOMSnapshot.captureSnapshot'){
   const styles={'font-size':'36px','font-weight':'600','font-family':'\"PB-test\"','font-style':'normal',color:'rgb(0, 0, 0)','background-color':'rgb(255, 255, 255)',visibility:'visible',display:'block',opacity:'1',overflow:'visible'};
   layout.styles=layout.nodeIndex.map(node=>input.computedStyles.map(name=>s(node===3&&name==='opacity'?opacity:node===3&&name==='color'&&transparent?'rgba(0, 0, 0, 0)':node===3&&name==='color'&&nestedColor?nestedColor:node===3&&name==='font-family'&&nestedFamily?nestedFamily:node===3&&name==='overflow'&&clippedByChild?'hidden':styles[name])));
   return{strings,documents:[{nodes,layout}]};
  }
  if(method==='DOM.pushNodesByBackendIdsToFrontend')return{nodeIds:missingFontNode?[input.backendNodeIds[0],0]:input.backendNodeIds};
  if(method==='CSS.getPlatformFontsForNode')return{fonts:input.nodeId===103&&nestedMissingFont?[]:[{familyName:input.nodeId===103&&nestedFallback?'Fallback':'Test',isCustomFont:!(input.nodeId===103&&nestedFallback),glyphCount:4}]};
  if(method==='DOM.getNodeForLocation')return{backendNodeId:101};return{};
 }};
 const face={fontId:'test',weight:600,style:'normal'},plan={target:{aspect:'landscape',width:1920,height:1080,safeInsets:{top:0,bottom:0,left:0,right:0}},
  fonts:[{...face,codePoints:[...'Text'].map(ch=>ch.codePointAt(0))}],spec:{scenes:grapheme?[{id:'product',kind:'custom',start:0,end:450,runtimeText:'grapheme-v1'}]:[],texts:{label:{role:'body',text:'Text'}},style:{type:{text:face}}}};
 return observe(cdp,plan,'render-test',45);
}

test('a nested glyph that is transparent, clipped or translated out of frame cannot pass as visible slot text',async()=>{
 const visible=await nestedTextObservation();assert.equal(visible.texts[0].text,'Text');assert.equal(visible.texts[0].clipped,false);
 for(const options of [{opacity:'0'},{transparent:true},{outside:true},{clippedByChild:true},{missingLayout:true}]){
  const result=await nestedTextObservation(options);assert.equal(result.texts[0].clipped,true,JSON.stringify(options));
  assert.ok(result.findings.some(f=>f.code==='text-clipped'&&f.severity==='BLOCK'));
 }
 const boundsFailure=await nestedTextObservation({clippedByChild:true});assert.match(boundsFailure.findings.find(f=>f.code==='text-clipped').detail,/Nested text.*clipping ancestor/);
 for(const options of [{nestedFallback:true},{nestedMissingFont:true}]){
  const result=await nestedTextObservation(options);assert.equal(result.texts[0].fallbackUsed,true);assert.ok(result.findings.some(f=>f.code==='FONT_FALLBACK_USED'));
 }
 assert.equal((await nestedTextObservation({opacity:'.5'})).texts[0].clipped,false);
 assert.equal((await nestedTextObservation({opacity:'.5',grapheme:true})).texts[0].clipped,true);
 await assert.rejects(nestedTextObservation({missingFontNode:true}),/FONT_OBSERVATION_UNAVAILABLE/);
 const wrongFace=await nestedTextObservation({grapheme:true,nestedFamily:'\"PB-other\"'});assert.equal(wrongFace.texts[0].fallbackUsed,false);assert.ok(wrongFace.findings.some(f=>f.code==='FONT_FACE_MISMATCH'));
 const lowContrast=await nestedTextObservation({nestedColor:'rgb(220, 220, 220)'});assert.ok(lowContrast.findings.some(f=>f.code==='low-contrast'));
});

async function imageObservation({opacity='1',hit=103,mask='none',sceneId='product',frame=45,observeAssets=true,overlayOpacity='0',anotherOpacity='0',overlayBackground='rgba(0, 0, 0, 0)',overlayShadow='none',overlayImage='none',overlayBorder='none',overlayTag='DIV',overlayPseudo=false,quads=true}={}){
 const strings=[],s=value=>{let index=strings.indexOf(value);if(index<0){index=strings.length;strings.push(value);}return index;};
 const nodes={parentIndex:[-1,0,1,2,1,1],nodeType:[1,1,1,1,1,1],nodeName:['HTML','SECTION','DIV','IMG',overlayTag,'DIV'].map(s),...(overlayPseudo?{pseudoType:{index:[4],value:[s('before')]}}:{}),
  nodeValue:[s(''),s(''),s(''),s(''),s(''),s('')],backendNodeId:[100,101,102,103,104,105],
  attributes:[[],[s('data-scene'),s(sceneId)],[],[s('src'),s('/r/res_fixture_dashboard')],[],[]]};
 const layout={nodeIndex:[0,1,2,3,4,5],bounds:[[0,0,1920,1080],[0,0,1920,1080],[0,0,800,800],[100,100,300,400],[100,100,300,400],[100,100,300,400]],paintOrders:[0,1,2,3,5,4],styles:[]};
 const cdp={async send(method,input){
  if(method==='DOMSnapshot.captureSnapshot'){
   const styles={'font-size':'36px','font-weight':'600',color:'rgb(0, 0, 0)','background-color':'rgb(255, 255, 255)',
    visibility:'visible',display:'block',opacity:'1',overflow:'visible','mask-image':'none',filter:'none','pointer-events':'auto',
    'background-image':'none','box-shadow':'none','outline-style':'none','border-top-style':'none','border-right-style':'none',
    'border-bottom-style':'none','border-left-style':'none','border-image-source':'none','backdrop-filter':'none'};
   layout.styles=layout.nodeIndex.map(node=>node===0?[]:input.computedStyles.map(name=>s(node===2&&name==='opacity'?opacity:node===2&&name==='mask-image'?mask:
    node===4&&name==='opacity'?overlayOpacity:node===5&&name==='opacity'?anotherOpacity:node===4&&name==='background-color'?overlayBackground:
    node===4&&name==='box-shadow'?overlayShadow:node===4&&name==='background-image'?overlayImage:node===4&&name==='border-top-style'?overlayBorder:
    (node===4||node===5)&&name==='pointer-events'?'none':styles[name])));
   return{strings,documents:[{nodes,layout}]};
  }
  if(method==='DOM.getNodeForLocation')return{backendNodeId:typeof hit==='function'?hit(input):hit};
  if(method==='DOM.getContentQuads')return{quads:quads?[[100,100,400,100,400,500,100,500]]:[]};
  return{};
 }};
 const plan={observeAssets,target:{aspect:'landscape',width:1920,height:1080,safeInsets:{top:0,bottom:0,left:0,right:0}},fonts:[],
  assets:{dashboard:{resourceId:'res_fixture_dashboard'}},spec:{scenes:[{id:'product',kind:'custom',start:0,end:450,params:{assetChecks:[{frame:45,assetKeys:['dashboard']}]}}],texts:{},style:{type:{}}}};
 return observe(cdp,plan,'render-test',frame);
}

test('asset observations use actual scene-scoped DOM state and do not turn an occluded image into a pass',async()=>{
 const visible=await imageObservation();assert.deepEqual(visible.assets,[{sceneId:'product',resourceId:'res_fixture_dashboard',visibility:'visible'}]);
 const hidden=await imageObservation({opacity:'0'});assert.equal(hidden.assets[0].visibility,'hidden');
 const covered=await imageObservation({hit:102});assert.equal(covered.assets[0].visibility,'unverified');
 const decorative=await imageObservation({hit:input=>input.ignorePointerEventsNone?104:103});assert.equal(decorative.assets[0].visibility,'visible');
 const transparent=await imageObservation({overlayOpacity:'1',hit:input=>input.ignorePointerEventsNone?104:103});assert.equal(transparent.assets[0].visibility,'visible');
 for(const overlay of [{overlayBackground:'rgb(0, 0, 0)'},{overlayShadow:'rgb(0, 0, 0) 0px 0px 8px 2px'},
  {overlayImage:'linear-gradient(rgb(0, 0, 0), rgb(0, 0, 0))'},{overlayBorder:'solid'},{overlayTag:'CANVAS'},{overlayPseudo:true}]){
  const actual=await imageObservation({...overlay,overlayOpacity:'1',hit:input=>input.ignorePointerEventsNone?104:103});assert.equal(actual.assets[0].visibility,'unverified');
 }
 const opaque=await imageObservation({hit:input=>input.ignorePointerEventsNone?104:103,anotherOpacity:'1'});assert.equal(opaque.assets[0].visibility,'unverified');
 // Both hit tests can land on an opacity-zero sibling. Geometry plus paint order can
 // prove the image underneath only when no painted node can cover the sampled point.
 assert.equal((await imageObservation({hit:104})).assets[0].visibility,'visible');
 assert.equal((await imageObservation({hit:104,anotherOpacity:'1'})).assets[0].visibility,'unverified');
 assert.equal((await imageObservation({hit:104,quads:false})).assets[0].visibility,'unverified');
 const passiveImage=await imageObservation({hit:input=>input.ignorePointerEventsNone?103:102});assert.equal(passiveImage.assets[0].visibility,'visible');
 const masked=await imageObservation({mask:'url(#mask)'});assert.equal(masked.assets[0].visibility,'unverified');
 assert.deepEqual((await imageObservation({sceneId:'other'})).assets,[]);
 assert.deepEqual((await imageObservation({frame:44})).assets,[]);
 assert.equal((await imageObservation({observeAssets:false})).assets,undefined);
});
