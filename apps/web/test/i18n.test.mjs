import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createWebsiteI18n, initialFormatting } from '../src/i18n.ts';
import messages from '../../../locales/en.json' with { type: 'json' };
import presets from '../../../config/platform-presets.json' with { type: 'json' };

test('concurrent SSR requests and hydration use independent English message stores and UTC', async () => {
  const [first, second, client] = await Promise.all([createWebsiteI18n(), createWebsiteI18n(), createWebsiteI18n()]);
  assert.notEqual(first, second);
  assert.equal(first.resolvedLanguage, 'en');
  assert.equal(second.dir(), 'ltr');
  for (const instance of [first, second, client]) {
    assert.equal(instance.t('marketing.headline'), messages.marketing.headline);
    assert.equal(instance.t('webShell.navigation.homeLabel', { brand: 'PromoBento' }), 'PromoBento home');
    assert.equal(instance.t('webShell.home.duration', { short: 15, long: 30 }), '15 / 30 seconds');
    assert.equal(instance.t('webShell.doesNotExist'), messages.webShell.errors.missingMessage);
  }
  first.addResource('en', 'translation', 'marketing.headline', 'request-local change');
  assert.equal(second.t('marketing.headline'), messages.marketing.headline);
  assert.equal(client.t('marketing.headline'), messages.marketing.headline);
  assert.deepEqual(initialFormatting, { locale: 'en-US', timeZone: 'UTC' });
  assert.equal(new Intl.NumberFormat(initialFormatting.locale, { style: 'currency', currency: 'USD' }).format(29), '$29.00');
  assert.equal(new Intl.DateTimeFormat(initialFormatting.locale, { timeZone: initialFormatting.timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date('2026-11-03T00:00:00Z')), '00');
});

test('public UI literal and dynamic translation keys resolve and interpolation parameters match', async () => {
  const i18n = await createWebsiteI18n();
  const app = new URL('../app/', import.meta.url);
  const files = ['root.tsx', ...(await readdir(new URL('routes/', app))).filter((file) => file.endsWith('.tsx')).map((file) => `routes/${file}`)];
  for (const file of files) {
    const source = await readFile(new URL(file, app), 'utf8');
    for (const match of source.matchAll(/\bt\('([^']+)'/g)) assert.ok(i18n.exists(match[1]), `${file}: ${match[1]}`);
  }
  for (const id of Object.keys(presets.aspectLayouts)) assert.ok(i18n.exists(`webShell.formats.${id}`));
  for (const preset of presets.presets) assert.ok(i18n.exists(preset.labelKey));
  for (const [key, params] of [
    ['webShell.navigation.homeLabel', { brand: 'PromoBento' }],
    ['webShell.home.duration', { short: 15, long: 30 }],
    ['webShell.formats.intro', { short: 15, long: 30 }],
  ]) {
    const source = i18n.getResource('en', 'translation', key);
    assert.deepEqual([...source.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort(), Object.keys(params).sort());
    assert.equal(i18n.t(key, params).includes('{{'), false);
  }
});
