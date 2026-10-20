/** Contract only; these types are not a browser or sandbox implementation. */
export type DurationSeconds = 15 | 30;
export type FrameCount = 450 | 900;
export type TargetId = string; // Validate presetId:aspectId against frozen platform rules.
export type Sha256 = string;
export type RenderProfile = ({
  sampling: 'centered-box-v1'; edgePolicy: 'clamp-v1';
} & (
  | { sampleCount: 1; shutterAngle: 0 }
  | { sampleCount: 4 | 8; shutterAngle: number }
));
export interface Envelope {
  protocolVersion: '2.6.0'; sessionId: string; requestId: string; sequence: number;
  revisionId: string; targetId: TargetId;
}
export interface Init extends Envelope {
  command: 'init'; manifestHash: Sha256; frameCount: FrameCount;
  /** Logical platform dimensions; never reduced for a low-resolution preview. */
  width: number; height: number; fps: 30; seed: string; renderProfile: RenderProfile;
  mode: 'local_preview' | 'trusted_render'; pixelScale: 0.5 | 1;
}
export interface Seek extends Envelope { command: 'seek'; frameIndex: number }
/** Internal command: authenticated Renderer sessions only. */
export interface Sample extends Envelope { command: 'sample'; frameIndex: number; sampleIndex: number }
export interface Inspect extends Envelope {
  command: 'inspect'; frameIndex: number; x01: number; y01: number;
}
export interface Dispose extends Envelope { command: 'dispose' }
export interface FrameReady extends Envelope { event: 'frame-ready'; frameIndex: number; manifestHash: Sha256 }
/** Low-resolution nominal-time playback, including approximation of motion profiles; never QA evidence. */
export interface PreviewFrameReady extends Envelope { event: 'preview-frame-ready'; frameIndex: number; manifestHash: Sha256 }
/** A single sample barrier is not readiness of the averaged output frame. */
export interface SampleReady extends Envelope {
  event: 'sample-ready'; frameIndex: number; sampleIndex: number; manifestHash: Sha256;
}
export interface ProtocolFailure extends Envelope {
  event: 'error'; code: 'FRAME_TIMEOUT' | 'ASSET_UNAVAILABLE' | 'CAPABILITY_UNAVAILABLE' | 'INVALID_SESSION';
}
export interface HitTarget {
  /** Must reference a statically declared region; no arbitrary sandbox-selected source path. */
  regionId: string; sourcePath?: string; line?: number;
  bounds: { x: number; y: number; width: number; height: number };
}
export interface HitResult extends Envelope {
  event: 'hit-result'; frameIndex: number; manifestHash: Sha256; hit: HitTarget | null;
}
/** Declarations are frozen in source. Current values come exclusively from values.json. */
export type EditableProperty = ({
  id: string; label: string; group?: string;
  /** Timing may be redistributed within the fixed 450/900 frames. */
  affectsTiming?: boolean;
} & (
  /** Bound text saves update the fact version and clear its confirmation in the same draft CAS. */
  | { type: 'text'; factId?: string }
  | { type: 'color' | 'asset' }
  /** step is a UI increment; accepted finite values are bounded by min/max, not quantized. */
  | { type: 'number'; min?: number; max?: number; step?: number }
  | { type: 'boolean' }
  | { type: 'enum'; choices: string[] }
  | { type: 'data' }
));
export interface CompositionBridge {
  init(input: Init): Promise<void>;
  /** Local playback returns preview-frame-ready. Trusted sampling returns frame-ready. */
  seekFrame(input: Seek): Promise<FrameReady | PreviewFrameReady>;
  /** Serialize with seek/sample; the response must match this exact envelope and manifest. */
  inspect(input: Inspect): Promise<HitResult>;
  dispose(input: Dispose): Promise<void>;
}
/** Not exposed to Studio callers or source code as a way to choose sampling. */
export interface RendererCompositionBridge extends CompositionBridge {
  seekFrame(input: Seek): Promise<FrameReady>;
  sampleSubframe(input: Sample): Promise<SampleReady>;
}
export type RenderCommand = Init | Seek | Inspect | Dispose;
export type RendererCommand = RenderCommand | Sample;
export type RenderResponse = FrameReady | PreviewFrameReady | HitResult | ProtocolFailure;
export type RendererResponse = FrameReady | SampleReady | HitResult | ProtocolFailure;
export type RenderState = 'created' | 'initializing' | 'idle' | 'seeking' | 'ready' | 'failed' | 'disposed';
