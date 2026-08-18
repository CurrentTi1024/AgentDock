import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { getDictionary } from './dictionaries';
import { isSupportedLocale, normalizeLocale, type Locale } from './locales';

const STORAGE_KEY = 'agentdock-locale';

const detectLocale = (): Locale => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isSupportedLocale(stored)) return stored;
  } catch {
    // ignore unavailable storage
  }
  return normalizeLocale(navigator.language);
};

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, number | string>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'en-US',
  setLocale: () => undefined,
  t: (key) => key,
});

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);
  const value = useMemo<I18nContextValue>(() => {
    const dict = getDictionary(locale);
    return {
      locale,
      setLocale: (next) => {
        setLocaleState(next);
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // ignore storage errors
        }
      },
      t: (key, vars) => {
        let text: string = dict[key] ?? key;
        if (vars) {
          for (const [name, raw] of Object.entries(vars)) {
            text = text.replaceAll(`{${name}}`, String(raw));
          }
        }
        return text;
      },
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => useContext(I18nContext);

export const hasExplicitLocalePreference = () => {
  try {
    return Boolean(localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
};
