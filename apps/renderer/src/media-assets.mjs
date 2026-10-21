import {readFileSync,writeFileSync,mkdirSync,rmSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {PNG} from 'pngjs';
import {parseCanonicalJson,digest} from '@promobento/contracts';
import {sha256} from './environment.mjs';
import {fontDeclarations,videoUses} from '../../../tests/fixtures/render/media-spec.mjs';

const repository=fileURLToPath(new URL('../../../',import.meta.url));
const registryPath='tests/fixtures/render/media-assets.json';
const sourceLicensePath='tests/fixtures/render/LICENSE.txt';
const width=320,height=180;
export {fontDeclarations,videoUses};

/** Read actual Unicode-to-glyph mappings, not CSS range labels or fonts.check().
 * This bounded parser admits only the vendored WOFF 1 fonts, with cmap 4/12.
 */
export function woffGlyphCoverage(bytes) {
  if (!Buffer.isBuffer(bytes)||bytes.length<44||bytes.length>1024*1024||bytes.toString('ascii',0,4)!=='wOFF'
    ||bytes.readUInt32BE(8)!==bytes.length) throw new Error('FONT_WOFF_INVALID');
  const count=bytes.readUInt16BE(12);
  if (count<1||count>64||44+count*20>bytes.length) throw new Error('FONT_WOFF_INVALID');
  let cmap;
  for(let i=0;i<count;i++) {
    const at=44+i*20,offset=bytes.readUInt32BE(at+4),compressed=bytes.readUInt32BE(at+8),original=bytes.readUInt32BE(at+12);
    if (offset+compressed>bytes.length||original>4*1024*1024||compressed>original) throw new Error('FONT_WOFF_INVALID');
    if(bytes.toString('ascii',at,at+4)==='cmap') {
      cmap=compressed===original?bytes.subarray(offset,offset+compressed):inflateSync(bytes.subarray(offset,offset+compressed),{maxOutputLength:original});
      if(cmap.length!==original) throw new Error('FONT_WOFF_INVALID');
    }
  }
  if(!cmap||cmap.length<4) throw new Error('FONT_CMAP_MISSING');
  const tables=cmap.readUInt16BE(2),points=new Set();
  if(tables>32||4+tables*8>cmap.length) throw new Error('FONT_CMAP_INVALID');
  let supported=false;
  for(let i=0;i<tables;i++) {
    const record=4+i*8,platform=cmap.readUInt16BE(record),encoding=cmap.readUInt16BE(record+2),start=cmap.readUInt32BE(record+4);
    if(platform!==0&&!(platform===3&&[1,10].includes(encoding))) continue;
    if(start+4>cmap.length) throw new Error('FONT_CMAP_INVALID');
    const format=cmap.readUInt16BE(start);
    if(format===4) {
      supported=true;
      const length=cmap.readUInt16BE(start+2),segments=cmap.readUInt16BE(start+6)/2;
      if(!Number.isInteger(segments)||segments<1||start+length>cmap.length||16+segments*8>length) throw new Error('FONT_CMAP_INVALID');
      const ends=start+14,starts=ends+segments*2+2,deltas=starts+segments*2,offsets=deltas+segments*2;
      for(let segment=0;segment<segments;segment++) {
        const first=cmap.readUInt16BE(starts+segment*2),last=cmap.readUInt16BE(ends+segment*2),delta=cmap.readInt16BE(deltas+segment*2),range=cmap.readUInt16BE(offsets+segment*2);
        if(first>last) throw new Error('FONT_CMAP_INVALID');
        for(let cp=first;cp<=last&&cp<0xffff;cp++) {
          let glyph;
          if(range===0) glyph=(cp+delta)&65535;
          else {
            const address=offsets+segment*2+range+(cp-first)*2;
            if(address+2>start+length) throw new Error('FONT_CMAP_INVALID');
            glyph=cmap.readUInt16BE(address);
            if(glyph) glyph=(glyph+delta)&65535;
          }
          if(glyph) points.add(cp);
        }
      }
    } else if(format===12) {
      supported=true;
      if(start+16>cmap.length) throw new Error('FONT_CMAP_INVALID');
      const length=cmap.readUInt32BE(start+4),groups=cmap.readUInt32BE(start+12);
      if(groups>4096||start+length>cmap.length||16+groups*12>length) throw new Error('FONT_CMAP_INVALID');
      for(let group=0;group<groups;group++) {
        const at=start+16+group*12,first=cmap.readUInt32BE(at),last=cmap.readUInt32BE(at+4),glyph=cmap.readUInt32BE(at+8);
        if(first>last||last>0x10ffff) throw new Error('FONT_CMAP_INVALID');
        for(let cp=first;cp<=last;cp++) if(glyph+cp-first!==0) points.add(cp);
      }
    }
  }
  if(!supported||!points.size) throw new Error('FONT_CMAP_UNSUPPORTED');
  const ranges=[];
  for(const point of [...points].sort((a,b)=>a-b)) {
    const last=ranges.at(-1);
    if(last&&last[1]+1===point) last[1]=point;else ranges.push([point,point]);
  }
  return ranges;
}

export function reviewedFixtureFonts() {
  const registry=parseCanonicalJson(readFileSync(join(repository,registryPath))),routes=new Map(),resources=[],fonts=[];
  const sourcePaths=[registryPath,'tests/fixtures/render/media-spec.mjs',sourceLicensePath];
  for(const font of registry.fonts) {
    // Verify the preserved license before decoding or processing the font bytes.
    const license=readFileSync(join(repository,font.licensePath));
    if(font.license!=='OFL-1.1'||sha256(license)!==font.licenseSha256||!license.toString('utf8').includes('SIL OPEN FONT LICENSE Version 1.1'))
      throw new Error('FONT_LICENSE_UNVERIFIED');
    const bytes=Buffer.from(readFileSync(join(repository,font.encodedPath),'utf8').trim(),'base64');
    if(bytes.length!==font.byteLength||sha256(bytes)!==font.sha256) throw new Error('FONT_HASH_MISMATCH');
    const declaration=fontDeclarations.find(item=>item.fontId===font.fontId);
    if(!declaration||declaration.registryVersion!==registry.registryVersion||declaration.assets[0].sha256!==font.sha256)
      throw new Error('FONT_REGISTRY_MISMATCH');
    const url='/media-fixture/'+font.sha256+'.woff';
    routes.set(url,{bytes,contentType:'font/woff',path:font.path});
    resources.push({path:font.path,url,sha256:font.sha256,byteLength:bytes.length,mediaType:'font/woff',licenseRef:font.licenseRef});
    fonts.push({fontId:font.fontId,registryVersion:registry.registryVersion,weight:font.weight,path:font.path,sha256:font.sha256,coverage:woffGlyphCoverage(bytes)});
    sourcePaths.push(font.encodedPath,font.licensePath);
  }
  return {routes,resources,fonts,sourcePaths,registry};
}

function screenPixels(index) {
  const image=new PNG({width,height});
  const rect=(x,y,w,h,color)=>{
    for(let row=Math.max(0,Math.floor(y));row<Math.min(height,Math.floor(y+h));row++)
      for(let col=Math.max(0,Math.floor(x));col<Math.min(width,Math.floor(x+w));col++) {
        const offset=(row*width+col)*4;image.data[offset]=color[0];image.data[offset+1]=color[1];image.data[offset+2]=color[2];image.data[offset+3]=255;
      }
  };
  rect(0,0,width,height,[245,241,232]);rect(0,0,width,23,[36,53,43]);
  for(let i=0;i<3;i++) rect(9+i*10,8,5,5,[[242,120,61],[248,220,128],[155,187,160]][i]);
  rect(0,23,58,height-23,[223,229,219]);
  for(let row=0;row<5;row++) rect(10,35+row*24,38,7,row===(index%5)?[36,53,43]:[155,187,160]);
  rect(70,34,140,8,[36,53,43]);rect(70,50,220,3,[155,187,160]);
  for(let col=0;col<3;col++) {
    rect(70+col*76,67,66,43,[255,255,255]);
    rect(77+col*76,74,38,5,[155,187,160]);rect(77+col*76,90,16+(index+col*7)%30,10,[36,53,43]);
  }
  rect(70,121,218,43,[255,255,255]);
  for(let bar=0;bar<15;bar++) {
    const h=10+((index*3+bar*13)%26);rect(76+bar*14,158-h,9,h,[242,120,61]);
  }
  const x=78+(index*7)%208,y=46+(index*11)%105;
  for(let row=0;row<10;row++) rect(x,y+row,1+Math.floor(row/2),1,[36,53,43]);
  rect(70,174,Math.floor(218*Math.min(index,60)/60),3,[242,120,61]);
  return PNG.sync.write(image);
}

const command=(binary,args,options={})=>execFileSync(binary,args,{timeout:60000,maxBuffer:8*1024*1024,...options});
const rational=(numerator,denominator)=>({numerator,denominator});

/** The only admitted source is this original geometric fixture, generated after
 * its CC0 declaration is checked. No arbitrary path, upload or URL is accepted.
 */
export function prepareFixtureMedia({outputDirectory}) {
  if(typeof outputDirectory!=='string'||!outputDirectory) throw new Error('MEDIA_OUTPUT_DIRECTORY_INVALID');
  const fonts=reviewedFixtureFonts();
  const license=readFileSync(join(repository,sourceLicensePath),'utf8');
  if(!license.includes('CC0')) throw new Error('VIDEO_LICENSE_UNVERIFIED');
  const directory=join(outputDirectory,'media'),inputDirectory=join(directory,'source-frames'),framesDirectory=join(directory,'decoded-frames');
  mkdirSync(directory,{recursive:true});mkdirSync(inputDirectory);mkdirSync(framesDirectory);
  const sourcePath=join(directory,'screen-demo.mp4'),sourceFrameHashes=[];
  try {
    // 61 frames: alternating 10/20 ticks at 30 Hz, plus a final sentinel at t=30.
    // The declared use is [0,30); the sentinel makes the last interval explicit.
    for(let index=0;index<=60;index++) {
      const bytes=screenPixels(index);writeFileSync(join(inputDirectory,String(index).padStart(3,'0')+'.png'),bytes);sourceFrameHashes.push(sha256(bytes));
    }
    command('/usr/bin/ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate','30','-i',join(inputDirectory,'%03d.png'),
      '-vf',"settb=1/30,setpts='floor(N/2)*30+mod(N,2)*10',format=yuv420p",'-fps_mode','vfr','-c:v','libx264','-preset','fast','-crf','18',
      '-threads','1','-filter_threads','1','-video_track_timescale','30000','-movflags','+faststart',sourcePath]);
    const sourceBytes=readFileSync(sourcePath),sourceSha256=sha256(sourceBytes);
    const probe=parseCanonicalJson(command('/usr/bin/ffprobe',['-v','error','-select_streams','v:0','-show_streams','-show_frames','-show_entries',
      'stream=codec_name,width,height,time_base,duration_ts,nb_frames:frame=pts,pkt_duration','-of','json',sourcePath]));
    const stream=probe.streams[0],[timeNumerator,timeDenominator]=stream.time_base.split('/').map(Number);
    if(stream.codec_name!=='h264'||stream.width!==width||stream.height!==height||probe.frames.length!==61||!Number.isSafeInteger(stream.duration_ts))
      throw new Error('VIDEO_SOURCE_PROBE_INVALID');
    const duration=rational(stream.duration_ts*timeNumerator,timeDenominator);
    const pts=probe.frames.map((frame,index)=>{
      if(!Number.isSafeInteger(frame.pts)||frame.pts<0||(index&&frame.pts<=probe.frames[index-1].pts)) throw new Error('VIDEO_PTS_INVALID');
      // Independently check the intended VFR schedule, including the end sentinel.
      if(frame.pts*timeNumerator*30!==(Math.floor(index/2)*30+(index%2)*10)*timeDenominator) throw new Error('VIDEO_PTS_DRIFT');
      return rational(frame.pts*timeNumerator,timeDenominator);
    });
    command('/usr/bin/ffmpeg',['-hide_banner','-loglevel','error','-y','-i',sourcePath,'-map','0:v:0','-fps_mode','passthrough',
      '-vf','format=rgb24','-threads','1','-filter_threads','1',join(framesDirectory,'%03d.png')]);
    if(readdirSync(framesDirectory).length!==pts.length) throw new Error('VIDEO_FRAME_UNAVAILABLE');
    const routes=new Map(fonts.routes),sourceUrl='/media-fixture/'+sourceSha256+'.mp4';
    routes.set(sourceUrl,{bytes:sourceBytes,contentType:'video/mp4',path:'media/screen-demo.mp4'});
    const resources=[...fonts.resources,{path:'media/screen-demo.mp4',url:sourceUrl,sha256:sourceSha256,byteLength:sourceBytes.length,mediaType:'video/mp4',licenseRef:'fixture-original-cc0'}];
    const frames=pts.map((sourcePts,index)=>{
      const bytes=readFileSync(join(framesDirectory,String(index+1).padStart(3,'0')+'.png')),hash=sha256(bytes),decoded=PNG.sync.read(bytes);
      if(decoded.width!==width||decoded.height!==height) throw new Error('VIDEO_FRAME_DIMENSIONS_INVALID');
      const path='media/screen-demo/'+String(index).padStart(3,'0')+'.png',url='/media-fixture/'+hash+'.png';
      routes.set(url,{bytes,contentType:'image/png',path});
      return {index,pts:sourcePts,path,url,sha256:hash,byteLength:bytes.length,pixelSha256:sha256(decoded.data)};
    });
    const videos=[{assetPath:'media/screen-demo.mp4',sourceSha256,duration,width,height,frames}];
    const manifest={version:'m0a-media-v1',resources,fonts:fonts.fonts,videos,limits:{maxDecodedFrames:8,maxDecodedBytes:8*width*height*4}};
    return {manifest,routes,fontDeclarations,videoUses,sourcePaths:fonts.sourcePaths,
      report:{manifestHash:digest(manifest),sourceSha256,sourceDuration:duration,sourceFrameCount:frames.length,
        variableFrameRate:true,sourceFrameHashes,sourcePts:pts,decodedFramePixelHashes:frames.map(frame=>frame.pixelSha256),
        frameSelection:'exact-containing-pts-interval-v1',decodePath:'trusted-ffmpeg-png',
        fonts:fonts.registry.fonts.map(font=>({fontId:font.fontId,sha256:font.sha256,licenseRef:font.licenseRef,licenseSha256:font.licenseSha256})),
        sourceLicenseRef:'fixture-original-cc0',sourceLicenseSha256:sha256(Buffer.from(license)),
        limitations:['reviewed synthetic app-screen only','Latin font registry fixture, not multilingual shaping certification','no arbitrary uploads or font registration']}};
  } finally {
    rmSync(inputDirectory,{recursive:true,force:true});rmSync(framesDirectory,{recursive:true,force:true});
  }
}
