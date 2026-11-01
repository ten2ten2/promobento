export type SourceFile={path:string;content:string};
export function assertAuthorPath(path:string):string;
export function nativeTextType(path:string):string;
export function assertSourceFiles(files:SourceFile[]):SourceFile[];
export function applyProjectPatch(files:SourceFile[],revisionId:string,input:any):SourceFile[];
export function reviewFrameTimes(frames:number[],durationSeconds:number):number[];
export function assertTreatment(value:any,durationSeconds:number,resourceIds:string[]):any;
export function normalizeTimingEvidence(entries:any,materials:any[]):any[];
