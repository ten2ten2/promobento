import test from 'node:test';
import assert from 'node:assert/strict';
import {capturePageOptions,capturePageScreens} from '../research/evals/capture-page.mjs';

test('page capture defaults to eight screens and accepts only a bounded explicit limit',()=>{
 assert.deepEqual(capturePageOptions([]),{grab:false,maxShots:1});
 assert.deepEqual(capturePageOptions(['--grab']),{grab:true,maxShots:8});
 assert.deepEqual(capturePageOptions(['--grab','--shots','24']),{grab:true,maxShots:24});
 for(const args of [['--shots','3'],['--grab','--shots','0'],['--grab','--shots','41'],['--grab','--shots','2','extra'],['--grab','--shots','01']])assert.throws(()=>capturePageOptions(args),/CAPTURE_MODE_INVALID/);
});
test('page capture notices lazy growth, keeps real scroll offsets, and reports an unfinished page',async()=>{
 let height=1300,scroll=0;const page={async evaluate(_fn,value){if(value===undefined)return{height,y:scroll};scroll=Math.min(value,height-1000);},async waitForTimeout(){if(height===1300)height=2500;}};
 const save=async index=>'page-'+index+'.png';
 const expanded=await capturePageScreens(page,{maxShots:4,firstFile:'first.png',save});
 assert.deepEqual(expanded.screenshots,[{file:'first.png',y:0},{file:'page-1.png',y:300},{file:'page-2.png',y:1300},{file:'page-3.png',y:1500}]);assert.equal(expanded.missingBelow,false);
 height=9000;const limited=await capturePageScreens(page,{maxShots:2,firstFile:'first.png',save});assert.equal(limited.missingBelow,true);assert.equal(limited.screenshots.at(-1).y,1000);
});

test('candidate observations keep lazy-loaded media from earlier viewports and report truncation',async()=>{
 const {mergeProductObservations}=await import('../research/evals/product-observation.mjs');
 const base={text:'top',images:[{src:'https://example.test/a.png'}],logos:[],videos:[],vectors:[{selector:'html > body > svg:nth-of-type(1)',label:'first'}],icons:[{src:'https://example.test/icon.svg'}],pageHeight:1000,colours:[],fonts:[],cssVariables:[{selector:':root',name:'--ink',value:'#000',conditions:[]}],cookieNoticeVisible:false,viewY:0};
 const next={...base,images:[{src:'https://example.test/a.png'},{src:'https://example.test/b.png'}],videos:[{src:'https://example.test/demo.mp4'}],vectors:[...base.vectors,{selector:'html > body > svg:nth-of-type(2)',label:'second'}],icons:[...base.icons,{src:'https://example.test/next.png'}],cssVariables:[...base.cssVariables,{selector:':root',name:'--accent',value:'#f00',conditions:['screen']}],cssRulesUnavailable:true,pageHeight:2000,cookieNoticeVisible:true,viewY:1000};
 const result=mergeProductObservations([base,next]);assert.deepEqual(result.images.map(item=>[item.src,item.observedAtY]),[['https://example.test/a.png',0],['https://example.test/b.png',1000]]);
 assert.equal(result.videos[0].observedAtY,1000);assert.deepEqual(result.vectors.map(item=>item.observedAtY),[0,1000]);assert.deepEqual(result.icons.map(item=>item.observedAtY),[0,1000]);assert.deepEqual(result.cssVariables.map(item=>item.name),['--ink','--accent']);assert.equal(result.cssRulesUnavailable,true);assert.equal(result.cookieNoticeVisible,true);assert.equal(result.pageHeight,2000);assert.equal(result.candidateCapExceeded,false);
 const crowded={...base,images:Array.from({length:201},(_,i)=>({src:'https://example.test/'+i+'.png'}))};
 assert.equal(mergeProductObservations([crowded]).images.length,200);assert.equal(mergeProductObservations([crowded]).candidateCapExceeded,true);
});
