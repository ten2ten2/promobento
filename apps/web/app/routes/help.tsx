import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import brand from '../../../../config/brand.json';
import messages from '../../../../locales/en.json';
import { publicPath } from '../../src/public-routes';
import { pageMeta } from '../metadata';

export const meta = () => pageMeta('public.help', messages.webShell.help.metaTitle, messages.webShell.help.metaDescription);

export default function Help() {
  const { t } = useTranslation();
  return <main id="main" className="readable page-section">
    <p className="eyebrow">{t('webShell.help.eyebrow')}</p><h1>{t('webShell.help.title')}</h1>
    <div className="help-items">
      <section><h2>{t('webShell.help.productTitle')}</h2><p>{t('webShell.help.productBody')}</p></section>
      <section><h2>{t('webShell.help.availabilityTitle')}</h2><p>{t('webShell.help.availabilityBody')}</p></section>
      <section><h2>{t('webShell.help.formatsTitle')}</h2><p>{t('webShell.help.formatsBody')} <Link to={publicPath('public.formats')}>{t('webShell.help.formatsLink')}</Link></p></section>
      <section><h2>{t('webShell.help.contactTitle')}</h2><p>{t('webShell.help.email')} <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.</p></section>
    </div>
  </main>;
}
