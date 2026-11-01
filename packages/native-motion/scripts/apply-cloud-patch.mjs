import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, copyFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {canonical, parseCanonicalJson} from '../../contracts/src/canonical.mjs';
import {CLOUD_PATCH_VERSION} from '../src/policy.mjs';

const root = resolve(process.argv[2] || '/opt/huashu-motion');
const lock = parseCanonicalJson(readFileSync(new URL('../upstream.lock.json', import.meta.url)));
const provenance = parseCanonicalJson(readFileSync(join(root, '.promobento-source.json')));
if (provenance.commit !== lock.commit || provenance.cloudPatch) throw Error('NATIVE_PATCH_BASE_MISMATCH');
const patches = [
  {
    "path": "cli/lib/cdp.js",
    "edits": [
      [
        "'--allow-file-access-from-files', ",
        ""
      ]
    ]
  },
  {
    "path": "cli/lib/capture.js",
    "edits": [
      [
        "import { OmError } from './project.js';",
        "import { OmError } from './project.js';\nimport { installProjectFetch, projectResourceUrl, assertNativeTimeline } from './promobento-policy.mjs';"
      ],
      [
        "    await Promise.all([page.send('Page.enable'), page.send('Runtime.enable'), page.send('Log.enable')]);",
        "    await Promise.all([page.send('Page.enable'), page.send('Runtime.enable'), page.send('Log.enable')]);\n    const pageUrl = await installProjectFetch(page, { root: dirname(file), html, errors });"
      ],
      [
        "    const nav = await page.send('Page.navigate', { url: pathToFileURL(target).href });",
        "    const nav = await page.send('Page.navigate', { url: pageUrl });"
      ],
      [
        "  const info = await page.evaluate('window.__omEngine.info()');",
        "  let info;\n  try {\n    info = await page.evaluate('(() => { const info = window.__omEngine.info(); const entries = Object.entries(window.__timelines || {}); return {...info, timelineDurations: Object.fromEntries(entries.map(([id, timeline]) => [id, timeline.duration()])), timelinePaused: Object.fromEntries(entries.map(([id, timeline]) => [id, timeline.paused()]))}; })()');\n    if (!lenient) assertNativeTimeline(info);\n  } catch (error) {\n    await conn.close();\n    if (scratch) rmSync(scratch, { recursive: true, force: true });\n    throw error;\n  }"
      ],
      [
        "    setFrames: (id, table) => page.evaluate(`window.__omEngine.setFrames(${JSON.stringify(id)}, ${JSON.stringify(table)})`),",
        "    setFrames: (id, table) => page.evaluate(`window.__omEngine.setFrames(${JSON.stringify(id)}, ${JSON.stringify({...table, base: projectResourceUrl(table.base, dirname(file))})})`),"
      ]
    ]
  },
  {
    "path": "cli/lib/render-om.js",
    "edits": [
      [
        "import { OmError } from './project.js';",
        "import { OmError } from './project.js';\nimport { safeMediaFile } from './promobento-policy.mjs';"
      ],
      [
        "function localPath(src, root) {\n  if (!src) return null;\n  if (src.startsWith('file:')) return fileURLToPath(src);\n  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return null; // http(s), data, blob\n  return isAbsolute(src) ? src : resolve(root, src.split(/[?#]/)[0]);\n}",
        "function localPath(src, root) {\n  return safeMediaFile(src, root);\n}"
      ]
    ]
  },
  {
    "path": "cli/lib/sound.js",
    "edits": [
      [
        "import { OmError, readSource, writeSource } from './project.js';",
        "import { OmError, readSource, writeSource } from './project.js';\nimport { safeMediaFile } from './promobento-policy.mjs';"
      ],
      [
        "  const voiceFile = voiceTag ? join(project.root, attrs(voiceTag[0]).src || 'assets/voice.wav') : null;",
        "  const voiceFile = voiceTag ? safeMediaFile(attrs(voiceTag[0]).src || 'assets/voice.wav', project.root) : null;"
      ]
    ]
  },
  {
    "path": "cli/lib/frames.js",
    "edits": [
      [
        "import { OmError } from './project.js';",
        "import { OmError } from './project.js';\nimport { mediaReadOptions, secureMediaArgs } from './promobento-policy.mjs';"
      ],
      [
        "const sh = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 << 20 });",
        "const sh = (cmd, args) => spawnSync(cmd, [...mediaReadOptions(args.at(-1)), ...args], { encoding: 'utf8', maxBuffer: 256 << 20 });"
      ],
      [
        "    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });",
        "    const p = spawn('ffmpeg', secureMediaArgs(args), { stdio: ['ignore', 'ignore', 'pipe'] });"
      ]
    ]
  },
  {
    "path": "cli/lib/audio.js",
    "edits": [
      [
        "import { OmError } from './project.js';",
        "import { OmError } from './project.js';\nimport { mediaReadOptions, secureMediaArgs } from './promobento-policy.mjs';"
      ],
      [
        "const ff = (args) => spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });",
        "const ff = (args) => spawnSync('ffmpeg', ['-v', 'error', '-y', ...secureMediaArgs(args)], { encoding: 'utf8', maxBuffer: 64 << 20 });"
      ],
      [
        "  const r = spawnSync('ffmpeg', ['-nostats', '-hide_banner', '-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });",
        "  const r = spawnSync('ffmpeg', secureMediaArgs(['-nostats', '-hide_banner', '-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-']), { encoding: 'utf8', maxBuffer: 64 << 20 });"
      ],
      [
        "export const hasAudio = (file) => spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim() === 'audio';",
        "export const hasAudio = (file) => spawnSync('ffprobe', [...mediaReadOptions(file), '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim() === 'audio';"
      ],
      [
        "  const inputs = tracks.flatMap((t) => ['-i', t.file]);",
        "  const inputs = tracks.flatMap((t) => [...mediaReadOptions(t.file), '-i', t.file]);"
      ]
    ]
  }
];
const files = [];
for (const patch of patches) {
  const path = join(root, patch.path), bytes = readFileSync(path);
  const expected = lock.files.find(file => file.path === patch.path);
  const originalSha = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  if (originalSha !== expected?.sha) throw Error('NATIVE_PATCH_SOURCE_MISMATCH: ' + patch.path);
  let source = bytes.toString('utf8');
  for (const [from, to] of patch.edits) {
    if (source.split(from).length !== 2) throw Error('NATIVE_PATCH_ANCHOR_MISMATCH: ' + patch.path);
    source = source.replace(from, to);
  }
  writeFileSync(path, source);
  files.push({path: patch.path, sha256: createHash('sha256').update(source).digest('hex')});
}
const helper = 'cli/lib/promobento-policy.mjs';
copyFileSync(new URL('../src/policy.mjs', import.meta.url), join(root, helper));
files.push({path: helper, sha256: createHash('sha256').update(readFileSync(join(root, helper))).digest('hex')});
writeFileSync(join(root, '.promobento-source.json'), canonical({...provenance, cloudPatch: {version: CLOUD_PATCH_VERSION, files}}) + '\n');
console.log('Applied scoped native file/media/HTTP adaptation ' + CLOUD_PATCH_VERSION);
