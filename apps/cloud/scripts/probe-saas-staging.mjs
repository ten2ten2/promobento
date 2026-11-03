import {fileURLToPath} from 'node:url';

function origin(value, label) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(label + ' must be a bare HTTPS origin');
  }
  return url.origin;
}

/** Read-only checks only; do not claim they prove Core bindings or D1 behavior. */
export async function probeSaasStaging({webUrl, previewUrl, accessClientId, accessClientSecret,
  fetcher = fetch}) {
  if (!webUrl || !previewUrl) throw new Error('Both staging Web and Preview URLs are required');
  if (Boolean(accessClientId) !== Boolean(accessClientSecret)) throw new Error('Incomplete Access service token');
  const web = origin(webUrl, 'STAGING_WEB_URL');
  const preview = origin(previewUrl, 'STAGING_PREVIEW_URL');
  if (new URL(web).hostname === new URL(preview).hostname) throw new Error('Preview needs a separate hostname');
  const headers = new Headers();
  if (accessClientId) {
    headers.set('CF-Access-Client-Id', accessClientId);
    headers.set('CF-Access-Client-Secret', accessClientSecret);
  }
  const get = async (base, path, status) => {
    const response = await fetcher(base + path, {headers, redirect: 'manual', signal: AbortSignal.timeout(15000)});
    if (response.status !== status) throw new Error(`${path} returned ${response.status} instead of ${status}`);
    return response;
  };
  const page = await get(web, '/', 200);
  if (!page.headers.get('content-type')?.includes('text/html')
    || !(await page.text()).includes('PromoBento')) throw new Error('Web root is not PromoBento SSR');
  const api = await get(web, '/api/__staging_probe_not_implemented__', 404);
  if ((await api.json()).code !== 'NOT_FOUND') throw new Error('Unknown API did not return the public error envelope');
  const forbidden = await get(preview, '/__staging_probe_not_authorized__', 404);
  if ((await forbidden.json()).code !== 'NOT_FOUND') throw new Error('Preview boundary did not reject an unknown resource');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.STAGING_WEB_URL && !process.env.STAGING_PREVIEW_URL) {
    console.log('SaaS staging HTTP probes not run: Access-protected Web/Preview routes are not configured. G1a remains pending.');
  } else {
    await probeSaasStaging({webUrl: process.env.STAGING_WEB_URL,
      previewUrl: process.env.STAGING_PREVIEW_URL,
      accessClientId: process.env.CF_ACCESS_CLIENT_ID,
      accessClientSecret: process.env.CF_ACCESS_CLIENT_SECRET});
    console.log('Staging Web SSR, closed API and Preview 404 probes passed. Core binding and D1 still need separate G1a checks.');
  }
}
