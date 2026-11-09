import { AgentActionType, LocalizedMessage, NegotiationTerms } from '@/types/negotiation';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/config';
import { translate } from '@/lib/i18n/dictionary';

/**
 * Public text is generated from the same proposal object that is executed.
 * This keeps a selected price, terms and message from drifting apart.
 *
 * Messages are stored as a dictionary key plus parameters, so the UI can render
 * the same offer in Japanese or English without regenerating the negotiation.
 */
export function buildPublicOfferMessageTemplate(
  role: 'buyer' | 'seller',
  action: AgentActionType,
  price: number,
  terms: NegotiationTerms,
  waitHours?: number
): LocalizedMessage {
  if (action === 'accept_offer') {
    return {
      key: role === 'buyer' ? 'offer.message.acceptBuyer' : 'offer.message.acceptSeller',
      params: { price },
    };
  }
  if (action === 'reject_offer') {
    return { key: 'offer.message.reject' };
  }
  if (action === 'wait') {
    return { key: 'offer.message.wait', params: { hours: waitHours ?? 6 } };
  }
  if (action === 'ask_user') {
    return { key: 'offer.message.askUser', params: { price } };
  }
  if (terms.shippingCost > 0) {
    return {
      key: role === 'buyer' ? 'offer.message.offerBuyerWithShipping' : 'offer.message.offerSellerWithShipping',
      params: { price, shipping: terms.shippingCost },
    };
  }
  return {
    key: role === 'buyer' ? 'offer.message.offerBuyer' : 'offer.message.offerSeller',
    params: { price },
  };
}

/** Rendered form of the public message, used for API clients and stored offers. */
export function buildPublicOfferMessage(
  role: 'buyer' | 'seller',
  action: AgentActionType,
  price: number,
  terms: NegotiationTerms,
  waitHours?: number,
  locale: Locale = DEFAULT_LOCALE
) {
  const template = buildPublicOfferMessageTemplate(role, action, price, terms, waitHours);
  return translate(locale, template.key, template.params);
}
