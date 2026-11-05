import { INTL_LOCALE, type Locale } from './config';

/**
 * Number/date formatting helpers.
 *
 * The app quotes prices in JPY for every locale, so the symbol stays `¥` even
 * on the English UI; only digit grouping follows the active locale.
 */
export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale]).format(value);
}

export function formatYen(locale: Locale, value: number): string {
  return `¥${formatNumber(locale, Math.round(value))}`;
}

export function formatPercent(locale: Locale, value: number): string {
  return `${new Intl.NumberFormat(INTL_LOCALE[locale], { maximumFractionDigits: 1 }).format(value)}%`;
}

/** Formats an ISO timestamp as a short time of day (e.g. `14:05`). */
export function formatTime(locale: Locale, iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** Formats an ISO timestamp as a calendar date + time. */
export function formatDateTime(locale: Locale, iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(date);
}
