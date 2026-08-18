import { NegotiationGuardrails } from '../../src/lib/engine/guardrails';
import { NegotiationSession } from '../../src/types/negotiation';
import { DEFAULT_BUYER_POLICY_SWITCH, DEFAULT_SELLER_POLICY_SWITCH, INITIAL_LISTINGS } from '../../src/lib/mockData';

export function runGuardrailsTests(): boolean {
  console.log('\n--- 🛡️ Running Guardrails Unit Tests ---');
  let passed = true;
  const listing = INITIAL_LISTINGS.find((candidate) => candidate.id === 'demo-000027') ?? INITIAL_LISTINGS[0];
  const buyerMax = DEFAULT_BUYER_POLICY_SWITCH.maxPrice;
  const sellerMin = DEFAULT_SELLER_POLICY_SWITCH.minPrice;

  const mockSession: NegotiationSession = {
    id: 'test-session',
    listing,
    buyerPolicy: { ...DEFAULT_BUYER_POLICY_SWITCH },
    sellerPolicy: { ...DEFAULT_SELLER_POLICY_SWITCH },
    buyerPrivateState: { reservationPrice: buyerMax, riskTolerance: 0.5, patienceScore: 0.8, batna: buyerMax },
    sellerPrivateState: { reservationPrice: sellerMin, riskTolerance: 0.5, patienceScore: 0.5, batna: sellerMin },
    offers: [{ id: 'o-1', round: 1, timestamp: '10:00', senderRole: 'seller_agent', senderName: 'Seller', price: listing.price, actionType: 'make_offer', messageText: 'Initial' }],
    currentTurn: 'buyer',
    currentOfferPrice: listing.price,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const buyerResult = NegotiationGuardrails.validateAndSanitize('buyer', 'counter_offer', buyerMax + 1000, buyerMax, mockSession.buyerPolicy.targetPrice, mockSession.offers, listing.price);
  if (buyerResult.sanitizedPrice === buyerMax) {
    console.log(`✅ [PASS] Buyer offer exceeding maxPrice clamped to ${buyerMax.toLocaleString()}`);
  } else {
    console.error(`❌ [FAIL] Buyer offer price was ${buyerResult.sanitizedPrice}, expected ${buyerMax}`);
    passed = false;
  }

  const sellerResult = NegotiationGuardrails.validateAndSanitize('seller', 'counter_offer', sellerMin - 1000, sellerMin, mockSession.sellerPolicy.targetPrice, mockSession.offers, listing.price);
  if (sellerResult.sanitizedPrice === sellerMin) {
    console.log(`✅ [PASS] Seller offer below minPrice clamped to ${sellerMin.toLocaleString()}`);
  } else {
    console.error(`❌ [FAIL] Seller offer price was ${sellerResult.sanitizedPrice}, expected ${sellerMin}`);
    passed = false;
  }

  const filtered = NegotiationGuardrails.filterPublicStateForOpponent(mockSession.offers);
  if (filtered.length === 1 && (filtered[0] as { reasoning?: unknown }).reasoning === undefined) {
    console.log('✅ [PASS] filterPublicStateForOpponent strips private reasoning from history');
  } else {
    console.error('❌ [FAIL] Public state filter did not strip reasoning');
    passed = false;
  }

  return passed;
}
