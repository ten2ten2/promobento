import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createMultiWorkerHarness } from '../../cloud/test/fixtures/multi-worker.mjs';
import { evaluationChromeExecutable } from '../../../research/evals/chrome.mjs';
import messages from '../../../locales/en.json' with { type: 'json' };
import theme from '../../../config/theme-tokens.json' with { type: 'json' };

// Run in the existing pinned browser-test image. Missing Chrome is a failure,
// never a skipped hydration gate or an implicit browser download.
test('SSR hydrates under CSP, navigates on the client and fits light/desktop and dark/mobile', { timeout: 90_000 }, async () => {
  const directory = new URL('../../../artifacts/web-browser/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const dockerfile = await readFile(new URL('../../render-container/Dockerfile', import.meta.url), 'utf8');
  const expectedVersion = dockerfile.match(/chrome-for-testing-public\/([^/]+)\/linux64\//)?.[1];
  assert.ok(expectedVersion, 'Chrome version must be pinned in the test image');
  const harness = await createMultiWorkerHarness();
  let browser;
  const report = [];
  try {
    browser = await chromium.launch({ executablePath: evaluationChromeExecutable, headless: true, chromiumSandbox: true });
    assert.equal(browser.version(), expectedVersion, 'Use the repository-pinned Chromium');
    const origin = (await harness.mf.ready).origin;
    for (const scenario of [
      { name: 'desktop-light', viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
      { name: 'mobile-dark', viewport: { width: 390, height: 844 }, colorScheme: 'dark' },
    ]) {
      const context = await browser.newContext({ viewport: scenario.viewport, colorScheme: scenario.colorScheme, locale: 'fr-FR', timezoneId: 'Asia/Tokyo' });
      try {
        const errors = [];
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => { if (message.type() === 'error' || /hydration|did not match/i.test(message.text())) errors.push(message.text()); });
        await context.route('**/*', (route) => {
          if (new URL(route.request().url()).origin === origin) return route.continue();
          errors.push(`Unexpected outbound browser request: ${route.request().url()}`);
          return route.abort();
        });
        await page.addInitScript(() => {
          globalThis.cspViolations = [];
          document.addEventListener('securitypolicyviolation', (event) => globalThis.cspViolations.push(event.violatedDirective));
        });
        const response = await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
        assert.equal(response.status(), 200);
        assert.match(response.headers()['content-security-policy'], /script-src 'self' 'nonce-[a-f0-9]+'/);
        assert.match(response.headers()['cache-control'], /no-store/);
        assert.equal(await page.locator('h1').textContent(), messages.marketing.headline);
        await page.evaluate(() => document.fonts.ready);
        const appearance = await page.evaluate(() => ({
          lang: document.documentElement.lang, direction: document.documentElement.dir,
          theme: document.documentElement.dataset.theme,
          background: getComputedStyle(document.documentElement).backgroundColor,
          width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          fonts: [...document.fonts].filter((font) => font.status === 'loaded').map((font) => font.family.replaceAll('"', '')),
          violations: globalThis.cspViolations,
        }));
        assert.equal(appearance.lang, 'en');
        assert.equal(appearance.direction, 'ltr');
        assert.equal(appearance.theme, 'system');
        assert.ok(appearance.scrollWidth <= appearance.width + 1, 'No horizontal overflow');
        assert.ok(appearance.fonts.includes('Schibsted Grotesk'), 'Display font is self-hosted and loaded');
        assert.ok(appearance.fonts.includes('Geist Sans'), 'Body font is self-hosted and loaded');
        const rgb = theme.themes[scenario.colorScheme].colors.bg.match(/[a-f0-9]{2}/gi).map((part) => Number.parseInt(part, 16));
        assert.equal(appearance.background, `rgb(${rgb.join(', ')})`);
        assert.deepEqual(appearance.violations, []);
        await page.screenshot({ path: fileURLToPath(new URL(`${scenario.name}.png`, directory)), fullPage: true });
        await page.evaluate(() => { globalThis.navigationSentinel = 'same-document'; });
        await page.getByRole('link', { name: new RegExp(messages.webShell.home.exploreFormats) }).click();
        await page.waitForURL(`${origin}/formats`, { timeout: 10_000 });
        // History and an already-idle network can precede React's route commit.
        // Wait for the destination document and its metadata, not only the URL.
        await page.waitForFunction(({ heading, canonical, title }) => {
          const element = document.querySelector('main h1');
          return element?.textContent === heading && element.getBoundingClientRect().height > 0
            && document.querySelector('link[rel="canonical"]')?.getAttribute('href') === canonical
            && document.title === title;
        }, {
          heading: messages.webShell.formats.title,
          canonical: 'https://promobento.com/formats',
          title: messages.webShell.formats.metaTitle,
        }, { timeout: 10_000 });
        await page.waitForLoadState('networkidle');
        assert.equal(await page.locator('h1').textContent(), messages.webShell.formats.title);
        assert.equal(await page.evaluate(() => globalThis.navigationSentinel), 'same-document', 'Navigation must use hydrated React Router');
        assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), 'https://promobento.com/formats');
        assert.equal(await page.title(), messages.webShell.formats.metaTitle);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        assert.deepEqual(await page.evaluate(() => globalThis.cspViolations), []);
        assert.deepEqual(errors, []);
        report.push({ name: scenario.name, appearance, clientNavigation: true, browserErrors: errors });
      } finally { await context.close(); }
    }
    const noScript = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark', viewport: { width: 390, height: 844 } });
    try {
      const page = await noScript.newPage();
      const response = await page.goto(`${origin}/help`);
      assert.equal(response.status(), 200);
      assert.equal(await page.locator('h1').textContent(), messages.webShell.help.title);
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'system');
    } finally { await noScript.close(); }
    await writeFile(new URL('ssr-report.json', directory), JSON.stringify({ chromiumVersion: browser.version(), scenarios: report, noScriptSsr: true }, null, 2));
  } finally {
    await browser?.close();
    await harness.dispose();
  }
});
