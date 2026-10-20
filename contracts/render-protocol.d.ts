/** Contract only; these types are not a browser or sandbox implementation. */
export type DurationSeconds = 15 | 30;
export type FrameCount = 450 | 900;
export type TargetId = string; // Validate presetId:aspectId against the frozen rules version.
export type Sha256 = string;
export interface Envelope {
  protocolVersion: '2.2.1'; sessionId: string; requestId: string; sequence: number;
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
export interface EditableProperty { id: string; label: string; type: 'text' | 'number' | 'color' | 'asset'; value: string | number }
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
