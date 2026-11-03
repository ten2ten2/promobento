import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';
import { I18nextProvider } from 'react-i18next';
import { createWebsiteI18n } from '../src/i18n';
import { NonceContext } from './nonce';

const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;
void createWebsiteI18n().then((i18n) => startTransition(() => {
  hydrateRoot(document, <StrictMode><I18nextProvider i18n={i18n}><NonceContext.Provider value={nonce}><HydratedRouter /></NonceContext.Provider></I18nextProvider></StrictMode>);
}));
