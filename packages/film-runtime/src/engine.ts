import { randomSequence } from '@promobento/contracts/random';
import type { BlockDefinition, BlockInstance, CustomScene, FilmScene, SceneContext, SceneRegion, TextSlotHandle } from '../../../contracts/film-runtime.d.ts';
import {customScenePlan} from '@promobento/contracts/custom-source';
import type { Envelope, Init, Seek, Sample, Inspect, Dispose, HitResult } from '../../../contracts/render-protocol.d.ts';
import { frameLayers } from './motion.ts';
import type { PagePlan, FilmEngine } from './types.ts';

const clock = window.__pbTakeClock?.();
if (!clock) throw Error('RUNTIME_CLOCK_HANDOFF_MISSING');
const blocks = new Map<string, BlockDefinition>();
const customScenes = new Map<string,(ctx:SceneContext)=>CustomScene>();
const instances = new Map<string, {scene: FilmScene; root: HTMLElement; instance: BlockInstance; random: ReturnType<typeof randomSequence>}>();
const fitters: Array<() => void> = [];
const textRegions = new Map<string, SceneRegion[]>();
const requestIds = new Set<string>();
const videoCache = new Map<string, ImageBitmap>();
let videoBytes = 0;
let plan: PagePlan | undefined, envelope: Init | undefined, busy = false, disposed = false, frame = -1, lastSequence = 0;
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

function textSlot(slotId: string): TextSlotHandle {
  const current = requiredPlan();
  const slot = current.spec.texts[slotId];
  if (!slot) throw Error('TEXT_SLOT_UNKNOWN');
  return {
    slotId, text: slot.text, role: slot.role,
    mount(parent, options = {}) {
      const el = document.createElement('span');
      el.textContent = slot.text; el.dataset.omId = slotId; el.dataset.pbSlot = slotId;
      if (slot.lang) el.lang = slot.lang;
      const display = slot.role === 'headline' || slot.role === 'cta' || slot.role === 'number';
      const font = current.spec.style.type[display ? 'display' : 'text'];
      const landscape = current.target.aspect === 'landscape';
      const minimum = slot.role === 'cta' ? landscape ? 28 : 32 : landscape ? 32 : 36;
      const scale = {compact: 0.85, regular: 1, large: 1.15}[current.spec.style.type.scale];
      const natural = display ? Math.max(minimum, Math.min(150, current.target.width * 0.085) * scale) : Math.max(minimum, 40 * scale);
      if (options.maxFontSize !== undefined && (!Number.isFinite(options.maxFontSize) || options.maxFontSize < minimum)) throw Error('TEXT_SIZE_INVALID');
      const start = Math.min(natural, options.maxFontSize ?? natural);
      Object.assign(el.style, {display: 'block', width: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'normal', wordBreak: 'normal',
        fontFamily: fontFamily(font.fontId), fontWeight: String(font.weight), fontStyle: font.style ?? 'normal',
        lineHeight: '1.1', letterSpacing: display ? '-0.045em' : '-0.015em', color: current.spec.style.palette.roles.ink,
        textAlign: options.align ?? 'start'});
      parent.append(el);
      const sceneRoot = el.closest<HTMLElement>('[data-scene]');
      if (!sceneRoot?.dataset.scene) throw Error('TEXT_SCENE_MISSING');
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
      await value.instance.render?.(layer.seconds);
      value.root.style.visibility = 'visible'; value.root.style.opacity = String(layer.opacity);
      value.root.style.transform = `translateX(${layer.x * current.target.width}px)`;
      value.root.style.filter = layer.blur ? `blur(${layer.blur}px)` : 'none';
    }
    for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = frameIndex / 30 * 1000; }
    await clock!.paint(current.frameTimeoutMs);
    if (window.__omBootFailed) throw Error(window.__omBootFailed);
    frame = frameIndex;
  } finally { busy = false; }
}

