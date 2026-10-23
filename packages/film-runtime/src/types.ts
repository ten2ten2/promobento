import type { AssetHandle, FilmSpec, Target, PB } from '../../../contracts/film-runtime.d.ts';
import type { RendererCompositionBridge } from '../../../contracts/render-protocol.d.ts';

export interface FontRecord {
  fontId: string; weight: number; style: 'normal' | 'italic'; licenseRef: string; rightsCleared: boolean;
}
export interface AssetRecord {
  resourceId: string; kind: 'image' | 'svg'; width: number; height: number; licenseRef: string; rightsCleared: boolean;
}
export interface PageOptions {
  target: Target; seed: string; fonts: FontRecord[]; resources: AssetRecord[]; confirmedFactIds: string[];
  initTimeoutMs: number; frameTimeoutMs: number;
}
export interface PagePlan {
  spec: FilmSpec; target: Target; seed: string; manifestHash: string;
  assets: Record<string, AssetHandle>; fonts: FontRecord[]; initTimeoutMs: number; frameTimeoutMs: number;
}
export interface PrivateClock {
  begin(seed: string): void; seek(seconds: number): void; paint(timeoutMs: number): Promise<void>;
  wait<T>(work: Promise<T>, timeoutMs: number, code: string): Promise<T>;
}
export interface FilmEngine extends RendererCompositionBridge { prepare(plan: PagePlan): Promise<void> }
declare global {
  interface Window {
    PB: PB; __omEngine: FilmEngine; __omTarget: Target; __omReady: boolean; __omBootFailed?: string;
    __pbTakeClock?: () => PrivateClock;
  }
}
