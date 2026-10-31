import {isCanvasTextScene} from '@promobento/contracts/canvas-text';
import { randomSequence } from '@promobento/contracts/random';
import type { BlockDefinition, BlockInstance, CustomScene, FilmScene, FilmSpec, SceneContext, SceneRegion, TextSlotHandle } from '../../../contracts/film-runtime.d.ts';
import {customScenePlan} from '@promobento/contracts/custom-source';
import {createClipHelpers} from './clip/helpers.js';
import type { Envelope, Init, Seek, Sample, Inspect, Dispose, HitResult } from '../../../contracts/render-protocol.d.ts';
import { frameLayers } from './motion.ts';
import {parseMetricText,metricTextAt} from './metric-text.ts';
import {createTextIntegrity} from './text-integrity.ts';
import {isStudioRuntime} from '@promobento/contracts/studio-runtime';
import type { PagePlan, FilmEngine, StudioInstance } from './types.ts';

const clock = window.__pbTakeClock?.();
if (!clock) throw Error('RUNTIME_CLOCK_HANDOFF_MISSING');
const inspectWebgl=window.__pbTakeWebGLInspector?.();
if(!inspectWebgl)throw Error('RUNTIME_WEBGL_HANDOFF_MISSING');
const cloneSceneData=globalThis.structuredClone.bind(globalThis);
const blocks = new Map<string, BlockDefinition>();
const customScenes = new Map<string,(ctx:SceneContext)=>CustomScene>();
const instances = new Map<string, {scene: FilmScene; root: HTMLElement; instance: BlockInstance; random: ReturnType<typeof randomSequence>; postSeek: Map<(time: number) => void, number>}>();
const fitters: Array<() => void> = [];
const textIntegrity=createTextIntegrity();
const textRegions = new Map<string, SceneRegion[]>();
const requestIds = new Set<string>();
const videoCache = new Map<string, ImageBitmap>();
let videoBytes = 0;
let plan: PagePlan | undefined, envelope: Init | undefined, busy = false, disposed = false, frame = -1, lastSequence = 0;
let filmBody:HTMLElement|undefined,filmStage:HTMLElement|undefined,filmPlanElement:Element|undefined;
window.__omReady = false;
Object.defineProperty(window, 'PB', {value: Object.freeze({
  info: Object.freeze({apiVersion: '3.0.0' as const, specVersion: 'film-v1' as const}),
  defineBlock<Params>(definition: BlockDefinition<Params>): void {
    const path=new URL((document.currentScript as HTMLScriptElement|null)?.src??location.href).pathname;
    if (plan || blocks.has(definition.id)||!['/runtime/blocks.js','/runtime/blocks-3d.js'].includes(path)) throw Error('BLOCK_REGISTRATION_CLOSED');
    blocks.set(definition.id, definition as BlockDefinition);
  },
  scene(id:string,factory:(ctx:SceneContext)=>CustomScene):void {
    const path=new URL((document.currentScript as HTMLScriptElement|null)?.src??location.href).pathname;
    if(plan||customScenes.has(id)||path!==`/scenes/${id}/index.js`||typeof factory!=='function')throw Error('CUSTOM_REGISTRATION_INVALID');
    customScenes.set(id,factory);
  }
}), writable: false, configurable: false});
const requiredPlan = (): PagePlan => { if (!plan) throw Error('INVALID_SESSION'); return plan; };
const check = (input: Envelope & {command: string}, command: string): void => {
  if (busy) throw Error('COMMAND_IN_PROGRESS');
  if (!input || input.command !== command || !envelope || disposed || input.protocolVersion !== '3.0.0' || input.sessionId !== envelope.sessionId
    || input.revisionId !== envelope.revisionId || input.aspectId !== envelope.aspectId
    || !input.requestId || requestIds.has(input.requestId) || !Number.isSafeInteger(input.sequence) || input.sequence !== lastSequence + 1) throw Error('INVALID_SESSION');
  lastSequence = input.sequence;
  requestIds.add(input.requestId);
};
const fontFamily = (fontId: string): string => '"PB-' + fontId + '"';

