import type { TranslationKey } from './dictionary';

/**
 * Negotiation terms are stored as free text chosen by the parties. The values
 * the app itself seeds are mapped back to dictionary keys so they follow the
 * viewer's language; anything else is shown verbatim.
 */
const TERM_VALUE_KEYS: Record<string, TranslationKey> = {
  即時決済: 'terms.immediatePayment',
  商品説明に準拠: 'terms.asDescribed',
  出品者指定: 'terms.sellerDefault',
};

export function termValueKey(value: string | undefined | null): TranslationKey | undefined {
  if (!value) return undefined;
  return TERM_VALUE_KEYS[value];
}

const SENDER_KEYS: Record<string, TranslationKey> = {
  'あなた（買い手）': 'role.youBuyer',
  'あなた（売り手）': 'role.youSeller',
  'You (buyer)': 'role.youBuyer',
  'You (seller)': 'role.youSeller',
};

/**
 * Fallback for records written before `senderKey` existed: recovers the key
 * from the stored Japanese (or English) sender label.
 */
export function senderKeyFromName(name: string | undefined): TranslationKey | undefined {
  if (!name) return undefined;
  return SENDER_KEYS[name];
}

/**
 * Approval tasks store a rendered title. These are the titles this app writes,
 * mapped back to keys so the approval queue follows the viewer's language.
 */
const APPROVAL_TITLE_KEYS: Record<string, TranslationKey> = {
  '購入確定の承認が必要です': 'approval.titleBuyerCommit',
  '売却確定の承認が必要です': 'approval.titleSellerCommit',
  '契約書ドラフトを承認してください': 'approval.titleContract',
  'Your purchase approval is required': 'approval.titleBuyerCommit',
  'Your sale approval is required': 'approval.titleSellerCommit',
  'Please approve the contract draft': 'approval.titleContract',
};

export function approvalTitleKey(title: string | undefined): TranslationKey | undefined {
  if (!title) return undefined;
  return APPROVAL_TITLE_KEYS[title];
}
