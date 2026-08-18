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

    const approvalLimit = buyerPolicy.autoApprovalMaxPrice ?? buyerPolicy.maxPrice;
    const requiresHumanApproval = action === 'accept_offer'
      ? !buyerPolicy.autoPurchase || totalOfferCost(sanitizedPrice, terms) > approvalLimit
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

  const approvalFloor = sellerPolicy.autoApprovalMinPrice ?? floor;
  const requiresHumanApproval = action === 'accept_offer'
    ? !sellerPolicy.autoAccept || sanitizedPrice < approvalFloor
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

