import type {FilmSpec,FilmScene} from '../../../contracts/film-runtime.d.ts';
export const CUSTOM_SOURCE_MAX_BYTES: number;
export interface CustomPlan {textSlots:string[];assetKeys:string[];events:Array<{name:string;frame:number}>;readingHolds:Array<{start:number;end:number;visibleTextSlots?:string[]}>;assetChecks?:Array<{frame:number;assetKeys:string[]}>;hardest?:boolean;sourceSfx?:boolean}
export function customScenePlan(scene:FilmScene,options?:{validateVisibleTextSlots?:boolean;validateAssetChecks?:boolean}):CustomPlan;
export function customStudioAsset(scene:FilmScene,source:string):string|null;
export function customStudioAssets(scene:FilmScene,source:string):string[]|null;
export function customSourceErrors(scene:FilmScene,source:string,spec:FilmSpec):Array<{code:string;line:number}>;
export interface CustomSfx {id:string;frame:number;sample?:number;seconds:number;gain:number;gainDb:number}
export function extractCustomSfx(scene:FilmScene,source:string,spec:FilmSpec):CustomSfx[];
export function filmCustomSfx(spec:FilmSpec,sources?:Record<string,string>):Array<CustomSfx & {sceneId:string}>;
export function assertCustomSources(spec:FilmSpec,sources?:Record<string,string>):void;
export function applyCustomEdit(previous:string|undefined,input:{path:string;command:string;fileText?:string;oldStr?:string;newStr?:string;insertLine?:number},path:string):string;
