import {
  BuyerPolicy,
  Listing,
  LocalizedMessage,
  NegotiationTerms,
  SellerPolicy,
} from '@/types/negotiation';
import { normalizeNegotiationTerms, totalOfferCost } from '@/lib/negotiation/terms';
import { DEFAULT_LOCALE } from '@/lib/i18n/config';
import { translate } from '@/lib/i18n/dictionary';

export interface PolicyDecision {
  price: number;
  terms: NegotiationTerms;
  correctionReason?: string;
  /** Structured form of `correctionReason`, so the UI can re-render it. */
  correctionReasons?: LocalizedMessage[];
  requiresHumanApproval: boolean;
  approvalReason?: string;
  /** Structured form of `approvalReason`. */
  approvalReasonTemplate?: LocalizedMessage;
  effectiveFloor?: number;
  effectiveCeiling?: number;
}

/** Renders a structured reason in the server's source language. */
function renderReason(template: LocalizedMessage | undefined): string | undefined {
  return template ? translate(DEFAULT_LOCALE, template.key, template.params) : undefined;
}

function addCorrection(corrections: LocalizedMessage[], template: LocalizedMessage) {
  corrections.push(template);
}

function joinCorrections(corrections: LocalizedMessage[]) {
  return corrections.length > 0 ? corrections.map((item) => renderReason(item) ?? '').join(' ') : undefined;
}

function clampToAllowedPaymentTerms(
  paymentTerms: string,
  allowedPaymentTerms: string[] | undefined,
  corrections: LocalizedMessage[]
) {
  if (!allowedPaymentTerms || allowedPaymentTerms.length === 0 || allowedPaymentTerms.includes(paymentTerms)) {
    return paymentTerms;
  }
  addCorrection(corrections, { key: 'reason.policy.paymentTerms', params: { term: allowedPaymentTerms[0] } });
  return allowedPaymentTerms[0];
}

export function effectiveSellerFloor(policy: SellerPolicy) {
  return Math.max(policy.minPrice, (policy.costPrice ?? 0) + (policy.minimumProfit ?? 0));
}

/**
 * An offer binds only while it still fits its author's *current* policy. When
 * the buyer lowers its budget, its older, higher offers are withdrawn: the
 * counterparty can no longer accept them (found by the fuzzer, see A23).
 */
export function isOfferStillBinding(session: { buyerPolicy: BuyerPolicy; sellerPolicy: SellerPolicy; listing: Listing }, offer: { senderRole: string; price: number; terms?: NegotiationTerms }) {
  if (offer.senderRole.startsWith('buyer')) {
    const total = totalOfferCost(offer.price, normalizeNegotiationTerms(session.listing, offer.terms));
    return total <= session.buyerPolicy.maxPrice && offer.price <= session.listing.price;
  }
  return offer.price >= effectiveSellerFloor(session.sellerPolicy);
}

/**
 * Single source of truth for "does the buyer's human have to approve this
 * purchase?". Returns the reason, or undefined when policy pre-authorizes it.
 * The reason mentions private limits, so show it only to the buyer.
 */
export function buyerCommitApprovalReason(policy: BuyerPolicy, total: number): string | undefined {
  return renderReason(buyerCommitApprovalTemplate(policy, total));
}

/** Structured form of the buyer approval reason, used to localise the UI. */
export function buyerCommitApprovalTemplate(policy: BuyerPolicy, total: number): LocalizedMessage | undefined {
  if (total > policy.maxPrice) return { key: 'reason.policy.buyerCommitAboveMax' };
  if (!policy.autoPurchase) return { key: 'reason.policy.buyerCommitAutoOff' };
  const limit = policy.autoApprovalMaxPrice ?? policy.maxPrice;
  if (total > limit) return { key: 'reason.policy.buyerCommitAboveAuto' };
  return undefined;
}

/** Seller-side counterpart of buyerCommitApprovalReason. */
export function sellerCommitApprovalReason(policy: SellerPolicy, price: number): string | undefined {
  return renderReason(sellerCommitApprovalTemplate(policy, price));
}

/** Structured form of the seller approval reason, used to localise the UI. */
export function sellerCommitApprovalTemplate(policy: SellerPolicy, price: number): LocalizedMessage | undefined {
  const floor = effectiveSellerFloor(policy);
  if (price < floor) return { key: 'reason.policy.sellerCommitBelowFloor' };
  if (!policy.autoAccept) return { key: 'reason.policy.sellerCommitAutoOff' };
  if (price < (policy.autoApprovalMinPrice ?? floor)) return { key: 'reason.policy.sellerCommitBelowAuto' };
  return undefined;
}

