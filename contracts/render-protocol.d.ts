/** Contract only; these types are not a browser or sandbox implementation. film-v1 pages: see film-runtime.d.ts. */
export type DurationSeconds = 15 | 30;
export type FrameCount = 450 | 900;
/** Renders are per aspect; targets map to an aspect render (cloud motion plan D9). */
export type AspectId = 'landscape' | 'portrait' | 'feed' | 'square';
export type Sha256 = string;
export type RenderProfile = ({
  sampling: 'centered-box-v1'; edgePolicy: 'clamp-v1';
} & (
  | { sampleCount: 1; shutterAngle: 0 }
  | { sampleCount: 4 | 8; shutterAngle: 180 }
));
export interface Envelope {
  protocolVersion: '3.0.0'; sessionId: string; requestId: string; sequence: number;
  revisionId: string; aspectId: AspectId;
}
export type EditableValue = string | number | boolean | ReadonlyArray<Record<string, string | number | boolean | null>>;
/** A slot restriction; rights clearance of the replacement asset remains required. */
export type EditableMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'video/mp4' | 'video/quicktime' | 'video/webm';
export type ValuesOverlay = Readonly<Record<string, EditableValue>>;
export type Init = Envelope & {
  command: 'init'; manifestHash: Sha256; frameCount: FrameCount;
  /** Logical platform dimensions; never reduced for a low-resolution preview. */
  width: number; height: number; fps: 30; seed: string; renderProfile: RenderProfile;
} & (
  | { mode: 'local_preview'; pixelScale: 0.5; previewEpoch: 0; valuesOverlay?: ValuesOverlay }
  | { mode: 'trusted_render'; pixelScale: 1; previewEpoch?: never; valuesOverlay?: never }
);
/**
 * Replaces the entire local overlay. Only one state-changing command may be in flight.
 * requestedEpoch must be the last applied epoch + 1. Studio advances only on values-applied.
 */
export interface LocalValues extends Envelope {
  command: 'set-values'; manifestHash: Sha256; requestedEpoch: number; valuesOverlay: ValuesOverlay;
}
export interface ValuesApplied extends Envelope {
  event: 'values-applied'; manifestHash: Sha256; requestedEpoch: number; appliedEpoch: number;
}
export interface ValuesRejected extends Envelope {
  event: 'values-rejected'; manifestHash: Sha256; requestedEpoch: number; appliedEpoch: number;
  code: 'VALUES_INVALID' | 'EPOCH_STALE' | 'PREPARE_FAILED' | 'INVALID_SESSION' | 'COMMAND_IN_PROGRESS';
}
/**
 * previewEpoch is the last successfully applied epoch in local sessions, absent in Renderer.
 * Studio owns play/pause and the audio clock (monotonic parent clock for silence). It keeps
 * one seek in flight and coalesces to the latest clock frame; autoplay denial pauses playback.
 */
export interface Seek extends Envelope { command: 'seek'; frameIndex: number; previewEpoch?: number }
/** Internal command: authenticated Renderer sessions only. */
export interface Sample extends Envelope { command: 'sample'; frameIndex: number; sampleIndex: number }
export interface Inspect extends Envelope {
  command: 'inspect'; frameIndex: number; x01: number; y01: number; previewEpoch?: number;
}
export interface Dispose extends Envelope { command: 'dispose' }
export interface FrameReady extends Envelope { event: 'frame-ready'; frameIndex: number; manifestHash: Sha256 }
/** Low-resolution nominal-time playback, including approximation of motion profiles; never QA evidence. */
export interface PreviewFrameReady extends Envelope { event: 'preview-frame-ready'; frameIndex: number; manifestHash: Sha256; previewEpoch: number }
/** A single sample barrier is not readiness of the averaged output frame. */
export interface SampleReady extends Envelope {
  event: 'sample-ready'; frameIndex: number; sampleIndex: number; manifestHash: Sha256;
}
export interface ProtocolFailure extends Envelope {
  event: 'error'; code: 'FRAME_TIMEOUT' | 'ASSET_UNAVAILABLE' | 'CAPABILITY_UNAVAILABLE' | 'INVALID_SESSION'
    | 'INIT_TIMEOUT' | 'PREPARE_FAILED' | 'DRAW_FAILED' | 'VIDEO_FRAME_UNAVAILABLE'
    | 'FRAME_OUT_OF_RANGE' | 'COMMAND_IN_PROGRESS';
  previewEpoch?: number;
}
export interface HitTarget {
  /** Must reference a statically declared region; no arbitrary sandbox-selected source path. */
  regionId: string; sourcePath?: string; line?: number;
  bounds: { x: number; y: number; width: number; height: number };
}
export interface HitResult extends Envelope {
  event: 'hit-result'; frameIndex: number; manifestHash: Sha256; hit: HitTarget | null; previewEpoch?: number;
}
/** Declarations and saved values are frozen in source; only local previews may apply an overlay. */
export type EditableProperty = ({
  id: string; label: string; group?: string;
  /** P0 routes these edits to AI; local values cannot safely redistribute timing. */
  affectsTiming?: boolean;
} & (
  /** Bound text saves update the fact version and clear its confirmation in the same draft CAS. */
  | { type: 'text'; factId?: string }
  | { type: 'color' }
  | { type: 'asset'; acceptedMediaTypes: ReadonlyArray<EditableMediaType> }
  /** step is a UI increment; accepted finite values are bounded by min/max, not quantized. */
  | { type: 'number'; min?: number; max?: number; step?: number }
  | { type: 'boolean' }
  | { type: 'enum'; choices: string[] }
  | { type: 'data' }
));
export interface CompositionBridge {
  init(input: Init): Promise<void>;
  /**
   * Local-only, serialized with init/seek/inspect. Prepare before committing values and epoch;
   * rejection retains the prior preparation and epoch. No save, model call or cloud QA.
   */
  setValues(input: LocalValues): Promise<ValuesApplied | ValuesRejected>;
  /** Local playback returns preview-frame-ready. Trusted sampling returns frame-ready. */
  seekFrame(input: Seek): Promise<FrameReady | PreviewFrameReady>;
  /** Serialize with seek/sample; the response must match this exact envelope and manifest. */
  inspect(input: Inspect): Promise<HitResult>;
  dispose(input: Dispose): Promise<void>;
}
/** Not exposed to Studio callers or source code as a way to choose sampling. */
export interface RendererCompositionBridge extends Omit<CompositionBridge, 'setValues'> {
  seekFrame(input: Seek): Promise<FrameReady>;
  sampleSubframe(input: Sample): Promise<SampleReady>;
}
export type RenderCommand = Init | LocalValues | Seek | Inspect | Dispose;
export type RendererCommand = Exclude<RenderCommand, LocalValues> | Sample;
export type RenderResponse = FrameReady | PreviewFrameReady | ValuesApplied | ValuesRejected | HitResult | ProtocolFailure;
export type RendererResponse = FrameReady | SampleReady | HitResult | ProtocolFailure;
export type RenderState = 'created' | 'initializing' | 'idle' | 'applying-values' | 'seeking' | 'ready' | 'failed' | 'disposed';
