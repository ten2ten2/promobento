import test from 'node:test';import assert from 'node:assert/strict';
import {findWord,prepare} from '../src/clip/cues.js';
const words=[{word:'先',start:.2,end:.4},{word:'看',start:.4,end:.6},{word:'缓',start:.6,end:.8},{word:'存命',start:.8,end:1.2},{word:'中',start:1.2,end:1.4},{word:'再看',start:1.6,end:2},{word:'缓存',start:2.5,end:2.9},{word:'3000',start:3.2,end:3.8}];
const spec=()=>({grammar:'y5_kinetic_type',duration:6,cues:[{at:0,kind:'title',text:'T'},{at:1,kind:'point',text:'A',word:'缓存'},{at:2,kind:'point',text:'B',word:'缓存',nth:2,offset:-.1},{at:3,kind:'react',word:'3000',edge:'end',offset:.5},{at:4,kind:'insert',data:{hit:4.5,hitWord:'3000'}}]});
test('clip timing anchors split words, nth occurrences and end times while preserving input',()=>{
 assert.equal(findWord(words,'缓存'),.6);assert.equal(findWord(words,'缓存',2),2.5);assert.equal(findWord(words,'缓存',1,'end'),1.2);assert.equal(findWord(words,'再 看'),1.6);assert.equal(findWord(words,'missing'),null);
 const input=spec(),result=prepare(input,{pace:2,words,voiceEnd:15});assert.deepEqual(result.spec.cues.map(q=>+q.at.toFixed(3)),[0,.6,2.4,4.3,8]);assert.equal(result.spec.cues[4].data.hit,3.2);assert.equal(result.duration,15.5);assert.equal(result.anchored.length,3);assert.deepEqual(input,spec());
 const unvoiced=prepare(input,{pace:1.5});assert.deepEqual(unvoiced.spec.cues.map(q=>q.at),[0,1.5,3,4.5,6]);assert.equal(unvoiced.spec.cues[4].data.hit,6.75);
});
test('clip timing preserves surrogate-pair boundaries and reports unresolved narration',()=>{
 const split=[{word:'🎬开',start:.1,end:.4},{word:'始',start:.4,end:.6},{word:'🙂',start:1,end:1.2},{word:'🎬',start:2,end:2.2}];
 assert.equal(findWord(split,'🎬开始'),.1);assert.equal(findWord(split,'🎬',2),2);assert.equal(findWord(split,'🙂',1,'end'),1.2);
 const input=spec();input.cues[1].word='不存在';const result=prepare(input,{words,voiceEnd:5});assert.equal(result.spec.cues[1].at,1);assert.match(result.problems[0],/不存在/);
 const resolved=prepare(spec(),{words,cue:term=>{if(term==='3000')return 9.9;throw Error('missing');}});assert.equal(resolved.spec.cues[3].at,10.4);assert.equal(resolved.spec.cues[1].at,.6);
});
