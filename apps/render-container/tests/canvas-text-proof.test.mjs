import test from 'node:test';
import assert from 'node:assert/strict';
import {pngRgba} from '@promobento/contracts/seams';
import {appendCanvasTextObservations,compareCanvasTextFrame} from '../src/canvas-text-proof.mjs';
import {canvasNumberText} from '@promobento/contracts/canvas-text';

test('Canvas text proof requires the complete actual frame and every bounded ink region',()=>{
 const width=12,height=8,base=new Uint8Array(width*height*4).fill(255),ink=new Uint8Array(base);
 const paint=(data,x,y)=>{const i=(y*width+x)*4;data[i]=10;data[i+1]=20;data[i+2]=30;};
 paint(ink,2,2);paint(ink,6,2);
 const png=bytes=>pngRgba(width,height,bytes),withText=png(ink),withoutText=png(base);
 const boxes=[{x:2,y:2,width:1,height:1},{x:6,y:2,width:1,height:1}],safeInsets={top:0,right:0,bottom:0,left:0};
 const check=(actual,extra={})=>compareCanvasTextFrame({actual,withText,withoutText,boxes,safeInsets,...extra});
 const good=check(withText);assert.deepEqual({...good,contrastRatio:undefined},{verified:true,actualMatches:true,changedPixels:2,insideSafeArea:true,clipped:false,unobservedBoxes:0,contrastRatio:undefined});
 assert.ok(good.contrastRatio>15);
 const partial=new Uint8Array(ink);partial.set(base.slice((2*width+6)*4,(2*width+6)*4+4),(2*width+6)*4);
 assert.equal(check(png(partial)).verified,false);assert.equal(check(withoutText).actualMatches,false);
 const overlay=new Uint8Array(ink);paint(overlay,0,0);assert.equal(check(png(overlay)).verified,false);
 const missing=check(withText,{boxes:[...boxes,{x:9,y:5,width:1,height:1}]});assert.equal(missing.verified,false);assert.equal(missing.unobservedBoxes,1);
 assert.equal(check(withText,{safeInsets:{...safeInsets,left:.2}}).insideSafeArea,false);
 assert.equal(check(withText,{boxes:[{x:-1,y:2,width:4,height:1}]}).clipped,true);
 assert.throws(()=>check(withText,{boxes:[]}),/CANVAS_TEXT_PROOF_INVALID/);
 assert.throws(()=>check(withText,{withoutText:pngRgba(1,1,Uint8Array.from([255,255,255,255]))}),/CANVAS_TEXT_DIMENSIONS_MISMATCH/);
});

test('an original counter observation reports its actual frame value bound to the confirmed final slot',()=>{
 const width=12,height=8,base=new Uint8Array(width*height*4).fill(255),ink=new Uint8Array(base);
 for(const x of [2,6]){const i=(2*width+x)*4;ink[i]=0;ink[i+1]=0;ink[i+2]=0;}
 const png=bytes=>Buffer.from(pngRgba(width,height,bytes)),withText=png(ink),withoutText=png(base),url=bytes=>'data:image/png;base64,'+bytes.toString('base64'),displayed=canvasNumberText('123',0);
 assert.equal(displayed.length,2);
 const plan={target:{width,height,aspect:'landscape',safeInsets:{left:0,right:0,top:0,bottom:0}},fonts:[{fontId:'fixture',weight:600,style:'normal',codePoints:[...Array(10)].map((_,i)=>48+i)}],
  spec:{totalFrames:450,scenes:[{id:'count',kind:'block',block:'canvas-number@1',start:0,end:450,params:{textSlot:'number'}}],texts:{number:{text:'123',role:'number',factIds:['confirmed']}},style:{type:{display:{fontId:'fixture',weight:600}}}}};
 const proof={sceneId:'count',slotId:'number',text:displayed,fontId:'fixture',weight:600,style:'normal',fontSize:40,alpha:1,boxes:[{x:2,y:2,width:1,height:1},{x:6,y:2,width:1,height:1}],withText:url(withText),withoutText:url(withoutText)};
 const {withText:_withText,withoutText:_withoutText,...trace}=proof,fontsByScene=new Map([['count',[{familyName:'Fixture',isCustomFont:true,glyphCount:2}]]]);
 const observation=appendCanvasTextObservations({plan,frame:0,proofs:[proof],traces:[trace],fontsByScene,actual:withText,observation:{texts:[],regions:[],findings:[]}});
 assert.equal(observation.texts[0].text,displayed);assert.notEqual(displayed,plan.spec.texts.number.text);assert.deepEqual(observation.findings,[]);
});

