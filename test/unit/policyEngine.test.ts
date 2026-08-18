import { findListing } from '../../src/lib/negotiation/sessionStore';
import { effectiveSellerFloor, sanitizeOfferByPolicy } from '../../src/lib/negotiation/policyEngine';
import { totalOfferCost } from '../../src/lib/negotiation/terms';
import { BuyerPolicy, SellerPolicy } from '../../src/types/negotiation';

export function runPolicyEngineTests(): boolean {
  console.log('\n--- ⚖️ Running Structured Offer Policy Tests ---');
  const listing = findListing('listing-switch-demo');
  if (!listing) return false;
  let passed = true;
  const buyer: BuyerPolicy = {
    targetPrice: 45_000,
    maxPrice: 50_000,
    deadlineDays: 3,
    autoPurchase: false,
    delegationLevel: 2,
    maxDeliveryDays: 3,
    maxShippingCost: 5_000,
    requiredCurrency: 'JPY',
    requireTaxIncluded: true,
    allowedPaymentTerms: ['即時決済'],
  };
  const buyerDecision = sanitizeOfferByPolicy('buyer', listing, buyer, 49_000, {
    shippingCost: 5_000,
    deliveryDays: 30,
    currency: 'usd',
    taxIncluded: false,
    paymentTerms: '後払い',
  }, 'counter_offer');
  if (buyerDecision.price === 45_000 && totalOfferCost(buyerDecision.price, buyerDecision.terms) === 50_000 && buyerDecision.terms.deliveryDays === 3 && buyerDecision.terms.currency === 'JPY' && buyerDecision.terms.taxIncluded && buyerDecision.terms.paymentTerms === '即時決済') {
    console.log('✅ [PASS] Buyer total budget and structured terms are normalized');
  } else {
    console.error('❌ [FAIL] Buyer policy did not normalize total budget and terms');
    passed = false;
  }

  const seller: SellerPolicy = {
    targetPrice: 65_000,
    minPrice: 55_000,
    urgency: 'medium',
    deadlineDays: 7,
    autoAccept: false,
    costPrice: 50_000,
    minimumProfit: 10_000,
  };
  const sellerDecision = sanitizeOfferByPolicy('seller', listing, seller, 55_000, undefined, 'counter_offer');
  if (effectiveSellerFloor(seller) === 60_000 && sellerDecision.price === 60_000) {
    console.log('✅ [PASS] Seller cost plus minimum profit creates an effective floor');
  } else {
    console.error('❌ [FAIL] Seller effective floor was not enforced');
    passed = false;
  }

  const approval = sanitizeOfferByPolicy('buyer', listing, buyer, 49_000, undefined, 'accept_offer');
  if (approval.requiresHumanApproval && approval.approvalReason) {
    console.log('✅ [PASS] Auto-approval boundary produces a human approval requirement');
  } else {
    console.error('❌ [FAIL] Auto-approval boundary was not enforced');
    passed = false;
  }

  return passed;
}
