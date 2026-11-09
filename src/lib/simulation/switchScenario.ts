import { DealSummary, Listing, LocalizedMessage, NegotiationOffer, NegotiationSession } from '@/types/negotiation';
import { DEFAULT_LOCALE } from '@/lib/i18n/config';
import { translate } from '@/lib/i18n/dictionary';
import { DEMO_CATALOG_ID } from '@/lib/catalog/catalogAdapter';
import { DEFAULT_BUYER_POLICY_DEMO, DEFAULT_SELLER_POLICY_DEMO } from '@/lib/mockData';
import {
  commitSession,
  createSwitchDemoSession,
  findListing,
  getSession,
  toPublicSession,
} from '@/lib/negotiation/sessionStore';

type SwitchScenarioStep = {
  role: 'buyer_agent' | 'seller_agent';
  name: string;
  price: number;
  action: 'make_offer' | 'counter_offer' | 'wait' | 'accept_offer';
  waitHours?: number;
  marketStateChange?: Partial<Listing>;
  /** Structured text so the scripted demo follows the viewer's language. */
  reason: LocalizedMessage;
  factors: LocalizedMessage[];
  message: LocalizedMessage;
};

/** Rendered fallback for API clients that read the demo offers directly. */
const renderStepText = (text: LocalizedMessage) => translate(DEFAULT_LOCALE, text.key, text.params);
const roundToHundred = (value: number) => Math.round(value / 100) * 100;
const demoListing = findListing(DEMO_CATALOG_ID);

if (!demoListing) {
  throw new Error(`Catalog demo listing ${DEMO_CATALOG_ID} is missing.`);
}

const demoPrice = demoListing.price;
const buyerTarget = DEFAULT_BUYER_POLICY_DEMO.targetPrice;
const buyerMax = DEFAULT_BUYER_POLICY_DEMO.maxPrice;
const sellerMin = DEFAULT_SELLER_POLICY_DEMO.minPrice;
const firstOffer = roundToHundred(demoPrice * 0.86);
const sellerCounter = roundToHundred(demoPrice * 0.96);
const sellerReoffer = roundToHundred(demoPrice * 0.92);
const finalOffer = roundToHundred(demoPrice * 0.90);

export const SWITCH_SCENARIO_STEPS: readonly SwitchScenarioStep[] = [
  {
    role: 'buyer_agent',
    name: 'BARGAIN Buyer Agent',
    price: firstOffer,
    action: 'make_offer',
    reason: { key: 'demo.step1.reason' },
    factors: [
      { key: 'demo.step1.factor1', params: { price: demoPrice } },
      { key: 'demo.step1.factor2', params: { target: buyerTarget } },
      { key: 'demo.step1.factor3', params: { median: demoListing.marketMedianPrice } },
    ],
    message: { key: 'demo.step1.message', params: { price: firstOffer } },
  },
  {
    role: 'seller_agent',
    name: `${demoListing.sellerName} (Seller Agent)`,
    price: sellerCounter,
    action: 'counter_offer',
    reason: { key: 'demo.step2.reason' },
    factors: [
      { key: 'demo.step2.factor1', params: { min: sellerMin } },
      { key: 'demo.step2.factor2', params: { delta: demoPrice - sellerCounter } },
      { key: 'demo.step2.factor3' },
    ],
    message: { key: 'demo.step2.message', params: { price: sellerCounter } },
  },
  {
    role: 'buyer_agent',
    name: 'BARGAIN Buyer Agent',
    price: firstOffer,
    action: 'wait',
    waitHours: 24,
    marketStateChange: { daysListed: demoListing.daysListed + 8, recentDemand: 'low', viewsCount: demoListing.viewsCount + 72 },
    reason: { key: 'demo.step3.reason' },
    factors: [
      { key: 'demo.step3.factor1' },
      { key: 'demo.step3.factor2' },
      { key: 'demo.step3.factor3', params: { max: buyerMax } },
    ],
    message: { key: 'demo.step3.message' },
  },
  {
    role: 'seller_agent',
    name: `${demoListing.sellerName} (Seller Agent)`,
    price: sellerReoffer,
    action: 'counter_offer',
    reason: { key: 'demo.step4.reason' },
    factors: [
      { key: 'demo.step4.factor1', params: { min: sellerMin, delta: sellerReoffer - sellerMin } },
      { key: 'demo.step4.factor2' },
      { key: 'demo.step4.factor3' },
    ],
    message: { key: 'demo.step4.message', params: { price: sellerReoffer } },
  },
  {
    role: 'buyer_agent',
    name: 'BARGAIN Buyer Agent',
    price: finalOffer,
    action: 'counter_offer',
    reason: { key: 'demo.step5.reason' },
    factors: [
      { key: 'demo.step5.factor1', params: { max: buyerMax } },
      { key: 'demo.step5.factor2', params: { min: sellerMin } },
      { key: 'demo.step5.factor3' },
    ],
    message: { key: 'demo.step5.message', params: { price: finalOffer } },
  },
  {
    role: 'seller_agent',
    name: `${demoListing.sellerName} (Seller Agent)`,
    price: finalOffer,
    action: 'accept_offer',
    reason: { key: 'demo.step6.reason' },
    factors: [
      { key: 'demo.step6.factor1', params: { min: sellerMin } },
      { key: 'demo.step6.factor2', params: { surplus: finalOffer - sellerMin } },
      { key: 'demo.step6.factor3' },
    ],
    message: { key: 'demo.step6.message', params: { price: finalOffer } },
  },
];

