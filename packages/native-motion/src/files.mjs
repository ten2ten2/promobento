import {closeSync, constants, copyFileSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync} from 'node:fs';
import {createSha256} from '../../contracts/src/digest.mjs';
import {dirname, extname, join, relative, resolve, sep} from 'node:path';
import {assertNativePath, NATIVE_SOURCE_LIMITS} from '../../contracts/src/native-project.mjs';
import {builtinSources} from './builtins.mjs';

const SKIP = new Set(['.om', 'out', 'snapshots', 'node_modules', '.git']);
/** Identity of a local regular file, with a fixed 64 KiB read buffer. */
export function fileIdentity(path, maxBytes = 50_000_000) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) throw Error('NATIVE_FILE_TOO_LARGE');
    const hash = createSha256(), buffer = Buffer.allocUnsafe(64 << 10);
    let byteLength = 0, count;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) !== 0) {
      byteLength += count;
      if (byteLength > maxBytes) throw Error('NATIVE_FILE_TOO_LARGE');
      hash.update(buffer.subarray(0, count));
    }
    if (byteLength !== stat.size) throw Error('NATIVE_FILE_CHANGED');
    return {sha256: hash.hex(), byteLength};
  } finally {closeSync(fd);}
}
export function projectPath(root, path) {
  assertNativePath(path);
  const full = resolve(root, path), rel = relative(resolve(root), full);
  if (!rel || rel.startsWith('..' + sep) || rel === '..' || rel.startsWith(sep)) throw Error('NATIVE_PATH_ESCAPE');
  let cursor = resolve(root);
  for (const part of path.split('/')) {
    cursor = join(cursor, part);
    try { if (lstatSync(cursor).isSymbolicLink()) throw Error('NATIVE_SYMLINK'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return full;
}

/** Only ordinary files: archives, symlinks and Node modules are never executed or unpacked. */
export function projectFiles(root) {
  const files = []; let bytes = 0;
  function walk(directory, prefix = '') {
    for (const name of readdirSync(directory).sort()) {
      if (SKIP.has(name)) continue;
      const path = prefix + name, full = projectPath(root, path), stat = lstatSync(full);
      if (stat.isDirectory()) walk(full, path + '/');
      else if (stat.isFile()) {
        bytes += stat.size;
        if (stat.size > NATIVE_SOURCE_LIMITS.fileBytes || bytes > NATIVE_SOURCE_LIMITS.bytes || files.length >= NATIVE_SOURCE_LIMITS.files) throw Error('NATIVE_PROJECT_TOO_LARGE');
        files.push({path, file: full, byteLength: stat.size, mediaType: mediaType(path)});
      } else throw Error('NATIVE_SPECIAL_FILE');
    }
  }
  walk(root);
  return files;
}

export function verifyProjectFiles(root, manifest) {
  const actual = projectFiles(root), expected = new Set(manifest.files.map(file => file.path));
  if (actual.length !== expected.size || actual.some(file => !expected.has(file.path))) throw Error('NATIVE_UNDECLARED_FILE');
  for (const file of manifest.files) {
    const full = projectPath(root, file.path), stat = lstatSync(full);
    if (!stat.isFile() || stat.size !== file.byteLength || fileIdentity(full, NATIVE_SOURCE_LIMITS.fileBytes).sha256 !== file.sha256)
      throw Error('NATIVE_INPUT_IDENTITY_MISMATCH');
  }
}

/** Native library files are materialized from the pinned installation, never produced by a model. */
export function seedBuiltinFiles(root, upstreamRoot) {
  const copy = (source, path) => {
    const from = join(upstreamRoot, source), to = projectPath(root, path), stat = lstatSync(from);
    if (stat.isSymbolicLink()) throw Error('NATIVE_UPSTREAM_SYMLINK');
    if (stat.isDirectory()) {
      mkdirSync(to, {recursive: true, mode: 0o2770});
      for (const name of readdirSync(from)) copy(source + '/' + name, path + '/' + name);
    } else {
      try {
        const existing=lstatSync(to);
        if (!existing.isFile() || existing.size !== stat.size
          || fileIdentity(to).sha256 !== fileIdentity(from).sha256) throw Error('NATIVE_BUILTIN_CONFLICT');
        return;
      }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      mkdirSync(dirname(to), {recursive: true, mode: 0o2770});
      copyFileSync(from, to);
    }
  };
  for (const [source, path] of builtinSources) copy(source, path);
  projectFiles(root);
}

const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.hdr': 'application/octet-stream'};
export const mediaType = path => TYPES[extname(path).toLowerCase()] || 'application/octet-stream';
