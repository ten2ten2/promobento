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
      const values={'font-size':size+'px','font-weight':String(weight),color:'rgb(255, 255, 255)',
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
