import presets from '../../../../config/platform-presets.json';
import messages from '../../../../locales/en.json';
import { useTranslation } from 'react-i18next';
import { pageMeta } from '../metadata';

export const meta = () => pageMeta('public.formats', messages.webShell.formats.metaTitle, messages.webShell.formats.metaDescription);

export default function Formats() {
  const { t } = useTranslation();
  return <main id="main" className="page-section">
    <div className="readable page-heading"><p className="eyebrow">{t('webShell.formats.eyebrow')}</p><h1>{t('webShell.formats.title')}</h1><p className="intro">{t('webShell.formats.intro', { short: presets.productLimits.durationSeconds[0], long: presets.productLimits.durationSeconds[1] })}</p><p className="availability">{t('webShell.formats.availability')}</p></div>
    <div className="format-grid">
      {Object.entries(presets.aspectLayouts).map(([id, layout]) => <article className={`format-card format-${id}`} key={id}>
        <div className="format-preview" aria-hidden="true"><div className="format-frame">{layout.ratio}</div></div>
        <h2>{t(`webShell.formats.${id}`)}</h2><p>{layout.width} × {layout.height}</p>
        <p className="platform-list">{presets.presets.filter((preset) => preset.defaultAspect === id || preset.optionalAspects.some((aspect) => aspect === id)).map((preset) => t(preset.labelKey)).join(' · ')}</p>
      </article>)}
    </div>
    <p className="format-note">{t('webShell.formats.note')}</p>
  </main>;
}
