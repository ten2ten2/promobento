import {pngPixels} from '@promobento/contracts/seams';
import {canonical} from '@promobento/contracts/canonical';
import {assertCanvasTextTrace} from '@promobento/contracts/canvas-text';

/**
 * Check a trusted, full-frame Canvas text layer against the actual screenshot.
 * `withText` and `withoutText` must be produced by the same admitted renderer
 * at the same frame; callers must independently bind text, fonts and geometry.
 * Any changed actual pixel fails closed, including overlays outside the ink.
 */
export function compareCanvasTextFrame({actual,withText,withoutText,boxes,safeInsets,expectedWidth,expectedHeight}){
 const a=pngPixels(actual),b=pngPixels(withText),c=pngPixels(withoutText),{width,height}=a;
 if((expectedWidth!==undefined&&width!==expectedWidth)||(expectedHeight!==undefined&&height!==expectedHeight)
  ||[b,c].some(image=>image.width!==width||image.height!==height))throw Error('CANVAS_TEXT_DIMENSIONS_MISMATCH');
 if(!Array.isArray(boxes)||!boxes.length||boxes.length>2000||!safeInsets
  ||!['left','right','top','bottom'].every(side=>Number.isFinite(safeInsets[side])&&safeInsets[side]>=0&&safeInsets[side]<.5))throw Error('CANVAS_TEXT_PROOF_INVALID');
 let same=true,changed=0;const mask=new Uint8Array(width*height);
 for(let p=0,i=0;p<mask.length;p++,i+=4){
  if(a.pixels[i]!==b.pixels[i]||a.pixels[i+1]!==b.pixels[i+1]||a.pixels[i+2]!==b.pixels[i+2]||a.pixels[i+3]!==b.pixels[i+3])same=false;
  if(b.pixels[i]!==c.pixels[i]||b.pixels[i+1]!==c.pixels[i+1]||b.pixels[i+2]!==c.pixels[i+2]||b.pixels[i+3]!==c.pixels[i+3]){mask[p]=1;changed++;}
 }
 const channel=value=>{const s=value/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;};
 const luminance=(pixels,i)=>channel(pixels[i])*.2126+channel(pixels[i+1])*.7152+channel(pixels[i+2])*.0722;
 let insideSafeArea=true,clipped=false,missing=0,contrastRatio=21;
 for(const box of boxes){
  if(!box||![box.x,box.y,box.width,box.height].every(Number.isFinite)||box.width<=0||box.height<=0)throw Error('CANVAS_TEXT_PROOF_INVALID');
  const {x,y,width:w,height:h}=box;
  if(x<0||y<0||x+w>width||y+h>height)clipped=true;
  if(x<width*safeInsets.left||y<height*safeInsets.top||x+w>width*(1-safeInsets.right)||y+h>height*(1-safeInsets.bottom))insideSafeArea=false;
  const left=Math.max(0,Math.floor(x)),right=Math.min(width,Math.ceil(x+w)),top=Math.max(0,Math.floor(y)),bottom=Math.min(height,Math.ceil(y+h));
  let best=1;for(let py=top;py<bottom;py++)for(let px=left;px<right;px++)if(mask[py*width+px]){
   const i=(py*width+px)*4,x=luminance(b.pixels,i),y=luminance(c.pixels,i);best=Math.max(best,(Math.max(x,y)+.05)/(Math.min(x,y)+.05));
  }
  if(best===1)missing++;contrastRatio=Math.min(contrastRatio,best);
 }
 return{verified:same&&changed>0&&!clipped&&insideSafeArea&&missing===0,actualMatches:same,changedPixels:changed,insideSafeArea,clipped,unobservedBoxes:missing,contrastRatio};
}

