/** Authoring contract. The reviewed-fixture implementation is a subset of product admission. */
import type { EditableProperty, EditableValue, FrameCount, Sha256, TargetId } from './render-protocol.js';
export type { EditableValue } from './render-protocol.js';

/** Seconds; non-negative safe integer numerator, positive safe integer denominator. */
export interface RationalTime { readonly numerator: number; readonly denominator: number }
export interface TimelineMarker {
  readonly id: string; readonly frame: number; readonly label: string;
  /** Stable frozen audio event id; array order never changes which event this marker refers to. */
  readonly audioEventId?: string;
}
export interface RegionDeclaration {
  readonly id: string; readonly label: string;
  readonly sourcePath?: string; readonly line?: number;
}
export interface RegionBounds {
  readonly id: string;
  /** Platform logical pixels, independent of preview scale and the user's screen DPR. */
  readonly x: number; readonly y: number; readonly width: number; readonly height: number;
}
/**
 * Exact source-bundle path: values.json, canonical UTF-8 bytes, at most 1 MiB.
 * All target entrypoints declare the same editable set; every editable has exactly one value.
 * The pinned runtime defines the file format. Wire protocol versions are not saved here.
 */
export interface SourceValues {
  readonly kind: 'source_values';
  readonly values: Readonly<Record<string, EditableValue>>;
}
export interface RuntimeAsset {
  readonly path: string; readonly sha256: Sha256;
  /** Task-scoped broker URL; never arbitrary network access or a management credential. */
  readonly url: string;
}
export interface RuntimeSurface {
  readonly mode: 'local_preview' | 'trusted_render';
  /** P0 local preview: 0.5; trusted rendering: 1. Platform width/height never change. */
  readonly pixelScale: 0.5 | 1;
  /** The host creates this clipped logical viewport. Authors mount only below this root. */
  readonly root: HTMLElement;
  /**
   * Appends a canvas with logical CSS size and integer backing dimensions scaled by pixelScale.
   * Canvas/WebGL drawing uses this explicit scale, never window.devicePixelRatio.
   * DOM, SVG and canvas share platform logical coordinates. The Studio parent owns the
   * local watermark outside this document; trusted capture adds its own marking layer.
   */
  createCanvas(): HTMLCanvasElement;
}
export interface VideoUse {
  readonly id: string; readonly assetPath: string;
  readonly sourceStart: RationalTime; readonly sourceEndExclusive: RationalTime;
  readonly timelineStart: RationalTime; readonly playbackRate: RationalTime;
}
export interface RuntimeVideoFrame {
  readonly image: ImageBitmap;
  readonly sourceSha256: Sha256; readonly sourcePts: RationalTime;
  readonly representation: 'source_frame' | 'preview_proxy';
}
export interface FontDeclaration {
  readonly registryVersion: string; readonly fontId: string;
  readonly weights: ReadonlyArray<number>; readonly fallbackFontIds: ReadonlyArray<string>;
  /** Actual subset bytes and hashes must also exist in the frozen resource manifest. */
  readonly assets: ReadonlyArray<{ readonly weight: number; readonly path: string; readonly sha256: Sha256 }>;
}
export interface RuntimeContext {
  readonly targetId: TargetId; readonly width: number; readonly height: number;
  readonly fps: 30; readonly totalFrames: FrameCount; readonly seed: string;
  readonly surface: RuntimeSurface;
  readonly assets: Readonly<Record<string, RuntimeAsset>>;
  /** Frozen values.json; local previews may merge a validated overlay before a new prepare. */
  readonly values: Readonly<Record<string, EditableValue>>;
  readonly videoFrames: {
    /**
     * sourceTime = sourceStart + (time - timelineStart) * playbackRate, using exact rationals.
     * Choose the source PTS interval containing sourceTime: [PTS, next PTS), last to duration.
     * The same rule handles integer and subframe times. Reject undeclared/out-of-range use,
     * missing frames or unverified proxy mappings; never choose a nearest wall-clock frame.
     */
    get(useId: string, time: RationalTime): Promise<RuntimeVideoFrame>;
  };
  readonly fonts: {
    /** Includes every declared fallback; glyph/shape QA is a separate trusted check. */
    readonly ready: Promise<void>;
    family(fontId: string): string;
    /**
     * Exact declared primary weight, with CSS weight matching in declared fallback families.
     * Checks the selected faces' cmap; does not certify complex shaping or layout.
     */
    assertText(fontId: string, text: string, weight: number): void;
  };
  /**
   * random-at-v1: length-prefixed UTF-8, FNV-1a + fmix32, unsigned value / 2^32.
   * Stable in [0, 1) for seed/key, independent of draw order. Fixed vectors live
   * with the runtime. Seed/key must be well-formed Unicode strings; isolated
   * surrogates are rejected. This visual helper is not cryptographic randomness.
   */
  readonly randomAt: (key: string) => number;
}
export interface DrawResult { readonly regions?: ReadonlyArray<RegionBounds> }
export interface PreparedComposition {
  /**
   * Complete state at time; no accumulating callbacks, clocks or audio/event side effects.
   * The reviewed-fixture runtime supports direct DOM/SVG updates, Canvas 2D,
   * registered font bytes and trusted PTS-extracted video frames.
   * Native CSS/WAAPI animations (also paused ones), WebGL and arbitrary source await admission.
   * A host frame deadline must terminate a stuck execution environment, not queue dispose
   * behind a draw that may never finish. That recovery is outside customer code.
   */
  draw(time: RationalTime): DrawResult | Promise<DrawResult>;
  dispose(): void | Promise<void>;
}
/** Each .mjs entrypoint default-exports this object. The host supplies the HTML document. */
export interface CompositionDefinition {
  readonly apiVersion: '2.7.0';
  /** Validated once by the trusted build; these are the sole source of UI/inspection metadata. */
  readonly editables: ReadonlyArray<EditableProperty>;
  readonly markers: ReadonlyArray<TimelineMarker>;
  /** Inspection precedence: the last declared region containing the point wins. */
  readonly regions: ReadonlyArray<RegionDeclaration>;
  readonly videoUses: ReadonlyArray<VideoUse>;
  readonly fonts: ReadonlyArray<FontDeclaration>;
  /** Resolve endpoints, immutable resources and fonts; a value edit creates a new preparation. */
  prepare(context: RuntimeContext): PreparedComposition | Promise<PreparedComposition>;
}

