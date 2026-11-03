import { createInstance } from 'i18next';
import localization from '../../../config/localization.json' with { type: 'json' };
import messages from '../../../locales/en.json' with { type: 'json' };

export const initialFormatting = Object.freeze({
  locale: localization.defaultFormattingLocale,
  timeZone: localization.defaultSsrTimeZone,
});

// Never keep a mutable translation singleton on a Worker isolate. The client
// creates its own instance from the same resources and initial locale as SSR.
export async function createWebsiteI18n() {
  const instance = createInstance();
  await instance.init({
    lng: localization.defaultUiLocale,
    fallbackLng: localization.fallbackUiLocale,
    supportedLngs: localization.supportedUiLocales,
    defaultNS: localization.defaultNamespace,
    resources: { en: { translation: structuredClone({
      marketing: messages.marketing,
      platforms: messages.platforms,
      webShell: messages.webShell,
    }) } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    parseMissingKeyHandler: () => messages.webShell.errors.missingMessage,
    returnNull: false,
  });
  return instance;
}
