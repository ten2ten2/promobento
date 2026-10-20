/** Contract only; these types are not a browser or sandbox implementation. */
export type DurationSeconds = 15 | 30;
export type FrameCount = 450 | 900;
export type TargetId = string; // Validate presetId:aspectId against the frozen rules version.
export type Sha256 = string;
export interface Envelope {
  protocolVersion: '2.4.0'; sessionId: string; requestId: string; sequence: number;
  revisionId: string; targetId: TargetId;
}
export interface Init extends Envelope {
  command: 'init'; manifestHash: Sha256; frameCount: FrameCount;
  width: number; height: number; fps: 30; seed: string;
}
export interface Seek extends Envelope { command: 'seek'; frameIndex: number }
export interface Dispose extends Envelope { command: 'dispose' }
export interface FrameReady extends Envelope { event: 'frame-ready'; frameIndex: number; manifestHash: Sha256 }
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
  seekFrame(input: Seek): Promise<FrameReady>;
  dispose(input: Dispose): Promise<void>;
  inspect?(input: Seek & { x01: number; y01: number }): Promise<HitTarget | null>;
  getEditables?(): EditableProperty[];
  getMarkers?(): Array<{ id: string; frame: number; label: string }>;
}
/** Wire failures carry the exact command envelope; reject late/disposed responses. */
export type RenderResponse = FrameReady | ProtocolFailure;
/** Serialize seek; validate envelope, nonce, origin and manifest before taking a frame. */
export type RenderState = 'created' | 'initializing' | 'idle' | 'seeking' | 'ready' | 'failed' | 'disposed';