/**
 * canvas-commands-v1 author profile: self-contained ESM in the isolated QuickJS
 * task. No imports, DOM, native canvas objects, resources, fonts, audio, wall
 * clocks, random sources or timers. The trusted host selects this profile; an
 * author cannot opt into capabilities or choose execution/output limits.
 * Existing CompositionDefinition remains the reviewed browser-fixture API.
 */
export interface CommandRuntimeContext {
  readonly targetId: TargetId; readonly width: number; readonly height: number;
  readonly fps: 30; readonly totalFrames: FrameCount; readonly seed: string;
  readonly values: Readonly<Record<string, EditableValue>>;
  /** The same random-at-v1 helper as RuntimeContext; maximum key length 65,536 UTF-16 units. */
  readonly randomAt: (key: string) => number;
  readonly motion: MotionMath;
  readonly camera: CommandCamera;
  readonly path: CommandPaths;
  readonly paint: CommandPaint;
  readonly components: CommandComponents;
}
/** Geometry only. Colors are six-digit hexadecimal RGB; opacity is in [0,1]. */
export type CanvasCommand = (
  | { readonly op: 'rect'; readonly x: number; readonly y: number;
      readonly width: number; readonly height: number; readonly radius?: number }
  | { readonly op: 'circle'; readonly x: number; readonly y: number; readonly radius: number }
  | { readonly op: 'polygon'; readonly points: ReadonlyArray<{readonly x: number; readonly y: number}> }
) & { readonly color: `#${string}`; readonly opacity: number };
export interface CommandDrawResult {
  /** At most 4,096 commands; polygon 3–64 points, at most 16,384 points in total. */
  readonly commands: ReadonlyArray<CanvasCommand>;
  /** Bounds only reference statically declared regions. No protocol or readiness fields. */
  readonly regions?: ReadonlyArray<RegionBounds>;
}
export interface PreparedCommandComposition {
  /** Synchronous, complete state at the absolute time. Promises and pending jobs are rejected. */
  draw(time: RationalTime): CommandDrawResult;
  /** Synchronous cleanup. The external host terminates a stuck or failed task. */
  dispose(): void;
}
export interface CommandCompositionDefinition {
  readonly apiVersion: '2.7.0';
  readonly editables: ReadonlyArray<EditableProperty>;
  readonly markers: ReadonlyArray<TimelineMarker>;
  readonly regions: ReadonlyArray<RegionDeclaration>;
  /** Media and font capabilities require a separately admitted profile. */
  readonly videoUses: readonly [];
  readonly fonts: readonly [];
  /** Declarations must match the independently validated declarations.json before prepare. */
  prepare(context: CommandRuntimeContext): PreparedCommandComposition;
}

