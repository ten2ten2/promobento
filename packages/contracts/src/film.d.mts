import type { FilmSpec } from '../../../contracts/film-runtime.d.ts';
export const ASPECTS: readonly ['landscape', 'portrait', 'feed', 'square'];
export interface FilmContext {
  confirmedFactIds?: Set<string>;
  resources?: Map<string, { rightsCleared: boolean; kind?: string }>;
  blocks?: Map<string, { major: number; validateParams?: (params: object) => string[] }>;
  fontIds?: Set<string>;
}
export function filmSpecErrors(spec: FilmSpec, context?: FilmContext): {
  errors: Array<{ code: string; path: string }>; reviews: Array<{ code: string; path: string }>;
};
export function blockReferences(params: Record<string, unknown>): {texts: string[]; assets: string[]};
export function filmTextBindings(spec: FilmSpec): Array<{slotId:string;sceneId:string;frameStart:number;frameEndExclusive:number;text:string;factIds:string[]}>;
