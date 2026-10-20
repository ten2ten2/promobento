#!/usr/bin/env node
// Repository/seed consistency only. This is not the application's runtime schema.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const counts = { prdDocuments: 0, localFileLinks: 0, seedJson: 0, messages: 0, routes: 0, apiContracts: 0, contrastPairs: 0, uiTokenMappings: 0 };
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
    '10-i18n-and-themes.md', '11-ui-design-spec.md', '12-routing-and-auth.md', '13-agent-native-production.md',
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

  const seedFiles = ['config/brand.json', 'config/localization.json', 'config/theme-tokens.json', 'config/ui-tokens.json',
    'config/platform-presets.json', 'config/routes.json', 'config/auth.json', 'locales/en.json', 'contracts/scene.example.json',
    'contracts/export-manifest.example.json', 'contracts/composition.example.json', 'contracts/edit-request.example.json'];
  const seeds = Object.fromEntries(seedFiles.map((file) => [file, json(file)]));
  counts.seedJson = seedFiles.length;
  const brand = seeds['config/brand.json'];
  const locale = seeds['config/localization.json'];
  const themes = seeds['config/theme-tokens.json'];
  const ui = seeds['config/ui-tokens.json'];
  const platforms = seeds['config/platform-presets.json'];
  const routeSeed = seeds['config/routes.json'];
  const auth = seeds['config/auth.json'];
  const messages = seeds['locales/en.json'];
  const scene = seeds['contracts/scene.example.json'];
  const manifest = seeds['contracts/export-manifest.example.json'];
  const composition = seeds['contracts/composition.example.json'];
  const editRequest = seeds['contracts/edit-request.example.json'];
  const pkg = json('package.json');

  expect(brand.brandName === 'PromoBento' && brand.appUrl === 'https://promobento.com', 'Brand seed mismatch');
  expect(locale.scope === 'website_ui' && same(locale.supportedUiLocales, ['en']), 'Localization seed must describe the English-first website UI');
  expect(!Object.hasOwn(locale, 'supportedVideoLanguages') && !Object.hasOwn(locale, 'defaultVideoLanguage'), 'Website localization must not impose a video language allowlist or default');
  expect(locale.uiLanguages?.en?.resourceFile === 'locales/en.json', 'English resource path must be relative to repository root');
  expect(locale.selection?.showUiLanguageSwitcher === false, 'Unpublished website language controls must remain hidden');
  expect(same(themes.preferences, ['system', 'light', 'dark']) && themes.defaultPreference === 'system', 'Theme preference mismatch');
  expect(themes.cssVariablePrefix !== themes.videoCssVariablePrefix, 'UI and video tokens must be separate');

  expect(ui.scope === 'website_ui' && ui.reference?.productionFeature === false, 'UI reference must remain separate from the production application and video content');
  for (const path of [ui.sourceDocument, ui.library?.dependencyPolicy, ui.reference?.template, ui.reference?.output, ui.reference?.generator]) {
    expect(typeof path === 'string' && existsSync(join(root, path)), 'UI design source or reference is missing: ' + path);
  }
  for (const [themeName, theme] of Object.entries(themes.themes)) {
    for (const [alias, token] of Object.entries(ui.themeTokenMap ?? {})) {
      expect(typeof theme.colors[token] === 'string', themeName + ': unresolved UI alias ' + alias + ' -> ' + token);
      counts.uiTokenMappings += 1;
    }
  }
  expect(ui.controls?.height >= ui.controls?.touchTargetMin && ui.controls?.iconButtonSize >= ui.controls?.touchTargetMin,
    'Default UI controls must provide the declared touch target');

  const flatMessages = flattenMessages(messages);
  counts.messages = Object.keys(flatMessages).length;
  for (const key of Object.keys(flatMessages)) {
    if (key.endsWith('_one')) expect(typeof flatMessages[key.slice(0, -4) + '_other'] === 'string', 'Missing plural counterpart: ' + key);
  }

  // Keep documented entry points, provider callbacks and authentication seeds in sync.
  // These checks do not execute a router, validate a user, or send an email.
  expect(routeSeed.status === 'prd_seed' && auth.status === 'prd_seed', 'Route/auth seeds must not claim a deployed application');
  const routes = routeSeed.routes;
  const byId = new Map(routes.map((route) => [route.id, route]));
  const signatures = new Set();
  counts.routes = routes.length;
  expect(byId.size === routes.length, 'Duplicate route ID');
  const patternSignature = (route) => route.method + ' ' + route.path.replace(/:[A-Za-z][A-Za-z0-9]*/g, ':param');
  for (const route of routes) {
    expect(/^[a-z][a-z0-9_.]*$/.test(route.id), 'Invalid route ID: ' + route.id);
    expect(route.path === '/' || /^\/(?:[a-z0-9.-]+|:[A-Za-z][A-Za-z0-9]*)(?:\/(?:[a-z0-9.-]+|:[A-Za-z][A-Za-z0-9]*))*$/.test(route.path),
      'Invalid canonical path: ' + route.path);
    expect(!route.path.split('/').some((segment) => segment === '.' || segment === '..'), 'Dot segment in route: ' + route.path);
    expect(['page', 'redirect', 'resource', 'api'].includes(route.kind), 'Unknown route kind: ' + route.id);
    expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(route.method), 'Unknown route method: ' + route.id);
    expect(typeof routeSeed.authPolicies[route.auth] === 'string', 'Unknown route auth policy: ' + route.id);
    expect(['index', 'noindex', 'not_applicable'].includes(route.indexing), 'Unknown indexing policy: ' + route.id);
    expect(route.kind === 'api' ? route.path.startsWith('/api/') : route.method === 'GET' && !route.path.startsWith('/api/'),
      'Route kind/method namespace mismatch: ' + route.id);
    expect(route.indexing !== 'index' || route.kind === 'page' && route.auth === 'public', 'Only public content pages may be indexed: ' + route.id);
    expect(route.auth === 'public' || route.indexing === 'noindex', 'Protected route cannot be indexed: ' + route.id);
    expect(route.kind !== 'api' || route.indexing === 'noindex', 'API route must not be indexed: ' + route.id);
    const signature = patternSignature(route);
    expect(!signatures.has(signature), 'Duplicate method/path shape: ' + signature);
    signatures.add(signature);
  }
  for (const redirect of routeSeed.redirects) {
    const source = byId.get(redirect.fromRouteId);
    const target = byId.get(redirect.toRouteId);
    expect(source?.kind === 'redirect' && target?.kind === 'page', 'Unresolved redirect endpoint: ' + redirect.fromRouteId);
    expect(redirect.status === 302 && redirect.cacheControl === 'private, no-store', 'Authenticated default redirects must be temporary and private');
    expect(Array.isArray(redirect.preserveQuery) && redirect.preserveQuery.every((key) => key === 'workspaceId'), 'Unexpected redirect query passthrough');
  }
  expect(routes.filter((route) => route.kind === 'redirect').every((route) =>
    routeSeed.redirects.filter((redirect) => redirect.fromRouteId === route.id).length === 1), 'Each redirect must have exactly one rule');

  const apiRows = [...text('docs/prd/04-architecture-and-data.md').matchAll(/^\| `(GET|POST|PUT|PATCH|DELETE|HEAD) (\/api\/[^`]+)` \|/gm)]
    .map((match) => match[1] + ' ' + match[2]);
  const declaredApis = routes.filter((route) => route.kind === 'api').map((route) => route.method + ' ' + route.path);
  expect(same(apiRows.sort(), declaredApis.sort()), 'API documentation differs from route seed');
  counts.apiContracts = apiRows.length;
  const pageSection = text('docs/prd/02-ux-and-flows.md').split('## 2 首页与首次进入')[0];
  const pagePaths = new Set(pageSection.split('\n').filter((line) => line.startsWith('| '))
    .flatMap((line) => [...(line.split('|')[1] ?? '').matchAll(/`(\/[^`]*)`/g)].map((match) => match[1])));
  const declaredPages = new Set(routes.filter((route) => route.kind !== 'api').map((route) => route.path));
  expect(same([...pagePaths].sort(), [...declaredPages].sort()), 'Page information architecture differs from route seed');

  expect(brand.routeSource === 'config/routes.json' && auth.routeSource === brand.routeSource, 'Route source must be shared by brand and auth');
  for (const [key, id] of Object.entries(brand.routeIds)) {
    const route = byId.get(id);
    const path = key === 'waffoSuccessPathTemplate' ? route?.path.replace(':orderId', '{localOrderId}') : route?.path;
    expect(typeof path === 'string' && brand.paths[key] === path, 'Brand callback/path differs from route: ' + key);
  }
  expect(same(Object.keys(brand.paths).sort(), Object.keys(brand.routeIds).sort()), 'Every brand path must resolve a route ID');
  const authMethods = {
    login: 'GET', verify: 'GET', link: 'GET', googleStart: 'POST', googleCallback: 'GET',
    emailRequest: 'POST', emailVerify: 'POST', emailResend: 'POST', session: 'GET', logout: 'POST',
    linkConfirm: 'POST', registrationConfirm: 'POST', cancelFlow: 'DELETE',
  };
  expect(same(Object.keys(auth.routes).sort(), Object.keys(authMethods).sort()), 'Authentication route references are incomplete');
  for (const [key, method] of Object.entries(authMethods)) {
    expect(byId.get(auth.routes[key])?.method === method, 'Unresolved authentication method/route: ' + key);
  }
  expect(byId.get(auth.routes.googleCallback)?.auth === 'oauth_state' && byId.get(brand.routeIds.waffoWebhook)?.auth === 'waffo_signature', 'Provider callbacks must retain protocol authentication');
  expect(existsSync(join(root, auth.sourceDocument)), 'Authentication source document missing');
  expect(routes.some((route) => route.kind === 'page' && route.path === auth.flow.returnTo.defaultPath && route.id.startsWith('app.')), 'Default sign-in return path must resolve to an application page');
  expect(same(auth.methods, ['google', 'email_otp']) && !auth.passwordAuthentication && !auth.magicLinkAuthentication, 'Launch authentication methods differ from PRD');
  expect(auth.email.transport === 'cloudflare_email_service' && auth.email.requiresWorkersPaid && auth.email.requiresVerifiedSendingDomain, 'Cloudflare email prerequisites are missing');
  expect(auth.email.production.fromAddress !== auth.email.staging.fromAddress && auth.email.staging.controlledRecipientsOnly && auth.email.localAndCiTransport === 'mock', 'Mail environments must be isolated');
  expect(auth.email.defaultMessageLocale === brand.defaultUiLocale && auth.email.messageLocaleSource === 'website_ui_locale', 'Authentication mail locale must follow website locale');
  expect(auth.email.otp.digest === 'HMAC-SHA-256' && auth.email.otp.storePlaintext === false &&
    auth.email.otp.resendResetsFailedAttempts === false && auth.email.otp.resendInvalidationScope === 'current_flow', 'Unsafe OTP storage or resend seed');
  expect(auth.email.otp.resendAfterSeconds > 0 && auth.email.otp.expiresAfterSeconds > auth.email.otp.resendAfterSeconds &&
    auth.flow.expiresAfterSeconds >= auth.email.otp.expiresAfterSeconds && auth.flow.proofExpiresAfterSeconds <= auth.flow.expiresAfterSeconds,
    'Inconsistent OTP/flow/proof lifetimes');
  for (const key of ['maxFailedAttemptsPerFlow', 'maxSendsPerFlow']) expect(Number.isInteger(auth.email.otp[key]) && auth.email.otp[key] > 0, 'Missing bounded OTP budget: ' + key);
  for (const part of [auth.flow, auth.session]) {
    const cookie = part.cookie;
    expect(part.randomBytes >= 32 && cookie.name.startsWith('__Host-') && cookie.path === '/' && cookie.httpOnly && cookie.secure && cookie.hostOnly && cookie.sameSite === 'Lax' && !Object.hasOwn(cookie, 'domain'), 'Invalid authentication cookie boundary');
  }
  expect(auth.flow.cookie.name !== auth.session.cookie.name && auth.session.storage === 'token_hash_only' &&
    auth.session.clearThemeCookieOnLogout === false, 'Session/flow/theme responsibilities must remain separate');
  expect(auth.accountLinking.existingMethodProofRequired && auth.accountLinking.newMethodProofRequired &&
    auth.accountLinking.explicitConfirmationRequired && !auth.accountLinking.automaticAccountMerge && !auth.accountLinking.allowIdentityTransfer,
    'Identity linking must preserve proof and ownership boundaries');
  for (const key of [...Object.values(auth.email.messageKeys), ...Object.values(auth.errorMessageKeys)]) {
    expect(typeof flatMessages[key] === 'string', 'Unresolved auth/email message key: ' + key);
  }
  for (const key of ['subject', 'preheader', 'linkSubject', 'linkPreheader']) {
    const message = flatMessages[auth.email.messageKeys[key]];
    expect(typeof message === 'string' && !/\{\{\s*code\s*\}\}/.test(message), 'Code must not appear in email subject or preheader: ' + key);
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
  // Content language is optional descriptive metadata; it never gates creating a video.
  expect(scene.language === manifest.language, 'Scene and manifest language metadata mismatch');
  expect(['ltr', 'rtl'].includes(scene.direction), 'Frozen text direction must be ltr or rtl');
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

  // v2.2 Composition is the source model. Keep the v1.x scene fixture as a migration test only.
  expect(composition.schemaVersion === '2.2.0' && composition.exampleOnly && composition.compositionKind === 'agent_authored_source', 'v2.2 composition seed mismatch');
  expect(same(platforms.productLimits.durationSeconds, [15, 30]) && platforms.productLimits.defaultDurationSeconds === 30, 'v2.2 duration must remain 15/30 seconds');
  expect([15, 30].includes(composition.durationSeconds) && composition.fps === 30 && composition.totalFrames === composition.durationSeconds * 30, 'v2.2 frame count invalid');
  expect(composition.source?.deterministicSeekRequired && typeof composition.source.entrypoint === 'string', 'v2.2 composition runtime metadata missing');
  expect(composition.textMetadata?.allowsMixedLanguages === true && !Object.hasOwn(composition, 'language') && !Object.hasOwn(composition, 'uiLocale') && !Object.hasOwn(composition, 'themePreference'), 'v2.2 video text must be independent from website UI locale/theme');
  expect(composition.selectedPlatformPresetIds.every((id) => expectedPlatforms.includes(id)) && composition.variants.every((v) => expectedPlatforms.includes(v.platformPresetId) && Object.hasOwn(platforms.aspectLayouts, v.layoutId)), 'v2.2 variant not in existing platform presets');
  expect(editRequest.exampleOnly && editRequest.revisionId === composition.revisionId && expectedPlatforms.includes(editRequest.targetPresetId), 'v2.2 edit request identity/preset mismatch');
  expect(Number.isInteger(editRequest.frameIndex) && editRequest.frameIndex >= 0 && editRequest.frameIndex < composition.totalFrames, 'v2.2 edit frame out of range');
  expect([editRequest.normalizedPoint?.x, editRequest.normalizedPoint?.y].every((n) => typeof n === 'number' && n >= 0 && n <= 1), 'v2.2 edit coordinates must be normalized');
  expect(['selected', 'shot', 'variant', 'all-variants'].includes(editRequest.editScope), 'v2.2 unknown edit scope');
  expect(composition.proof?.renderStatus === 'NOT_TESTED' && editRequest.proof?.patchStatus === 'NOT_TESTED', 'v2.2 seeds must not claim test completion');

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
  expect(pkg.scripts?.['build:ui-reference'] === 'node scripts/build-ui-reference.mjs' &&
    pkg.scripts?.['check:ui-reference'] === 'node scripts/build-ui-reference.mjs --check', 'UI reference command mismatch');
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
  console.log('Scope: PRD files and seed consistency only; no application, authentication, email delivery, payment, rendering, or deployment tests.');
}
