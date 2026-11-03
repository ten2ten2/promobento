import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import brand from '../../../../config/brand.json';
import presets from '../../../../config/platform-presets.json';
import { publicPath } from '../../src/public-routes';
import { pageMeta } from '../metadata';

export const meta = () => pageMeta('public.home', `${brand.brandName} — ${brand.tagline}`, brand.description);

export default function Home() {
  const { t } = useTranslation();
  return <main id="main">
    <section className="hero page-section">
      <div className="hero-copy">
        <p className="eyebrow">{t('webShell.home.eyebrow')}</p>
        <h1>{t('marketing.headline')}</h1>
        <p className="intro">{t('marketing.description')}</p>
        <p className="availability">{t('webShell.home.availability')}</p>
        <div className="actions">
          <Link className="button" to={publicPath('public.formats')}>{t('webShell.home.exploreFormats')} <span aria-hidden="true">↗</span></Link>
          <Link className="text-link" to={publicPath('public.help')}>{t('webShell.home.about')}</Link>
        </div>
      </div>
      <div className="bento-illustration" role="img" aria-label={t('webShell.home.illustrationLabel')}>
        <div className="bento-tile tile-assets"><span className="tile-number">01</span><span>{t('webShell.home.assets')}</span><div className="asset-stack" aria-hidden="true"><i /><i /><i /></div></div>
        <div className="bento-tile tile-story"><span className="tile-number">02</span><span>{t('webShell.home.story')}</span><div className="story-lines" aria-hidden="true"><i /><i /><i /></div></div>
        <div className="bento-tile tile-film"><span className="tile-number">03</span><span>{t('webShell.home.promo')}</span><div className="film-note">{t('webShell.home.duration', { short: presets.productLimits.durationSeconds[0], long: presets.productLimits.durationSeconds[1] })}</div><div className="film-strip" aria-hidden="true"><i /><i /><i /><i /></div></div>
      </div>
    </section>
    <section className="page-section feature-section" aria-labelledby="process-heading">
      <div className="section-heading"><p className="eyebrow">{t('webShell.home.processEyebrow')}</p><h2 id="process-heading">{t('webShell.home.processTitle')}</h2></div>
      <div className="feature-grid">
        <article><span className="step">{t('webShell.home.assetsStep')}</span><h3>{t('webShell.home.assetsTitle')}</h3><p>{t('webShell.home.assetsBody')}</p></article>
        <article><span className="step">{t('webShell.home.directionStep')}</span><h3>{t('webShell.home.directionTitle')}</h3><p>{t('webShell.home.directionBody')}</p></article>
        <article><span className="step">{t('webShell.home.formatStep')}</span><h3>{t('webShell.home.formatTitle')}</h3><p>{t('webShell.home.formatBody')}</p></article>
      </div>
    </section>
  </main>;
}
