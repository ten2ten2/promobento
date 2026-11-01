import {canonical} from './canonical.mjs';
import {digest} from './digest.mjs';

export const NATIVE_RUNTIME_COMMIT = '52467f99c602b76ba86d511d37acdfe93fa1e16e';
export const NATIVE_SOURCE_LIMITS = Object.freeze({files: 512, bytes: 128 << 20, fileBytes: 40 << 20});
const dimensions = new Set(['1920x1080', '1080x1920', '1080x1350', '1080x1080']);
const reserved = new Set(['.om', '.git', 'out', 'snapshots', 'node_modules']);
const hash = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, required) {
  if (!record(value) || Object.keys(value).length !== required.length || required.some(key => !Object.hasOwn(value, key))) throw Error('NATIVE_PROJECT_INVALID');
}

/** Portable ordinary relative paths only; the host separately rejects symlinks and special files. */
export function assertNativePath(path) {
  if (typeof path !== 'string' || !path || encoder.encode(path).byteLength > 512
    || /[\\\u0000-\u001f\u007f:#?%]/u.test(path)
    || path !== path.normalize('NFC')
    || path.split('/').some(part => !part || part === '.' || part === '..' || reserved.has(part) || part.startsWith('.') || part.trim() !== part))
    throw Error('NATIVE_PATH_INVALID');
  return path;
}

/** This envelope transports native files; it never describes or evaluates scenes. */
export function assertNativeProject(project) {
  keys(project, ['schemaVersion', 'kind', 'entry', 'runtime', 'composition', 'files', 'resources']);
  if (project.schemaVersion !== '1.0.0' || project.kind !== 'native_project' || project.entry !== 'index.html') throw Error('NATIVE_PROJECT_INVALID');
  keys(project.runtime, ['name', 'commit']);
  if (project.runtime.name !== 'huashu-motion' || project.runtime.commit !== NATIVE_RUNTIME_COMMIT) throw Error('NATIVE_RUNTIME_MISMATCH');
  keys(project.composition, ['durationSeconds', 'fps', 'width', 'height']);
  const c = project.composition;
  if (![15, 30].includes(c.durationSeconds) || c.fps !== 30 || !dimensions.has(c.width + 'x' + c.height)
    || !Number.isSafeInteger(c.width) || !Number.isSafeInteger(c.height)) throw Error('NATIVE_COMPOSITION_INVALID');
  if (!Array.isArray(project.files) || !project.files.length || project.files.length > NATIVE_SOURCE_LIMITS.files) throw Error('NATIVE_FILES_INVALID');
  const paths = new Set(); let total = 0;
  for (const file of project.files) {
    keys(file, ['path', 'key', 'sha256', 'byteLength', 'mediaType']);
    assertNativePath(file.path);
    // Reject case-folding collisions before a project is copied between file systems.
    const pathKey = file.path.toLowerCase();
    if (paths.has(pathKey)) throw Error('NATIVE_PATH_COLLISION');
    paths.add(pathKey);
    if (typeof file.key !== 'string' || !file.key || encoder.encode(file.key).byteLength > 1024
      || /[\\\u0000-\u001f\u007f?#%]/u.test(file.key) || file.key.split('/').some(part => !part || part === '.' || part === '..')
      || !hash.test(file.sha256) || !Number.isSafeInteger(file.byteLength) || file.byteLength < 0
      || file.byteLength > NATIVE_SOURCE_LIMITS.fileBytes
      || typeof file.mediaType !== 'string' || !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(file.mediaType)) throw Error('NATIVE_FILE_INVALID');
    total += file.byteLength;
    if (total > NATIVE_SOURCE_LIMITS.bytes) throw Error('NATIVE_PROJECT_TOO_LARGE');
    if (file.path === 'index.html' && (file.byteLength === 0 || file.mediaType !== 'text/html')) throw Error('NATIVE_ENTRY_INVALID');
  }
  if (!project.files.some(file => file.path === 'index.html')) throw Error('NATIVE_ENTRY_REQUIRED');
  for (const file of project.files) {
    const parts = file.path.toLowerCase().split('/'); parts.pop();
    while (parts.length) { if (paths.has(parts.join('/'))) throw Error('NATIVE_PATH_COLLISION'); parts.pop(); }
  }
  if (!Array.isArray(project.resources) || project.resources.length > 128 || project.resources.some(resource => !record(resource))) throw Error('NATIVE_RESOURCES_INVALID');
  if (encoder.encode(canonical(project.resources)).byteLength > 1 << 20) throw Error('NATIVE_RESOURCES_INVALID');
  canonical(project); // Reject accessors, non-JSON objects, cycles and invalid Unicode before identity.
  return project;
}

/** Stable file ordering; keys and hashes are bound to the immutable revision together. */
export async function nativeProjectHash(project) {
  assertNativeProject(project);
  return digest({...project, files: [...project.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)});
}
