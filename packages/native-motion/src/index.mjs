import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {assertNativeProject} from '../../contracts/src/native-project.mjs';
import {sha256Bytes} from '../../contracts/src/digest.mjs';
import {seedBuiltinFiles, verifyProjectFiles} from './files.mjs';
import {loadNative, NATIVE_COMMIT} from './upstream.mjs';
import {assertNativeTimeline} from './policy.mjs';

export {NATIVE_COMMIT};
export {projectPath, projectFiles, mediaType, verifyProjectFiles} from './files.mjs';

export function frameTimes(composition, requested) {
  const {durationSeconds, fps} = composition;
  const last = durationSeconds - 1 / fps;
  const times = requested ?? [0, durationSeconds / 3, durationSeconds * 2 / 3, last];
  if (!Array.isArray(times) || times.length < 1 || times.length > 12 || times.some(time => typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > last) || new Set(times).size !== times.length) throw Error('NATIVE_FRAME_TIMES_INVALID');
  return times;
}

export function assertSourceComposition(html, expected) {
  const root = /<[a-z][\w-]*\b[^>]*\sdata-composition-id\s*=[^>]*>/i.exec(html)?.[0];
  if (!root) throw Error('NATIVE_COMPOSITION_REQUIRED');
  const value = name => {
    const match = new RegExp(`\\sdata-${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(root);
    return Number(match?.[1] ?? match?.[2] ?? match?.[3]);
  };
  if (value('width') !== expected.width || value('height') !== expected.height || value('duration') !== expected.durationSeconds || value('fps') !== expected.fps) throw Error('NATIVE_COMPOSITION_MISMATCH');
}

export function assertBrowserComposition(info, expected) {
  if (!info || info.width !== expected.width || info.height !== expected.height || info.fps !== expected.fps || !Number.isFinite(info.duration) || Math.abs(info.duration - expected.durationSeconds) > 1e-9 || !info.timelines?.length) throw Error('NATIVE_BROWSER_COMPOSITION_MISMATCH');
  assertNativeTimeline(info);
}

export async function prepareNativeProject(projectDir, manifest) {
  assertNativeProject(manifest);
  verifyProjectFiles(projectDir, manifest);
  const native = await loadNative();
  seedBuiltinFiles(projectDir, native.root);
  const project = native.project.openProject(projectDir);
  const {html, token} = native.project.readSource(project);
  assertSourceComposition(html, manifest.composition);
  const findings = native.check.checkSource(project);
  if (findings.some(item => item.level === 'error')) {
    const error = Error('NATIVE_SOURCE_CHECK_FAILED');
    error.findings = findings.filter(item => item.level === 'error').slice(0, 12);
    throw error;
  }
  return {native, project, inputSourceSha256: token, findings};
}

/** The upstream capture implementation drives native HTML/GSAP/Canvas/Three, without a host scene DSL. */
export async function previewNativeProject(prepared, composition, requested) {
  const times = frameTimes(composition, requested);
  const result = await prepared.native.capture.capture(prepared.project.index, {times, chromeArgs: ['--disable-gpu-compositing', '--use-angle=swiftshader']});
  assertBrowserComposition(result.info, composition);
  if (result.errors.length) throw Object.assign(Error('NATIVE_PAGE_ERRORS'), {pageErrors: result.errors.slice(0, 12)});
  return {times, ...result};
}

/** Same refresh + sound preparation as upstream `om render`; renderer and audio synthesis remain upstream. */
export async function renderNativeProject(prepared, composition, out, onLog = () => {}) {
  const {native, project} = prepared;
  native.sound.refreshRuntime(project, onLog);
  let prepare = null;
  if (native.sound.hasSound(native.project.readSource(project).html)) {
    prepare = async page => {
      assertBrowserComposition(page.info, composition);
      let rewrote = false;
      await native.sound.sound(project, {page, onWrite: () => { rewrote = true; }}, onLog);
      return rewrote;
    };
  } else prepare = async page => { assertBrowserComposition(page.info, composition); return false; };
  const file = await native.renderer.render(project, {format: 'mp4', fps: 30, out, workers: 1, video: 'extract', frameFormat: 'png', tune: {software: true}, prepare, onLog, onWarn: onLog});
  return {file, renderedSourceSha256: sha256Bytes(readFileSync(join(project.root, 'index.html')))};
}

/** Direct source edits keep the upstream optimistic token and native .om/history semantics. */
export async function editNativeProject(projectDir, {html, values, baseToken, label = 'edit'}) {
  if (typeof baseToken !== 'string' || !/^[a-f0-9]{64}$/.test(baseToken)) throw Error('NATIVE_BASE_TOKEN_REQUIRED');
  if ((html == null) === (values == null)) throw Error('NATIVE_EDIT_REQUIRED');
  const native = await loadNative(), project = native.project.openProject(projectDir);
  const current = native.project.readSource(project);
  const next = html == null ? native.project.setVariables(current.html, values) : html;
  if (typeof next !== 'string' || Buffer.byteLength(next) > 2 << 20) throw Error('NATIVE_SOURCE_TOO_LARGE');
  const token = native.project.writeSource(project, next, baseToken, label);
  return {token, html: next};
}
