/** Contract for a future runtime. The trusted host owns barriers, media, overlays and audio. */
import type { EditableProperty, EditableValue, FrameCount, Sha256, TargetId } from './render-protocol.js';
export type { EditableValue } from './render-protocol.js';

/** Seconds; non-negative safe integer numerator, positive safe integer denominator. */
export interface RationalTime { readonly numerator: number; readonly denominator: number }
export interface TimelineMarker {
  readonly id: string; readonly frame: number; readonly label: string;
  /** Optional index in frozen audioEvents; the trusted build verifies the same start frame. */
  readonly audioEventIndex?: number;
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
/** Exact source-bundle path: values.json. Every declared editable has exactly one value. */
export interface SourceValues {
  readonly schemaVersion: '2.7.0'; readonly kind: 'source_values';
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
   * DOM, SVG and canvas share platform logical coordinates. Brand/AI overlays are host-owned.
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
  };
  /** Stable for seed/key, independent of draw order; algorithm belongs to the pinned runtime. */
  readonly randomAt: (key: string) => number;
}
export interface DrawResult { readonly regions?: ReadonlyArray<RegionBounds> }
export interface PreparedComposition {
  /** Complete state at time; no accumulating callbacks, clocks or audio/event side effects. */
  draw(time: RationalTime): DrawResult | Promise<DrawResult>;
  dispose(): void | Promise<void>;
}
export interface CompositionDefinition {
  readonly apiVersion: '2.7.0';
  /** Validated once by the trusted build; these are the sole source of UI/inspection metadata. */
  readonly editables: ReadonlyArray<EditableProperty>;
  readonly markers: ReadonlyArray<TimelineMarker>;
  readonly regions: ReadonlyArray<RegionDeclaration>;
  readonly videoUses: ReadonlyArray<VideoUse>;
  readonly fonts: ReadonlyArray<FontDeclaration>;
  /** Resolve endpoints, immutable resources and fonts; a value edit creates a new preparation. */
  prepare(context: RuntimeContext): PreparedComposition | Promise<PreparedComposition>;
}
