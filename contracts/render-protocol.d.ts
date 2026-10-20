/** Contract only. A browser/sandbox runtime has not been implemented by these types. */
export type DurationSeconds = 15 | 30;
export type FrameCount = 450 | 900;
export type TargetId = string; // Server validates presetId:aspectId against pinned preset rules.
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
/** Caller must serialize seek, validate exact envelope/nonce/origin, and discard late responses. */
export type RenderState = 'created' | 'initializing' | 'idle' | 'seeking' | 'ready' | 'failed' | 'disposed';
