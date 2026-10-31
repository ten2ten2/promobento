/**
 * film-v1 page contract: what trusted blocks and untrusted custom scenes may rely on.
 * Contract only; packages/film-runtime implements it (cloud motion plan §4).
 * The page itself is generated from film.json; authors never write index.html.
 */
export interface FilmRuntimeInfo { apiVersion: '3.0.0'; specVersion: 'film-v1' }

export type AspectId = 'landscape' | 'portrait' | 'feed' | 'square';
export interface SafeInsets { top: number; right: number; bottom: number; left: number }
/** Aspect-level only: there is no targetId, so targets sharing an aspect share one render. */
export interface Target {
  aspect: AspectId; width: number; height: number; safeInsets: SafeInsets;
  fps: 30; totalFrames: 450 | 900;
}
export interface StyleTokens {
  palette: Readonly<Record<string, string>>;
  type: { display: FontRef; text: FontRef; mono?: FontRef; scale: 'compact' | 'regular' | 'large' };
  motion: { language: string; energy: 1 | 2 | 3 | 4 | 5; easing: string; transitions: string };
}
export interface FontRef { fontId: string; weight: number; style?: 'normal' | 'italic' }
export interface Box { x: number; y: number; width: number; height: number }
export interface StudioView {yaw?:number;pitch?:number;distanceScale?:number;targetX?:number;targetY?:number;
  objectYaw?:number;objectPitch?:number;objectRoll?:number;objectScale?:number}

/** Data accepted by film.schema.json; executable code is never carried in this object. */
export interface FilmSpec {
  schemaVersion: '3.0.0'; specVersion: 'film-v1'; audience: 'software' | 'course';
  durationSeconds: 15 | 30; fps: 30; totalFrames: 450 | 900;
  style: Omit<StyleTokens, 'palette'> & {
    palette: { roles: Record<string, string>; sources: Record<string, string> };
    texture?: { kind: 'none' | 'grain' | 'paper' | 'glow'; amount?: number };
  };
  audio: {
    music: { kind: 'procedural'; style: string; bpm?: number } | { kind: 'score'; scoreRef: string }
      | { kind: 'upload'; resourceId: string } | { kind: 'none' };
    voice?: { resourceId: string; transcriptId: string } | { tts: { voiceId: string; transcriptId: string } };
    /** gain is dB (-30 to +6); omitted defaults to -6 dB, 0 is unity. */
    sfx: 'auto' | Array<{ at: { sceneId: string; event: string } | { frame: number }; id: string; gain?: number }>;
    captions: 'auto' | 'off'; mute?: boolean;
  };
  texts: Record<string, { text: string; role: TextSlotHandle['role']; factIds: string[]; lang?: string; maxLines?: number; editable?: boolean }>;
  assets: Record<string, { resourceId: string; roi?: Box[]; crop?: Box; editable?: boolean }>;
  scenes: FilmScene[];
  treatment: {
    message: string; hook: string; energyCurve: Array<{ frame: number; level: number }>;
    holds?: Array<{ start: number; end: number; reason: string }>; continuity: string;
  };
}
export type FilmScene = {
  id: string; start: number; end: number; purpose: string; focusFrom?: string; focusTo?: string;
  layout?: Partial<Record<AspectId, Record<string, unknown>>>;
  transitionIn?: { type: 'cut' | 'crossfade' | 'fade-through' | 'push' | 'whip' | 'wipe' | 'zoom-through' | 'match-handoff'; frames: number };
} & (
  | { kind: 'block'; block: string; params: Record<string, unknown> }
  /** params.gsapScope='scene' scopes selectors; params.sourceSfx=true enables frozen source sound declarations. */
  | { kind: 'custom'; module: string; brief: string; runtime3D?: 'om3-studio-v1' | 'om3-studio-v2'; params?: Record<string, unknown> }
);

/** A frozen asset as the page sees it; video frames come from the runtime, never a <video> element. */
export interface AssetHandle {
  resourceId: string; kind: 'image' | 'video' | 'svg'; width: number; height: number;
  /** Image or SVG URL under /r/<resourceId>. */
  url: string;
  /** Video only: the frame for a film-local time, resolved by PTS. Throws VIDEO_FRAME_UNAVAILABLE. */
  frameAt?(seconds: number): Promise<ImageBitmap>;
  roi: ReadonlyArray<Box>;
}

