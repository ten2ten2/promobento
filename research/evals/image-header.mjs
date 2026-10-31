// Bounded image headers for the existing individually authorized local intake.
// Actual visual review and renderer decoding remain required before use.
const fail=()=>{throw Error('MATERIAL_IDENTITY_INVALID');};
const tiffOrientation=bytes=>{
 let b=bytes;if(b.subarray(0,6).toString('binary')==='Exif\0\0')b=b.subarray(6);
 if(b.length<8)return fail();const le=b.subarray(0,2).toString('ascii')==='II';
 if(!le&&b.subarray(0,2).toString('ascii')!=='MM')return fail();
 const u16=n=>{if(n<0||n+2>b.length)return fail();return le?b.readUInt16LE(n):b.readUInt16BE(n);};
 const u32=n=>{if(n<0||n+4>b.length)return fail();return le?b.readUInt32LE(n):b.readUInt32BE(n);};
 if(u16(2)!==42)return fail();const start=u32(4),count=u16(start);if(count>1024||start+2+count*12+4>b.length)return fail();
 for(let i=0;i<count;i++){const pos=start+2+i*12;if(u16(pos)!==0x112)continue;
  if(u16(pos+2)!==3||u32(pos+4)!==1)return fail();const orientation=u16(pos+8);if(orientation<1||orientation>8)return fail();return orientation;
 }
 return 1;
};
const oriented=(width,height,orientation)=>orientation>=5?{width:height,height:width}:{width,height};
export function imageHeader(bytes){
 const b=Buffer.from(bytes);let width,height,orientation=1,exifSeen=false,mediaType,extension;
 const setOrientation=value=>{if(exifSeen&&orientation!==value)return fail();orientation=value;exifSeen=true;};
 if(b.length>=8&&b.subarray(0,8).toString('hex')==='89504e470d0a1a0a'){
  let offset=8,header=false,data=false,ended=false;
  while(offset<b.length){
   if(offset+12>b.length)return fail();const length=b.readUInt32BE(offset),type=b.toString('ascii',offset+4,offset+8),next=offset+12+length;
   if(next>b.length)return fail();
   if(['acTL','fcTL','fdAT'].includes(type))throw Error('ANIMATED_IMAGE_UNSUPPORTED');
   if(!header){if(type!=='IHDR'||length!==13)return fail();header=true;width=b.readUInt32BE(offset+8);height=b.readUInt32BE(offset+12);}
   else if(type==='IHDR')return fail();
   if(type==='IDAT')data=true;
   if(type==='IEND'){if(length!==0||next!==b.length)return fail();ended=true;break;}
   offset=next;
  }
  if(!header||!data||!ended)return fail();mediaType='image/png';extension='png';
 }else if(b.length>=4&&b[0]===255&&b[1]===216){
  mediaType='image/jpeg';extension='jpg';let offset=2,foundScan=false;
  while(offset<b.length){
   if(b[offset++]!==255)return fail();while(b[offset]===255)offset++;if(offset>=b.length)return fail();const marker=b[offset++];
   if(marker===0xda){if(offset+2>b.length)return fail();const length=b.readUInt16BE(offset);if(length<6||offset+length>b.length||b.lastIndexOf(Buffer.from([255,217]))<offset+length)return fail();foundScan=true;break;}if(marker===0xd9)break;
   if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;
   if(offset+2>b.length)return fail();const length=b.readUInt16BE(offset);if(length<2||offset+length>b.length)return fail();
   const start=offset+2,end=offset+length;
   if(marker===0xe1&&b.subarray(start,start+6).toString('binary')==='Exif\0\0')setOrientation(tiffOrientation(b.subarray(start,end)));
   if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
    if(length<8||width!==undefined)return fail();height=b.readUInt16BE(start+1);width=b.readUInt16BE(start+3);
   }
   offset=end;
  }
  if(!foundScan)return fail();
 }else if(b.length>=20&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'){
  mediaType='image/webp';extension='webp';const end=b.readUInt32LE(4)+8;if(end!==b.length)return fail();let imageWidth,imageHeight;
  for(let offset=12;offset<end;){
   if(offset+8>end)return fail();const type=b.toString('ascii',offset,offset+4),length=b.readUInt32LE(offset+4),start=offset+8,next=start+length+(length%2);
   if(next>end)return fail();
   if(type==='ANIM'||type==='ANMF')throw Error('ANIMATED_IMAGE_UNSUPPORTED');
   if(type==='EXIF')setOrientation(tiffOrientation(b.subarray(start,start+length)));
   if(type==='VP8X'){
    if(length<10||b[start]&2)throw Error('ANIMATED_IMAGE_UNSUPPORTED');
    width=1+b.readUIntLE(start+4,3);height=1+b.readUIntLE(start+7,3);
   }else if(type==='VP8 '){
    if(imageWidth!==undefined||length<10||b[start+3]!==0x9d||b[start+4]!==1||b[start+5]!==0x2a)return fail();
    imageWidth=b.readUInt16LE(start+6)&0x3fff;imageHeight=b.readUInt16LE(start+8)&0x3fff;
   }else if(type==='VP8L'){
    if(imageWidth!==undefined||length<5||b[start]!==0x2f)return fail();imageWidth=1+(b[start+1]|(b[start+2]&0x3f)<<8);imageHeight=1+((b[start+2]>>6)|(b[start+3]<<2)|((b[start+4]&15)<<10));
   }
   offset=next;
  }
  if(!imageWidth||!imageHeight||width!==undefined&&(width!==imageWidth||height!==imageHeight))return fail();
  width??=imageWidth;height??=imageHeight;
 }else return fail();
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)return fail();
 return{mediaType,extension,...oriented(width,height,orientation)};
}