export function startSwitchDemo() {
  return toPublicSession(createSwitchDemoSession());
}

export function advanceSwitchDemo(sessionId: string, stepIndex: number) {
  const session = getSession(sessionId);
  // Only sessions created by startSwitchDemo() can be driven by the script.
  if (!session || !session.scriptedDemo) throw new Error('SESSION_NOT_FOUND');
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= SWITCH_SCENARIO_STEPS.length) {
    throw new Error('STEP_OUT_OF_BOUNDS');
  }

  const listingBase = findListing(DEMO_CATALOG_ID) ?? session.listing;
  let listing = { ...listingBase };
  const offers: NegotiationOffer[] = [];

  for (let index = 0; index <= stepIndex; index += 1) {
    const step = SWITCH_SCENARIO_STEPS[index];
    if (step.marketStateChange) listing = { ...listing, ...step.marketStateChange };
    offers.push({
      id: `offer-demo-${index + 1}`,
      round: index + 1,
      timestamp: `19:${String(30 + index * 2).padStart(2, '0')}`,
      senderRole: step.role,
      senderName: step.name,
      price: step.price,
      actionType: step.action,
      waitTimeHours: step.waitHours,
      reasoning: {
        summary: renderStepText(step.reason),
        summaryTemplate: step.reason,
        marketMedian: listing.marketMedianPrice,
        daysListed: listing.daysListed,
        demandTrend: listing.recentDemand,
        acceptanceScore: step.action === 'accept_offer' ? 100 : Math.min(96, 60 + index * 6),
        factors: step.factors.map(renderStepText),
        factorTemplates: step.factors.map((factor) => ({ ...factor })),
      },
      messageText: renderStepText(step.message),
      messageTemplate: step.message,
    });
  }

  const currentStep = SWITCH_SCENARIO_STEPS[stepIndex];
  const isDeal = currentStep.action === 'accept_offer';
  const dealSummary: DealSummary | undefined = isDeal
    ? {
        agreedPrice: currentStep.price,
        initialPrice: demoPrice,
        buyerSaved: demoPrice - currentStep.price,
        buyerSavedPercent: Math.round(((demoPrice - currentStep.price) / demoPrice) * 1000) / 10,
        sellerSurplus: currentStep.price - sellerMin,
        totalRounds: SWITCH_SCENARIO_STEPS.length,
        totalActions: SWITCH_SCENARIO_STEPS.length,
        humanMessagesCount: 0,
        completedAt: new Date().toISOString(),
      }
    : undefined;

  const next: NegotiationSession = {
    ...session,
    listing,
    offers,
    currentTurn: currentStep.role === 'buyer_agent' ? 'seller' : 'buyer',
    currentOfferPrice: currentStep.price,
    status: isDeal ? 'deal' : currentStep.action === 'wait' ? 'waiting' : 'active',
    waitingUntilHours: currentStep.waitHours,
    waitingUntilAt: currentStep.waitHours
      ? new Date(Date.now() + currentStep.waitHours * 60 * 60 * 1000).toISOString()
      : undefined,
    dealSummary,
    simulationStep: stepIndex,
  };

  const committed = commitSession(next, session.version ?? 0);
  return {
    session: toPublicSession(committed),
    currentStepIndex: stepIndex,
    isCompleted: isDeal,
    hasNextStep: stepIndex < SWITCH_SCENARIO_STEPS.length - 1,
  };
}
