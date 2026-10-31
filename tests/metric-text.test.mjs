import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMetricText,metricTextAt} from '../packages/film-runtime/src/metric-text.ts';

test('metric display keeps the existing cubic count and exact settled text',()=>{
 for(const text of ['30 fps','-12,5%','+1.25','0']){
  const metric=parseMetricText(text),match=/^(\D*?)([-+]?\d+(?:[.,]\d+)?)(\D*)$/.exec(text);
  for(const time of [0,.2,.6,1.19,1.2,4]){
   const p=1-(1-Math.max(0,Math.min(1,time/1.2)))**3,decimals=match[2].split(/[.,]/)[1]?.length??0;
   const expected=p===1?text:match[1]+(Number(match[2].replace(',','.'))*p).toFixed(decimals).replace('.',match[2].includes(',')?',':'.')+match[3];
   assert.equal(metricTextAt(metric,time).text,expected);
  }
 }
 assert.throws(()=>parseMetricText('not a number'),/METRIC_NUMBER_INVALID/);
 const long='1.'+'1'.repeat(101);assert.equal(metricTextAt(parseMetricText(long),2).text,long);
});


test('a custom scene cannot change the trusted metric arithmetic through shared prototypes',()=>{
 const metric=parseMetricText('30 fps'),expected=metricTextAt(metric,.6).text;
 const fixed=Number.prototype.toFixed,originalMax=Math.max,originalReplace=String.prototype.replace;
 try{Number.prototype.toFixed=()=>"999";Math.max=()=>1;String.prototype.replace=()=>"999";assert.equal(metricTextAt(metric,.6).text,expected);assert.equal(parseMetricText('30 fps').number,30);}
 finally{Number.prototype.toFixed=fixed;Math.max=originalMax;String.prototype.replace=originalReplace;}
});
