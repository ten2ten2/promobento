/** Initial internal-evaluation capacity ceilings; not measured production promises. */
import {NATIVE_SOURCE_LIMITS} from '@promobento/contracts/native-project';

// The pinned runtime seeds 37 files (4,298,698 bytes). Keep headroom for
// those files and authored text, plus the PCM WAV that `om sound` may create.
const runtimeReserveBytes = 6 << 20;
const runtimeReserveFiles = 37;
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
  // Count the pinned files conservatively even for an imported snapshot that
  // already contains them. This avoids admitting a render that will breach the
  // immutable native project envelope after the renderer has been paid.
  if (total > NATIVE_SOURCE_LIMITS.bytes - runtimeReserveBytes - soundGrowth
    || project.files.length > NATIVE_SOURCE_LIMITS.files - runtimeReserveFiles - (existingSound ? 0 : 1))
    throw Error('NATIVE_PROJECT_TOO_LARGE');
}

export const nativeRenderPolicy = {
  instance: 'standard-3', globalInstances: 4, workspaceInstances: 1,
  previewDeadlineMs: 180000, exportDeadlineMs: 600000,
  queueWaitMs: 15 * 60_000, previewOperationMs: 30 * 60_000, exportOperationMs: 45 * 60_000,
  containerStartupMs: 45000, maxAttempts: 2,
} as const;
