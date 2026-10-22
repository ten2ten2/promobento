import {inflateSync} from 'node:zlib';

/** Bounded WOFF 1 decoding for registered, licensed bytes. Only metrics tables
 * are inflated: large CJK outlines remain the pinned browser's responsibility. */
export function woffCommandMetrics(bytes) {
  const fail=()=>{throw Error('FONT_WOFF_INVALID');};
  if(!Buffer.isBuffer(bytes)||bytes.length<44||bytes.length>8*1024*1024||bytes.toString('ascii',0,4)!=='wOFF'||bytes.readUInt32BE(8)!==bytes.length)fail();
  const tables=new Map(),count=bytes.readUInt16BE(12),wanted=new Set(['head','hhea','hmtx','cmap','fvar']);
  if(count<1||count>64||44+count*20>bytes.length)fail();
  for(let i=0;i<count;i++) {
    const at=44+i*20,tag=bytes.toString('ascii',at,at+4),offset=bytes.readUInt32BE(at+4),length=bytes.readUInt32BE(at+8),original=bytes.readUInt32BE(at+12);
    if(offset+length>bytes.length||length>original||original>16*1024*1024)fail();
    if(!wanted.has(tag))continue;
    const data=length===original?bytes.subarray(offset,offset+length):inflateSync(bytes.subarray(offset,offset+length),{maxOutputLength:original});
    if(data.length!==original||tables.has(tag))fail();tables.set(tag,data);
  }
  const head=tables.get('head'),hhea=tables.get('hhea'),hmtx=tables.get('hmtx'),cmap=tables.get('cmap');
  if(!head||head.length<20||!hhea||hhea.length<36||!hmtx||!cmap||cmap.length<4)throw Error('FONT_METRICS_MISSING');
  const unitsPerEm=head.readUInt16BE(18),metricCount=hhea.readUInt16BE(34),glyphs={},coveragePoints=new Set();
  if(!unitsPerEm||!metricCount||metricCount*4>hmtx.length)fail();
  const save=(cp,glyph)=>{
    if(!glyph)return;coveragePoints.add(cp);
    // Latin + CJK punctuation/ideographs/fullwidth forms. Combining marks, RTL,
    // kana/hangul shaping and emoji require a separate shaping contract.
    if((cp>=32&&cp<=126)||(cp>=160&&cp<=255)||(cp>=0x3000&&cp<=0x303f)
      ||(cp>=0x4e00&&cp<=0x9fff)||(cp>=0xff01&&cp<=0xff5e))glyphs[cp]=hmtx.readUInt16BE(Math.min(glyph,metricCount-1)*4);
  };
  const tableCount=cmap.readUInt16BE(2);
  if(tableCount>32||4+tableCount*8>cmap.length)fail();
  for(let i=0;i<tableCount;i++) {
    const record=4+i*8,platform=cmap.readUInt16BE(record),encoding=cmap.readUInt16BE(record+2),start=cmap.readUInt32BE(record+4);
    if(platform!==0&&!(platform===3&&[1,10].includes(encoding)))continue;
    if(start+4>cmap.length)fail();const format=cmap.readUInt16BE(start);
    if(format===4) {
      if(start+16>cmap.length)fail();
      const length=cmap.readUInt16BE(start+2),segments=cmap.readUInt16BE(start+6)/2,ends=start+14,starts=ends+segments*2+2,deltas=starts+segments*2,offsets=deltas+segments*2;
      if(!Number.isInteger(segments)||segments<1||start+length>cmap.length||16+segments*8>length)fail();
      for(let segment=0;segment<segments;segment++) {
        const first=cmap.readUInt16BE(starts+segment*2),last=cmap.readUInt16BE(ends+segment*2),delta=cmap.readInt16BE(deltas+segment*2),range=cmap.readUInt16BE(offsets+segment*2);
        if(first>last)fail();
        for(let cp=first;cp<=last&&cp<0xffff;cp++) {
          const address=offsets+segment*2+range+(cp-first)*2;if(range&&address+2>start+length)fail();
          let glyph=range?cmap.readUInt16BE(address):(cp+delta)&65535;if(range&&glyph)glyph=(glyph+delta)&65535;save(cp,glyph);
        }
      }
    } else if(format===12) {
      if(start+16>cmap.length)fail();const length=cmap.readUInt32BE(start+4),groups=cmap.readUInt32BE(start+12);
      if(groups>4096||start+length>cmap.length||16+groups*12>length)fail();
      for(let group=0;group<groups;group++) {
        const at=start+16+group*12,first=cmap.readUInt32BE(at),last=cmap.readUInt32BE(at+4),glyph=cmap.readUInt32BE(at+8);
        if(first>last||last>0x10ffff)fail();for(let cp=first;cp<=last;cp++)save(cp,glyph+cp-first);
      }
    }
  }
  const coverage=[];
  for(const cp of [...coveragePoints].sort((a,b)=>a-b)) {const last=coverage.at(-1);if(last&&last[1]+1===cp)last[1]=cp;else coverage.push([cp,cp]);}
  if(!coverage.length)throw Error('FONT_CMAP_UNSUPPORTED');
  let defaultWeight=null;const fvar=tables.get('fvar');
  if(fvar) {
    if(fvar.length<16)fail();const start=fvar.readUInt16BE(4),count=fvar.readUInt16BE(8),size=fvar.readUInt16BE(10);
    if(size<20||count>16||start+count*size>fvar.length)fail();
    for(let i=0;i<count;i++){const at=start+i*size;if(fvar.toString('ascii',at,at+4)==='wght')defaultWeight=fvar.readInt32BE(at+8)/65536;}
  }
  return {unitsPerEm,ascent:hhea.readInt16BE(4),descent:-hhea.readInt16BE(6),glyphs,coverage,defaultWeight};
}
