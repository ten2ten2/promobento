/** Initial internal-evaluation capacity ceilings; not measured production promises. */
import {NATIVE_SOURCE_LIMITS} from '@promobento/contracts/native-project';
import {pinnedBuiltinFiles} from '../../../packages/native-motion/src/builtins.mjs';
import {assertAuthorPath} from '../../../packages/methods/native-authoring.mjs';

export type MediaFile={path:string;sha256:string;byteLength:number;mediaType:string};
type MediaSelection={uses?:{sha256:string}[]}|null;

/** Use the same inheritance, de-duplication and retired-lock rules for paid
 * patch preflight and for the eventual immutable native snapshot. */
export function activeNativeMediaFiles(baseFiles:MediaFile[],freshFiles:MediaFile[],selection:MediaSelection,audioLocks:{sha256:string}[]):MediaFile[]{
 const assets=new Map<string,MediaFile>();
 for(const file of [...baseFiles.filter(file=>{try{assertAuthorPath(file.path);return false;}catch{return true;}}),...freshFiles]){
  const previous=assets.get(file.path);
  if(previous&&(previous.sha256!==file.sha256||previous.byteLength!==file.byteLength||previous.mediaType!==file.mediaType))
   throw Error('NATIVE_ASSET_PATH_CONFLICT');
  if(!previous)assets.set(file.path,file);
 }
 if(selection||audioLocks.length){
  const permitted=new Set([...(selection?.uses??[]).map(use=>use.sha256),...audioLocks.map(lock=>lock.sha256)]);
  for(const [path,file] of assets)if(/^assets\/[a-f0-9]{24}\./.test(path)&&!permitted.has(file.sha256))assets.delete(path);
 }
 return [...assets.values()];
}

// The pinned runtime seeds 37 files (4,298,698 bytes). Keep headroom for
// those files and authored text, plus the PCM WAV that `om sound` may create.
const runtimeReserveBytes = 6 << 20;
const generatedHtmlHeadroom = 64 << 10;
export const nativeSoundtrackBytes = (durationSeconds: number) => 44 + durationSeconds * 48_000 * 2 * 2;
export const nativeNewMediaLimit = (durationSeconds: number) =>
  NATIVE_SOURCE_LIMITS.bytes - runtimeReserveBytes - nativeSoundtrackBytes(durationSeconds);

/** An accepted source revision must also fit after native export materializes its files. */
export function assertNativeSnapshotHeadroom(project: {
  composition: {durationSeconds: number}; files: Array<{path: string; byteLength: number}>;
}) {
  const existingSound = project.files.find(file => file.path === 'assets/sound.wav');
  const soundGrowth = Math.max(0, nativeSoundtrackBytes(project.composition.durationSeconds) - (existingSound?.byteLength ?? 0));
  const total = project.files.reduce((bytes, file) => bytes + file.byteLength, 0);
  const existing = new Map(project.files.map(file => [file.path, file.byteLength]));
  let missingBytes = 0, missingFiles = 0;
  for (const builtin of pinnedBuiltinFiles) {
    const size = existing.get(builtin.path);
    if (size === undefined) {missingBytes += builtin.byteLength; missingFiles++;}
    else if (size !== builtin.byteLength) throw Error('NATIVE_BUILTIN_CONFLICT');
  }
  // A native import may already include the pinned runtime and WAV. Reserve
  // only what will actually be created, plus room for injected HTML markup.
  if (total + missingBytes + soundGrowth + generatedHtmlHeadroom > NATIVE_SOURCE_LIMITS.bytes
    || project.files.length + missingFiles + (existingSound ? 0 : 1) > NATIVE_SOURCE_LIMITS.files)
    throw Error('NATIVE_PROJECT_TOO_LARGE');
}

/** Before authoring, reject only snapshots that cannot fit even with minimal
 * source. Once the author responds, check its actual files before caching it. */
export function assertNativePatchHeadroom(project:{composition:{durationSeconds:number};files:MediaFile[]},
 freshFiles:MediaFile[],selection:MediaSelection,audioLocks:{sha256:string}[],authored?:{path:string;content:string}[],
 frozenDocuments?:{path:string;content:string}[]){
 const assets=activeNativeMediaFiles(project.files,freshFiles,selection,audioLocks);
 const inherited=new Set(project.files.map(file=>file.path));
 const frozenPaths=new Set(['BRIEF.md','TREATMENT.md','script.json','material-selection.json','script-audio-locks.json']);
 const frozenBytes=new Map(frozenDocuments?.filter(file=>frozenPaths.has(file.path))
  .map(file=>[file.path,new TextEncoder().encode(file.content).byteLength])??[]);
 const source=authored
  ? authored.map(file=>({path:file.path,byteLength:new TextEncoder().encode(file.content).byteLength}))
  : [...new Set(['index.html','BRIEF.md',
     ...(inherited.has('script.json')?['script-audio-locks.json']:[]),
     ...(selection?['material-selection.json']:[]),
     ...project.files.filter(file=>
     frozenPaths.has(file.path)).map(file=>file.path),...frozenBytes.keys()])]
    .map(path=>({path,byteLength:frozenBytes.get(path)??1}));
 assertNativeSnapshotHeadroom({composition:project.composition,files:[...assets,...source]});
}

export const nativeRenderPolicy = {
  instance: 'standard-3', globalInstances: 4, workspaceInstances: 1,
  previewDeadlineMs: 180000, exportDeadlineMs: 600000,
  queueWaitMs: 15 * 60_000, previewOperationMs: 30 * 60_000, exportOperationMs: 45 * 60_000,
  containerStartupMs: 45000, maxAttempts: 2,
} as const;
