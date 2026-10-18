#!/usr/bin/env node
// Repository/seed consistency only. This is not the application's runtime schema.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const counts = { prdDocuments: 0, localFileLinks: 0, seedJson: 0, messages: 0, contrastPairs: 0 };
const expect = (condition, message) => { if (!condition) failures.push(message); };
const text = (path) => readFileSync(join(root, path), 'utf8');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const get = (object, key) => key?.split('.').reduce((value, part) => value?.[part], object);

function json(path) {
  try { return JSON.parse(text(path)); }
  catch (error) { throw new Error(path + ': ' + error.message); }
}

function walk(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((item) => {
    const child = join(path, item.name);
    if (item.isSymbolicLink()) return [];
    return item.isDirectory() ? walk(child) : [child];
  });
}

function withoutCode(markdown) {
  const lines = [];
  let fence = null;
  for (const line of markdown.split('\n')) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (!fence) lines.push(line.replace(/`[^`]*`/g, ''));
  }
  return lines.join('\n');
}

function checkLinks(path) {
  const markdown = withoutCode(readFileSync(path, 'utf8'));
  for (const match of markdown.matchAll(/!?\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (target.startsWith('sandbox:') || target.startsWith('file:')) {
      failures.push(relative(root, path) + ': non-portable link ' + target);
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) continue;
    const filePart = target.split(/[?#]/)[0];
    if (!filePart) continue;
    const destination = resolve(dirname(path), decodeURIComponent(filePart));
    const repoPath = relative(root, destination);
    expect(!isAbsolute(repoPath) && repoPath !== '..' && !repoPath.startsWith('..' + sep),
      relative(root, path) + ': link escapes repository: ' + target);
    expect(existsSync(destination), relative(root, path) + ': missing link target: ' + target);
    counts.localFileLinks += 1;
  }
}

function flattenMessages(value, prefix = '', output = {}) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? prefix + '.' + key : key;
    if (typeof child === 'string') output[path] = child;
    else if (child && typeof child === 'object' && !Array.isArray(child)) flattenMessages(child, path, output);
    else failures.push('English resource must contain strings or nested objects: ' + path);
  }
  return output;
}

function luminance(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex ?? '')) throw new Error('Invalid color token: ' + hex);
  const rgb = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function main() {
  const chapters = [
    'README.md', '01-product-prd.md', '02-ux-and-flows.md', '03-platform-presets.md',
    '04-architecture-and-data.md', '05-waffo-billing.md', '06-testing-and-release.md',
    '07-growth-and-experiments.md', '08-codex-execution.md', '09-sources-and-decisions.md',
    '10-i18n-and-themes.md',
  ];
  for (const chapter of chapters) {
    expect(existsSync(join(root, 'docs/prd', chapter)), 'Missing PRD document: ' + chapter);
  }
  counts.prdDocuments = chapters.length;
  for (const file of ['README.md', 'AGENTS.md', '.mise.toml', '.gitignore', '.gitattributes',
    '.editorconfig', 'package.json', 'pnpm-lock.yaml', 'docs/implementation-status.md',
    'docs/implementation-decisions.md', 'docs/getting-started.md']) {
    expect(existsSync(join(root, file)), 'Missing repository file: ' + file);
  }

  const markdownFiles = [
    ...readdirSync(root).map((name) => join(root, name)).filter((path) => statSync(path).isFile()),
    ...walk(join(root, 'docs')), ...walk(join(root, '.github')),
  ].filter((path) => extname(path) === '.md');
  for (const file of markdownFiles) checkLinks(file);

  const seedFiles = ['config/brand.json', 'config/localization.json', 'config/theme-tokens.json',
    'config/platform-presets.json', 'locales/en.json', 'contracts/scene.example.json',
    'contracts/export-manifest.example.json'];
  const seeds = Object.fromEntries(seedFiles.map((file) => [file, json(file)]));
  counts.seedJson = seedFiles.length;
  const brand = seeds['config/brand.json'];
  const locale = seeds['config/localization.json'];
  const themes = seeds['config/theme-tokens.json'];
  const platforms = seeds['config/platform-presets.json'];
  const messages = seeds['locales/en.json'];
  const scene = seeds['contracts/scene.example.json'];
  const manifest = seeds['contracts/export-manifest.example.json'];
  const pkg = json('package.json');

  expect(brand.brandName === 'PromoBento' && brand.appUrl === 'https://promobento.com', 'Brand seed mismatch');
  expect(same(locale.supportedUiLocales, ['en']) && same(locale.supportedVideoLanguages, ['en']), 'Launch allowlists must contain only en');
  expect(locale.videoLanguageField === 'language', 'Video language field must remain language');
  expect(locale.uiLanguages?.en?.resourceFile === 'locales/en.json', 'English resource path must be relative to repository root');
  expect(locale.selection?.showUiLanguageSwitcher === false && locale.selection?.showVideoLanguageSelector === false, 'Unsupported language controls must remain hidden');
  expect(same(themes.preferences, ['system', 'light', 'dark']) && themes.defaultPreference === 'system', 'Theme preference mismatch');
  expect(themes.cssVariablePrefix !== themes.videoCssVariablePrefix, 'UI and video tokens must be separate');

  const flatMessages = flattenMessages(messages);
  counts.messages = Object.keys(flatMessages).length;
  for (const key of Object.keys(flatMessages)) {
    if (key.endsWith('_one')) expect(typeof flatMessages[key.slice(0, -4) + '_other'] === 'string', 'Missing plural counterpart: ' + key);
  }
  const expectedPlatforms = ['tiktok', 'instagram_feed', 'instagram_reels', 'x', 'youtube', 'youtube_shorts'];
  const layouts = ['landscape', 'portrait', 'feed', 'square'];
  expect(same(platforms.presets.map((preset) => preset.id).sort(), [...expectedPlatforms].sort()), 'Six launch platform presets are required');
  expect(same(Object.keys(platforms.aspectLayouts).sort(), [...layouts].sort()), 'Four composition layouts are required');
  for (const preset of platforms.presets) {
    for (const key of [preset.labelKey, preset.userNoteKey]) expect(typeof get(messages, key) === 'string', preset.id + ': unresolved English resource key ' + key);
    expect(platforms.encodingProfiles[preset.encodingProfile], preset.id + ': unknown encoding profile');
    for (const aspect of [preset.defaultAspect, ...preset.optionalAspects]) expect(platforms.aspectLayouts[aspect], preset.id + ': unknown aspect ' + aspect);
  }

  expect(scene.exampleOnly === true && manifest.exampleOnly === true, 'Contract examples must remain marked exampleOnly');
  expect(scene.language === 'en' && manifest.language === 'en', 'Contract example language must be en');
  expect(scene.brand.name === 'Sample Product', 'Customer fixture brand must not be replaced by the platform brand');
  expect(scene.projectId === manifest.projectId && scene.revisionId === manifest.revisionId, 'Scene and manifest identity mismatch');
  expect(scene.direction === manifest.direction && scene.videoStyle === manifest.videoStyle, 'Frozen video properties differ between examples');
  expect(scene.totalFrames === manifest.durationFrames && scene.fps === manifest.fps, 'Scene and manifest timing mismatch');
  expect(scene.platformPresetVersion === platforms.rulesVersion && manifest.presetRulesVersion === platforms.rulesVersion, 'Preset rule version mismatch');
  expect(scene.totalFrames === scene.fps * scene.durationSeconds, 'Scene duration and frame count mismatch');
  const facts = new Set(scene.facts.map((fact) => fact.id));
  const assets = new Set(scene.assets.map((asset) => asset.assetVersionId));
  let nextFrame = 0;
  for (const item of scene.scenes) {
    expect(item.startFrame === nextFrame && item.durationFrames > 0, item.id + ': non-contiguous scene frames');
    nextFrame += item.durationFrames;
    for (const aspect of layouts) expect(item.layoutByAspect[aspect], item.id + ': missing layout ' + aspect);
    for (const fact of item.factRefs) expect(facts.has(fact), item.id + ': unknown fact ' + fact);
    for (const asset of item.assetRefs) expect(assets.has(asset), item.id + ': unknown asset ' + asset);
  }
  expect(nextFrame === scene.totalFrames, 'Scene timeline must end at totalFrames');
  const artifactIds = new Set(manifest.artifacts.map((artifact) => artifact.id));
  expect(artifactIds.size === manifest.artifacts.length, 'Duplicate artifact IDs');
  for (const id of manifest.initialArtifactManifest) expect(artifactIds.has(id), 'Initial manifest refers to missing artifact ' + id);
  for (const mapping of manifest.platformMappings) {
    expect(expectedPlatforms.includes(mapping.platformId), 'Unknown platform in manifest ' + mapping.platformId);
    expect(artifactIds.has(mapping.videoArtifact) && artifactIds.has(mapping.coverArtifact), 'Unresolved artifacts for ' + mapping.platformId);
  }

  for (const [name, theme] of Object.entries(themes.themes)) {
    for (const rule of themes.contrastRules) {
      const foreground = luminance(theme.colors[rule.foreground]);
      for (const backgroundName of rule.backgrounds) {
        const background = luminance(theme.colors[backgroundName]);
        const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        expect(ratio >= rule.minimum, name + ': contrast below declared threshold for ' + rule.foreground + '/' + backgroundName);
        counts.contrastPairs += 1;
      }
    }
  }

  const mise = text('.mise.toml');
  expect(pkg.private === true, 'Root tooling package must be private');
  expect(pkg.scripts?.['check:repo'] === 'node scripts/check-repo.mjs', 'Repository check command mismatch');
  expect(mise.match(/^node\s*=\s*"([^"]+)"/m)?.[1] === pkg.engines?.node, 'Node pin differs between mise and package.json');
  expect('pnpm@' + mise.match(/^pnpm\s*=\s*"([^"]+)"/m)?.[1] === pkg.packageManager, 'pnpm pin differs between mise and package.json');
}

try { main(); }
catch (error) { failures.push(error.message); }

if (failures.length) {
  console.error('Repository check failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exitCode = 1;
} else {
  console.log('Repository check passed.');
  console.log(JSON.stringify({ node: process.version, ...counts }, null, 2));
  console.log('Scope: PRD files and seed consistency only; no application, payment, rendering, or deployment tests.');
}
