export type NativeFile = {path: string; key: string; sha256: string; byteLength: number; mediaType: string};
export type NativeComposition = {durationSeconds: 15 | 30; fps: 30; width: number; height: number};
export type NativeProject = {
  schemaVersion: '1.0.0'; kind: 'native_project'; entry: 'index.html';
  runtime: {name: 'huashu-motion'; commit: string};
  composition: NativeComposition; files: NativeFile[]; resources: Record<string, unknown>[];
  timingEvidenceRef?: {key: string; sha256: string; byteLength: number};
};
export const NATIVE_RUNTIME_COMMIT: string;
export const NATIVE_SOURCE_LIMITS: Readonly<{files: number; bytes: number; fileBytes: number}>;
export function assertNativePath(path: unknown): string;
export function assertNativeProject(project: unknown): NativeProject;
export function nativeProjectHash(project: unknown): Promise<string>;
