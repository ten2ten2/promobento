import { createHash } from 'node:crypto';
import { compareUtf16, canonical } from './canonical.mjs';
import { digest } from './digest.mjs';

const sourcePath = value => typeof value === 'string' && value.length > 0 && value.length <= 512
  && !/[\\\u0000-\u001f\u007f%:?#]/u.test(value)
  && value.split('/').every(part => part && part !== '.' && part !== '..');
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);

/** The trusted builder supplies actual file bytes, after resolving the allowed dependency graph. */
export function sourceFileDigests(files) {
  if (!Array.isArray(files)) throw Error('SOURCE_FILES_REQUIRED');
  return files.map(({path,bytes}) => {
    if (!sourcePath(path) || !(bytes instanceof Uint8Array)) throw Error('SOURCE_FILE_INVALID');
    return {path,sha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.byteLength};
  });
}

/** A target includes its entrypoint, values.json and every executed local dependency. */
export function targetSourceIdentity({entrypoint,files}) {
  if (!sourcePath(entrypoint) || !Array.isArray(files) || files.length === 0) throw Error('SOURCE_GRAPH_INVALID');
  const paths = new Set();
  const ordered = files.map(file => {
    if (!sourcePath(file.path) || paths.has(file.path) || !hash(file.sha256)
      || !Number.isSafeInteger(file.byteLength) || file.byteLength < 0) throw Error('SOURCE_FILE_INVALID');
    paths.add(file.path);
    return {path:file.path,sha256:file.sha256,byteLength:file.byteLength};
  }).sort((a,b) => compareUtf16(a.path,b.path));
  if (!paths.has(entrypoint) || !paths.has('values.json')) throw Error('SOURCE_GRAPH_INCOMPLETE');
  return {identityVersion:1,entrypoint,files:ordered};
}

/** Build receipts come from the trusted builder/store, never from a request body. */
export function sourceBuildErrors(composition,builds) {
  const errors = [];
  for (const variant of composition.variants) {
    const build = builds && Object.hasOwn(builds,variant.targetId) ? builds[variant.targetId] : null;
    if (!build) { errors.push('SOURCE_BUILD_REQUIRED'); continue; }
    if (build.sourceArchiveHash !== composition.sourceArchiveHash || build.entrypoint !== variant.entrypoint)
      errors.push('SOURCE_BUILD_SCOPE_MISMATCH');
    try {
      if (digest(targetSourceIdentity(build)) !== variant.sourceHash) errors.push('SOURCE_HASH_MISMATCH');
    } catch (error) { errors.push(error.message); }
  }
  return [...new Set(errors)];
}

const environmentFields = ['identityVersion','runtimeVersion','dependencyManifestHash','presetRulesVersion',
  'layoutRulesHash','rendererImageDigest','renderProfile'];

/** Ordinary edits inherit the base environment. Explicit migrations use a separate correction flow. */
export function inheritRevisionEnvironment(base,candidate) {
  if (base.projectId !== candidate.projectId) throw Error('REVISION_PROJECT_MISMATCH');
  const next = structuredClone(candidate);
  for (const key of environmentFields) {
    if (!Object.hasOwn(base,key)) throw Error('REVISION_ENVIRONMENT_INCOMPLETE');
    next[key] = structuredClone(base[key]);
  }
  return next;
}

export function revisionEnvironmentErrors(base,candidate) {
  if (base.projectId !== candidate.projectId) return ['REVISION_PROJECT_MISMATCH'];
  return environmentFields.filter(key => !Object.hasOwn(base,key) || !Object.hasOwn(candidate,key)
    || canonical(base[key]) !== canonical(candidate[key])).map(key => 'REVISION_ENVIRONMENT_CHANGED:'+key);
}
