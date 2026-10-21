import {canonical} from '../../contracts/src/canonical.mjs';
import {safePath,sourceValuesBytes} from '../../contracts/src/source-values.mjs';
import {editableValuesErrors,localPreviewValues} from '../../contracts/src/editable-values.mjs';

/** Browser runtime for M0a's reviewed, self-contained standard-profile fixtures.
 * This is not the security boundary for customer code. Cloud admission is M0b.
 */
export function frameTime(frameIndex, totalFrames) {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= totalFrames)
    throw new RangeError('FRAME_OUT_OF_RANGE');
  return Object.freeze({numerator: frameIndex, denominator: 30});
}

/**
 * random-at-v1: UTF-8 byte lengths (uint32 little-endian) followed by each value,
 * FNV-1a, then MurmurHash3's fmix32. Unsigned output / 2^32 is in [0, 1).
 * This is keyed visual noise, not a source of credentials or cryptographic entropy.
 */
export function randomAt(seed, key) {
  if (typeof seed !== 'string' || typeof key !== 'string' || !seed.isWellFormed() || !key.isWellFormed())
    throw new TypeError('RANDOM_KEY_INVALID');
  let value = 2166136261;
  const add = byte => { value = Math.imul(value ^ byte, 16777619) >>> 0; };
  for (const input of [seed, key]) {
    const bytes = new TextEncoder().encode(input);
    if (bytes.length > 0xffffffff) throw new RangeError('RANDOM_KEY_TOO_LONG');
    for (let shift = 0; shift < 32; shift += 8) add((bytes.length >>> shift) & 255);
    for (const byte of bytes) add(byte);
  }
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35) >>> 0;
  value = (value ^ (value >>> 16)) >>> 0;
  return value / 4294967296;
}

function assertSupportedDrawing(root) {
  // Display invalidation below is only valid for direct absolute-time drawing.
  // It would cancel/restart native animations, including manually paused ones.
  if (root.getAnimations({subtree:true}).length)
    throw new Error('NATIVE_ANIMATION_UNSUPPORTED: use absolute-time DOM/SVG attributes or Canvas 2D drawing');
}

async function settleDirectDrawing(root) {
  assertSupportedDrawing(root);
  const display = root.style.getPropertyValue('display');
  const priority = root.style.getPropertyPriority('display');
  try {
    root.style.setProperty('display', 'none', 'important');
    root.getBoundingClientRect();
  } finally {
    if (display) root.style.setProperty('display', display, priority);
    else root.style.removeProperty('display');
  }
  // This invalidates retained SVG raster layers for the supported drawing path.
  // The screenshot supplies the compositor/readback barrier. It is not a media
  // or WebGL barrier, and cannot make stateful customer code deterministic.
  root.getBoundingClientRect();
  assertSupportedDrawing(root);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  assertSupportedDrawing(root);
}

const id=value=>typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
const freeze=value=>{
  if(value && typeof value==='object') {for(const child of Object.values(value))freeze(child);Object.freeze(value);}
  return value;
};
const snapshot=value=>freeze(structuredClone(value));

