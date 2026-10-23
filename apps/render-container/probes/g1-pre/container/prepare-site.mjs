// Builds container/site from a huashu-motion checkout at 4236053 and the repo's vendored fonts.
// Usage: node prepare-site.mjs <huashu-motion checkout> <fonts dir>
// Nothing produced here is committed: site/ is gitignored and rebuilt in CI.
import {cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const [upstream, fontsDir] = process.argv.slice(2);
if (!upstream || !fontsDir) throw Error('usage: node prepare-site.mjs <huashu-motion checkout> <fonts dir>');
const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, 'site');
rmSync(site, {recursive: true, force: true});
mkdirSync(site, {recursive: true});

// GSAP 3.14.2 bytes as shipped by upstream; the digest is pinned in apps/render-container/environment.lock.json.
const GSAP_SHA256 = 'c174bfce53a729418d57a8ad8625e7247c793a22fef8e2851e3cfa3de9cd8280';
const gsap = readFileSync(join(upstream, 'templates/blank/vendor/gsap.min.js'));
const digest = createHash('sha256').update(gsap).digest('hex');
if (digest !== GSAP_SHA256) throw Error('GSAP digest mismatch: ' + digest);

function vendor(target) {
  mkdirSync(join(target, 'vendor'), {recursive: true});
  writeFileSync(join(target, 'vendor/gsap.min.js'), gsap);
  cpSync(join(upstream, 'runtime/om.js'), join(target, 'vendor/om.js'));
  cpSync(join(upstream, 'runtime/clip'), join(target, 'vendor/clip'), {recursive: true});
  cpSync(join(upstream, 'runtime/three/three.min.js'), join(target, 'vendor/three.min.js'));
  cpSync(join(upstream, 'runtime/three/om-three.js'), join(target, 'vendor/om-three.js'));
}

// Fonts: every registry face under its own family, plus upstream's PuHui-* aliases for Noto Sans SC.
mkdirSync(join(site, 'fonts'), {recursive: true});
const registry = JSON.parse(readFileSync(join(fontsDir, 'registry.json'), 'utf8'));
const faces = [];
const families = new Set();
for (const font of registry.fonts) {
  const file = font.sourcePath.split('/').at(-1);
  cpSync(join(fontsDir, file), join(site, 'fonts', file));
  faces.push(`@font-face{font-family:"${font.family}";font-style:${font.style};font-weight:${font.weight};src:url(${file}) format("woff");}`);
  families.add(`${font.weight} ${font.family}`);
}
for (const [alias, weight] of [['PuHui-Medium', 500], ['PuHui-Bold', 700], ['PuHui-Heavy', 800], ['PuHui-Black', 900]]) {
  faces.push(`@font-face{font-family:"${alias}";src:url(NotoSansSC-${weight}.woff) format("woff");}`);
  families.add(`400 ${alias}`);
}
writeFileSync(join(site, 'fonts/fonts.css'), faces.join('\n') + '\n');
// Canvas text does not trigger font loads, so a hidden element touches every face before document.fonts.ready.
const preload = `<div aria-hidden="true" style="position:absolute;left:-9999px;top:0;opacity:0">${[...families].map(spec => {
  const [weight, ...name] = spec.split(' ');
  return `<span style="font-family:'${name.join(' ')}';font-weight:${weight}">Aa中</span>`;
}).join('')}</div>`;

for (const template of ['kinetic-type', 'object-3d']) {
  const target = join(site, template);
  cpSync(join(upstream, 'templates', template), target, {recursive: true});
  vendor(target);
  // `om new` copies fonts into <project>/assets/fonts; templates reference them there.
  cpSync(join(site, 'fonts'), join(target, 'assets/fonts'), {recursive: true});
  const html = readFileSync(join(target, 'index.html'), 'utf8')
    .replace(/<head>/i, '<head><link rel="stylesheet" href="../fonts/fonts.css">')
    .replace(/<\/body>/i, preload + '</body>');
  writeFileSync(join(target, 'index.html'), html);
}

// Upstream's engine, with the hard-coded 5 s paint wait raised: object-3d's first WebGL frame takes ~31 s.
const engine = readFileSync(join(upstream, 'runtime/om-engine.js'), 'utf8');
if (!engine.includes('const raf2 = (ms = 5000)')) throw Error('om-engine.js changed: paint wait patch point missing');
writeFileSync(join(site, 'engine.js'), engine.replace('const raf2 = (ms = 5000)', 'const raf2 = (ms = 120000)'));

console.log('site ready:', readdirSync(site).join(', '));
