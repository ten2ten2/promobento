/** Contract only; these types are not a browser or sandbox implementation. */
export type DurationSeconds = 15 | 30;
export type FrameCount = 450 | 900;
export type TargetId = string; // Validate presetId:aspectId against the frozen rules version.
export type Sha256 = string;
/** Chosen by the trusted controller from platform-presets.renderProfiles and frozen at init. */
export type RenderProfile = ({
  sampling: 'centered-box-v1'; edgePolicy: 'clamp-v1';
} & (
  | { sampleCount: 1; shutterAngle: 0 }
  | { sampleCount: 4 | 8; shutterAngle: number }
));
export interface Envelope {
  protocolVersion: '2.5.0'; sessionId: string; requestId: string; sequence: number;
  revisionId: string; targetId: TargetId;
}
export interface Init extends Envelope {
  command: 'init'; manifestHash: Sha256; frameCount: FrameCount;
  width: number; height: number; fps: 30; seed: string; renderProfile: RenderProfile;
}
export interface Seek extends Envelope { command: 'seek'; frameIndex: number }
/** Internal command: authenticated Renderer sessions only; both indices are integers. */
export interface Sample extends Envelope { command: 'sample'; frameIndex: number; sampleIndex: number }
export interface Dispose extends Envelope { command: 'dispose' }
export interface FrameReady extends Envelope { event: 'frame-ready'; frameIndex: number; manifestHash: Sha256 }
/** A single sample barrier is not readiness of the averaged final frame. */
export interface SampleReady extends Envelope {
  event: 'sample-ready'; frameIndex: number; sampleIndex: number; manifestHash: Sha256;
}
export interface ProtocolFailure extends Envelope {
  event: 'error'; code: 'FRAME_TIMEOUT' | 'ASSET_UNAVAILABLE' | 'CAPABILITY_UNAVAILABLE' | 'INVALID_SESSION';
}
export interface HitTarget {
  elementId?: string; sourcePath?: string; line?: number;
  bounds?: { x: number; y: number; width: number; height: number };
}
export type EditableProperty = ({
  id: string; label: string; group?: string;
  /** Changing this value may reflow beats, but never extends the fixed 450/900 frames. */
  affectsTiming?: boolean;
} & (
  | { type: 'text' | 'color' | 'asset'; value: string }
  | { type: 'number'; value: number; min?: number; max?: number; step?: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'enum'; value: string; choices: string[] }
  | { type: 'data'; value: ReadonlyArray<Record<string, string | number | boolean | null>> }
));
export interface CompositionBridge {
  init(input: Init): Promise<void>;
  /** Resolve the final frame under the frozen profile; never accept a fractional frameIndex. */
  seekFrame(input: Seek): Promise<FrameReady>;
  dispose(input: Dispose): Promise<void>;
  inspect?(input: Seek & { x01: number; y01: number }): Promise<HitTarget | null>;
  getEditables?(): EditableProperty[];
  getMarkers?(): Array<{ id: string; frame: number; label: string }>;
}
/** Not exposed to a Studio caller or to untrusted code as a way to choose exposure. */
export interface RendererCompositionBridge extends CompositionBridge {
  sampleSubframe(input: Sample): Promise<SampleReady>;
}
export type RenderCommand = Init | Seek | Dispose;
export type RendererCommand = RenderCommand | Sample;
/** Wire failures carry the exact command envelope; reject late/disposed responses. */
export type RenderResponse = FrameReady | ProtocolFailure;
export type RendererResponse = RenderResponse | SampleReady;
/** Serialize seek; validate envelope, nonce, origin and manifest before taking a frame. */
export type RenderState = 'created' | 'initializing' | 'idle' | 'seeking' | 'ready' | 'failed' | 'disposed';
