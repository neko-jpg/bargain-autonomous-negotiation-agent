/**
 * Supported locales for the BARGAIN UI.
 *
 * `ja` is the source language: every dictionary key is declared there first and
 * `en` is type-checked against it, so a missing English string is a compile
 * error rather than a silent fallback.
 */
export const LOCALES = ['ja', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ja';

/** Cookie that keeps the server render and the client render in sync. */
export const LOCALE_COOKIE = 'bargain_locale';

export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const HTML_LANG: Record<Locale, string> = {
  ja: 'ja',
  en: 'en',
};

export const INTL_LOCALE: Record<Locale, string> = {
  ja: 'ja-JP',
  en: 'en-US',
};

/** Label shown inside the language switcher, written in the target language. */
export const LOCALE_LABELS: Record<Locale, string> = {
  ja: '日本語',
  en: 'English',
};

/** Short label used for the compact segmented control. */
export const LOCALE_SHORT_LABELS: Record<Locale, string> = {
  ja: 'JA',
  en: 'EN',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Locale negotiation for the `Accept-Language` header (used when no cookie exists). */
export function localeFromHeader(header: string | null | undefined): Locale | undefined {
  if (!header) return undefined;
  const preferred = header
    .split(',')
    .map((part) => {
      const [tag, quality] = part.trim().split(';q=');
      return { tag: tag.toLowerCase(), quality: quality ? Number(quality) : 1 };
    })
    .filter((entry) => entry.tag.length > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const entry of preferred) {
    if (entry.tag.startsWith('en')) return 'en';
    if (entry.tag.startsWith('ja')) return 'ja';
  }
  return undefined;
}
