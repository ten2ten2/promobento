import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const templatePath = path.join(root, 'docs/design/ui-reference.template.html');
const outputPath = path.join(root, 'docs/design/ui-reference.html');
const check = process.argv.includes('--check');
const unsupported = process.argv.slice(2).filter((value) => value !== '--check');
if (unsupported.length) throw new Error(`Unknown arguments: ${unsupported.join(', ')}`);

const [template, theme, ui] = await Promise.all([
  readFile(templatePath, 'utf8'),
  readFile(path.join(root, 'config/theme-tokens.json'), 'utf8').then(JSON.parse),
  readFile(path.join(root, 'config/ui-tokens.json'), 'utf8').then(JSON.parse),
]);
const kebab = (value) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const themeBlock = (name) => {
  const source = theme.themes[name];
  if (!source?.colors) throw new Error(`Missing ${name} theme colors`);
  return [`color-scheme: ${source.colorScheme};`, ...Object.entries(source.colors).map(([key, value]) => {
    if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Invalid theme color: ${name}.${key}`);
    return `--ui-${kebab(key)}: ${value};`;
  }), ...Object.entries(ui.shadow[name]).map(([key, value]) => `--ui-shadow-${kebab(key)}: ${value};`), `--ui-overlay: ${ui.overlay[name]};`].join('\n  ');
};
const withUnit = (value, keys) => {
  if (typeof value !== 'number') return value;
  const top = keys[0];
  const last = keys.at(-1);
  if (top === 'motion') return `${value}ms`;
  if (last === 'mobilePanelMaxVh') return `${value}dvh`;
  if (last === 'fontWeight' || top === 'zIndex' || keys.includes('weights') || last === 'strokeWidth') return value;
  if (['spacing', 'radius', 'layout', 'breakpoints', 'controls', 'focus', 'icons'].includes(top) || (top === 'typography' && keys.includes('styles'))) return `${value}px`;
  return value;
};
const flatten = (value, keys = []) => Object.entries(value).flatMap(([key, child]) => {
  if (child && typeof child === 'object' && !Array.isArray(child)) return flatten(child, [...keys, key]);
  if (!['string', 'number'].includes(typeof child)) return [];
  if (/[{};<>]/.test(String(child))) return [];
  return [`--design-${[...keys, key].map(kebab).join('-')}: ${withUnit(child, [...keys, key])};`];
});
const css = [
  ':root {', `  ${flatten(ui).join('\n  ')}`, '  --ui-font-display: var(--design-typography-display-font-family);', '}',
  `:root, :root[data-theme="light"], :root[data-theme="system"] {\n  ${themeBlock('light')}\n}`,
  `:root[data-theme="dark"] {\n  ${themeBlock('dark')}\n}`,
  `@media (prefers-color-scheme: dark) {\n  :root[data-theme="system"] {\n    ${themeBlock('dark')}\n  }\n}`,
].join('\n');
const marker = '/* GENERATED_TOKEN_CSS */';
if (template.split(marker).length !== 2) throw new Error('Expected exactly one token marker');
const html = template.replace(marker, css);
if (check) {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  if (current !== html) throw new Error('UI reference is stale. Run mise run build:ui-reference.');
  process.stdout.write('UI reference is current. Scope: generated offline design reference only.\n');
} else {
  await writeFile(outputPath, html);
  process.stdout.write('Built docs/design/ui-reference.html from the template and shared tokens.\n');
}
