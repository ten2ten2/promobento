import type { AssetHandle, CanvasTextProof, FilmSpec, Target, PB, SceneContext, MotionTimeline } from '../../../contracts/film-runtime.d.ts';
import type { RendererCompositionBridge } from '../../../contracts/render-protocol.d.ts';

export interface FontRecord {
  fontId: string; weight: number; style: 'normal' | 'italic'; licenseRef: string; rightsCleared: boolean;
  codePoints?: number[];
}
export interface AssetRecord {
  resourceId: string; kind: 'image' | 'svg' | 'video'; width: number; height: number; licenseRef: string; rightsCleared: boolean;
  videoFramePacking?: 'webp-pack-v1';
  videoFrames?: Array<{pts: number; duration: number; index: number}>;
  videoStartSeconds?: number;
}
export interface PageOptions {
  target: Target; seed: string; fonts: FontRecord[]; resources: AssetRecord[]; confirmedFactIds: string[];
  initTimeoutMs: number; frameTimeoutMs: number;
  observeAssets?: boolean;
  customSources?: Record<string,string>;
}
export interface PagePlan {
  spec: FilmSpec; usesWebgl: boolean; target: Target; seed: string; manifestHash: string;
  assets: Record<string, AssetHandle & {videoFrames?: AssetRecord['videoFrames']; videoStartSeconds?: number}>;
  fonts: FontRecord[]; initTimeoutMs: number; frameTimeoutMs: number;
  observeAssets?: boolean;
  customSfx?: Record<string, import('@promobento/contracts/custom-source').CustomSfx[]>;
}
export interface PrivateWebglFactory {create(canvas:unknown):unknown;release(canvas:unknown):void}
export interface WebglInfo {renderer:string;vendor:string;version:string}
export interface StudioInstance {ready:Promise<void>;dispose():void;renderView(view:import('../../../contracts/film-runtime.d.ts').StudioView):void}
export interface PrivateClock {
  begin(seed: string): void; seek(seconds: number): void; paint(timeoutMs: number): Promise<void>;
  wait<T>(work: Promise<T>, timeoutMs: number, code: string): Promise<T>;
}
export interface SceneReadiness {open: boolean; pending: Promise<unknown>[]}
export interface SceneSounds {open: boolean; declarations: import('@promobento/contracts/custom-source').CustomSfx[]; used: Set<number>}
export interface FilmEngine extends RendererCompositionBridge { prepare(plan: PagePlan): Promise<void>;webglInfo():WebglInfo[];canvasTextProof():Array<CanvasTextProof & {sceneId:string}> }
declare global {
  interface Window {
    PB: PB; __omEngine: FilmEngine; __omTarget: Target; __omReady: boolean; __omBootFailed?: string;
    __pbTakeCanvasText?:()=>unknown;
    __pbTakeClock?: () => PrivateClock;
    __pbTakeWebGLFactory?:()=>PrivateWebglFactory;
    __pbTakeWebGLInspector?:()=>()=>WebglInfo[];
    __pbTakeStudioFactory?: () => (ctx:SceneContext, params:{assetKey:string;objectMotion?:boolean;panelKeys?:readonly string[]}) => StudioInstance;
    __pbCreateOM: (ctx: Pick<SceneContext, 'root' | 'target'> & {sceneScoped?: boolean; bpm?: number}, regions: import('../../../contracts/film-runtime.d.ts').SceneRegion[], readiness: SceneReadiness, sounds: SceneSounds, postSeek: Map<(time:number)=>void, number>) => SceneContext['OM'];
    CLIP: SceneContext['CLIP'];
    gsap: {timeline(options: {paused: boolean}): MotionTimeline;
      context(callback: () => void, scope: Element): {kill(): void}};
  }
}