/** Separately admitted canvas-media-v1 profile. Resource IDs resolve only through
 * the trusted renderer catalog and resources.json; guest modules get no bytes,
 * URLs, DOM, audio clock, networking or browser objects.
 */
export interface TextLayout {
  readonly wrap?: 'none' | 'word-cjk'; readonly lineHeight?: number; readonly padding?:number; readonly align?: 'left' | 'center' | 'right';
}
export interface TextMeasurement {
  readonly width:number; readonly ascent:number; readonly descent:number; readonly height:number;
  readonly lineHeight:number; readonly lineCount:number;
}
export interface MediaCommandRuntimeContext extends CommandRuntimeContext {
  /** Exact WOFF advances, no implicit font fallback. Explicit layout enables
   * newlines/word-CJK wrapping. No RTL, combining-mark or emoji shaping. */
  measureText(fontId:string,text:string,fontSize:number,weight:number,layout?:TextLayout & {readonly width:number}):TextMeasurement;
}
export type AffineTransform=readonly [number,number,number,number,number,number];
export interface CommandClip {readonly x:number;readonly y:number;readonly width:number;readonly height:number;readonly radius?:number}
export interface CommandStroke {
  readonly color:`#${string}`;readonly width:number;readonly cap?:'butt'|'round'|'square';readonly join?:'round'|'bevel'|'miter';
  readonly dash?:ReadonlyArray<number>;readonly dashOffset?:number;
}
export interface CommandGradient {
  readonly kind:'linear'|'radial';readonly x0:number;readonly y0:number;readonly x1:number;readonly y1:number;
  readonly r0?:number;readonly r1?:number;readonly stops:ReadonlyArray<{readonly offset:number;readonly color:`#${string}`}>;
}
export type CommandPathSegment=
  | {readonly kind:'move'|'line';readonly x:number;readonly y:number}
  | {readonly kind:'quadratic';readonly cx:number;readonly cy:number;readonly x:number;readonly y:number}
  | {readonly kind:'cubic';readonly cx1:number;readonly cy1:number;readonly cx2:number;readonly cy2:number;readonly x:number;readonly y:number}
  | {readonly kind:'close'};
export type MediaCanvasCommand=(
  | (CanvasCommand & {readonly fill?:boolean;readonly stroke?:CommandStroke;readonly gradient?:CommandGradient})
  | {readonly op:'path';readonly segments:ReadonlyArray<CommandPathSegment>;readonly color:`#${string}`;readonly opacity:number;
      readonly fill?:boolean;readonly stroke?:CommandStroke;readonly gradient?:CommandGradient}
  | ({readonly op:'texture';readonly style:'paper'|'grain'|'halftone'|'mosaic'|'brush';readonly color:`#${string}`;
      readonly accent:`#${string}`;readonly seed:number;readonly scale?:number} & CommandClip & {readonly opacity:number})
  | ((
    | {readonly op:'text';readonly id:string;readonly fontId:string;readonly text:string;
        readonly fontSize:number;readonly weight:number;readonly color:`#${string}`;readonly layout?:TextLayout}
    | {readonly op:'image';readonly resourceId:string;readonly crop?:CommandClip;
        readonly effect?:{readonly style:'halftone'|'mosaic'|'brush';readonly cell:number;readonly seed:number}}
    | {readonly op:'video';readonly useId:string;readonly crop?:CommandClip}
  ) & {readonly x:number;readonly y:number;readonly width:number;readonly height:number;readonly opacity:number})
) & {readonly transform?:AffineTransform;readonly clip?:CommandClip};
/** Geometry profile callers retain the original command subset; helpers that
 * create text/resources/effects require the separately admitted media profile. */
