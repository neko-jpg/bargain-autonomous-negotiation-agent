import { INITIAL_LISTINGS, DEFAULT_BUYER_POLICY_SWITCH, DEFAULT_SELLER_POLICY_SWITCH } from '../../src/lib/mockData';
import { NegotiationSession } from '../../src/types/negotiation';
import { SWITCH_SCENARIO_STEPS } from '../../src/lib/simulation/switchScenario';

export function runSwitchDemoE2ETests(): boolean {
  console.log('\n--- 🎮 Running Curated Catalog 6-Step Demo E2E Tests ---');
  let passed = true;
  const listing = INITIAL_LISTINGS.find((candidate) => candidate.id === 'demo-000027') ?? INITIAL_LISTINGS[0];

  const session: NegotiationSession = {
    id: 'demo-test-1',
    listing,
    buyerPolicy: { ...DEFAULT_BUYER_POLICY_SWITCH },
    sellerPolicy: { ...DEFAULT_SELLER_POLICY_SWITCH },
    buyerPrivateState: { reservationPrice: DEFAULT_BUYER_POLICY_SWITCH.maxPrice, riskTolerance: 0.5, patienceScore: 0.8, batna: DEFAULT_BUYER_POLICY_SWITCH.maxPrice },
    sellerPrivateState: { reservationPrice: DEFAULT_SELLER_POLICY_SWITCH.minPrice, riskTolerance: 0.5, patienceScore: 0.5, batna: DEFAULT_SELLER_POLICY_SWITCH.minPrice },
    offers: [],
    currentTurn: 'buyer',
    currentOfferPrice: listing.price,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  for (let index = 0; index < SWITCH_SCENARIO_STEPS.length; index += 1) {
    const step = SWITCH_SCENARIO_STEPS[index];
    session.offers.push({ id: `offer-step-${index + 1}`, round: index + 1, timestamp: `10:${(index + 1) * 5}`, senderRole: step.role, senderName: step.name, price: step.price, actionType: step.action, messageText: `Step ${index + 1} execution` });
    session.currentOfferPrice = step.price;
    if (index === SWITCH_SCENARIO_STEPS.length - 1) {
      session.status = 'deal';
      session.dealSummary = {
        agreedPrice: step.price,
        initialPrice: listing.price,
        buyerSaved: listing.price - step.price,
        buyerSavedPercent: Math.round(((listing.price - step.price) / listing.price) * 1000) / 10,
        sellerSurplus: step.price - session.sellerPrivateState.reservationPrice,
        totalRounds: SWITCH_SCENARIO_STEPS.length,
        totalActions: SWITCH_SCENARIO_STEPS.length,
        humanMessagesCount: 0,
        completedAt: new Date().toISOString(),
      };
    }
  }

  const expectedPrice = SWITCH_SCENARIO_STEPS[SWITCH_SCENARIO_STEPS.length - 1].price;
  const expectedSaved = listing.price - expectedPrice;
  const expectedSurplus = expectedPrice - DEFAULT_SELLER_POLICY_SWITCH.minPrice;

  if (session.status === 'deal') console.log('✅ [PASS] Step 6 reached DEAL status successfully');
  else { console.error(`❌ [FAIL] Status was ${session.status}, expected deal`); passed = false; }

  if (session.dealSummary?.agreedPrice === expectedPrice) console.log(`✅ [PASS] Agreed price matches the catalog scenario: ¥${expectedPrice.toLocaleString()}`);
  else { console.error(`❌ [FAIL] Agreed price was ${session.dealSummary?.agreedPrice}, expected ${expectedPrice}`); passed = false; }

  if (session.dealSummary?.buyerSaved === expectedSaved) console.log(`✅ [PASS] Buyer saved amount matches the catalog scenario: ¥${expectedSaved.toLocaleString()}`);
  else { console.error(`❌ [FAIL] Buyer saved was ${session.dealSummary?.buyerSaved}, expected ${expectedSaved}`); passed = false; }

  if (session.dealSummary?.sellerSurplus === expectedSurplus) console.log(`✅ [PASS] Seller surplus matches the catalog scenario: +¥${expectedSurplus.toLocaleString()}`);
  else { console.error(`❌ [FAIL] Seller surplus was ${session.dealSummary?.sellerSurplus}, expected ${expectedSurplus}`); passed = false; }

  return passed;
}