function textSlot(slotId: string, sceneStyle?: FilmSpec['style'], splitGraphemes=false): TextSlotHandle {
  const current = requiredPlan();
  const slot = current.spec.texts[slotId];
  if (!slot) throw Error('TEXT_SLOT_UNKNOWN');
  return {
    slotId, text: slot.text, role: slot.role,
    mount(parent, options = {}) {
      const el = document.createElement('span');
      if(splitGraphemes&&options.split==='graphemes'){
        for(const {segment} of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(slot.text)){
          if(/^\s+$/u.test(segment)){el.append(document.createTextNode(segment));continue;}
          const mask=document.createElement('span'),character=document.createElement('span');
          Object.assign(mask.style,{display:'inline-block',overflow:'hidden',verticalAlign:'top'});
          character.className='pb-grapheme';character.style.display='inline-block';character.textContent=segment;mask.append(character);el.append(mask);
        }
      }else el.textContent = slot.text;
      el.dataset.omId = slotId; el.dataset.pbSlot = slotId;
      if (slot.lang) el.lang = slot.lang;
      const display = slot.role === 'headline' || slot.role === 'cta' || slot.role === 'number';
      const style=sceneStyle??current.spec.style,font = style.type[display ? 'display' : 'text'];
      const landscape = current.target.aspect === 'landscape';
      const minimum = slot.role === 'cta' ? landscape ? 28 : 32 : landscape ? 32 : 36;
      const scale = {compact: 0.85, regular: 1, large: 1.15}[style.type.scale];
      const natural = display ? Math.max(minimum, Math.min(150, current.target.width * 0.085) * scale) : Math.max(minimum, 40 * scale);
      if (options.maxFontSize !== undefined && (!Number.isFinite(options.maxFontSize) || options.maxFontSize < minimum)) throw Error('TEXT_SIZE_INVALID');
      const start = Math.min(natural, options.maxFontSize ?? natural);
      Object.assign(el.style, {display: 'block', width: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'normal', wordBreak: 'normal',
        fontFamily: fontFamily(font.fontId), fontWeight: String(font.weight), fontStyle: font.style ?? 'normal',
        lineHeight: '1.1', letterSpacing: display ? '-0.045em' : '-0.015em', color: style.palette.roles.ink,
        textAlign: options.align ?? 'start'});
      parent.append(el);
      const sceneRoot = el.closest<HTMLElement>('[data-scene]');
      if (!sceneRoot?.dataset.scene) throw Error('TEXT_SCENE_MISSING');
      textIntegrity.register(sceneRoot,el,slot.text);
      const regions = textRegions.get(sceneRoot.dataset.scene) ?? [];
      regions.push({regionId: slotId, boxAt() {
        if (!el.getClientRects().length || getComputedStyle(el).visibility !== 'visible') return null;
        for (let parent: HTMLElement | null = el; parent && parent !== sceneRoot; parent = parent.parentElement)
          if (Number(getComputedStyle(parent).opacity) === 0) return null;
        const box = el.getBoundingClientRect(), sceneBox = sceneRoot.getBoundingClientRect();
        return {x: box.x - sceneBox.x, y: box.y - sceneBox.y, width: box.width, height: box.height};
      }});
      textRegions.set(sceneRoot.dataset.scene, regions);
      fitters.push(() => {
        const maxLines = options.maxLines ?? slot.maxLines ?? (display ? 4 : 3);
        const parentHeight = parent.getBoundingClientRect().height;
        for (let size = Math.floor(start); size >= minimum; size--) {
          el.style.fontSize = size + 'px';
          if (el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= Math.min(parentHeight, size * 1.1 * maxLines) + 2) return;
        }
        throw Error('TEXT_FIT_FAILED:' + slotId);
      });
      return el;
    }
  };
}

