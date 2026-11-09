'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  DEFAULT_LOCALE,
  HTML_LANG,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  normalizeLocale,
  type Locale,
} from './config';
import { createTranslator, type Translate } from './dictionary';
import { formatDateTime, formatNumber, formatTime, formatYen } from './format';

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
  formatNumber: (value: number) => string;
  formatYen: (value: number) => string;
  formatTime: (iso: string | undefined) => string;
  formatDateTime: (iso: string | undefined) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function createValue(locale: Locale, setLocale: (locale: Locale) => void): I18nContextValue {
  return {
    locale,
    setLocale,
    t: createTranslator(locale),
    formatNumber: (value) => formatNumber(locale, value),
    formatYen: (value) => formatYen(locale, value),
    formatTime: (iso) => formatTime(locale, iso),
    formatDateTime: (iso) => formatDateTime(locale, iso),
  };
}

/**
 * Keeps the active locale in a cookie so the next server render (layout,
 * metadata, API route messages) already agrees with the client.
 */
export function I18nProvider({
  initialLocale = DEFAULT_LOCALE,
  children,
}: {
  initialLocale?: Locale;
  children: ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(() => normalizeLocale(initialLocale));

  useEffect(() => {
    setLocaleState(normalizeLocale(initialLocale));
  }, [initialLocale]);

  useEffect(() => {
    document.documentElement.lang = HTML_LANG[locale] ?? HTML_LANG[DEFAULT_LOCALE];
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale) => {
      const normalized = normalizeLocale(next);
      setLocaleState(normalized);
      if (typeof document !== 'undefined') {
        document.cookie = `${LOCALE_COOKIE}=${normalized}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
      }
      router.refresh();
    },
    [router],
  );

  const value = useMemo(() => createValue(locale, setLocale), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Reads the active locale. Components rendered outside the provider (for
 * example a root error boundary) still get a working default translator
 * instead of crashing.
 */
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (context) return context;
  return createValue(DEFAULT_LOCALE, () => undefined);
}

/** Convenience hook for components that only need the translator. */
export function useTranslate(): Translate {
  return useI18n().t;
}
