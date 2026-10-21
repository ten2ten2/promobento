import {inflateSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {reviewedFixtureFonts} from './media-assets.mjs';
import {repository} from './admission-image.mjs';
import {parseCanonicalJson} from '@promobento/contracts';
import {measureCommandText} from '../../../packages/composition-runtime/src/command-text.mjs';

/** The same licensed face bytes supply glyph coverage, advances and browser painting. */
export function woffCommandMetrics(bytes) {
  if(bytes.toString('ascii',0,4)!=='wOFF'||bytes.readUInt32BE(8)!==bytes.length)throw Error('FONT_WOFF_INVALID');
  const tables=new Map(),count=bytes.readUInt16BE(12);
  for(let i=0;i<count;i++) {
    const at=44+i*20,offset=bytes.readUInt32BE(at+4),length=bytes.readUInt32BE(at+8),original=bytes.readUInt32BE(at+12);
    if(original>4194304||offset+length>bytes.length||length>original)throw Error('FONT_WOFF_INVALID');
    const data=length===original?bytes.subarray(offset,offset+length):inflateSync(bytes.subarray(offset,offset+length),{maxOutputLength:original});
    if(data.length!==original)throw Error('FONT_WOFF_INVALID');tables.set(bytes.toString('ascii',at,at+4),data);
  }
  const head=tables.get('head'),hhea=tables.get('hhea'),hmtx=tables.get('hmtx'),cmap=tables.get('cmap');
  if(!head||!hhea||!hmtx||!cmap)throw Error('FONT_METRICS_MISSING');
  const unitsPerEm=head.readUInt16BE(18),metricCount=hhea.readUInt16BE(34),glyphs={};
  if(!unitsPerEm||!metricCount||metricCount*4>hmtx.length)throw Error('FONT_METRICS_INVALID');
  const save=(cp,glyph)=>{
    // This first profile deliberately does not claim shaping, combining marks, RTL or emoji.
    if(glyph&&((cp>=32&&cp<=126)||(cp>=160&&cp<=255)))
      glyphs[cp]=hmtx.readUInt16BE(Math.min(glyph,metricCount-1)*4);
  };
  for(let i=0;i<cmap.readUInt16BE(2);i++) {
    const record=4+i*8,platform=cmap.readUInt16BE(record),encoding=cmap.readUInt16BE(record+2),start=cmap.readUInt32BE(record+4);
    if(platform!==0&&!(platform===3&&[1,10].includes(encoding)))continue;
    const format=cmap.readUInt16BE(start);
    if(format===4) {
      const segments=cmap.readUInt16BE(start+6)/2,ends=start+14,starts=ends+segments*2+2,deltas=starts+segments*2,offsets=deltas+segments*2;
      for(let segment=0;segment<segments;segment++) {
        const first=cmap.readUInt16BE(starts+segment*2),last=Math.min(255,cmap.readUInt16BE(ends+segment*2)),delta=cmap.readInt16BE(deltas+segment*2),range=cmap.readUInt16BE(offsets+segment*2);
        for(let cp=first;cp<=last;cp++) {
          let glyph=range?cmap.readUInt16BE(offsets+segment*2+range+(cp-first)*2):(cp+delta)&65535;
          if(range&&glyph)glyph=(glyph+delta)&65535;save(cp,glyph);
        }
      }
    } else if(format===12)for(let group=0;group<cmap.readUInt32BE(start+12);group++) {
      const at=start+16+group*12,first=cmap.readUInt32BE(at),last=Math.min(255,cmap.readUInt32BE(at+4)),glyph=cmap.readUInt32BE(at+8);
      for(let cp=first;cp<=last;cp++)save(cp,glyph+cp-first);
    }
  }
  return {unitsPerEm,ascent:hhea.readInt16BE(4),descent:-hhea.readInt16BE(6),glyphs};
}

let cached;
export function admittedFontMetrics() {
  if(!cached) {
    const reviewed=reviewedFixtureFonts(); // License check precedes decoding/metrics.
    cached=reviewed.registry.fonts.map(font=>({...font,...woffCommandMetrics(reviewed.routes.get('/media-fixture/'+font.sha256+'.woff').bytes)}));
  }
  return structuredClone(cached);
}
export function admittedFontDeclarations() {
  return parseCanonicalJson(readFileSync(join(repository,'tests/fixtures/render/media.declarations.json'))).fonts;
}
export const admissionTextMeasurement=(declarations,fontId,text,fontSize,weight)=>
  measureCommandText(admittedFontMetrics(),declarations.fonts,fontId,text,fontSize,weight);
