import {
  BuyerPolicy,
  Listing,
  NegotiationTerms,
  SellerPolicy,
} from '@/types/negotiation';
import { normalizeNegotiationTerms, totalOfferCost } from '@/lib/negotiation/terms';

export interface PolicyDecision {
  price: number;
  terms: NegotiationTerms;
  correctionReason?: string;
  requiresHumanApproval: boolean;
  approvalReason?: string;
  effectiveFloor?: number;
  effectiveCeiling?: number;
}

function addCorrection(corrections: string[], message: string) {
  corrections.push(message);
}

function joinCorrections(corrections: string[]) {
  return corrections.length > 0 ? corrections.join(' ') : undefined;
}

function clampToAllowedPaymentTerms(
  paymentTerms: string,
  allowedPaymentTerms: string[] | undefined,
  corrections: string[]
) {
  if (!allowedPaymentTerms || allowedPaymentTerms.length === 0 || allowedPaymentTerms.includes(paymentTerms)) {
    return paymentTerms;
  }
  addCorrection(corrections, `支払条件を許可済みの「${allowedPaymentTerms[0]}」に補正しました。`);
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
  if (total > policy.maxPrice) return '総額が上限価格を超えるため、人間の承認が必要です。';
  if (!policy.autoPurchase) return '自動購入がオフのため、購入確定には人間の承認が必要です。';
  const limit = policy.autoApprovalMaxPrice ?? policy.maxPrice;
  if (total > limit) return '総額が自動承認上限を超えるため、人間の承認が必要です。';
  return undefined;
}

/** Seller-side counterpart of buyerCommitApprovalReason. */
export function sellerCommitApprovalReason(policy: SellerPolicy, price: number): string | undefined {
  const floor = effectiveSellerFloor(policy);
  if (price < floor) return '売り手の実効最低価格を下回るため、人間の承認が必要です。';
  if (!policy.autoAccept) return '自動受諾がオフのため、売却確定には人間の承認が必要です。';
  if (price < (policy.autoApprovalMinPrice ?? floor)) return '自動承認下限を下回るため、人間の承認が必要です。';
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
  const corrections: string[] = [];
  const terms = normalizeNegotiationTerms(listing, inputTerms);
  let sanitizedPrice = Number.isFinite(price) ? Math.max(0, Math.round(price)) : 0;

  if (role === 'buyer') {
    const buyerPolicy = policy as BuyerPolicy;
    const maxShippingCost = buyerPolicy.maxShippingCost ?? Number.MAX_SAFE_INTEGER;
    if (terms.shippingCost > maxShippingCost) {
      terms.shippingCost = maxShippingCost;
      addCorrection(corrections, `送料を上限¥${maxShippingCost.toLocaleString()}に補正しました。`);
    }
    if (buyerPolicy.maxDeliveryDays && terms.deliveryDays > buyerPolicy.maxDeliveryDays) {
      terms.deliveryDays = buyerPolicy.maxDeliveryDays;
      addCorrection(corrections, `納期を${buyerPolicy.maxDeliveryDays}日以内に補正しました。`);
    }
    if (buyerPolicy.minQuantity && terms.quantity < buyerPolicy.minQuantity) {
      terms.quantity = buyerPolicy.minQuantity;
      addCorrection(corrections, `数量を最低${buyerPolicy.minQuantity}個に補正しました。`);
    }
    if (buyerPolicy.requiredCurrency && terms.currency !== buyerPolicy.requiredCurrency.toUpperCase()) {
      terms.currency = buyerPolicy.requiredCurrency.toUpperCase();
      addCorrection(corrections, `通貨を${terms.currency}に補正しました。`);
    }
    if (buyerPolicy.requireTaxIncluded && !terms.taxIncluded) {
      terms.taxIncluded = true;
      addCorrection(corrections, '税込条件に補正しました。');
    }
    terms.paymentTerms = clampToAllowedPaymentTerms(terms.paymentTerms, buyerPolicy.allowedPaymentTerms, corrections);

    const maxItemPrice = Math.max(0, buyerPolicy.maxPrice - terms.shippingCost);
    if (sanitizedPrice > maxItemPrice) {
      sanitizedPrice = maxItemPrice;
      addCorrection(corrections, `総額上限¥${buyerPolicy.maxPrice.toLocaleString()}以内に補正しました。`);
    }
    if (sanitizedPrice > listing.price) {
      sanitizedPrice = listing.price;
      addCorrection(corrections, '出品価格を超えないように補正しました。');
    }

    const requiresHumanApproval = action === 'accept_offer'
      ? buyerCommitApprovalReason(buyerPolicy, totalOfferCost(sanitizedPrice, terms)) !== undefined
      : false;
    return {
      price: sanitizedPrice,
      terms,
      correctionReason: joinCorrections(corrections),
      requiresHumanApproval,
      approvalReason: requiresHumanApproval ? '買い手の承認条件を満たしていないため、最終受諾に人間承認が必要です。' : undefined,
      effectiveCeiling: buyerPolicy.maxPrice,
    };
  }

  const sellerPolicy = policy as SellerPolicy;
  const floor = effectiveSellerFloor(sellerPolicy);
  const maxShippingCost = sellerPolicy.maxShippingCost ?? Number.MAX_SAFE_INTEGER;
  if (terms.shippingCost > maxShippingCost) {
    terms.shippingCost = maxShippingCost;
    addCorrection(corrections, `送料を上限¥${maxShippingCost.toLocaleString()}に補正しました。`);
  }
  if (sellerPolicy.maxDeliveryDays && terms.deliveryDays > sellerPolicy.maxDeliveryDays) {
    terms.deliveryDays = sellerPolicy.maxDeliveryDays;
    addCorrection(corrections, `納期を${sellerPolicy.maxDeliveryDays}日以内に補正しました。`);
  }
  if (sellerPolicy.minQuantity && terms.quantity < sellerPolicy.minQuantity) {
    terms.quantity = sellerPolicy.minQuantity;
    addCorrection(corrections, `数量を最低${sellerPolicy.minQuantity}個に補正しました。`);
  }
  if (sellerPolicy.requiredCurrency && terms.currency !== sellerPolicy.requiredCurrency.toUpperCase()) {
    terms.currency = sellerPolicy.requiredCurrency.toUpperCase();
    addCorrection(corrections, `通貨を${terms.currency}に補正しました。`);
  }
  if (sellerPolicy.requireTaxIncluded && !terms.taxIncluded) {
    terms.taxIncluded = true;
    addCorrection(corrections, '税込条件に補正しました。');
  }
  terms.paymentTerms = clampToAllowedPaymentTerms(terms.paymentTerms, sellerPolicy.allowedPaymentTerms, corrections);

  if (sanitizedPrice < floor) {
    sanitizedPrice = floor;
    addCorrection(corrections, `売り手の実効最低価格¥${floor.toLocaleString()}を下回らないように補正しました。`);
  }

  const requiresHumanApproval = action === 'accept_offer'
    ? sellerCommitApprovalReason(sellerPolicy, sanitizedPrice) !== undefined
    : false;
  return {
    price: sanitizedPrice,
    terms,
    correctionReason: joinCorrections(corrections),
    requiresHumanApproval,
    approvalReason: requiresHumanApproval ? '売り手の承認条件を満たしていないため、最終受諾に人間承認が必要です。' : undefined,
    effectiveFloor: floor,
  };
}

