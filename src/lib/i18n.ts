import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import zhCN from '../locales/zh-CN.json';

/** Supported UI locales. API responses remain English regardless of this setting. */
export type Locale = 'en' | 'zh-CN';

const storageKey = 'lessconfig.locale';

/** Prefer a saved choice, then the first supported browser language, with English as the fallback. */
function preferredLocale(): Locale {
    try {
        const saved = localStorage.getItem(storageKey);

        if (saved === 'en' || saved === 'zh-CN') {
            return saved;
        }
    } catch {
        // Browser language detection still works when storage is unavailable.
    }

    const languages = navigator.languages.length ? navigator.languages : [navigator.language];

    for (const language of languages) {
        const base = language.split('-')[0].toLowerCase();

        if (base === 'zh') {
            return 'zh-CN';
        }

        if (base === 'en') {
            return 'en';
        }
    }

    return 'en';
}

void i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, 'zh-CN': { translation: zhCN } },
    lng: preferredLocale(),
    fallbackLng: 'en',
    supportedLngs: ['en', 'zh-CN'],
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    initAsync: false,
});

/**
 * Persist language changes without making storage availability a requirement.
 * @param locale - The supported interface language explicitly selected by the user.
 */
export async function changeLocale(locale: Locale): Promise<void> {
    await i18n.changeLanguage(locale);
    document.documentElement.lang = locale;

    try {
        localStorage.setItem(storageKey, locale);
    } catch {
        // Private browsing may disable storage; the current session still uses this locale.
    }
}

document.documentElement.lang = i18n.language;

export default i18n;
