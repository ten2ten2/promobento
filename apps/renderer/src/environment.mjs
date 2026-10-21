import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {parseCanonicalJson,digest} from '@promobento/contracts';

export const environmentLock = parseCanonicalJson(readFileSync(new URL('../environment.lock.json',import.meta.url)));
export const browserDirectory = () => process.env.PROMOBENTO_BROWSER_DIR || join(tmpdir(),'promobento-chromium-'+environmentLock.browser.version);
export const browserExecutable = () => join(browserDirectory(),environmentLock.browser.relativeExecutable);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const command = (file,args) => execFileSync(file,args,{encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024});

function libraryHashes(executable) {
  const output = command('ldd',[executable]);
  if (/not found/.test(output)) throw new Error('RENDERER_SYSTEM_LIBRARY_MISSING');
  const paths = [...new Set([...output.matchAll(/(?:=>\s+|^\s*)(\/[^\s]+)\s+\(/gm)].map(match=>match[1]))].sort();
  return paths.map(path=>({path,sha256:sha256(readFileSync(path))}));
}

export function inspectEnvironment() {
  const lock = environmentLock;
  if (process.platform !== lock.platform || process.arch !== lock.architecture || process.versions.node !== lock.nodeVersion)
    throw new Error('RENDERER_TOOLCHAIN_MISMATCH: use the pinned Linux x64 Node environment');
  const os = Object.fromEntries(readFileSync('/etc/os-release','utf8').trim().split('\n').map(line=>{
    const index=line.indexOf('=');return [line.slice(0,index),line.slice(index+1).replace(/^"|"$/g,'')];
  }));
  if (os.ID !== lock.distribution || os.VERSION_ID !== lock.distributionVersion) throw new Error('RENDERER_OS_MISMATCH');
  const require = createRequire(import.meta.url);
  const driver = require('playwright-core/package.json').version;
  if (driver !== lock.playwrightCoreVersion) throw new Error('RENDERER_DRIVER_MISMATCH');
  const browser = browserExecutable();
  for (const path of [browser,'/usr/bin/ffmpeg','/usr/bin/ffprobe'])
    if (!existsSync(path)) throw new Error('RENDERER_TOOL_MISSING: '+path+'; run the renderer installation steps in PRD 08');
  const browserHash=sha256(readFileSync(browser)),ffmpegHash=sha256(readFileSync('/usr/bin/ffmpeg')),ffprobeHash=sha256(readFileSync('/usr/bin/ffprobe'));
  if (browserHash!==lock.browser.executableSha256 || ffmpegHash!==lock.ffmpeg.executableSha256 || ffprobeHash!==lock.ffmpeg.ffprobeSha256)
    throw new Error('RENDERER_BINARY_HASH_MISMATCH');
  const browserVersion=command(browser,['--version']).trim();
  const ffmpegVersion=command('/usr/bin/ffmpeg',['-version']);
  const ffprobeVersion=command('/usr/bin/ffprobe',['-version']);
  if (!browserVersion.endsWith(lock.browser.version) || !ffmpegVersion.startsWith('ffmpeg version '+lock.ffmpeg.version+' ')
    || !ffprobeVersion.startsWith('ffprobe version '+lock.ffmpeg.version+' ')) throw new Error('RENDERER_VERSION_MISMATCH');
  if (!ffmpegVersion.includes('--enable-gpl') || !ffmpegVersion.includes('--enable-libx264') || !ffmpegVersion.includes('--enable-libzimg'))
    throw new Error('RENDERER_ENCODER_UNAVAILABLE');
  const bundledData = ['icudtl.dat','v8_context_snapshot.bin'].map(name=>{
    const path=join(dirname(browser),name);return {name,sha256:sha256(readFileSync(path))};
  });
  const environment = {
    lockHash:digest(lock),platform:process.platform,architecture:process.arch,os:os.PRETTY_NAME,
    node:process.versions.node,playwrightCore:driver,browserVersion,browserHash,ffmpegHash,ffprobeHash,
    ffmpegVersion,ffprobeVersion,bundledData,
    sharedLibraries:{browser:libraryHashes(browser),ffmpeg:libraryHashes('/usr/bin/ffmpeg'),ffprobe:libraryHashes('/usr/bin/ffprobe')},
    launchArgs:lock.launchArgs,deviceScaleFactor:lock.deviceScaleFactor,
    // The harness cannot accept a customer composition or arbitrary URL.
    browserSandbox:false,scope:lock.scope,fonts:lock.fonts
  };
  return {...environment,environmentHash:digest(environment)};
}
