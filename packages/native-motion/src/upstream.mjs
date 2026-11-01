import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseCanonicalJson} from '../../contracts/src/canonical.mjs';
import {NATIVE_RUNTIME_COMMIT} from '../../contracts/src/native-project.mjs';
import {sha256Bytes} from '../../contracts/src/digest.mjs';
import {CLOUD_PATCH_VERSION} from './policy.mjs';

export const NATIVE_COMMIT = NATIVE_RUNTIME_COMMIT;
export async function loadNative() {
  if (process.platform === 'linux' && process.getuid?.() === 0) throw Error('NATIVE_REQUIRES_UNPRIVILEGED_UID');
  const root = resolve(process.env.HUASHU_MOTION_ROOT || '/opt/huashu-motion');
  const provenance = parseCanonicalJson(readFileSync(join(root, '.promobento-source.json')));
  if (provenance.commit !== NATIVE_COMMIT || provenance.version !== '0.3.1' || provenance.files !== 315) throw Error('NATIVE_INSTALLATION_MISMATCH');
  if (provenance.cloudPatch?.version !== CLOUD_PATCH_VERSION || provenance.cloudPatch.files?.length !== 7) throw Error('NATIVE_CLOUD_PATCH_REQUIRED');
  for (const file of provenance.cloudPatch.files) {
    if (sha256Bytes(readFileSync(join(root, file.path))) !== file.sha256) throw Error('NATIVE_CLOUD_PATCH_MISMATCH');
  }
  if (sha256Bytes(readFileSync(join(root, 'cli/lib/promobento-policy.mjs'))) !== sha256Bytes(readFileSync(new URL('./policy.mjs', import.meta.url)))) throw Error('NATIVE_CLOUD_POLICY_MISMATCH');
  const load = file => import(pathToFileURL(join(root, file)).href);
  const cdp = await load('cli/lib/cdp.js');
  // Keep Chromium's sandbox. CDP uses inherited pipes and fulfills only the project's virtual HTTP origin.
  // The outer job container also has enableInternet=false, including FFmpeg and helper subprocesses.
  for (const flag of ['--disable-dev-shm-usage', '--disable-background-networking', '--disable-extensions', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp']) {
    if (!cdp.CHROME_FLAGS.includes(flag)) cdp.CHROME_FLAGS.push(flag);
  }
  if (cdp.CHROME_FLAGS.some(flag => /no-sandbox|disable-web-security/.test(flag))) throw Error('NATIVE_SANDBOX_DISABLED');
  if (cdp.CHROME_FLAGS.includes('--allow-file-access-from-files')) throw Error('NATIVE_FILE_ORIGIN_DISABLED');
  const [project, capture, renderer, sound, check, exporter] = await Promise.all([
    load('cli/lib/project.js'), load('cli/lib/capture.js'), load('cli/lib/render.js'),
    load('cli/lib/sound.js'), load('cli/lib/check.js'), load('cli/lib/export.js'),
  ]);
  return {root, project, capture, renderer, sound, check, exporter};
}