/** Defensive fixture checks. The trusted builder still owns full schema/resource admission. */
function declarationsFor(definition,totalFrames) {
  const names=['editables','markers','regions','videoUses','fonts'];
  for(const name of names)if(!Array.isArray(definition[name]))throw Error('COMPOSITION_DECLARATIONS_REQUIRED');
  const declarations=Object.fromEntries(names.map(name=>[name,definition[name]]));
  canonical(declarations);
  for(const name of ['editables','markers','regions','videoUses']) {
    if(declarations[name].some(item=>!item || !id(item.id))
      || new Set(declarations[name].map(item=>item.id)).size!==declarations[name].length)
      throw Error('COMPOSITION_DECLARATION_ID_INVALID');
  }
  if(declarations.editables.length>256)throw Error('SOURCE_VALUES_TOO_MANY');
  for(const item of declarations.editables) {
    if(!['text','color','asset','number','boolean','enum','data'].includes(item.type)
      || typeof item.label!=='string' || !item.label.length || item.label.length>128
      || (item.affectsTiming!==undefined && typeof item.affectsTiming!=='boolean')
      || (item.factId!==undefined && (item.type!=='text' || !id(item.factId))))throw Error('EDITABLE_DECLARATION_INVALID');
    if(item.type==='enum') {
      if(!Array.isArray(item.choices) || !item.choices.length
        || item.choices.some(choice=>typeof choice!=='string' || !choice.length)
        || new Set(item.choices).size!==item.choices.length)throw Error('EDITABLE_CHOICES_REQUIRED');
    } else if(item.choices!==undefined)throw Error('EDITABLE_CHOICES_NOT_ALLOWED');
    if(item.type==='number') {
      if(['min','max','step'].some(key=>item[key]!==undefined && !Number.isFinite(item[key]))
        || (item.min!==undefined && item.max!==undefined && item.min>item.max)
        || (item.step!==undefined && item.step<=0))throw Error('EDITABLE_RANGE_INVALID');
    } else if(['min','max','step'].some(key=>item[key]!==undefined))throw Error('EDITABLE_RANGE_NOT_ALLOWED');
  }
  for(const marker of declarations.markers)frameTime(marker.frame,totalFrames);
  for(const region of declarations.regions) {
    if(region.sourcePath!==undefined && !safePath(region.sourcePath))throw Error('REGION_SOURCE_PATH_INVALID');
    if(region.line!==undefined && (!Number.isSafeInteger(region.line) || region.line<1))throw Error('REGION_SOURCE_LINE_INVALID');
  }
  return snapshot(declarations);
}

/** Regions are evidence for this completed draw, never a new source-location declaration. */
export function checkedRegions(regions,declarations,width,height) {
  if(!Array.isArray(regions) || regions.length>declarations.length)throw Error('REGION_BOUNDS_INVALID');
  const declared=new Set(declarations.map(region=>region.id)),seen=new Set();
  return snapshot(regions.map(region=>{
    if(!region || Object.keys(region).some(key=>!['id','x','y','width','height'].includes(key))
      || !declared.has(region.id) || seen.has(region.id))throw Error('REGION_UNDECLARED');
    seen.add(region.id);
    if(!['x','y','width','height'].every(key=>Number.isFinite(region[key]))
      || region.width<0 || region.height<0)throw Error('REGION_BOUNDS_INVALID');
    if(region.x<0 || region.y<0 || region.x+region.width>width || region.y+region.height>height)
      throw Error('REGION_OUT_OF_BOUNDS');
    return {...region};
  }));
}

export function inspectRegions(regions,declarations,width,height,x01,y01) {
  if(![x01,y01].every(value=>Number.isFinite(value) && value>=0 && value<=1))throw Error('INSPECT_COORDINATES_INVALID');
  if(x01===1 || y01===1)return null;
  const x=x01*width,y=y01*height;
  for(const declaration of [...declarations].reverse()) {
    const bounds=regions.find(region=>region.id===declaration.id);
    if(bounds && x>=bounds.x && x<bounds.x+bounds.width && y>=bounds.y && y<bounds.y+bounds.height) {
      const {id:regionId,sourcePath,line}=declaration;
      return {regionId,...(sourcePath===undefined?{}:{sourcePath}),...(line===undefined?{}:{line}),
        bounds:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}};
    }
  }
  return null;
}

/**
 * A direct, serialized reviewed-fixture API, not the cross-origin RenderProtocol bridge.
 * The host owns media lifetime; value preparations may share its verified immutable resources.
 */
