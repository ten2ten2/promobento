import assert from 'node:assert/strict';
import test from 'node:test';
import {probeSaasStaging} from '../scripts/probe-saas-staging.mjs';

test('staging probes require separate HTTPS origins and complete Access credentials', async () => {
  const noop = async () => new Response(null);
  for (const [webUrl, previewUrl] of [
    ['http://web.test/', 'https://preview.test/'],
    ['https://web.test/admin', 'https://preview.test/'],
    ['https://web.test/', 'https://web.test/'],
  ]) await assert.rejects(probeSaasStaging({webUrl, previewUrl, fetcher: noop}));
  await assert.rejects(probeSaasStaging({webUrl: 'https://web.test/', previewUrl: 'https://preview.test/',
    accessClientId: 'id', fetcher: noop}), /Incomplete Access/u);
});

test('staging probes check only SSR and closed boundaries with read-only requests', async () => {
  const visited = [];
  await probeSaasStaging({webUrl: 'https://web.test/', previewUrl: 'https://preview.test/',
    accessClientId: 'id', accessClientSecret: 'secret',
    fetcher: async (url, init) => {
      visited.push([url, init]);
      if (url === 'https://web.test/') return new Response('<html>PromoBento</html>',
        {headers: {'content-type': 'text/html; charset=utf-8'}});
      return Response.json({code: 'NOT_FOUND'}, {status: 404});
    }});
  assert.deepEqual(visited.map(([url]) => url), ['https://web.test/',
    'https://web.test/api/__staging_probe_not_implemented__',
    'https://preview.test/__staging_probe_not_authorized__']);
  assert.ok(visited.every(([, init]) => init.redirect === 'manual'
    && init.headers.get('CF-Access-Client-Secret') === 'secret'));
});