/** Text is only ever shown through a slot, so QA and fact binding see every word on screen. */
export interface TextSlotHandle {
  slotId: string; text: string; role: 'headline' | 'body' | 'label' | 'number' | 'quote' | 'caption' | 'cta';
  /** Mounts the slot's text into an element with auto-fit to the role's minimum size; returns that element. */
  mount(parent: Element, options?: { maxLines?: number; maxFontSize?: number; align?: 'start' | 'center' | 'end' }): HTMLElement;
}

export interface SceneContext {
  root: HTMLElement;
  target: Target;
  style: StyleTokens;
  text(slotId: string): TextSlotHandle;
  asset(key: string): AssetHandle;
  /** Film frames covered by this scene, half-open. */
  frames: { start: number; end: number };
  /** Beat frames inside this scene, from the frozen audio plan. */
  beats: ReadonlyArray<number>;
  /** A seeded random stream (random-seq-v1); identical for the same seek time. */
  random(): number;
  OM: MotionHelpers;
  CLIP: ClipHelpers;
  /** v2 additionally permits bounded object rotation and scale. */
  OM3?: {studio(assetKey: string): {render(view:StudioView): void}};
}

export interface MotionTimeline extends GsapTimelineLike {
  fromTo(target: object, from: Record<string, unknown>, to: Record<string, unknown>, at?: number): MotionTimeline;
}
export interface MotionCamera {
  set(pose: Record<string, unknown>): MotionCamera;
  to(timeline: MotionTimeline | null, at: number, pose: Record<string, unknown>): MotionCamera;
  apply?(seconds: number): unknown;
}
export type CameraVector = [number, number, number];
export interface CameraRigKey {
  at: number; position: CameraVector; target: CameraVector; fov: number; roll?: number;
  ease?: 'linear' | 'hold' | 'inQuad' | 'outCubic' | 'inOutCubic' | 'inOutQuint' | 'outExpo' | 'inExpo';
}
export interface CameraRigShot {id: string; start: number; end: number; keys: CameraRigKey[]}
export interface CameraRigPose {
  time: number; shot: string; local: number; progress: number;
  position: CameraVector; target: CameraVector; fov: number; roll: number;
}
export interface CameraRig {
  readonly duration: number;
  sample(seconds: number): CameraRigPose;
  shots(): CameraRigShot[];
}
export interface CameraRigHelpers {
  create(shots: CameraRigShot[]): CameraRig;
  track<T extends object>(pose: T, subject: {position: CameraVector; forward: CameraVector},
    options?: {distance?: number; height?: number; side?: number; lookAhead?: number}): T & {position: CameraVector; target: CameraVector};
  readonly eases: readonly CameraRigKey['ease'][];
}
export interface MotionHelpers {
  /** Register asynchronous scene setup before the first frame; late registrations fail. */
  ready<T>(promise: PromiseLike<T>): PromiseLike<T>;
  /** With params.sourceSfx=true, register one statically admitted sound during construction. */
  sfx(id: string, atSeconds: number, options?: {gain?: number}): number;
  clock(timeline: MotionTimeline, draw: (seconds: number) => void, duration: number, at?: number): MotionTimeline;
  /** Draw synchronously after all tweens have reached the seek time; exceptions fail the frame. */
  clockAfter(timeline: MotionTimeline, draw: (seconds: number) => void, duration: number, at?: number): MotionTimeline;
  /** Seconds for n beats. Omitted bpm uses the frozen procedural-music bpm, if present. */
  beat(n: number, bpm?: number): number;
  random(seed: number): () => number;
  spring(bounce: number): (progress: number) => number;
  springValue(from: number, changes: Array<{at: number; to: number}>, time: number, options?: {bounce?: number; settle?: number}): number;
  camera(world: HTMLElement | string, options?: Record<string, unknown>): MotionCamera;
  space(world: HTMLElement | string, options?: Record<string, unknown>): MotionCamera;
  readonly cameraRig: CameraRigHelpers;
  region(id: string, boxAt: (seconds: number) => [number, number, number, number] | null): MotionHelpers;
}
/** Canvas helper namespaces from the pinned clip library; full signatures are in the shipped JS sources. */
export interface ClipHelpers {
  U: {setStage(width: number, height: number): void};
  MO: Record<string, (...args: number[]) => number>;
  /** Original clip timing: local seconds, with optional previously approved narration-word timestamps. */
  cues: {
    findWord(words: Array<{word:string;start:number;end:number}> | null, term:string, nth?:number, edge?:'start'|'end'):number|null;
    prepare<T extends {duration:number;cues:Array<{at:number;kind:string;word?:string;nth?:number;edge?:'start'|'end';offset?:number;data?:Record<string,unknown>}>}>(spec:T, options?:{pace?:number;words?:Array<{word:string;start:number;end:number}>|null;voiceEnd?:number|null;cue?:(term:string,nth:number,edge:'start'|'end')=>number;tail?:number}):{spec:T;duration:number;problems:string[];anchored:Array<{kind:string;word:string;at:number}>};
  };

