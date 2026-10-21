/** Reviewed-fixture media broker. The host freezes and serves verified bytes;
 * these readiness barriers do not admit arbitrary source, URLs or uploads.
 */
const fail=code=>{throw new Error(code);};
const hashPattern=/^[0-9a-f]{64}$/;
const isRational=value=>value&&Number.isSafeInteger(value.numerator)&&value.numerator>=0
  &&Number.isSafeInteger(value.denominator)&&value.denominator>0;
const ratio=value=>{
  if(!isRational(value)) fail('VIDEO_TIME_INVALID');
  return [BigInt(value.numerator),BigInt(value.denominator)];
};
const compare=(a,b)=>a[0]*b[1]<b[0]*a[1]?-1:a[0]*b[1]>b[0]*a[1]?1:0;
const subtract=(a,b)=>[a[0]*b[1]-b[0]*a[1],a[1]*b[1]];
const add=(a,b)=>[a[0]*b[1]+b[0]*a[1],a[1]*b[1]];
const multiply=(a,b)=>[a[0]*b[0],a[1]*b[1]];

/** Exact containment, including VFR and subframes. Never a nearest-time seek. */
export function selectVideoFrame(use,video,time) {
  if(!use||!video||use.assetPath!==video.assetPath||!Array.isArray(video.frames)||!video.frames.length) fail('VIDEO_USE_UNDECLARED');
  const at=ratio(time),start=ratio(use.timelineStart),sourceStart=ratio(use.sourceStart),sourceEnd=ratio(use.sourceEndExclusive),rate=ratio(use.playbackRate);
  if(rate[0]===0n||compare(sourceStart,sourceEnd)>=0||compare(sourceEnd,ratio(video.duration))>0) fail('VIDEO_USE_INVALID');
  if(compare(at,start)<0) fail('VIDEO_TIME_OUT_OF_RANGE');
  const source=add(sourceStart,multiply(subtract(at,start),rate));
  if(compare(source,sourceStart)<0||compare(source,sourceEnd)>=0) fail('VIDEO_TIME_OUT_OF_RANGE');
  let low=0,high=video.frames.length;
  while(low<high) {
    const middle=(low+high)>>>1;
    if(compare(ratio(video.frames[middle].pts),source)<=0) low=middle+1;else high=middle;
  }
  const frame=video.frames[low-1];
  if(!frame||compare(source,ratio(video.frames[low]?.pts??video.duration))>=0) fail('VIDEO_FRAME_UNAVAILABLE');
  return frame;
}

function validateManifest(manifest) {
  if(manifest?.version!=='m0a-media-v1'||!Array.isArray(manifest.resources)||!Array.isArray(manifest.fonts)||!Array.isArray(manifest.videos)
    ||manifest.resources.length>32||manifest.fonts.length>8||manifest.videos.length>3
    ||!Number.isSafeInteger(manifest.limits?.maxDecodedFrames)||manifest.limits.maxDecodedFrames<1||manifest.limits.maxDecodedFrames>32
    ||!Number.isSafeInteger(manifest.limits.maxDecodedBytes)||manifest.limits.maxDecodedBytes<1||manifest.limits.maxDecodedBytes>64*1024*1024)
    fail('MEDIA_MANIFEST_INVALID');
  const resources=new Map();
  for(const resource of manifest.resources) {
    if(typeof resource.path!=='string'||resources.has(resource.path)||!resource.licenseRef||!hashPattern.test(resource.sha256)
      ||typeof resource.mediaType!=='string'||!resource.mediaType.length
      ||!Number.isSafeInteger(resource.byteLength)||resource.byteLength<=0||resource.byteLength>8*1024*1024
      ||typeof resource.url!=='string'||!resource.url.startsWith('/media-fixture/'+resource.sha256+'.')) fail('MEDIA_RESOURCE_INVALID');
    resources.set(resource.path,resource);
  }
  const videos=new Map();
  for(const video of manifest.videos) {
    if(videos.has(video.assetPath)||resources.get(video.assetPath)?.sha256!==video.sourceSha256
      ||!Number.isSafeInteger(video.width)||!Number.isSafeInteger(video.height)||video.width<1||video.height<1
      ||video.width*video.height*4>manifest.limits.maxDecodedBytes
      ||!Array.isArray(video.frames)||video.frames.length<1||video.frames.length>1800) fail('VIDEO_MANIFEST_INVALID');
    let previous;
    for(const [index,frame] of video.frames.entries()) {
      const pts=ratio(frame.pts);
      if(frame.index!==index||!hashPattern.test(frame.sha256)||frame.url!=='/media-fixture/'+frame.sha256+'.png'
        ||!Number.isSafeInteger(frame.byteLength)||frame.byteLength<1||frame.byteLength>8*1024*1024
        ||(previous&&compare(pts,previous)<=0)||compare(pts,ratio(video.duration))>=0) fail('VIDEO_PTS_INVALID');
      previous=pts;
    }
    videos.set(video.assetPath,video);
  }
  return {resources,videos};
}

