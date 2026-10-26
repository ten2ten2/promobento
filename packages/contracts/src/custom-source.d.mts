import type {FilmSpec,FilmScene} from '../../../contracts/film-runtime.d.ts';
export const CUSTOM_SOURCE_MAX_BYTES: number;
export interface CustomPlan {textSlots:string[];assetKeys:string[];events:Array<{name:string;frame:number}>;readingHolds:Array<{start:number;end:number}>;hardest?:boolean}
export function customScenePlan(scene:FilmScene):CustomPlan;
export function customSourceErrors(scene:FilmScene,source:string,spec:FilmSpec):Array<{code:string;line:number}>;
export function assertCustomSources(spec:FilmSpec,sources?:Record<string,string>):void;
export function applyCustomEdit(previous:string|undefined,input:{path:string;command:string;fileText?:string;oldStr?:string;newStr?:string;insertLine?:number},path:string):string;
