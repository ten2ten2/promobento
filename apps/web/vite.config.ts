import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import theme from '../../config/theme-tokens.json' with { type: 'json' };
import ui from '../../config/ui-tokens.json' with { type: 'json' };

const cssVariables = (colors: Record<string, string>) => Object.entries(colors)
  .map(([key, value]) => `--ui-${key}:${value};`).join('');
const light = cssVariables(theme.themes.light.colors);
const dark = cssVariables(theme.themes.dark.colors);
const fontVariables = `--ui-font:${ui.typography.fontFamily};--ui-display-font:${ui.typography.displayFontFamily};--ui-mono-font:${ui.typography.monospaceFontFamily};`;

export default defineConfig({
  publicDir: '../../public',
  plugins: [
    {
      name: 'promobento-theme-tokens',
      resolveId(id) { if (id === 'virtual:promobento-theme.css') return '\0promobento-theme.css'; },
      load(id) {
        if (id !== '\0promobento-theme.css') return;
        return `:root{color-scheme:light;${fontVariables}${light}}@media(prefers-color-scheme:dark){:root{color-scheme:dark;${dark}}}`;
      },
    },
    tailwindcss(),
    reactRouter(),
  ],
});