async function draw(frameIndex: number): Promise<void> {
  const current = requiredPlan();
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= current.spec.totalFrames) throw Error('FRAME_OUT_OF_RANGE');
  busy = true;
  try {
    clock!.seek(frameIndex / 30);
    const layers = frameLayers(current.spec.scenes, frameIndex);
    for (const value of instances.values()) {
      value.root.style.display = 'none'; value.root.style.visibility = 'hidden'; value.root.style.opacity = '1'; value.root.style.transform = 'none'; value.root.style.filter = 'none';
    }
    for (const layer of layers) {
      const value = instances.get(layer.id)!;
      value.root.style.display = 'block';
      value.random.reset();
      value.instance.timeline?.pause();
      value.instance.timeline?.seek(layer.seconds, true);
      const pending = [...value.postSeek]; value.postSeek.clear();
      for (const [draw, time] of pending) {
        const result = draw(time) as unknown;
        if (result && typeof (result as {then?:unknown}).then === 'function') throw Error('CUSTOM_ASYNC_DRAW_UNSUPPORTED');
      }
      await value.instance.render?.(layer.seconds);
      value.root.style.visibility = 'visible'; value.root.style.opacity = String(layer.opacity);
      value.root.style.transform = `translateX(${layer.x * current.target.width}px)`;
      value.root.style.filter = layer.blur ? `blur(${layer.blur}px)` : 'none';
    }
    for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = frameIndex / 30 * 1000; }
    await clock!.paint(current.frameTimeoutMs);
    if (window.__omBootFailed) throw Error(window.__omBootFailed);
    // The sampled CDP observations remain necessary for visibility, typography
    // and contrast. This separate check binds every emitted custom frame's DOM
    // text, including frames between those sampling points, to its real slot.
    const hasCustom=current.spec.scenes.some(scene=>scene.kind==='custom');
    for(const layer of layers){const instance=instances.get(layer.id)!;
      if(instance.scene.kind==='custom'||hasCustom&&instance.scene.kind==='block'){
        const scene=instance.scene;
        const metricSlot=scene.kind==='block'&&scene.block==='metric@1'?String(scene.params.textSlot):undefined;
        const metricElement=(instance.instance as BlockInstance & {metricTextElement?:HTMLElement}).metricTextElement;
        if(metricSlot&&!metricElement)throw Error('METRIC_TEXT_HANDOFF_MISSING');
        const override=metricSlot?{element:metricElement!,expected:metricTextAt(parseMetricText(current.spec.texts[metricSlot]!.text),layer.seconds).text}:undefined;
        textIntegrity.verify(instance.root,override);
      }}
    if(hasCustom)textIntegrity.verifyBody(filmBody!,filmStage!,filmPlanElement!);
    frame = frameIndex;
  } finally { busy = false; }
}