test('only plan-bound, actual-frame Canvas proof can become a readable text observation',()=>{
 const width=12,height=8,base=new Uint8Array(width*height*4).fill(255),ink=new Uint8Array(base);
 for(const x of [2,6]){const i=(2*width+x)*4;ink[i]=0;ink[i+1]=0;ink[i+2]=0;}
 const png=bytes=>Buffer.from(pngRgba(width,height,bytes)),withText=png(ink),withoutText=png(base),url=bytes=>'data:image/png;base64,'+bytes.toString('base64');
 const plan={target:{width,height,aspect:'landscape',safeInsets:{left:0,right:0,top:0,bottom:0}},fonts:[{fontId:'fixture',weight:600,style:'normal',codePoints:[65,66]}],
  spec:{totalFrames:450,scenes:[{id:'title',kind:'block',block:'canvas-title@1',start:0,end:450,params:{textSlot:'headline'}}],texts:{headline:{text:'AB',role:'headline'}},style:{type:{display:{fontId:'fixture',weight:600}}}}};
 const proof={sceneId:'title',slotId:'headline',text:'AB',fontId:'fixture',weight:600,style:'normal',fontSize:40,alpha:1,
  boxes:[{x:2,y:2,width:1,height:1},{x:6,y:2,width:1,height:1}],withText:url(withText),withoutText:url(withoutText)};
 const fontEvidence=new Map([['title',[{familyName:'Fixture',isCustomFont:true,glyphCount:2}]]]);
 const {withText:_withText,withoutText:_withoutText,...trace}=proof;
 const run=(actual=withText,proofs=[proof],current=plan,fontsByScene=fontEvidence,traces=[trace])=>appendCanvasTextObservations({plan:current,frame:45,proofs,traces,fontsByScene,actual,observation:{texts:[],regions:[],findings:[]}});
 const ok=run();assert.equal(ok.texts[0].text,'AB');assert.equal(ok.texts[0].clipped,false);assert.deepEqual(ok.findings,[]);
 const shaped=run(withText,[proof],plan,new Map([['title',[{familyName:'Fixture',isCustomFont:true,glyphCount:1}]]]));
 assert.equal(shaped.texts[0].fonts[0].glyphCount,1,'report CDP glyph count, not character count');
 const covered=run(withoutText);assert.equal(covered.texts[0].covered,true);assert.ok(covered.findings.some(item=>item.code==='text-clipped'&&item.severity==='BLOCK'));
 assert.throws(()=>run(withText,[]),/CANVAS_TEXT_PROOF_MISSING/);
 assert.throws(()=>run(withText,[{...proof,text:'AC'}]),/CANVAS_TEXT_PROOF_INVALID/);
 assert.throws(()=>run(withText,[{...proof,boxes:proof.boxes.slice(0,1)}]),/CANVAS_TEXT_PROOF_INVALID/);
 assert.throws(()=>run(withText,[{...proof,alpha:.5}]),/CANVAS_TEXT_TRACE_MISMATCH/);
 assert.throws(()=>run(withText,[proof],{...plan,fonts:[]}),/FONT_CMAP_UNAVAILABLE/);
 const missing=run(withText,[proof],{...plan,fonts:[{...plan.fonts[0],codePoints:[65]}]});
 assert.ok(missing.findings.some(item=>item.code==='FONT_GLYPH_MISSING'&&item.severity==='BLOCK'));
 const fallback=run(withText,[proof],plan,new Map([['title',[{familyName:'Fallback',isCustomFont:false,glyphCount:2}]]]));
 assert.ok(fallback.findings.some(item=>item.code==='FONT_FALLBACK_USED'&&item.severity==='BLOCK'));
});
