import {
  DICTIONARIES,
  createTranslator,
  listTranslationKeys,
  translate,
} from '../../src/lib/i18n/dictionary';
import { LOCALES, localeFromHeader, normalizeLocale } from '../../src/lib/i18n/config';

/**
 * Guards the dictionary contract: `en` must cover every `ja` key, both locales
 * must use the same interpolation placeholders, and the translator must handle
 * plurals and currency formatting. TypeScript enforces key parity at build
 * time; this suite catches placeholder drift and runtime regressions.
 */
const PLACEHOLDER = /\{(\w+)(?:,\w+)?\}/g;

function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();
}

export function runI18nTests(): boolean {
  console.log('\n--- 🌐 Running i18n Dictionary Tests ---');
  let passed = true;

  const assert = (title: string, ok: boolean, detail = '') => {
    if (ok) console.log(`✅ [PASS] ${title}${detail ? ` — ${detail}` : ''}`);
    else console.error(`❌ [FAIL] ${title}${detail ? ` — ${detail}` : ''}`);
    if (!ok) passed = false;
  };

  const keys = listTranslationKeys();
  const ja = DICTIONARIES.ja;
  const en = DICTIONARIES.en;

  const missing = keys.filter((key) => !(key in en));
  const orphan = Object.keys(en).filter((key) => !(key in ja));
  assert('The English dictionary covers every Japanese key', missing.length === 0, missing.slice(0, 5).join(', '));
  assert('The English dictionary has no orphan keys', orphan.length === 0, orphan.slice(0, 5).join(', '));

  const placeholderDrift = keys.filter((key) => {
    const jaParams = placeholders(ja[key] ?? '');
    const enParams = placeholders(en[key] ?? '');
    return jaParams.length !== enParams.length || jaParams.some((name, index) => name !== enParams[index]);
  });
  assert('Both locales use the same placeholders for every key', placeholderDrift.length === 0, placeholderDrift.slice(0, 5).join(', '));

  const empty = LOCALES.flatMap((locale) =>
    keys.filter((key) => (DICTIONARIES[locale][key] ?? '').trim() === '').map((key) => `${locale}:${key}`),
  );
  assert('No translation is empty', empty.length === 0, empty.slice(0, 5).join(', '));

  const tJa = createTranslator('ja');
  assert('A string parameter is interpolated', tJa('market.searchNoMatch', { query: 'PS5' }).includes('PS5'));
  assert(
    'A currency parameter is formatted as yen',
    tJa('offer.message.offerBuyer', { price: 57500 }) === '提示条件で¥57,500ではいかがでしょうか。',
    tJa('offer.message.offerBuyer', { price: 57500 }),
  );
  assert('A number parameter is grouped', tJa('market.synced', { count: 1234 }).includes('1,234'), tJa('market.synced', { count: 1234 }));

  const tEn = createTranslator('en');
  assert('The singular form is used for a count of one', tEn('market.itemCount', { count: 1 }) === '1 item', tEn('market.itemCount', { count: 1 }));
  assert('The plural form is used for other counts', tEn('market.itemCount', { count: 3 }) === '3 items', tEn('market.itemCount', { count: 3 }));

  assert('Generated offers render in English', tEn('offer.message.acceptBuyer', { price: 57500 }) === 'Deal — I will take it at ¥57,500. Thank you.');

  assert('An unknown key falls back to the key itself', translate('en', 'does.not.exist' as never) === 'does.not.exist');
  assert('An unknown locale is normalised to the default', normalizeLocale('fr') === 'ja');
  assert('Accept-Language picks English', localeFromHeader('en-US,en;q=0.9') === 'en');
  assert('Accept-Language picks Japanese', localeFromHeader('ja-JP,ja;q=0.9,en;q=0.8') === 'ja');

  return passed;
}
