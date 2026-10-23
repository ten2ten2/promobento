import { randomSequence } from '@promobento/contracts/random';
import type { BlockDefinition, BlockInstance, FilmScene, SceneContext, TextSlotHandle } from '../../../contracts/film-runtime.d.ts';
import type { Envelope, Init, Seek, Sample, Inspect, Dispose, HitResult } from '../../../contracts/render-protocol.d.ts';
import { frameLayers } from './motion.ts';
import type { PagePlan, FilmEngine } from './types.ts';

const clock = window.__pbTakeClock?.();
if (!clock) throw Error('RUNTIME_CLOCK_HANDOFF_MISSING');
const blocks = new Map<string, BlockDefinition>();
const instances = new Map<string, {scene: FilmScene; root: HTMLElement; instance: BlockInstance; random: ReturnType<typeof randomSequence>}>();
const fitters: Array<() => void> = [];
const requestIds = new Set<string>();
let plan: PagePlan | undefined, envelope: Init | undefined, busy = false, disposed = false, frame = -1, lastSequence = 0;
window.__omReady = false;
window.PB = Object.freeze({
  info: Object.freeze({apiVersion: '3.0.0' as const, specVersion: 'film-v1' as const}),
  defineBlock<Params>(definition: BlockDefinition<Params>): void {
    if (plan || blocks.has(definition.id)) throw Error('BLOCK_REGISTRATION_CLOSED');
    blocks.set(definition.id, definition as BlockDefinition);
  },
  scene(): never { throw Error('CUSTOM_SCENES_NOT_IMPLEMENTED'); }
});
const requiredPlan = (): PagePlan => { if (!plan) throw Error('INVALID_SESSION'); return plan; };
const check = (input: Envelope): void => {
  if (busy) throw Error('COMMAND_IN_PROGRESS');
  if (!envelope || disposed || input.protocolVersion !== '3.0.0' || input.sessionId !== envelope.sessionId
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
      const start = display ? Math.max(minimum, Math.min(150, current.target.width * 0.085) * scale) : 40 * scale;
      Object.assign(el.style, {display: 'block', width: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
        fontFamily: fontFamily(font.fontId), fontWeight: String(font.weight), fontStyle: font.style ?? 'normal',
        lineHeight: '1.1', letterSpacing: display ? '-0.045em' : '-0.015em', color: current.spec.style.palette.roles.ink,
        textAlign: options.align ?? 'start'});
      parent.append(el);
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
      value.root.style.visibility = 'hidden'; value.root.style.opacity = '1'; value.root.style.transform = 'none'; value.root.style.filter = 'none';
    }
    for (const layer of layers) {
      const value = instances.get(layer.id)!;
      value.random.reset();
      value.instance.timeline?.pause();
      value.instance.timeline?.seek(layer.seconds, true);
      value.instance.render?.(layer.seconds);
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
    const stage = document.getElementById('film');
    if (!stage) throw Error('RUNTIME_STAGE_MISSING');
    const fontLoads = input.fonts.map(font => document.fonts.load(`${font.style} ${font.weight} 36px ${fontFamily(font.fontId)}`));
    await Promise.all([...fontLoads, document.fonts.ready]);
    if (disposed) throw Error('INVALID_SESSION');
    for (const scene of input.spec.scenes) {
      if (scene.kind !== 'block') throw Error('CUSTOM_SCENES_NOT_IMPLEMENTED');
      const [id] = scene.block.split('@');
      const definition = blocks.get(id!);
      if (!definition) throw Error('BLOCK_UNKNOWN');
      const root = document.createElement('section'); root.dataset.scene = scene.id;
      Object.assign(root.style, {position: 'absolute', inset: '0', overflow: 'hidden', visibility: 'hidden', background: input.spec.style.palette.roles.bg});
      stage.append(root);
      const random = randomSequence(input.seed + '\0' + scene.id);
      const ctx: SceneContext = {
        root, target: window.__omTarget, frames: {start: scene.start, end: scene.end}, beats: [],
        style: {...input.spec.style, palette: input.spec.style.palette.roles}, random: () => random.next(), text: textSlot,
        asset(key) { const asset = input.assets[key]; if (!asset) throw Error('ASSET_SLOT_UNKNOWN'); return asset; }
      };
      const instance = definition.build(ctx, scene.params);
      if (!instance.render && !instance.timeline) throw Error('BLOCK_DRAW_MISSING');
      if (instance.render && instance.timeline) throw Error('BLOCK_DRAW_AMBIGUOUS');
      instance.timeline?.pause();
      instances.set(scene.id, {scene, root, instance, random});
    }
    await Promise.all([...document.images].map(image => image.decode()));
    if (disposed) throw Error('INVALID_SESSION');
    for (const fit of fitters) fit();
    document.documentElement.dataset.omSignature = 'off';
    window.__omReady = true;
    })(), input.initTimeoutMs, 'INIT_TIMEOUT'); }
    catch (error) { disposed = true; throw error; }
  },
  async init(input: Init) {
    const current = requiredPlan();
    if (envelope || !window.__omReady || input.protocolVersion !== '3.0.0' || input.mode !== 'trusted_render'
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
    check(input);
    if ('previewEpoch' in input) throw Error('INVALID_SESSION');
    await draw(input.frameIndex);
    return {...input, event: 'frame-ready' as const, manifestHash: requiredPlan().manifestHash};
  },
  async sampleSubframe(input: Sample) {
    check(input);
    if (input.sampleIndex !== 0) throw Error('FRAME_OUT_OF_RANGE');
    await draw(input.frameIndex);
    return {...input, event: 'sample-ready' as const, manifestHash: requiredPlan().manifestHash};
  },
  async inspect(input: Inspect): Promise<HitResult> {
    check(input);
    if (input.frameIndex !== frame || !Number.isFinite(input.x01) || !Number.isFinite(input.y01)
      || input.x01 < 0 || input.x01 > 1 || input.y01 < 0 || input.y01 > 1 || 'previewEpoch' in input) throw Error('FRAME_OUT_OF_RANGE');
    const current = requiredPlan();
    let hit: HitResult['hit'] = null;
    for (const layer of frameLayers(current.spec.scenes, frame).reverse()) {
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
    check(input); disposed = true; instances.clear(); fitters.length = 0;
    document.getElementById('film')?.replaceChildren(); window.__omReady = false;
  }
};
window.__omEngine = Object.freeze(engine);
