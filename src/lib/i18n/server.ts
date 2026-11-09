import { cookies, headers } from 'next/headers';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  localeFromHeader,
  normalizeLocale,
  type Locale,
} from './config';
import { createTranslator, type Translate } from './dictionary';

/**
 * Server-side locale resolution: explicit cookie first, then `Accept-Language`,
 * then the project default.
 */
export async function getRequestLocale(): Promise<Locale> {
  try {
    const cookieStore = await cookies();
    const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
    if (cookieLocale) return normalizeLocale(cookieLocale);

    const headerStore = await headers();
    return localeFromHeader(headerStore.get('accept-language')) ?? DEFAULT_LOCALE;
  } catch {
    // Outside a request scope (unit tests, scripts): fall back to the default.
    return DEFAULT_LOCALE;
  }
}

export interface RequestI18n {
  locale: Locale;
  t: Translate;
}

/** Translator bound to the request locale, for API route messages. */
export async function getRequestI18n(): Promise<RequestI18n> {
  const locale = await getRequestLocale();
  return { locale, t: createTranslator(locale) };
}

/** Locale echoed by a request body or query string, if the caller sent one. */
export function readLocaleFromRequest(input: {
  locale?: unknown;
  searchParams?: URLSearchParams | null;
}): Locale | undefined {
  if (typeof input.locale === 'string' && input.locale.length > 0) {
    return normalizeLocale(input.locale);
  }
  const fromQuery = input.searchParams?.get('lang');
  if (fromQuery) return normalizeLocale(fromQuery);
  return undefined;
}
