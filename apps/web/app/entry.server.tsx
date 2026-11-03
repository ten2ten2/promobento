import { renderToReadableStream } from 'react-dom/server.browser';
import { ServerRouter, type EntryContext } from 'react-router';
import { I18nextProvider } from 'react-i18next';
import { createWebsiteI18n } from '../src/i18n';
import { NonceContext } from './nonce';

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
): Promise<Response> {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const i18n = await createWebsiteI18n();
  let failed = false;
  const body = await renderToReadableStream(
    <I18nextProvider i18n={i18n}><NonceContext.Provider value={nonce}>
      <ServerRouter context={routerContext} url={request.url} nonce={nonce} />
    </NonceContext.Provider></I18nextProvider>,
    { signal: request.signal, nonce, onError() { failed = true; } },
  );
  await body.allReady;
  responseHeaders.set('content-type', 'text/html; charset=utf-8');
  responseHeaders.set('content-security-policy', [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'",
    "form-action 'self'", `script-src 'self' 'nonce-${nonce}'`, "style-src 'self'",
    "img-src 'self' data:", "font-src 'self'", "connect-src 'self'",
  ].join('; '));
  return new Response(body, { status: failed ? 500 : responseStatusCode, headers: responseHeaders });
}