const engine: FilmEngine = {
  webglInfo(){return inspectWebgl!();},
  canvasTextProof(){
    if(frame<0||busy||disposed)throw Error('FRAME_NOT_READY');
    return frameLayers(requiredPlan().spec.scenes,frame).flatMap(layer=>{
      const value=instances.get(layer.id)!,proof=value.instance.canvasTextProof?.();return proof?(Array.isArray(proof)?proof:[proof]).map(item=>({...item,sceneId:layer.id})):[];
    });
  },
  async prepare(input) {
    try { await clock!.wait((async () => {
    if (plan || disposed) throw Error('INVALID_SESSION');
    plan = input;
    // Authored factories must never run if the trusted block bundle failed to
    // consume the one-shot native Canvas text capability.
    if (window.__pbTakeCanvasText) {
      delete window.__pbTakeCanvasText;
      throw Error('RUNTIME_TEXT_HANDOFF_MISSING');
    }
    const studioFactory = window.__pbTakeStudioFactory?.();
    // If no 3D bundle consumed it, discard the creation capability before author code runs.
    window.__pbTakeWebGLFactory?.();
    // Keep immutable admitted values before any authored factory runs. Each
    // scene gets its own mutable handles, including nested ROI/video metadata.
    const admittedAssets=cloneSceneData(input.assets),admittedStyle=cloneSceneData(input.spec.style);
    const admittedStudioAssets=new Map(Object.entries(admittedAssets));
    const admittedStudioPalette={...admittedStyle.palette.roles};
    Object.defineProperty(window, '__omTarget', {value: Object.freeze({...input.target, safeInsets: Object.freeze({...input.target.safeInsets})}), writable: false});
    window.CLIP.U.setStage(input.target.width, input.target.height);
    const stage = document.getElementById('film');
    if (!stage) throw Error('RUNTIME_STAGE_MISSING');
    const planElement=document.getElementById('pb-plan');if(!document.body||!planElement)throw Error('RUNTIME_STAGE_MISSING');
    filmBody=document.body;filmStage=stage;filmPlanElement=planElement;
    const fontLoads = input.fonts.map(font => document.fonts.load(`${font.style} ${font.weight} 36px ${fontFamily(font.fontId)}`));
    await Promise.all([...fontLoads, document.fonts.ready]);
    if (disposed) throw Error('INVALID_SESSION');
    for (const scene of input.spec.scenes) {
      const definition = scene.kind==='block'?blocks.get(scene.block.split('@')[0]!):null;
      if (scene.kind==='block'&&!definition) throw Error('BLOCK_UNKNOWN');
      const factory=scene.kind==='custom'?customScenes.get(scene.id):null;
      if(scene.kind==='custom'&&!factory)throw Error('CUSTOM_SOURCE_MISSING');
      const root = document.createElement('section'); root.dataset.scene = scene.id;
      textIntegrity.registerRoot(root);
      Object.assign(root.style, {position: 'absolute', inset: '0', overflow: 'hidden', visibility: 'hidden', background: input.spec.style.palette.roles.bg});
      stage.append(root);
      const random = randomSequence(input.seed + '\0' + scene.id);
      const sceneAssets=cloneSceneData(admittedAssets),sceneStyle=cloneSceneData(admittedStyle);
      const sceneClip=scene.kind==='block'?createClipHelpers():window.CLIP;
      if(scene.kind==='block')sceneClip.U.setStage(input.target.width,input.target.height);
      const helperRegions: SceneRegion[] = [];
      const readiness = {open:true, pending:[] as Promise<unknown>[]};
      const postSeek = new Map<(time: number) => void, number>();
      const sounds = {open:scene.kind==='custom'&&scene.params?.sourceSfx===true,declarations:input.customSfx?.[scene.id]??[],used:new Set<number>()};
      const ctx: SceneContext = {
        root, target: window.__omTarget, frames: {start: scene.start, end: scene.end}, beats: input.spec.audio.music.kind==='procedural'&&input.spec.audio.music.bpm?
          Array.from({length:Math.ceil(input.spec.totalFrames/(1800/input.spec.audio.music.bpm))},(_,i)=>Math.round(i*1800/(input.spec.audio.music as {bpm:number}).bpm)).filter(frame=>frame>=scene.start&&frame<scene.end):[],
        OM: window.__pbCreateOM({root, target: window.__omTarget, sceneScoped:scene.kind==='custom'&&scene.params?.gsapScope==='scene',
          ...(input.spec.audio.music.kind==='procedural'&&input.spec.audio.music.bpm?{bpm:input.spec.audio.music.bpm}:{})}, helperRegions, readiness, sounds, postSeek), CLIP: sceneClip,
        style: {...sceneStyle, palette: sceneStyle.palette.roles}, random: () => random.next(), text: slotId=>textSlot(slotId,sceneStyle,scene.kind==='custom'&&scene.runtimeText==='grapheme-v1'),
        asset(key) {
          const asset = sceneAssets[key]; if (!asset) throw Error('ASSET_SLOT_UNKNOWN');
          if (asset.kind !== 'video') return asset;
          return {...asset, async frameAt(seconds: number) {
            if (!Number.isFinite(seconds) || seconds < 0) throw Error('VIDEO_FRAME_UNAVAILABLE');
            const time = seconds + (asset.videoStartSeconds ?? 0), frames = asset.videoFrames!;
            let low = 0, high = frames.length - 1, index = -1;
            while (low <= high) { const middle = (low + high) >>> 1;
              if (frames[middle]!.pts <= time + 1e-8) { index = middle; low = middle + 1; } else high = middle - 1;
            }
            const selected = frames[index];
            if (!selected || time >= selected.pts + selected.duration + 1e-8) throw Error('VIDEO_FRAME_UNAVAILABLE');
            const key = asset.resourceId + '/' + selected.index;
            const cached = videoCache.get(key); if (cached) return cached;
            const image = new Image(); image.src = '/frames/' + key + '.webp';
            try { await image.decode(); } catch { throw Error('VIDEO_FRAME_UNAVAILABLE'); }
            const bitmap = await createImageBitmap(image);
            const bytes = bitmap.width * bitmap.height * 4;
            if (bytes > 128 << 20) { bitmap.close(); throw Error('VIDEO_FRAME_CACHE_LIMIT'); }
            while (videoBytes + bytes > 128 << 20 || videoCache.size >= 16) {
              const oldest = videoCache.keys().next().value!; const old = videoCache.get(oldest)!;
              videoBytes -= old.width * old.height * 4; old.close(); videoCache.delete(oldest);
            }
            videoCache.set(key, bitmap); videoBytes += bytes; return bitmap;
          }};
        }
      };
      let instance:BlockInstance;
      if(scene.kind==='custom'){
        const declared=customScenePlan(scene),studios: StudioInstance[]=[];
        let studioOpen=true;
        if(isStudioRuntime(scene.runtime3D)){
          if(!studioFactory)throw Error('CUSTOM_3D_RUNTIME_UNAVAILABLE');
          // Freeze the trusted inputs before author code can mutate its ordinary ctx handles.
          const studioAssets=new Map(declared.assetKeys.map(key=>[key,{...admittedStudioAssets.get(key)!}]));
          const studioCtx:SceneContext={...ctx,root,frames:{start:scene.start,end:scene.end},
            style:{...ctx.style,palette:{...admittedStudioPalette}},asset(key){const asset=studioAssets.get(key);if(!asset)throw Error('CUSTOM_SLOT_UNDECLARED');return asset;}};
          ctx.OM3=Object.freeze({studio(assetKey:string,panelKeys?:readonly string[]){
            if(!studioOpen||studios.length)throw Error('CUSTOM_3D_STUDIO_CLOSED');
            if(typeof assetKey!=='string'||!declared.assetKeys.includes(assetKey))throw Error('CUSTOM_SLOT_UNDECLARED');
            const multi=scene.runtime3D==='om3-studio-v3'||scene.runtime3D==='om3-studio-v4';
            if(multi&&(!Array.isArray(panelKeys)||panelKeys.length<1||panelKeys.length>2||new Set([assetKey,...panelKeys]).size!==panelKeys.length+1
              ||panelKeys.some(key=>typeof key!=='string'||!declared.assetKeys.includes(key))))throw Error('CUSTOM_SLOT_UNDECLARED');
            const studio=studioFactory(studioCtx,{assetKey,...(scene.runtime3D==='om3-studio-v2'||multi?{objectMotion:true}:{}),...(multi?{panelKeys:[...panelKeys!]}:{}),...(scene.runtime3D==='om3-studio-v4'?{panelFocus:{...scene.params!.panelFocus as Record<string,string>}}:{})});studios.push(studio);
            void studio.ready.catch(()=>{});readiness.pending.push(studio.ready);
            return Object.freeze({render:(view:Parameters<typeof studio.renderView>[0])=>{if(studioOpen)throw Error('CUSTOM_3D_EARLY_DRAW');studio.renderView(view);}});
          }});
        }

        let built:CustomScene|undefined,gsapScope:{kill():void}|undefined;
        // Opt in for original compositions that address their own elements by selector.
        // Older custom scenes keep their original document-wide GSAP semantics.
        try{
          if(scene.params?.gsapScope==='scene')gsapScope=window.gsap.context(()=>{built=factory!(ctx);},root);
          else built=factory!(ctx);
          const timeline=built?.timeline;
          if(!built||!timeline||!['pause','seek','duration'].every(key=>typeof (timeline as unknown as Record<string,unknown>)[key]==='function'))throw Error('CUSTOM_TIMELINE_REQUIRED');
          if(Math.abs(built.timeline.duration()-(scene.end-scene.start)/30)>1/30)throw Error('CUSTOM_TIMELINE_DURATION');
          if(built.events&&(!Array.isArray(built.events)||built.events.length!==declared.events.length||built.events.some((event,index)=>event.name!==declared.events[index]!.name||event.frame!==declared.events[index]!.frame)))throw Error('CUSTOM_EVENT_MISMATCH');
          if(isStudioRuntime(scene.runtime3D)&&studios.length!==1)throw Error('CUSTOM_3D_ONE_STUDIO_REQUIRED');
          instance={timeline:built.timeline,events:declared.events,regions:built.regions??[],...((gsapScope||studios.length)?{dispose:()=>{try{gsapScope?.kill();}finally{studios.forEach(studio=>studio.dispose());}}}:{})};
        }catch(error){try{gsapScope?.kill();}finally{studios.forEach(studio=>studio.dispose());}throw error;}finally{studioOpen=false;}
      }else instance=definition!.build(ctx,scene.params);
      sounds.open=false;
      if(sounds.used.size!==sounds.declarations.length)throw Error('CUSTOM_SFX_NOT_EXECUTED');
      if (!instance.render && !instance.timeline) throw Error('BLOCK_DRAW_MISSING');
      if (instance.render && instance.timeline) throw Error('BLOCK_DRAW_AMBIGUOUS');
      if(instance.ready)readiness.pending.push(instance.ready);
      if(readiness.pending.length){
        instance={...instance,ready:(async()=>{
          let index=0;
          try{
            while(index<readiness.pending.length){const batch=readiness.pending.slice(index);index+=batch.length;await Promise.all(batch);}
          }finally{readiness.open=false;}
        })()};
      }else readiness.open=false;
      instance.timeline?.pause();
      instances.set(scene.id, {scene, root, instance: {...instance, regions: [...instance.regions, ...helperRegions, ...(textRegions.get(scene.id) ?? [])]}, random, postSeek});
    }
    await Promise.all([...instances.values()].map(value=>value.instance.ready));
    await Promise.all([...document.images].map(image => image.decode()));
    if (disposed) throw Error('INVALID_SESSION');
    for (const fit of fitters) fit();
    document.documentElement.dataset.omSignature = 'off';
    window.__omReady = true;
    })(), input.initTimeoutMs, 'INIT_TIMEOUT'); }
    catch (error) { disposed = true;await Promise.allSettled([...instances.values()].map(value=>Promise.resolve().then(()=>value.instance.dispose?.())));throw error; }
  },
  async init(input: Init) {
    const current = requiredPlan();
    if (!input || input.command !== 'init' || envelope || !window.__omReady || input.protocolVersion !== '3.0.0' || input.mode !== 'trusted_render'
      || input.pixelScale !== 1 || 'valuesOverlay' in input || input.manifestHash !== current.manifestHash
      || input.frameCount !== current.spec.totalFrames || input.width !== current.target.width || input.height !== current.target.height
      || input.aspectId !== current.target.aspect || input.fps !== 30 || input.seed !== current.seed
      || input.renderProfile.sampleCount !== 1 || input.renderProfile.shutterAngle !== 0
      || input.renderProfile.sampling !== 'centered-box-v1' || input.renderProfile.edgePolicy !== 'clamp-v1'
      || !input.requestId || !input.sessionId || !input.revisionId || input.sequence !== 1) throw Error('INVALID_SESSION');
    envelope = structuredClone(input); lastSequence = 1; requestIds.add(input.requestId);
    clock!.begin(current.seed);
  },
  async seekFrame(input: Seek) {
    check(input, 'seek');
    if ('previewEpoch' in input) throw Error('INVALID_SESSION');
    await draw(input.frameIndex);
    const current=requiredPlan(),usesCanvas=current.spec.scenes.some(scene=>isCanvasTextScene(scene));
    const canvasTextTrace=usesCanvas?frameLayers(current.spec.scenes,input.frameIndex).flatMap(layer=>{
      const value=instances.get(layer.id)!,trace=value.instance.canvasTextTrace?.();return trace?(Array.isArray(trace)?trace:[trace]).map(item=>({...item,sceneId:layer.id})):[];
    }):undefined;
    return {...input, event: 'frame-ready' as const, manifestHash: current.manifestHash,...(canvasTextTrace?{canvasTextTrace}:{})};
  },
  async sampleSubframe(input: Sample) {
    check(input, 'sample');
    if (input.sampleIndex !== 0) throw Error('FRAME_OUT_OF_RANGE');
    await draw(input.frameIndex);
    return {...input, event: 'sample-ready' as const, manifestHash: requiredPlan().manifestHash};
  },
  async inspect(input: Inspect): Promise<HitResult> {
    check(input, 'inspect');
    if (input.frameIndex !== frame || !Number.isFinite(input.x01) || !Number.isFinite(input.y01)
      || input.x01 < 0 || input.x01 > 1 || input.y01 < 0 || input.y01 > 1 || 'previewEpoch' in input) throw Error('FRAME_OUT_OF_RANGE');
    const current = requiredPlan();
    let hit: HitResult['hit'] = null;
    for (const layer of frameLayers(current.spec.scenes, frame).reverse()) {
      if (layer.opacity <= 0) continue;
      for (const region of [...instances.get(layer.id)!.instance.regions].reverse()) {
        const box = region.boxAt(frame - instances.get(layer.id)!.scene.start);
        const x = input.x01 * current.target.width - layer.x * current.target.width, y = input.y01 * current.target.height;
        if (box && x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height) {
          hit = {regionId: region.regionId, bounds: {...box, x: box.x + layer.x * current.target.width}};
          break;
        }
      }
      if (hit) break;
    }
    return {...input, event: 'hit-result', manifestHash: current.manifestHash, hit};
  },
  async dispose(input: Dispose) {
    check(input, 'dispose'); disposed = true;
    await Promise.all([...instances.values()].map(value=>value.instance.dispose?.()));
    instances.clear(); textRegions.clear(); fitters.length = 0;
    customScenes.clear();
    for (const bitmap of videoCache.values()) bitmap.close(); videoCache.clear(); videoBytes = 0;
    document.getElementById('film')?.replaceChildren(); window.__omReady = false;
  }
};
Object.defineProperty(window, '__omEngine', {value: Object.freeze(engine), writable: false, configurable: false});
