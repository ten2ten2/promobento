import test from 'node:test';
import assert from 'node:assert/strict';
import {imageHeader} from './image-header.mjs';
import {pngRgba} from '@promobento/contracts/seams';

// Original synthetic 2×3 RGB fixtures, encoded once as JPEG and WebP.
export const jpeg=Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAL/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCAA5IH/9k=','base64');
export const webp=Buffer.from('UklGRjoAAABXRUJQVlA4IC4AAADQAQCdASoCAAMAAUAmJaACdLoB+AADsAD+rhf/NgVzXPv9/+8+fufP3Pn/CAAA','base64');

test('bounded image headers identify the actual PNG, JPEG and WebP dimensions and EXIF orientation',()=>{
 const png=pngRgba(2,3,new Uint8Array(2*3*4));
 assert.deepEqual(imageHeader(png),{mediaType:'image/png',extension:'png',width:2,height:3});
 assert.throws(()=>imageHeader(png.subarray(0,24)),/MATERIAL_IDENTITY_INVALID/);
 const actl=Buffer.alloc(20);actl.writeUInt32BE(8,0);actl.write('acTL',4);actl.writeUInt32BE(2,8);
 const animatedPng=Buffer.concat([png.subarray(0,33),actl,png.subarray(33)]);assert.throws(()=>imageHeader(animatedPng),/ANIMATED_IMAGE_UNSUPPORTED/);
 const broken=Buffer.from(png);broken.writeUInt32BE(0x7fffffff,33);assert.throws(()=>imageHeader(broken),/MATERIAL_IDENTITY_INVALID/);
 assert.deepEqual(imageHeader(jpeg),{mediaType:'image/jpeg',extension:'jpg',width:2,height:3});
 assert.deepEqual(imageHeader(webp),{mediaType:'image/webp',extension:'webp',width:2,height:3});
 const tiff=Buffer.alloc(26);tiff.write('II');tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);tiff.writeUInt16LE(1,8);
 tiff.writeUInt16LE(0x112,10);tiff.writeUInt16LE(3,12);tiff.writeUInt32LE(1,14);tiff.writeUInt16LE(6,18);
 const payload=Buffer.concat([Buffer.from('Exif\0\0'),tiff]),segment=Buffer.alloc(4);segment[0]=255;segment[1]=0xe1;segment.writeUInt16BE(payload.length+2,2);
 const rotated=Buffer.concat([jpeg.subarray(0,2),segment,payload,jpeg.subarray(2)]);
 assert.deepEqual(imageHeader(rotated),{mediaType:'image/jpeg',extension:'jpg',width:3,height:2});
 assert.throws(()=>imageHeader(jpeg.subarray(0,100)),/MATERIAL_IDENTITY_INVALID/);
 assert.throws(()=>imageHeader(jpeg.subarray(0,jpeg.length-2)),/MATERIAL_IDENTITY_INVALID/);
 assert.throws(()=>imageHeader(webp.subarray(0,20)),/MATERIAL_IDENTITY_INVALID/);
 const extended=Buffer.alloc(30);extended.write('RIFF',0);extended.writeUInt32LE(22,4);extended.write('WEBPVP8X',8);extended.writeUInt32LE(10,16);
 assert.throws(()=>imageHeader(extended),/MATERIAL_IDENTITY_INVALID/);
 const animated=Buffer.from(webp);animated.write('ANIM',12);assert.throws(()=>imageHeader(animated),/ANIMATED_IMAGE_UNSUPPORTED/);
});
