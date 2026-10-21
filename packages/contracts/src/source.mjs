import { createHash } from 'node:crypto';
import { compareUtf16, canonical } from './canonical.mjs';
import { digest } from './digest.mjs';

import { safePath, sourceValuesBytes, pathComparisonKey } from './source-values.mjs';
export { safePath, SOURCE_VALUES_MAX_BYTES, SOURCE_VALUES_MAX_ITEMS, sourceValuesBytes, parseSourceValues } from './source-values.mjs';
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);

/** The trusted builder supplies actual file bytes, after resolving the allowed dependency graph. */
export function sourceFileDigests(files) {
  if (!Array.isArray(files)) throw Error('SOURCE_FILES_REQUIRED');
  assertSourcePaths(files);
  return files.map(({path,bytes}) => {
    if (!safePath(path) || !(bytes instanceof Uint8Array)) throw Error('SOURCE_FILE_INVALID');
    return {path,sha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.byteLength};
  });
}

/** Validate the complete archive inventory before writing any files into a destination tree. */
function assertSourcePaths(files) {
  const entries=new Map();
  for (const file of files) {
    if (!file || !safePath(file.path)) throw Error('SOURCE_FILE_INVALID');
    const parts=file.path.split('/');
    for (let index=0;index<parts.length;index++) {
      const path=parts.slice(0,index+1).join('/'),key=pathComparisonKey(path),directory=index<parts.length-1;
      const previous=entries.get(key);
      if (previous) {
        if (previous.path!==path || previous.directory!==directory) throw Error('SOURCE_PATH_COLLISION');
        if (!directory) throw Error('SOURCE_FILE_INVALID');
      } else entries.set(key,{path,directory});
    }
  }
}

function orderedSourceFiles(files) {
  if (!Array.isArray(files) || files.length === 0) throw Error('SOURCE_GRAPH_INVALID');
  assertSourcePaths(files);
  const paths = new Set();
  const ordered = files.map(file => {
    if (!file || !safePath(file.path) || paths.has(file.path) || !hash(file.sha256)
      || !Number.isSafeInteger(file.byteLength) || file.byteLength < 0) throw Error('SOURCE_FILE_INVALID');
    paths.add(file.path);
    return {path:file.path,sha256:file.sha256,byteLength:file.byteLength};
  }).sort((a,b) => compareUtf16(a.path,b.path));
  if (!paths.has('values.json')) throw Error('SOURCE_GRAPH_INCOMPLETE');
  return ordered;
}

/** Full source-tree identity, independent of archive timestamps, entry order or compression. */
export function sourceArchiveIdentity(files) {
  return {identityVersion:1,files:orderedSourceFiles(files)};
}

/** A target includes its entrypoint, values.json and every executed local dependency. */
export function targetSourceIdentity({entrypoint,files}) {
  if (!safePath(entrypoint) || !entrypoint.endsWith('.mjs')) throw Error('SOURCE_ENTRYPOINT_INVALID');
  const ordered = orderedSourceFiles(files);
  if (!ordered.some(file => file.path === entrypoint)) throw Error('SOURCE_GRAPH_INCOMPLETE');
  return {identityVersion:1,entrypoint,files:ordered};
}

/** Build receipts come from the trusted builder/store, never from a request body. */
export function sourceBuildErrors(composition,builds,archiveFiles) {
  const errors = [];
  let archive;
  try {
    archive = sourceArchiveIdentity(archiveFiles);
    if (digest(archive) !== composition.sourceArchiveHash) errors.push('SOURCE_ARCHIVE_HASH_MISMATCH');
  } catch { errors.push('SOURCE_ARCHIVE_REQUIRED'); }
  const inventory = new Map((archive?.files ?? []).map(file => [file.path,file]));
  let sharedDeclarations;
  for (const variant of composition.variants) {
    const build = builds && Object.hasOwn(builds,variant.targetId) ? builds[variant.targetId] : null;
    if (!build) { errors.push('SOURCE_BUILD_REQUIRED'); continue; }
    if (build.sourceArchiveHash !== composition.sourceArchiveHash || build.entrypoint !== variant.entrypoint)
      errors.push('SOURCE_BUILD_SCOPE_MISMATCH');
    try {
      if (digest(targetSourceIdentity(build)) !== variant.sourceHash) errors.push('SOURCE_HASH_MISMATCH');
      for (const file of build.files) {
        const original = inventory.get(file.path);
        if (archive && (!original || original.sha256 !== file.sha256 || original.byteLength !== file.byteLength))
          errors.push('SOURCE_BUILD_FILE_MISMATCH');
      }
      const actual = build.files.find(file => file.path === 'values.json');
      const expected = sourceFileDigests([{path:'values.json',bytes:sourceValuesBytes(build.values)}])[0];
      if (actual.sha256 !== expected.sha256 || actual.byteLength !== expected.byteLength)
        errors.push('SOURCE_VALUES_BYTES_MISMATCH');
      if (Array.isArray(build.editables)) {
        const declarations = canonical([...build.editables].sort((a,b) => compareUtf16(a.id,b.id)));
        if (sharedDeclarations !== undefined && declarations !== sharedDeclarations)
          errors.push('SHARED_EDITABLE_DECLARATIONS_MISMATCH');
        sharedDeclarations ??= declarations;
      }
    } catch (error) {
      const codes = ['SOURCE_GRAPH_INVALID','SOURCE_FILE_INVALID','SOURCE_PATH_COLLISION','SOURCE_GRAPH_INCOMPLETE','SOURCE_ENTRYPOINT_INVALID',
        'SOURCE_VALUES_INVALID','SOURCE_VALUES_TOO_LARGE','SOURCE_VALUES_TOO_MANY'];
      errors.push(codes.includes(error.message) ? error.message : 'SOURCE_BUILD_INVALID');
    }
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