export function sanitizeOfferByPolicy(
  role: 'buyer' | 'seller',
  listing: Listing,
  policy: BuyerPolicy | SellerPolicy,
  price: number,
  inputTerms?: Partial<NegotiationTerms>,
  action: 'make_offer' | 'counter_offer' | 'accept_offer' | 'reject_offer' | 'wait' | 'ask_user' = 'counter_offer'
): PolicyDecision {
  const corrections: LocalizedMessage[] = [];
  const terms = normalizeNegotiationTerms(listing, inputTerms);
  // Units are not a negotiable dimension here: a listing has fixed stock and
  // the quoted price is the price of the whole lot. Anything above stock is a
  // correction, never a silent multiplication of what the buyer owes.
  const stock = typeof listing.inventoryQuantity === 'number' && listing.inventoryQuantity > 0
    ? listing.inventoryQuantity
    : 1;
  if (terms.quantity > stock) {
    terms.quantity = stock;
    addCorrection(corrections, { key: 'reason.policy.quantityStock', params: { stock } });
  }
  let sanitizedPrice = Number.isFinite(price) ? Math.max(0, Math.round(price)) : 0;

  if (role === 'buyer') {
    const buyerPolicy = policy as BuyerPolicy;
    const maxShippingCost = buyerPolicy.maxShippingCost ?? Number.MAX_SAFE_INTEGER;
    if (terms.shippingCost > maxShippingCost) {
      terms.shippingCost = maxShippingCost;
      addCorrection(corrections, { key: 'reason.policy.shippingCap', params: { max: maxShippingCost } });
    }
    if (buyerPolicy.maxDeliveryDays && terms.deliveryDays > buyerPolicy.maxDeliveryDays) {
      terms.deliveryDays = buyerPolicy.maxDeliveryDays;
      addCorrection(corrections, { key: 'reason.policy.deliveryCap', params: { days: buyerPolicy.maxDeliveryDays } });
    }
    if (buyerPolicy.minQuantity && terms.quantity < buyerPolicy.minQuantity) {
      terms.quantity = buyerPolicy.minQuantity;
      addCorrection(corrections, { key: 'reason.policy.quantityMin', params: { min: buyerPolicy.minQuantity } });
    }
    if (buyerPolicy.requiredCurrency && terms.currency !== buyerPolicy.requiredCurrency.toUpperCase()) {
      terms.currency = buyerPolicy.requiredCurrency.toUpperCase();
      addCorrection(corrections, { key: 'reason.policy.currency', params: { currency: terms.currency } });
    }
    if (buyerPolicy.requireTaxIncluded && !terms.taxIncluded) {
      terms.taxIncluded = true;
      addCorrection(corrections, { key: 'reason.policy.taxIncluded' });
    }
    terms.paymentTerms = clampToAllowedPaymentTerms(terms.paymentTerms, buyerPolicy.allowedPaymentTerms, corrections);

    const maxItemPrice = Math.max(0, buyerPolicy.maxPrice - terms.shippingCost);
    if (sanitizedPrice > maxItemPrice) {
      sanitizedPrice = maxItemPrice;
      addCorrection(corrections, { key: 'reason.policy.buyerTotalCap', params: { max: buyerPolicy.maxPrice } });
    }
    if (sanitizedPrice > listing.price) {
      sanitizedPrice = listing.price;
      addCorrection(corrections, { key: 'reason.policy.notAboveListing' });
    }

    const requiresHumanApproval = action === 'accept_offer'
      ? buyerCommitApprovalTemplate(buyerPolicy, totalOfferCost(sanitizedPrice, terms)) !== undefined
      : false;
    const buyerApprovalTemplate: LocalizedMessage | undefined = requiresHumanApproval ? { key: 'reason.policy.buyerApproval' } : undefined;
    return {
      price: sanitizedPrice,
      terms,
      correctionReason: joinCorrections(corrections),
      correctionReasons: corrections.length > 0 ? [...corrections] : undefined,
      requiresHumanApproval,
      approvalReason: renderReason(buyerApprovalTemplate),
      approvalReasonTemplate: buyerApprovalTemplate,
      effectiveCeiling: buyerPolicy.maxPrice,
    };
  }

  const sellerPolicy = policy as SellerPolicy;
  const floor = effectiveSellerFloor(sellerPolicy);
  const maxShippingCost = sellerPolicy.maxShippingCost ?? Number.MAX_SAFE_INTEGER;
  if (terms.shippingCost > maxShippingCost) {
    terms.shippingCost = maxShippingCost;
    addCorrection(corrections, { key: 'reason.policy.shippingCap', params: { max: maxShippingCost } });
  }
  if (sellerPolicy.maxDeliveryDays && terms.deliveryDays > sellerPolicy.maxDeliveryDays) {
    terms.deliveryDays = sellerPolicy.maxDeliveryDays;
    addCorrection(corrections, { key: 'reason.policy.deliveryCap', params: { days: sellerPolicy.maxDeliveryDays } });
  }
  if (sellerPolicy.minQuantity && terms.quantity < sellerPolicy.minQuantity) {
    terms.quantity = sellerPolicy.minQuantity;
    addCorrection(corrections, { key: 'reason.policy.quantityMin', params: { min: sellerPolicy.minQuantity } });
  }
  if (sellerPolicy.requiredCurrency && terms.currency !== sellerPolicy.requiredCurrency.toUpperCase()) {
    terms.currency = sellerPolicy.requiredCurrency.toUpperCase();
    addCorrection(corrections, { key: 'reason.policy.currency', params: { currency: terms.currency } });
  }
  if (sellerPolicy.requireTaxIncluded && !terms.taxIncluded) {
    terms.taxIncluded = true;
    addCorrection(corrections, { key: 'reason.policy.taxIncluded' });
  }
  terms.paymentTerms = clampToAllowedPaymentTerms(terms.paymentTerms, sellerPolicy.allowedPaymentTerms, corrections);

  if (sanitizedPrice < floor) {
    sanitizedPrice = floor;
    addCorrection(corrections, { key: 'reason.policy.sellerFloor', params: { floor } });
  }

  const requiresHumanApproval = action === 'accept_offer'
    ? sellerCommitApprovalTemplate(sellerPolicy, sanitizedPrice) !== undefined
    : false;
  const sellerApprovalTemplate: LocalizedMessage | undefined = requiresHumanApproval ? { key: 'reason.policy.sellerApproval' } : undefined;
  return {
    price: sanitizedPrice,
    terms,
    correctionReason: joinCorrections(corrections),
    correctionReasons: corrections.length > 0 ? [...corrections] : undefined,
    requiresHumanApproval,
    approvalReason: renderReason(sellerApprovalTemplate),
    approvalReasonTemplate: sellerApprovalTemplate,
    effectiveFloor: floor,
  };
}

