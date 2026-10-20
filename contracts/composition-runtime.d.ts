/**
 * Authoring contract for the future composition-runtime package, not an implementation.
 * The trusted adapter owns RenderProtocol, resource barriers, sampling and audio playback.
 * A source module exports one CompositionDefinition; declarations are frozen with its source.
 */
import type { EditableProperty, FrameCount, Sha256, TargetId } from './render-protocol.js';

/** Seconds as a non-negative rational; numerator/denominator are safe integers, denominator > 0. */
export interface RationalTime { readonly numerator: number; readonly denominator: number }
export interface TimelineMarker { readonly id: string; readonly frame: number; readonly label: string }
export interface RegionDeclaration {
  readonly id: string; readonly label: string;
  readonly sourcePath?: string; readonly line?: number;
}
export interface RegionBounds {
  readonly id: string;
  /** Current target pixel coordinates; finite, non-negative size; clipping is checked by Q1. */
  readonly x: number; readonly y: number; readonly width: number; readonly height: number;
}
export type EditableValue = string | number | boolean | ReadonlyArray<Record<string, string | number | boolean | null>>;
export interface RuntimeAsset {
  readonly path: string; readonly sha256: Sha256;
  /** Task-scoped broker reference, never an arbitrary network URL or a management credential. */
  readonly url: string;
}
export interface RuntimeContext {
  readonly targetId: TargetId; readonly width: number; readonly height: number;
  readonly fps: 30; readonly totalFrames: FrameCount; readonly seed: string;
  readonly assets: Readonly<Record<string, RuntimeAsset>>;
  readonly values: Readonly<Record<string, EditableValue>>;
  /** Stable for this seed/key, independent of draw order; the pinned runtime owns the algorithm. */
  readonly randomAt: (key: string) => number;
}
export interface DrawResult { readonly regions?: ReadonlyArray<RegionBounds> }
export interface PreparedComposition {
  /**
   * Draw the complete state at time. Equal frozen inputs/time give equal pixels and regions.
   * No wall clock, unseeded randomness, accumulating callbacks or audio/event side effects.
   * Resolve only after target resources, video position and drawing commands are ready.
   */
  draw(time: RationalTime): DrawResult | Promise<DrawResult>;
  dispose(): void | Promise<void>;
}
export interface CompositionDefinition {
  readonly apiVersion: '2.5.0';
  /** May be empty. Trusted build checks unique IDs, ranges and source paths once before init. */
  readonly editables: ReadonlyArray<EditableProperty>;
  readonly markers: ReadonlyArray<TimelineMarker>;
  readonly regions: ReadonlyArray<RegionDeclaration>;
  /** Resolve tween endpoints and immutable resources here; a new edit creates a new preparation. */
  prepare(context: RuntimeContext): PreparedComposition | Promise<PreparedComposition>;
}
