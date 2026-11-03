import type { ReactNode } from 'react';
import { Links, Meta, NavLink, Outlet, Scripts, ScrollRestoration, isRouteErrorResponse, useRouteError } from 'react-router';
import { useTranslation } from 'react-i18next';
import brand from '../../../config/brand.json';
import { publicPath } from '../src/public-routes';
import { useNonce } from './nonce';
import './styles.css';
import 'virtual:promobento-theme.css';

export function Layout({ children }: { children: ReactNode }) {
  const nonce = useNonce();
  const { t, i18n } = useTranslation();
  return <html lang={i18n.resolvedLanguage ?? brand.defaultUiLocale} dir="ltr" data-theme="system">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex, nofollow" />
      <meta name="color-scheme" content="light dark" />
      <link rel="icon" href={brand.assets.icon} type="image/svg+xml" />
      <Meta />
      <Links nonce={nonce} />
    </head>
    <body>
      <a className="skip-link" href="#main">{t('webShell.navigation.skipToContent')}</a>
      <header className="site-header">
        <NavLink className="wordmark" to={publicPath('public.home')} aria-label={t('webShell.navigation.homeLabel', { brand: brand.brandName })}>
          <img src={brand.assets.mark} alt="" width="36" height="36" />
          <span>{brand.brandName}</span>
        </NavLink>
        <nav aria-label={t('webShell.navigation.mainLabel')}>
          <NavLink to={publicPath('public.formats')}>{t('webShell.navigation.formats')}</NavLink>
          <NavLink to={publicPath('public.help')}>{t('webShell.navigation.help')}</NavLink>
        </nav>
      </header>
      {children}
      <footer className="site-footer">
        <p>{t('marketing.tagline')}</p>
        <nav aria-label={t('webShell.navigation.footerLabel')}>
          <NavLink to={publicPath('public.home')}>{t('webShell.navigation.home')}</NavLink>
          <NavLink to={publicPath('public.formats')}>{t('webShell.navigation.formats')}</NavLink>
          <NavLink to={publicPath('public.help')}>{t('webShell.navigation.help')}</NavLink>
        </nav>
      </footer>
      <ScrollRestoration nonce={nonce} />
      <Scripts nonce={nonce} />
    </body>
  </html>;
}

export default function App() { return <Outlet />; }

export function ErrorBoundary() {
  const { t } = useTranslation();
  const error = useRouteError();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <main id="main" className="readable page-section">
    <p className="eyebrow">{missing ? '404' : t('webShell.errors.retry')}</p>
    <h1>{t(missing ? 'webShell.errors.notFoundTitle' : 'webShell.errors.unavailableTitle')}</h1>
    <p>{t(missing ? 'webShell.errors.notFoundBody' : 'webShell.errors.unavailableBody')}</p>
    <NavLink className="button" to={publicPath('public.home')}>{t('webShell.errors.returnHome')}</NavLink>
  </main>;
}
