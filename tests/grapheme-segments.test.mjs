import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentText} from '../packages/film-runtime/src/grapheme-segments.ts';

test('segmentation preserves words, combining characters and source whitespace',()=>{
 assert.deepEqual(segmentText('Keep the product\nin the picture.','en','word'),['Keep',' ','the',' ','product','\n','in',' ','the',' ','picture','.']);
 assert.deepEqual(segmentText('A\u0301 B','en','grapheme'),['A\u0301',' ','B']);
 assert.equal(segmentText('日本語を学ぶ','ja','word').join(''),'日本語を学ぶ');
 assert.deepEqual(segmentText('Plain words',undefined,'word'),['Plain',' ','words']);
});
test('earlier custom scenes cannot replace the segmenter or iterator used by trusted text',()=>{
 const original=Intl.Segmenter,segment=original.prototype.segment;
 const sample=segment.call(new original('en',{granularity:'grapheme'}),'a'),partsProto=Object.getPrototypeOf(sample),iterate=partsProto[Symbol.iterator],iteratorProto=Object.getPrototypeOf(iterate.call(sample)),next=iteratorProto.next;
 try{Intl.Segmenter=function(){throw Error('poisoned');};original.prototype.segment=function(){throw Error('poisoned');};partsProto[Symbol.iterator]=()=>{throw Error('poisoned');};iteratorProto.next=()=>{throw Error('poisoned');};
  assert.deepEqual(segmentText('A\u0301 B','en','grapheme'),['A\u0301',' ','B']);}
 finally{Intl.Segmenter=original;original.prototype.segment=segment;partsProto[Symbol.iterator]=iterate;iteratorProto.next=next;}
});
