'use client';

import { LOCALES, LOCALE_LABELS, LOCALE_SHORT_LABELS, type Locale } from '@/lib/i18n/config';
import { useI18n } from '@/lib/i18n/provider';

/**
 * Compact JA/EN segmented control.
 *
 * Selecting a locale writes the locale cookie and refreshes server components,
 * so server-rendered messages (API error text, contract drafts) follow suit.
 */
export function LocaleSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <div role="group" aria-label={t('locale.switcherLabel')} className={`locale-switch ${className}`.trim()}>
      {LOCALES.map((value: Locale) => (
        <button
          key={value}
          type="button"
          onClick={() => setLocale(value)}
          aria-pressed={value === locale}
          aria-label={LOCALE_LABELS[value]}
          title={LOCALE_LABELS[value]}
          lang={value}
          className="locale-switch__button"
        >
          {LOCALE_SHORT_LABELS[value]}
        </button>
      ))}
    </div>
  );
}