async function verifiedBytes(resource) {
  const response=await fetch(resource.url,{cache:'no-store',credentials:'omit'});
  if(!response.ok) fail('MEDIA_RESOURCE_UNAVAILABLE');
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength!==resource.byteLength) fail('MEDIA_RESOURCE_HASH_MISMATCH');
  const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  if(sha256!==resource.sha256) fail('MEDIA_RESOURCE_HASH_MISMATCH');
  return bytes;
}

/** Actually ask the decoder for a decoded first frame. This is diagnostic:
 * both supported and unsupported browsers use the same trusted PNG frame path.
 */
async function probeVideoDecode(bytes) {
  const video=document.createElement('video'),url=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));
  video.muted=true;video.preload='auto';
  let timer;
  try {
    return await new Promise(resolve=>{
      const done=result=>{clearTimeout(timer);resolve(result);};
      video.onloadeddata=()=>done({decoded:video.readyState>=2,method:'html-video-loadeddata',width:video.videoWidth,height:video.videoHeight});
      video.onerror=()=>done({decoded:false,method:'html-video-loadeddata',reason:'decoder-error',errorCode:video.error?.code??null});
      timer=setTimeout(()=>done({decoded:false,method:'html-video-loadeddata',reason:'decoder-timeout'}),2000);
      video.src=url;video.load();
    });
  } finally {
    clearTimeout(timer);video.onloadeddata=null;video.onerror=null;video.removeAttribute('src');video.load();URL.revokeObjectURL(url);
  }
}