export interface MotionMath {
  clamp(value:number,min?:number,max?:number):number;lerp(a:number,b:number,p:number):number;
  seg(t:number,start:number,end:number):number;at(t:number,start:number,duration:number):number;
  anim(t:number,start:number,duration:number,ease?:(p:number)=>number):number;step(t:number,fps?:number):number;
  smooth(p:number):number;smoothCE(p:number,inflection?:number):number;thereAndBack(p:number):number;
  rushInto(p:number):number;rushFrom(p:number):number;doubleSmooth(p:number):number;wiggle(p:number,wiggles?:number):number;
  lagged(index:number,count:number,p:number,ratio?:number):number;linear(p:number):number;sineInOut(p:number):number;
  cubicIn(p:number):number;cubicOut(p:number):number;cubicInOut(p:number):number;quartOut(p:number):number;quintOut(p:number):number;
  quintInOut(p:number):number;expoIn(p:number):number;expoOut(p:number):number;expoInOut(p:number):number;
  backOut(p:number,overshoot?:number):number;elasticOut(p:number):number;
  bezier(x1:number,y1:number,x2:number,y2:number):(p:number)=>number;
  appleOut(p:number):number;emphasized(p:number):number;k75(p:number):number;easyEase(p:number):number;longTail(p:number):number;
  spring(t:number,options?:{duration?:number;bounce?:number;v0?:number}):number;
  smoothSpring(t:number):number;snappy(t:number):number;bouncy(t:number):number;springHz(t:number,frequency?:number,decay?:number):number;
  settle(t:number,amplitude:number,frequency?:number,decay?:number):number;float(t:number,amplitude?:number,period?:number,phase?:number):number;
  count(time:number,start:number,duration:number,a:number,b:number,ease?:(p:number)=>number):number;formatNumber(value:number,decimals?:number):string;
  invert(ease:(p:number)=>number,y:number,iterations?:number):number;beat(n:number,bpm?:number):number;onBeat(barTime:number,revealProgress:number,duration:number):number;
}
export interface CommandPoint {readonly x:number;readonly y:number}
export interface CameraPose {readonly x?:number;readonly y?:number;readonly z?:number;readonly r?:number}
export interface CommandCamera {
  matrix(camera:CameraPose):AffineTransform;zlerp(a:number,b:number,p:number):number;
  toScreen(camera:CameraPose,x:number,y:number):CommandPoint;toWorld(camera:CameraPose,x:number,y:number):CommandPoint;
  coverZoom(radius:number,x?:number,y?:number):number;anchor(x:number,y:number,z:number,sx:number,sy:number):CameraPose;
  at(keys:ReadonlyArray<CameraPose & {readonly t:number;readonly ease?:(p:number)=>number}>,t:number):CameraPose;
  parallax(camera:CameraPose,depth:number):CameraPose;drift(t:number,amplitude?:number,seed?:number):readonly [number,number];
  apply(commands:ReadonlyArray<MediaCanvasCommand>,camera:CameraPose):ReadonlyArray<MediaCanvasCommand>;
  region(region:RegionBounds,camera:CameraPose):RegionBounds;
  pushTo(base:CameraPose,x:number,y:number,z:number,p:number,centering?:number,to?:CommandPoint):CameraPose;
}
export interface CommandPaths {
  densify(points:ReadonlyArray<CommandPoint>,per?:number):ReadonlyArray<CommandPoint>;
  resample(points:ReadonlyArray<CommandPoint>,count?:number):ReadonlyArray<CommandPoint>;
  ribbon(points:ReadonlyArray<CommandPoint>,width?:number|((p:number,index:number)=>number),color?:`#${string}`):MediaCanvasCommand;
  cumulative(points:ReadonlyArray<CommandPoint>):ReadonlyArray<number>;pointAt(points:ReadonlyArray<CommandPoint>,p:number):CommandPoint;
  partial(points:ReadonlyArray<CommandPoint>,p:number):ReadonlyArray<CommandPoint>;
  cubic(a:CommandPoint,b:CommandPoint,c:CommandPoint,d:CommandPoint,count?:number):ReadonlyArray<CommandPoint>;
  arc(x:number,y:number,rx:number,ry:number,start:number,end:number,count?:number):ReadonlyArray<CommandPoint>;
  morph(a:ReadonlyArray<CommandPoint>,b:ReadonlyArray<CommandPoint>,p:number):ReadonlyArray<CommandPoint>;
  hand(points:ReadonlyArray<CommandPoint>,key?:string,amplitude?:number):ReadonlyArray<CommandPoint>;
  line(points:ReadonlyArray<CommandPoint>,color?:`#${string}`,width?:number,p?:number):MediaCanvasCommand;
}
export interface CommandPaint {
  tornPaper(x:number,y:number,width:number,height:number,options?:{key?:string;color?:`#${string}`;amplitude?:number}):MediaCanvasCommand;
  rect(x:number,y:number,width:number,height:number,color:`#${string}`,radius?:number):MediaCanvasCommand;
  circle(x:number,y:number,radius:number,color:`#${string}`):MediaCanvasCommand;
  text(id:string,text:string,x:number,y:number,width:number,options?:TextLayout & {fontId?:string;fontSize?:number;weight?:number;color?:`#${string}`}):MediaCanvasCommand;
  texture(style:'paper'|'grain'|'halftone'|'mosaic'|'brush',x:number,y:number,width:number,height:number,
    options?:{color?:`#${string}`;accent?:`#${string}`;seed?:number;scale?:number;opacity?:number}):MediaCanvasCommand;
  transform(commands:ReadonlyArray<MediaCanvasCommand>,options?:{x?:number;y?:number;scale?:number;rotation?:number;originX?:number;originY?:number}):ReadonlyArray<MediaCanvasCommand>;
  /** Wipes are for geometry/images; partial text clipping fails admission. */
  wipe(commands:ReadonlyArray<MediaCanvasCommand>,p:number,options?:CommandClip & {direction?:'left'|'right'}):ReadonlyArray<MediaCanvasCommand>;
  lightSweep(x:number,y:number,width:number,height:number,p:number,color?:`#${string}`):MediaCanvasCommand;
}
export interface ComponentBox {id?:string;x?:number;y?:number;width?:number;height?:number;fontId?:string;weight?:number;progress?:number}
export interface CommandComponents {
  ui(options?:ComponentBox & {title?:string;navigation?:ReadonlyArray<string>;cards?:ReadonlyArray<{label:string;value:string}>;resourceId?:string;crop?:CommandClip}):ReadonlyArray<MediaCanvasCommand>;
  mechanism(options?:ComponentBox & {nodes?:ReadonlyArray<{label:string;x?:number;y?:number;color?:`#${string}`}>;edges?:ReadonlyArray<readonly [number,number]>;formula?:string}):ReadonlyArray<MediaCanvasCommand>;
  chart(options?:ComponentBox & {kind?:'line'|'bar';title?:string;data?:ReadonlyArray<{label:string;value:number;color?:`#${string}`}>}):ReadonlyArray<MediaCanvasCommand>;
  flatWorld(options?:ComponentBox & {time?:number;color?:`#${string}`;nodes?:ReadonlyArray<string>}):ReadonlyArray<MediaCanvasCommand>;
  collage(options?:ComponentBox & {cards?:ReadonlyArray<{title:string;text?:string;resourceId?:string}>}):ReadonlyArray<MediaCanvasCommand>;
  whiteboard(options?:ComponentBox & {points?:ReadonlyArray<CommandPoint>;title?:string;annotation?:string}):ReadonlyArray<MediaCanvasCommand>;
  kineticType(options?:ComponentBox & {words?:ReadonlyArray<string>;fontSize?:number;highlight?:number;color?:`#${string}`}):ReadonlyArray<MediaCanvasCommand>;
}
export interface MediaCommandCompositionDefinition {
  readonly apiVersion:'2.7.0';
  readonly editables:ReadonlyArray<EditableProperty>;
  readonly markers:ReadonlyArray<TimelineMarker>;
  readonly regions:ReadonlyArray<RegionDeclaration>;
  readonly videoUses:ReadonlyArray<VideoUse>;
  readonly fonts:ReadonlyArray<FontDeclaration>;
  prepare(context:MediaCommandRuntimeContext): {
    draw(time:RationalTime): {readonly commands:ReadonlyArray<MediaCanvasCommand>; readonly regions?:ReadonlyArray<RegionBounds>};
    dispose():void;
  };
}