export async function createCompositionRuntime(input) {
  const {definition,root,targetId,width,height,durationSeconds,seed,values={},media,
    mode='trusted_render',pixelScale=mode==='local_preview'?0.5:1}=input;
  if(!root?.ownerDocument || definition?.apiVersion!=='2.7.0' || typeof definition.prepare!=='function')
    throw new TypeError('COMPOSITION_INVALID');
  if(![15,30].includes(durationSeconds) || ![width,height].every(value=>Number.isSafeInteger(value) && value>0))
    throw new TypeError('DIMENSIONS_INVALID');
  if(!['trusted_render','local_preview'].includes(mode) || pixelScale!==(mode==='local_preview'?0.5:1)
    || ![width*pixelScale,height*pixelScale].every(Number.isSafeInteger))throw Error('SURFACE_MODE_INVALID');
  if(mode==='trusted_render' && Object.hasOwn(input,'valuesOverlay'))throw Error('TRUSTED_RENDER_OVERLAY_FORBIDDEN');
  const totalFrames=durationSeconds*30,declarations=declarationsFor(definition,totalFrames);
  if((declarations.videoUses.length && typeof media?.videoFrames?.get!=='function')
    || (declarations.fonts.length && (!media?.fonts?.ready || typeof media.fonts.family!=='function')))
    throw Error('CAPABILITY_UNAVAILABLE: verified media and font registries are required');
  const editables=Object.fromEntries(declarations.editables.map(item=>[item.id,item]));
  // A public resource URL is not a grant to use it as an editable visual. Font/audio
  // files and evidence stay outside the controller's explicit drawable inventory.
  const valueContext={editables,sourceValues:values,resources:media?.resources??{},drawableResourcePaths:media?.drawableResourcePaths??[]};
  const valueErrors=editableValuesErrors(values,valueContext);
  if(valueErrors.length)throw Error(valueErrors[0]);
  const frozenValues=snapshot(values);
  valueContext.sourceValues=frozenValues;
  const initialValues=mode==='local_preview'?localPreviewValues(input.valuesOverlay??{},valueContext):frozenValues;
  const prepare=definition.prepare.bind(Object.freeze({...declarations,apiVersion:'2.7.0',prepare:definition.prepare}));
  const emptyFonts=Object.freeze({ready:Promise.resolve(),family:()=>{throw Error('CAPABILITY_UNAVAILABLE');},
    assertText:()=>{throw Error('CAPABILITY_UNAVAILABLE');}});
  const fonts=media?.fonts??emptyFonts;
  const videoFrames=media?.videoFrames??Object.freeze({get:async()=>{throw Error('CAPABILITY_UNAVAILABLE');}});
  await fonts.ready;
  root.replaceChildren();
  Object.assign(root.style,{width:width*pixelScale+'px',height:height*pixelScale+'px',position:'relative',overflow:'hidden'});
  let active,appliedEpoch=0,disposed=false,pending=Promise.resolve(),readyFrame=null,lastFrame=0;
  const cleanupErrors=[];
  const serial=operation=>{
    const next=pending.then(operation);pending=next.catch(()=>{});return next;
  };
  const release=async candidate=>{
    try {await candidate?.prepared?.dispose();}finally {candidate?.root.remove();}
  };
  const ensureSession=()=>{if(disposed)throw Error('INVALID_SESSION');};
  const ensureEpoch=options=>{
    ensureSession();
    if(mode==='local_preview' && options?.previewEpoch!==appliedEpoch)throw Error('PREVIEW_EPOCH_STALE');
    if(mode==='trusted_render' && options?.previewEpoch!==undefined)throw Error('TRUSTED_RENDER_OVERLAY_FORBIDDEN');
  };
  const draw=async(candidate,frameIndex)=>{
    const time=frameTime(frameIndex,totalFrames);
    assertSupportedDrawing(candidate.root);
    const result=await candidate.prepared.draw(time);
    const regions=checkedRegions(result?.regions??[],declarations.regions,width,height);
    await settleDirectDrawing(candidate.root);
    return {frameIndex,time,regions};
  };
  const prepareCandidate=async(nextValues,frameIndex)=>{
    const inner=root.ownerDocument.createElement('div');
    Object.assign(inner.style,{position:'absolute',left:'0px',top:'0px',width:width+'px',height:height+'px',
      overflow:'hidden',transform:`scale(${pixelScale})`,transformOrigin:'0 0',visibility:'hidden'});
    root.append(inner);
    const context=Object.freeze({targetId,width,height,fps:30,totalFrames,seed,
      values:snapshot(nextValues),assets:media?.assets??Object.freeze({}),fonts,videoFrames,
      surface:Object.freeze({mode,pixelScale,root:inner,
        createCanvas() {
          const canvas=root.ownerDocument.createElement('canvas');
          canvas.width=width*pixelScale;canvas.height=height*pixelScale;
          Object.assign(canvas.style,{width:width+'px',height:height+'px'});inner.append(canvas);return canvas;
        }}),randomAt:key=>randomAt(seed,key)});
    const candidate={root:inner,context};
    try {
      candidate.prepared=await prepare(context);
      if(!candidate.prepared || typeof candidate.prepared.draw!=='function' || typeof candidate.prepared.dispose!=='function')
        throw Error('PREPARED_COMPOSITION_INVALID');
      assertSupportedDrawing(inner);
      candidate.receipt=await draw(candidate,frameIndex);
      return candidate;
    } catch(error) {
      try {await release(candidate);}catch(cause){cleanupErrors.push(String(cause.message??cause));}
      throw error;
    }
  };
  const show=async(candidate,previous)=>{
    candidate.root.style.visibility='';
    root.replaceChildren(candidate.root);
    try {await settleDirectDrawing(candidate.root);}
    catch(error) {
      if(previous)root.replaceChildren(previous.root);else root.replaceChildren();
      try {await release(candidate);}catch(cause){cleanupErrors.push(String(cause.message??cause));}
      throw error;
    }
  };
  active=await prepareCandidate(initialValues,0);
  await show(active);
  readyFrame=0;
  return Object.freeze({
    seek(frameIndex,options) {
      return serial(async()=>{
        ensureEpoch(options);frameTime(frameIndex,totalFrames);readyFrame=null;
        const receipt=await draw(active,frameIndex);lastFrame=frameIndex;readyFrame=frameIndex;
        return {...receipt,...(mode==='local_preview'?{previewEpoch:appliedEpoch}:{})};
      });
    },
    inspect(frameIndex,x01,y01,options) {
      return serial(async()=>{
        ensureEpoch(options);frameTime(frameIndex,totalFrames);
        if(![x01,y01].every(value=>Number.isFinite(value) && value>=0 && value<=1))throw Error('INSPECT_COORDINATES_INVALID');
        readyFrame=null;
        const receipt=await draw(active,frameIndex);lastFrame=frameIndex;readyFrame=frameIndex;
        return {...receipt,hit:inspectRegions(receipt.regions,declarations.regions,width,height,x01,y01),
          ...(mode==='local_preview'?{previewEpoch:appliedEpoch}:{})};
      });
    },
    setValues({valuesOverlay,requestedEpoch}={}) {
      // Capture the submitted command now, before a preceding draw finishes. A caller
      // retaining the form object cannot rewrite an already enqueued operation.
      let submittedOverlay,submissionError;
      try {sourceValuesBytes(valuesOverlay);submittedOverlay=snapshot(valuesOverlay);}
      catch(error){submissionError=error.message;}
      return serial(async()=>{
        ensureSession();
        if(mode!=='local_preview')throw Error('TRUSTED_RENDER_OVERLAY_FORBIDDEN');
        const reject=(code,reason)=>({event:'values-rejected',requestedEpoch,appliedEpoch,code,...(reason?{reason}:{})});
        if(!Number.isSafeInteger(requestedEpoch) || requestedEpoch!==appliedEpoch+1)return reject('EPOCH_STALE');
        if(submissionError)return reject('VALUES_INVALID',submissionError);
        let nextValues,candidate;
        try {nextValues=localPreviewValues(submittedOverlay,valueContext);}
        catch(error){return reject('VALUES_INVALID',error.message);}
        try {candidate=await prepareCandidate(nextValues,lastFrame);await show(candidate,active);}
        catch(error){return reject('PREPARE_FAILED',error.message);}
        const previous=active;active=candidate;appliedEpoch=requestedEpoch;readyFrame=lastFrame;
        // A ready replacement is already committed. Cleanup faults are retained and fail final disposal.
        try {await release(previous);}catch(error){cleanupErrors.push(String(error.message??error));}
        return {event:'values-applied',requestedEpoch,appliedEpoch};
      });
    },
    snapshot() {
      ensureSession();
      return snapshot({mode,pixelScale,appliedEpoch:mode==='local_preview'?appliedEpoch:null,frameIndex:readyFrame,
        values:active.context.values,sourceValues:frozenValues,declarations,cleanupErrors});
    },
    dispose() {
      return serial(async()=>{
        if(disposed)return;disposed=true;readyFrame=null;
        try {await release(active);}finally {root.replaceChildren();}
        if(cleanupErrors.length)throw Error('PREPARATION_CLEANUP_FAILED: '+cleanupErrors.join('; '));
      });
    }
  });
}