const engine: FilmEngine = {
  async prepare(input) {
    try { await clock!.wait((async () => {
    if (plan || disposed) throw Error('INVALID_SESSION');
    plan = input;
    Object.defineProperty(window, '__omTarget', {value: Object.freeze({...input.target, safeInsets: Object.freeze({...input.target.safeInsets})}), writable: false});
    window.CLIP.U.setStage(input.target.width, input.target.height);
    const stage = document.getElementById('film');
    if (!stage) throw Error('RUNTIME_STAGE_MISSING');
    const fontLoads = input.fonts.map(font => document.fonts.load(`${font.style} ${font.weight} 36px ${fontFamily(font.fontId)}`));
    await Promise.all([...fontLoads, document.fonts.ready]);
    if (disposed) throw Error('INVALID_SESSION');
    for (const scene of input.spec.scenes) {
      const definition = scene.kind==='block'?blocks.get(scene.block.split('@')[0]!):null;
      if (scene.kind==='block'&&!definition) throw Error('BLOCK_UNKNOWN');
      const factory=scene.kind==='custom'?customScenes.get(scene.id):null;
      if(scene.kind==='custom'&&!factory)throw Error('CUSTOM_SOURCE_MISSING');
      const root = document.createElement('section'); root.dataset.scene = scene.id;
      Object.assign(root.style, {position: 'absolute', inset: '0', overflow: 'hidden', visibility: 'hidden', background: input.spec.style.palette.roles.bg});
      stage.append(root);
      const random = randomSequence(input.seed + '\0' + scene.id);
      const helperRegions: SceneRegion[] = [];
      const readiness = {open:true, pending:[] as Promise<unknown>[]};
      const sounds = {open:scene.kind==='custom'&&scene.params?.sourceSfx===true,declarations:input.customSfx?.[scene.id]??[],used:new Set<number>()};
      const ctx: SceneContext = {
        root, target: window.__omTarget, frames: {start: scene.start, end: scene.end}, beats: input.spec.audio.music.kind==='procedural'&&input.spec.audio.music.bpm?
          Array.from({length:Math.ceil(input.spec.totalFrames/(1800/input.spec.audio.music.bpm))},(_,i)=>Math.round(i*1800/(input.spec.audio.music as {bpm:number}).bpm)).filter(frame=>frame>=scene.start&&frame<scene.end):[],
        OM: window.__pbCreateOM({root, target: window.__omTarget, sceneScoped:scene.kind==='custom'&&scene.params?.gsapScope==='scene',
          ...(input.spec.audio.music.kind==='procedural'&&input.spec.audio.music.bpm?{bpm:input.spec.audio.music.bpm}:{})}, helperRegions, readiness, sounds), CLIP: window.CLIP,
        style: {...input.spec.style, palette: input.spec.style.palette.roles}, random: () => random.next(), text: textSlot,
        asset(key) {
          const asset = input.assets[key]; if (!asset) throw Error('ASSET_SLOT_UNKNOWN');
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
        const declared=customScenePlan(scene);
        let built:CustomScene|undefined,gsapScope:{kill():void}|undefined;
        // Opt in for original compositions that address their own elements by selector.
        // Older custom scenes keep their original document-wide GSAP semantics.
        if(scene.params?.gsapScope==='scene')gsapScope=window.gsap.context(()=>{built=factory!(ctx);},root);
        else built=factory!(ctx);
        const timeline=built?.timeline;
        if(!built||!timeline||!['pause','seek','duration'].every(key=>typeof (timeline as unknown as Record<string,unknown>)[key]==='function'))throw Error('CUSTOM_TIMELINE_REQUIRED');
        if(Math.abs(built.timeline.duration()-(scene.end-scene.start)/30)>1/30)throw Error('CUSTOM_TIMELINE_DURATION');
        if(built.events&&(!Array.isArray(built.events)||built.events.length!==declared.events.length||built.events.some((event,index)=>event.name!==declared.events[index]!.name||event.frame!==declared.events[index]!.frame)))throw Error('CUSTOM_EVENT_MISMATCH');
        instance={timeline:built.timeline,events:declared.events,regions:built.regions??[],...(gsapScope?{dispose:()=>gsapScope.kill()}:{})};
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
      instances.set(scene.id, {scene, root, instance: {...instance, regions: [...instance.regions, ...helperRegions, ...(textRegions.get(scene.id) ?? [])]}, random});
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
    return {...input, event: 'frame-ready' as const, manifestHash: requiredPlan().manifestHash};
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
