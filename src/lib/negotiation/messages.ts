import { AgentActionType, NegotiationTerms } from '@/types/negotiation';

/**
 * Public text is generated from the same proposal object that is executed.
 * This keeps a selected price, terms and message from drifting apart.
 */
export function buildPublicOfferMessage(
  role: 'buyer' | 'seller',
  action: AgentActionType,
  price: number,
  terms: NegotiationTerms,
  waitHours?: number
) {
  const yen = `¥${price.toLocaleString('ja-JP')}`;
  if (action === 'accept_offer') {
    return role === 'buyer'
      ? `提示いただいた${yen}で購入させていただきます。よろしくお願いいたします。`
      : `${yen}でのお取引を承諾いたしました。ご購入手続きをお願いいたします。`;
  }
  if (action === 'reject_offer') return '今回は条件が合わないため、見送らせていただきます。';
  if (action === 'wait') return `条件を確認するため、${waitHours ?? 6}時間ほど待機して再評価します。`;
  if (action === 'ask_user') return `${yen}の条件について、最終確認をお願いします。`;
  const termsText = terms.shippingCost > 0 ? `送料${terms.shippingCost.toLocaleString('ja-JP')}円を含む条件` : '提示条件';
  return role === 'buyer'
    ? `${termsText}で${yen}ではいかがでしょうか。`
    : `${termsText}で${yen}まででしたら対応可能です。`;
}
