import { DEFAULT_LOCALE, type Locale } from './config';
import { en } from './dictionaries/en';
import { ja } from './dictionaries/ja';
import { formatNumber, formatYen } from './format';

/** Every valid dictionary key. `ja` declares the set; `en` must match it. */
export type TranslationKey = keyof typeof ja;

export type TranslationParamValue = string | number | null | undefined;

export type TranslationParams = Record<string, TranslationParamValue>;

export const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = { ja, en };

export type Translate = (key: TranslationKey, params?: TranslationParams) => string;

const PLACEHOLDER = /\{(\w+)(?:,(\w+))?\}/g;

/**
 * Replaces `{name}` and `{name,format}` placeholders.
 *
 * Supported formats: `number` (locale digit grouping), `currency` (JPY) and
 * `percent`. Unknown formats fall back to `String(value)`.
 */
export function interpolate(
  template: string,
  params: TranslationParams | undefined,
  locale: Locale,
): string {
  return template.replace(PLACEHOLDER, (match, name: string, format: string | undefined) => {
    const value = params?.[name];
    if (value === undefined || value === null) return match;
    if (typeof value === 'number' && format) {
      if (format === 'number') return formatNumber(locale, value);
      if (format === 'currency') return formatYen(locale, value);
      if (format === 'percent') return `${value}%`;
    }
    return String(value);
  });
}

/** Picks `key.one` / `key.other` when the key declares count-aware variants. */
function resolvePluralKey(
  dictionary: Record<TranslationKey, string>,
  key: TranslationKey,
  count: number | undefined,
): TranslationKey {
  if (typeof count !== 'number') return key;
  const candidate = `${key}.${count === 1 ? 'one' : 'other'}` as TranslationKey;
  return candidate in dictionary ? candidate : key;
}

export function translate(locale: Locale, key: TranslationKey, params?: TranslationParams): string {
  const dictionary = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  const count = params?.count;
  const resolved = resolvePluralKey(dictionary, key, typeof count === 'number' ? count : undefined);
  const template = dictionary[resolved] ?? dictionary[key];
  if (template === undefined) return key;
  return interpolate(template, params, locale);
}

export function createTranslator(locale: Locale): Translate {
  return (key, params) => translate(locale, key, params);
}

/** All keys that exist in the dictionaries; used by the key-coverage test. */
export function listTranslationKeys(): TranslationKey[] {
  return Object.keys(ja) as TranslationKey[];
}

/**
 * Resolves a stored dictionary key back to a string.
 *
 * Server-side records may carry `{ key, params }` instead of rendered text so
 * the client can render them in whichever language the viewer is using.
 */
export function translateRecord(
  locale: Locale,
  record: { key: string; params?: TranslationParams } | undefined,
  fallbackText?: string,
): string | undefined {
  if (!record) return fallbackText;
  const dictionary = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  if (!(record.key in dictionary)) return fallbackText;
  return translate(locale, record.key as TranslationKey, record.params);
}
