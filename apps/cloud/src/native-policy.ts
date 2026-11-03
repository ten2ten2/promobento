/** Initial internal-evaluation capacity ceilings; not measured production promises. */
import {NATIVE_SOURCE_LIMITS} from '@promobento/contracts/native-project';
import {pinnedBuiltinFiles} from '../../../packages/native-motion/src/builtins.mjs';

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

export const nativeRenderPolicy = {
  instance: 'standard-3', globalInstances: 4, workspaceInstances: 1,
  previewDeadlineMs: 180000, exportDeadlineMs: 600000,
  queueWaitMs: 15 * 60_000, previewOperationMs: 30 * 60_000, exportOperationMs: 45 * 60_000,
  containerStartupMs: 45000, maxAttempts: 2,
} as const;
