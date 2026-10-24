export interface FilmBuildReceipt {
  capabilityProfile:'film-v1';entrypoint:'film.json';sourceArchiveHash:string;
  files:Array<{path:string;sha256:string;byteLength:number}>;filmSource:string;
}
export interface FilmCompositionContext {
  filmSource:string|Uint8Array;presetConfig:Record<string,any>;
  resourceManifest:Record<string,any>;factManifest:Record<string,any>;
}
export interface FilmCompositionInput extends FilmCompositionContext {
  dependencyManifest:Record<string,unknown>;projectId:string;revisionId:string;seed:string;
  runtimeVersion:string;rendererImageDigest:string;renderProfile:Record<string,unknown>;
  targetIds?:string[];coverFrame?:number;exampleOnly?:boolean;styleLabel?:string;
}
export function filmBuildReceipt(raw:string|Uint8Array):FilmBuildReceipt;
export function filmCompositionErrors(composition:Record<string,any>,context:FilmCompositionContext):string[];
export function createFilmComposition(input:FilmCompositionInput):Record<string,any>;
export function filmBuildErrors(composition:Record<string,any>,builds:Record<string,FilmBuildReceipt>,archiveFiles:FilmBuildReceipt['files']):string[];
