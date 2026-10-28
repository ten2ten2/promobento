// Internal-only, data-only bridge. Hypit validates the source clock and positions;
// project components are never imported or executed by this tool.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';

const entry=import.meta.resolve('@hypit/hypit/cli'),require=createRequire(entry);
require('tsx/esm/api').register();
const distribution=new URL('../../../',entry);
const {installDistributionPackageResolution}=await import(new URL('packages/loader/src/node/distribution-resolution.ts',distribution).href);
installDistributionPackageResolution([fileURLToPath(distribution)]);
const {resolveVisualSourceTime,resolveVisualMotionPosition}=await import('@hypit/visual-track');

/** Convert a single real-time Hypit source relation and normalized focus anchors to block params. */
export function focusParams(input){
 const {assetKey,textSlot,clipFrames,sourceFrameCount,sourceTime,focusTrack,aspectTracks}=input;
 if(!/^[a-z][a-z0-9-]{0,47}$/.test(assetKey??'')||textSlot!==undefined&&!/^[a-z][a-z0-9-]{0,47}$/.test(textSlot)
   ||!Number.isSafeInteger(clipFrames)||clipFrames<1||clipFrames>900||!Number.isSafeInteger(sourceFrameCount)||sourceFrameCount<clipFrames||sourceFrameCount>1800)
   throw Error('HYPIT_FOCUS_INPUT_INVALID');
 const frameRate={numerator:30,denominator:1};
 const map=resolveVisualSourceTime({timeline:{id:'internal-focus',frameRate,frameCount:clipFrames},sourceFrameRate:frameRate,
   sourceFrameCount,targetFrameCount:clipFrames,...(sourceTime===undefined?{}:{spec:sourceTime})});
 const piece=map.pieces[0];
 if(map.pieces.length!==1||piece.target.startFrame!==0||piece.target.endFrameExclusive!==clipFrames||piece.wrap||
   piece.rate.numerator!==piece.rate.denominator||piece.sourceAtStart.denominator!==1||piece.sourceAtStart.numerator<0||piece.sourceAtStart.numerator>1799)
   throw Error('HYPIT_FOCUS_REALTIME_CONTINUOUS_SOURCE_REQUIRED');
 const convert=points=>{
  if(!Array.isArray(points)||points.length<1||points.length>8)throw Error('HYPIT_FOCUS_TRACK_INVALID');
  let previous=-1;
  return points.map(({at,x,y,zoom})=>{
   const frame=resolveVisualMotionPosition(at,clipFrames);
   if(frame<=previous||frame>=clipFrames||previous<0&&frame!==0||![x,y,zoom].every(Number.isFinite)||x<0||x>1||y<0||y>1||zoom<1||zoom>3)
     throw Error('HYPIT_FOCUS_TRACK_INVALID');
   previous=frame;return {frame,x,y,zoom};
  });
 };
 if(aspectTracks!==undefined&&(!aspectTracks||typeof aspectTracks!=='object'||Array.isArray(aspectTracks)||
   Object.keys(aspectTracks).some(aspect=>!['landscape','portrait','feed','square'].includes(aspect))))throw Error('HYPIT_FOCUS_TRACK_INVALID');
 return {assetKey,...(textSlot?{textSlot}:{}),sourceStartFrame:piece.sourceAtStart.numerator,
   ...(focusTrack!==undefined?{focusTrack:convert(focusTrack)}:{}),...(aspectTracks?{aspectTracks:Object.fromEntries(Object.entries(aspectTracks).map(([aspect,points])=>[aspect,convert(points)]))}:{})};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const raw=readFileSync(0);if(raw.length>1<<20)throw Error('HYPIT_FOCUS_INPUT_TOO_LARGE');
 console.log(canonical(focusParams(parseCanonicalJson(raw))));
}