export async function createMediaController({definition,manifest}) {
  // Snapshot host declarations so a composition cannot later redirect a request.
  const frozen=structuredClone(manifest),{resources,videos}=validateManifest(frozen),uses=new Map(),declarations=new Map();
  const faces=[],fontFamilies=new Map(),fontEntries=new Map(),cache=new Map();
  let disposed=false,decodedBytes=0,peakDecodedBytes=0,peakDecodedFrames=0,fetches=0,cacheHits=0,pending=Promise.resolve();
  const decodeProbes=[];
  const dispose=()=>{
    if(disposed) return;
    disposed=true;
    for(const {image} of cache.values()) image.close();cache.clear();decodedBytes=0;
    for(const face of faces) document.fonts.delete(face);
  };
  try {
    for(const declaration of structuredClone(definition.fonts??[])) {
      if(declarations.has(declaration.fontId)||!Array.isArray(declaration.weights)||!Array.isArray(declaration.assets)||!Array.isArray(declaration.fallbackFontIds)) fail('FONT_DECLARATION_INVALID');
      declarations.set(declaration.fontId,declaration);
      const entries=[];
      for(const asset of declaration.assets) {
        const registered=frozen.fonts.find(font=>font.fontId===declaration.fontId&&font.weight===asset.weight),resource=resources.get(asset.path);
        if(!registered||registered.registryVersion!==declaration.registryVersion||registered.path!==asset.path||registered.sha256!==asset.sha256
          ||resource?.sha256!==asset.sha256||!declaration.weights.includes(asset.weight)||!Array.isArray(registered.coverage)) fail('FONT_REGISTRY_MISMATCH');
        for(const range of registered.coverage) if(!Array.isArray(range)||range.length!==2||!range.every(Number.isSafeInteger)||range[0]<0||range[1]<range[0]||range[1]>0x10ffff) fail('FONT_CMAP_INVALID');
        const family='Fixture_'+declaration.fontId.replace(/[^a-zA-Z0-9_-]/g,'_')+'_'+asset.sha256.slice(0,16);
        const face=new FontFace(family,await verifiedBytes(resource),{weight:String(asset.weight),style:'normal'});
        await face.load();document.fonts.add(face);faces.push(face);entries.push({...registered,family});
      }
      if(entries.length!==declaration.weights.length||!entries.length) fail('FONT_REGISTRY_MISMATCH');
      fontEntries.set(declaration.fontId,entries);
    }
    const chain=(id,seen=new Set())=>{
      if(seen.has(id)) fail('FONT_FALLBACK_CYCLE');
      const declaration=declarations.get(id);if(!declaration) fail('FONT_FALLBACK_UNDECLARED');
      const next=new Set(seen).add(id);
      return [id,...declaration.fallbackFontIds.flatMap(fallback=>chain(fallback,next))];
    };
    for(const id of declarations.keys()) fontFamilies.set(id,[...new Set(chain(id).flatMap(fontId=>fontEntries.get(fontId).map(font=>font.family)))].map(family=>'"'+family+'"').join(', '));
    await document.fonts.ready;
    for(const use of structuredClone(definition.videoUses??[])) {
      if(typeof use.id!=='string'||uses.has(use.id)||!videos.has(use.assetPath)) fail('VIDEO_USE_UNDECLARED');
      const video=videos.get(use.assetPath);
      selectVideoFrame(use,video,use.timelineStart);
      uses.set(use.id,use);
    }
    for(const video of videos.values()) {
      const source=resources.get(video.assetPath),bytes=await verifiedBytes(source);
      decodeProbes.push({assetPath:video.assetPath,sourceSha256:video.sourceSha256,...await probeVideoDecode(bytes),selectedPath:'trusted-ffmpeg-png'});
    }
    const fonts=Object.freeze({ready:Promise.resolve(),family(fontId) {
      if(disposed) fail('MEDIA_DISPOSED');
      return fontFamilies.get(fontId)??fail('FONT_UNDECLARED');
    },assertText(fontId,text) {
      if(disposed) fail('MEDIA_DISPOSED');
      if(typeof text!=='string'||!text.isWellFormed()||text.length>16384) fail('FONT_TEXT_INVALID');
      const available=chain(fontId).flatMap(id=>fontEntries.get(id).flatMap(entry=>entry.coverage));
      for(const character of text) {
        const point=character.codePointAt(0);
        if([9,10,13].includes(point)) continue;
        if(!available.some(([first,last])=>point>=first&&point<=last)) fail('FONT_GLYPH_MISSING: U+'+point.toString(16).toUpperCase());
      }
      return true;
    }});
    const videoFrames=Object.freeze({get(useId,time) {
      const operation=async()=>{
        if(disposed) fail('MEDIA_DISPOSED');
        const use=uses.get(useId);if(!use) fail('VIDEO_USE_UNDECLARED');
        const video=videos.get(use.assetPath),frame=selectVideoFrame(use,video,time),key=video.sourceSha256+':'+frame.index;
        let stored=cache.get(key);
        if(stored) {cache.delete(key);cache.set(key,stored);cacheHits++;}
        else {
          const size=video.width*video.height*4;
          while(cache.size>=frozen.limits.maxDecodedFrames||decodedBytes+size>frozen.limits.maxDecodedBytes) {
            const oldest=cache.keys().next().value,value=cache.get(oldest);
            if(!value) fail('VIDEO_CACHE_LIMIT');
            value.image.close();cache.delete(oldest);decodedBytes-=value.size;
          }
          const bytes=await verifiedBytes(frame);
          const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
          if(disposed||image.width!==video.width||image.height!==video.height) {image.close();fail(disposed?'MEDIA_DISPOSED':'VIDEO_FRAME_DIMENSIONS_INVALID');}
          stored={image,size};cache.set(key,stored);decodedBytes+=size;fetches++;
          peakDecodedBytes=Math.max(peakDecodedBytes,decodedBytes);peakDecodedFrames=Math.max(peakDecodedFrames,cache.size);
        }
        return Object.freeze({image:stored.image,sourceSha256:video.sourceSha256,sourcePts:Object.freeze({...frame.pts}),representation:'source_frame'});
      };
      const result=pending.then(operation);pending=result.catch(()=>{});return result;
    }});
    const trustedResources=Object.freeze(Object.fromEntries([...resources].map(([path,resource])=>[path,Object.freeze({...resource})])));
    const drawableResourcePaths=Object.freeze([...resources.values()].filter(resource=>/^(?:image|video)\//u.test(resource.mediaType)).map(resource=>resource.path));
    return Object.freeze({assets:Object.freeze(Object.fromEntries([...resources].map(([path,resource])=>[path,Object.freeze({path,sha256:resource.sha256,url:resource.url})]))),
      resources:trustedResources,drawableResourcePaths,fonts,videoFrames,dispose,
      report:()=>({decodeProbes:structuredClone(decodeProbes),fonts:faces.map(face=>({family:face.family,status:face.status,weight:face.weight})),
        cache:{maxDecodedFrames:frozen.limits.maxDecodedFrames,maxDecodedBytes:frozen.limits.maxDecodedBytes,peakDecodedFrames,peakDecodedBytes,fetches,cacheHits}})});
  } catch(error) {dispose();throw error;}
}