/** Join private trusted-block evidence to an observation of the captured frame. */
export function appendCanvasTextObservations({plan,frame,observation,proofs,traces,fontsByScene,actual}){
 if(!Array.isArray(proofs))throw Error('CANVAS_TEXT_PROOF_INVALID');
 assertCanvasTextTrace(plan.spec,frame,traces);
 const scenes=plan.spec.scenes.filter(scene=>scene.kind==='block'&&scene.block==='canvas-title@1'&&scene.start<=frame&&frame<scene.end);
 if(proofs.length!==scenes.length||new Set(proofs.map(proof=>proof?.sceneId)).size!==proofs.length)throw Error('CANVAS_TEXT_PROOF_MISSING');
 const limit=Math.min(30<<20,plan.target.width*plan.target.height*6+65536);
 const png=value=>{
  if(typeof value!=='string'||value.length>limit||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))throw Error('CANVAS_TEXT_PROOF_INVALID');
  return Buffer.from(value.slice('data:image/png;base64,'.length),'base64');
 };
 for(const scene of scenes){
  const proof=proofs.find(item=>item?.sceneId===scene.id),slotId=scene.params.textSlot,slot=plan.spec.texts[slotId],font=plan.spec.style.type.display;
  if(!proof||!slot||proof.slotId!==slotId||proof.text!==slot.text||proof.fontId!==font.fontId||proof.weight!==font.weight||proof.style!==(font.style??'normal')
   ||!Number.isFinite(proof.fontSize)||proof.fontSize<=0||!Number.isFinite(proof.alpha)||proof.alpha<0||proof.alpha>1
   ||!Array.isArray(proof.boxes)||proof.boxes.length!==[...slot.text].filter(ch=>ch.trim()).length)throw Error('CANVAS_TEXT_PROOF_INVALID');
  const {withText:_withText,withoutText:_withoutText,...metadata}=proof;
  if(canonical(metadata)!==canonical(traces.find(item=>item.sceneId===scene.id)))throw Error('CANVAS_TEXT_TRACE_MISMATCH');
  const face=plan.fonts.find(item=>item.fontId===font.fontId&&item.weight===font.weight&&item.style===(font.style??'normal'));
  if(!face?.codePoints)throw Error('FONT_CMAP_UNAVAILABLE');
  const cmap=new Set(face.codePoints),missingGlyphs=[...slot.text].filter(ch=>ch.trim()&&!cmap.has(ch.codePointAt(0))).length;
  const platformFonts=fontsByScene?.get(scene.id);
  if(!Array.isArray(platformFonts)||platformFonts.length>8||platformFonts.some(item=>typeof item.familyName!=='string'||item.familyName.length>120
   ||typeof item.isCustomFont!=='boolean'||!Number.isSafeInteger(item.glyphCount)||item.glyphCount<0))throw Error('CANVAS_FONT_OBSERVATION_UNAVAILABLE');
  const fallbackUsed=!platformFonts.length||platformFonts.some(item=>!item.isCustomFont)||missingGlyphs>0;
  const result=compareCanvasTextFrame({actual,withText:png(proof.withText),withoutText:png(proof.withoutText),boxes:proof.boxes,safeInsets:plan.target.safeInsets,
   expectedWidth:plan.target.width,expectedHeight:plan.target.height});
  const left=Math.min(...proof.boxes.map(box=>box.x)),top=Math.min(...proof.boxes.map(box=>box.y)),
   right=Math.max(...proof.boxes.map(box=>box.x+box.width)),bottom=Math.max(...proof.boxes.map(box=>box.y+box.height));
  const largeText=proof.fontSize>=24||proof.fontSize>=14*4/3&&font.weight>=700;
  const clipped=result.clipped||!result.actualMatches||result.changedPixels===0||result.unobservedBoxes>0;
  const ratio=Math.max(1,Math.min(21,result.contrastRatio));
  observation.texts.push({slotId,sceneId:scene.id,text:slot.text,box:{x:left,y:top,width:right-left,height:bottom-top},
   fonts:platformFonts.map(item=>({family:item.familyName,glyphCount:item.glyphCount})),fallbackUsed,missingGlyphs,
   contrastRatio:ratio,largeText,insideSafeArea:result.insideSafeArea,clipped,covered:!result.actualMatches});
  observation.regions.push({regionId:slotId,box:{x:left,y:top,width:right-left,height:bottom-top}});
  for(const [condition,code]of [[fallbackUsed,'FONT_FALLBACK_USED'],[missingGlyphs>0,'FONT_GLYPH_MISSING'],[!result.insideSafeArea,'outside-safe-area'],[clipped,'text-clipped'],
   [ratio<(largeText?3:4.5),'low-contrast'],[proof.fontSize<(plan.target.aspect==='landscape'?32:36),'TEXT_FIT_FAILED']])
   if(condition)observation.findings.push({code,severity:'BLOCK',slotId});
  if(observation.texts.length>400||observation.regions.length>200||observation.findings.length>200)throw Error('CANVAS_TEXT_PROOF_LIMIT');
 }
 return observation;
}
