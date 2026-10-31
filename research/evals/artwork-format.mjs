/** Validate a bounded, already-authorized GIF/AVIF as one still image. */
export function assertStaticArtwork(source,type){
 const b=Buffer.from(source),invalid=()=>{throw Error('ARTWORK_FORMAT_INVALID');},animated=()=>{throw Error('ARTWORK_ANIMATION_UNSUPPORTED');};
 if(type==='image/gif'){
  if(b.length<14||!['GIF87a','GIF89a'].includes(b.toString('ascii',0,6))||!b.readUInt16LE(6)||!b.readUInt16LE(8))return invalid();
  let at=13,frames=0,ended=false;const packed=b[10];if(packed&128)at+=3*(1<<((packed&7)+1));
  const subBlocks=()=>{for(;;){if(at>=b.length)return invalid();const size=b[at++];if(!size)return;if(at+size>b.length)return invalid();at+=size;}};
  while(at<b.length){
   const tag=b[at++];if(tag===0x3b){ended=true;break;}
   if(tag===0x21){if(at>=b.length)return invalid();const label=b[at++];if(label===0x01)return invalid();subBlocks();continue;}
   if(tag!==0x2c||at+9>b.length)return invalid();if(++frames>1)return animated();
   const width=b.readUInt16LE(at+4),height=b.readUInt16LE(at+6),flags=b[at+8];if(!width||!height)return invalid();at+=9;
   if(flags&128)at+=3*(1<<((flags&7)+1));if(at>=b.length)return invalid();const lzw=b[at++];if(lzw<2||lzw>8)return invalid();subBlocks();
  }
  if(!ended||at!==b.length||frames!==1)return invalid();return;
 }
 if(type==='image/avif'){
  if(b.length<16)return invalid();let at=0,ftyp=false,meta=false,data=false;
  while(at<b.length){
   if(at+8>b.length)return invalid();let size=b.readUInt32BE(at),header=8;const kind=b.toString('ascii',at+4,at+8);
   if(size===1){if(at+16>b.length)return invalid();const big=b.readBigUInt64BE(at+8);if(big>BigInt(b.length))return invalid();size=Number(big);header=16;}
   else if(size===0)size=b.length-at;
   if(size<header||at+size>b.length)return invalid();
   if(kind==='ftyp'){
    if(ftyp||size<header+8||(size-header)%4!==0)return invalid();ftyp=true;
    const brands=[b.toString('ascii',at+header,at+header+4)];for(let p=at+header+8;p<at+size;p+=4)brands.push(b.toString('ascii',p,p+4));
    if(brands.includes('avis'))return animated();if(!brands.includes('avif'))return invalid();
   }else if(kind==='moov'||kind==='moof')return animated();
   else if(kind==='meta')meta=true;else if(kind==='mdat')data=true;
   at+=size;
  }
  if(!ftyp||!meta||!data)return invalid();return;
 }
 return invalid();
}