  CAM: object; PAINT: object; KIT: object; DG: object; TY: object; CH: object; UI: object; CL: object; TOON: object;
}

export interface SceneEvent { name: string; frame: number }
export interface SceneRegion { regionId: string; boxAt(frame: number): Box | null }
/** Private trusted-block comparison inputs; never supplied by authored scenes. */
export interface CanvasTextTrace {
  slotId:string; text:string; fontId:string; weight:number; style:'normal';
  boxes:Box[]; fontSize:number; alpha:number;
}
export interface CanvasTextProof extends CanvasTextTrace { withText:string; withoutText:string }

/** Trusted blocks: render must be a pure function of time (checked by golden frames, plan §4.3). */
export interface BlockDefinition<Params = Record<string, unknown>> {
  id: string; version: string;
  build(ctx: SceneContext, params: Params): BlockInstance;
}
export interface BlockInstance {
  /** Trusted asynchronous resources are ready before init is acknowledged. */
  ready?: Promise<void>;
  /** Draws the scene at a scene-local time in seconds. Either this or a paused GSAP timeline. */
  render?(localSeconds: number): void | Promise<void>;
  timeline?: GsapTimelineLike;
  events: ReadonlyArray<SceneEvent>;
  regions: ReadonlyArray<SceneRegion>;
  canvasTextProof?(): CanvasTextProof;
  canvasTextTrace?(): CanvasTextTrace;
  /** Release scene-owned textures, geometries, contexts and other resources. */
  dispose?(): void | Promise<void>;
}

/** Untrusted custom scenes register through PB.scene and return a paused timeline. */
export interface CustomScene {
  timeline: GsapTimelineLike;
  regions?: ReadonlyArray<SceneRegion>;
  events?: ReadonlyArray<SceneEvent>;
}
export interface GsapTimelineLike { pause(): unknown; seek(seconds: number, suppressEvents?: boolean): unknown; duration(): number }

export interface PB {
  info: FilmRuntimeInfo;
  defineBlock<Params>(definition: BlockDefinition<Params>): void;
  scene(sceneId: string, factory: (ctx: SceneContext) => CustomScene): void;
}

/**
 * Forbidden in custom scenes and enforced by the runtime shim (plan §4.4): network APIs, workers,
 * WebAssembly, eval/new Function, storage, AudioContext, <video>, <iframe>, timers after init,
 * and text not drawn through ctx.text().
 */
export type ForbiddenRuntimeError =
  | 'RUNTIME_NETWORK_FORBIDDEN' | 'RUNTIME_WORKER_FORBIDDEN' | 'RUNTIME_WASM_FORBIDDEN' | 'RUNTIME_EVAL_FORBIDDEN'
  | 'RUNTIME_STORAGE_FORBIDDEN' | 'RUNTIME_AUDIO_FORBIDDEN' | 'RUNTIME_VIDEO_FORBIDDEN' | 'RUNTIME_IFRAME_FORBIDDEN'
  | 'RUNTIME_TIMER_FORBIDDEN' | 'RUNTIME_TEXT_FORBIDDEN';
