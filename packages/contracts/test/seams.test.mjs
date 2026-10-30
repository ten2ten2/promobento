import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {pngPixels,pngRgba,compareSeam} from '../src/seams.mjs';

// Encode independently from the decoder, including all five PNG predictors and both CDP colour types.
function filteredPng(channels,filter){
 const width=3,height=3,source=Uint8Array.from({length:width*height*channels},(_,i)=>(i*73+17)%256),stride=width*channels;
 const raw=Buffer.alloc((stride+1)*height);
 for(let y=0;y<height;y++){
  raw[y*(stride+1)]=filter;
  for(let x=0;x<stride;x++){
   const i=y*stride+x,left=x>=channels?source[i-channels]:0,up=y?source[i-stride]:0,corner=y&&x>=channels?source[i-stride-channels]:0;
   const estimate=left+up-corner,distances=[left,up,corner].map(value=>Math.abs(estimate-value));
   const predictor=[0,left,up,Math.floor((left+up)/2),[left,up,corner][distances.indexOf(Math.min(...distances))]][filter];
   raw[y*(stride+1)+x+1]=(source[i]-predictor+256)%256;
  }
 }
 const template=pngRgba(width,height,new Uint8Array(width*height*4)),header=Buffer.from(template.subarray(16,29));header[9]=channels===4?6:2;
 const chunk=(type,data)=>{const body=Buffer.concat([Buffer.from(type),data]),out=Buffer.alloc(body.length+8);out.writeUInt32BE(data.length);body.copy(out,4);
  let crc=0xffffffff;for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;};
 const expected=channels===4?source:Uint8Array.from(Array.from({length:width*height},(_,i)=>[...source.subarray(i*3,i*3+3),255]).flat());
 return{bytes:Buffer.concat([template.subarray(0,8),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]),expected};
}

test('CDP RGB and RGBA PNGs retain exact pixels with every PNG row predictor',()=>{
 for(const channels of [3,4])for(let filter=0;filter<=4;filter++){
  const{bytes,expected}=filteredPng(channels,filter),decoded=pngPixels(bytes);
  assert.equal(decoded.width,3);assert.equal(decoded.height,3);assert.deepEqual([...decoded.pixels],[...expected]);
  assert.deepEqual(compareSeam(bytes,bytes),{identical:true,maxChannelDiff:0,diffPixelPct:0,verdict:'pass'});
  assert.equal(compareSeam(bytes,filteredPng(channels,(filter+1)%5).bytes).verdict,'pass');
 }
});

test('identical invalid PNGs still fail; seam tolerance and dimensions stay unchanged',()=>{
 const invalid=Buffer.from('not a PNG');assert.throws(()=>compareSeam(invalid,invalid),/SEAM_PNG_INVALID/);
 const badFilter=filteredPng(4,5).bytes;assert.throws(()=>compareSeam(badFilter,badFilter),/SEAM_PNG_UNSUPPORTED/);
 const pixels=new Uint8Array(1000*4).fill(255),base=pngRgba(1000,1,pixels);
 pixels[0]=253;assert.deepEqual(compareSeam(base,pngRgba(1000,1,pixels)),{identical:false,maxChannelDiff:2,diffPixelPct:.1,verdict:'pass_within_tolerance'});
 pixels[0]=252;assert.equal(compareSeam(base,pngRgba(1000,1,pixels)).verdict,'RENDER_SEAM_BLOCK');
 pixels[0]=253;pixels[4]=253;assert.equal(compareSeam(base,pngRgba(1000,1,pixels)).verdict,'RENDER_SEAM_BLOCK');
 assert.throws(()=>compareSeam(base,pngRgba(1,1,new Uint8Array(4))),/SEAM_DIMENSIONS_MISMATCH/);
});
