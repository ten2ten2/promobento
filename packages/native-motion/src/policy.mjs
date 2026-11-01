// Copied byte-for-byte beside the pinned upstream CLI by apply-cloud-patch.mjs.
// Trusted I/O adaptation only: project JS still runs solely in Chromium, never imported/evaluated in Node.
import {closeSync, lstatSync, openSync, readSync, readFileSync, realpathSync} from 'node:fs';
import {extname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export const CLOUD_PATCH_VERSION = '1.0.0';
export const PROJECT_ORIGIN = 'http://native.project.invalid';
const MAX_FILE_BYTES = 40 << 20;
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.gif':'image/gif','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf','.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.wav':'audio/wav','.mp3':'audio/mpeg','.m4a':'audio/mp4','.ogg':'audio/ogg','.flac':'audio/flac','.gltf':'model/gltf+json','.glb':'model/gltf-binary'};
export const PROJECT_CSP = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function confinedPath(root, candidate, {directory = false, publicResource = false} = {}) {
  if (typeof candidate !== 'string' || !candidate || /[\\\u0000-\u001f\u007f]/.test(candidate)) throw Error('NATIVE_MEDIA_PATH_INVALID');
  const base = realpathSync(root), full = resolve(base, candidate), rel = relative(base, full);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw Error('NATIVE_MEDIA_OUTSIDE_PROJECT');
  const parts = rel.split(sep);
  if (publicResource && parts.some(part => part.startsWith('.')) && !(parts[0] === '.om' && parts[1] === 'cache' && parts[2] === 'frames')) throw Error('NATIVE_PRIVATE_PROJECT_PATH');
  let at = base;
  for (const part of parts) { at = join(at, part); if (lstatSync(at).isSymbolicLink()) throw Error('NATIVE_MEDIA_SYMLINK'); }
  const stat = lstatSync(full);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw Error('NATIVE_MEDIA_SPECIAL_FILE');
  if (!directory && stat.size > MAX_FILE_BYTES) throw Error('NATIVE_MEDIA_TOO_LARGE');
  return full;
}

/** Resolves only ordinary files inside this task's project, including native cache files. */
export function safeMediaFile(src, root) {
  if (!src) return null;
  if (typeof src !== 'string') throw Error('NATIVE_MEDIA_PATH_INVALID');
  let path;
  if (src.startsWith('file:')) path = fileURLToPath(src);
  else if (/^[a-z][a-z0-9+.-]*:/i.test(src)) {
    const url = new URL(src);
    if (url.origin !== PROJECT_ORIGIN || url.username || url.password) throw Error('NATIVE_MEDIA_URL_FORBIDDEN');
    path = decodeURIComponent(url.pathname).slice(1);
  } else path = src.split(/[?#]/)[0];
  return confinedPath(root, path);
}

export function projectResourceUrl(src, root) {
  const file = confinedPath(root, src.startsWith('file:') ? fileURLToPath(src) : src, {directory: true, publicResource: true});
  const rel = relative(realpathSync(root), file).split(sep).map(encodeURIComponent).join('/');
  return PROJECT_ORIGIN + '/' + rel + '/';
}

/** Do not let a local HLS/concat/SDP/playlist open additional local files or network URLs in FFmpeg. */
export function mediaReadOptions(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw Error('NATIVE_MEDIA_SPECIAL_FILE');
  const header = Buffer.alloc(64), descriptor = openSync(file, 'r');
  try { readSync(descriptor, header, 0, header.length, 0); } finally { closeSync(descriptor); }
  const prefix = header.toString('ascii', 0, 12), atom = header.toString('ascii', 4, 8);
  let format;
  if (['ftyp', 'moov', 'wide', 'free', 'mdat', 'skip', 'pnot'].includes(atom)) format = 'mov';
  else if (header.subarray(0, 4).toString('hex') === '1a45dfa3') format = 'matroska,webm';
  else if (prefix.startsWith('RIFF') && prefix.slice(8) === 'WAVE') format = 'wav';
  else if (prefix.startsWith('RIFF') && prefix.slice(8) === 'AVI ') format = 'avi';
  else if (prefix.startsWith('OggS')) format = 'ogg';
  else if (prefix.startsWith('fLaC')) format = 'flac';
  else if (/^GIF8[79]a/.test(prefix)) format = 'gif';
  else if (header.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') format = 'apng,png_pipe';
  else if (prefix.startsWith('ID3') || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)) format = 'mp3,aac';
  else throw Error('NATIVE_MEDIA_FORMAT_FORBIDDEN');
  return ['-protocol_whitelist', 'file,pipe', '-format_whitelist', format, ...(format === 'mov' ? ['-enable_drefs', '0', '-use_absolute_path', '0'] : [])];
}

export function secureMediaArgs(args) {
  return args.flatMap((arg, index) => arg === '-i' ? [...mediaReadOptions(args[index + 1]), arg] : [arg]);
}

/** Header CSP and an HTTP origin keep pages away from local files, workers, frames and other origins.
 * Fetch fulfills bytes itself: no local HTTP port is opened and no network connection is needed. */
export async function installProjectFetch(page, {root, html, errors}) {
  const respond = async event => {
    const {requestId, request} = event;
    try {
      const url = new URL(request.url);
      if (url.protocol === 'data:' || (url.protocol === 'blob:' && url.origin === PROJECT_ORIGIN)) {
        await page.send('Fetch.continueRequest', {requestId});
        return;
      }
      if (url.origin !== PROJECT_ORIGIN || url.username || url.password || !['GET', 'HEAD'].includes(request.method)) throw Error('NATIVE_REQUEST_FORBIDDEN');
      const path = decodeURIComponent(url.pathname).slice(1) || 'index.html';
      const file = confinedPath(root, path, {publicResource: true});
      let body = path === 'index.html' ? Buffer.from(html) : readFileSync(file);
      let responseCode = 200;
      const headers = {'Content-Type': MIME[extname(path).toLowerCase()] || 'application/octet-stream', 'Content-Security-Policy': PROJECT_CSP,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes'};
      const range = Object.entries(request.headers || {}).find(([name]) => name.toLowerCase() === 'range')?.[1];
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!match) throw Error('NATIVE_RANGE_INVALID');
        const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= body.length) throw Error('NATIVE_RANGE_INVALID');
        headers['Content-Range'] = `bytes ${start}-${end}/${body.length}`;
        body = body.subarray(start, end + 1); responseCode = 206;
      }
      headers['Content-Length'] = String(body.length);
      await page.send('Fetch.fulfillRequest', {requestId, responseCode, responseHeaders: Object.entries(headers).map(([name, value]) => ({name, value})), body: request.method === 'HEAD' ? '' : body.toString('base64')});
    } catch (error) {
      errors.push('policy: ' + (/^NATIVE_[A-Z_]+$/.test(error.message) ? error.message : 'NATIVE_RESOURCE_UNAVAILABLE'));
      await page.send('Fetch.failRequest', {requestId, errorReason: 'BlockedByClient'}).catch(() => {});
    }
  };
  page.on('Fetch.requestPaused', event => respond(event));
  await page.send('Network.enable');
  await page.send('Network.setCacheDisabled', {cacheDisabled: true});
  await page.send('Network.setBypassServiceWorker', {bypass: true});
  await page.send('Fetch.enable', {patterns: [{urlPattern: '*', requestStage: 'Request'}]});
  return PROJECT_ORIGIN + '/index.html';
}

export function assertNativeTimeline(info) {
  const actual = info?.timelineDurations?.[info.id];
  if (!Number.isFinite(actual) || Math.abs(actual - info.duration) > 1e-6 || info.timelinePaused?.[info.id] !== true) throw Error('NATIVE_TIMELINE_DURATION_MISMATCH');
}
