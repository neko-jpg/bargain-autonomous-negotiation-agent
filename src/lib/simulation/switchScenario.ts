import { DealSummary, Listing, NegotiationOffer, NegotiationSession } from '@/types/negotiation';
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
  reasonSummary: string;
  factors: string[];
  message: string;
};

const yen = (value: number) => `¥${Math.round(value).toLocaleString('ja-JP')}`;
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
    reasonSummary: '商品相場と出品経過日数を分析し、目標価格に近い初回提示を行います。',
    factors: [`出品価格 ${yen(demoPrice)} に対する初期打診`, `目標価格 ${yen(buyerTarget)} に近い`, `市場中央値 ${yen(demoListing.marketMedianPrice)} を参照`],
    message: `状態を確認しました。${yen(firstOffer)}でお譲りいただけますか？`,
  },
  {
    role: 'seller_agent',
    name: `${demoListing.sellerName} (Seller Agent)`,
    price: sellerCounter,
    action: 'counter_offer',
    reasonSummary: '商品の状態と市場価格を守りながら、販売成立に向けてカウンター提示します。',
    factors: [`最低販売価格 ${yen(sellerMin)} を確保`, `出品価格からの譲歩 ${yen(demoPrice - sellerCounter)}`, '商品の状態・付属品情報を評価'],
    message: `状態と相場を踏まえ、${yen(sellerCounter)}まででしたら対応可能です。`,
  },
  {
    role: 'buyer_agent',
    name: 'BARGAIN Buyer Agent',
    price: firstOffer,
    action: 'wait',
    waitHours: 24,
    marketStateChange: { daysListed: demoListing.daysListed + 8, recentDemand: 'low', viewsCount: demoListing.viewsCount + 72 },
    reasonSummary: '需要の変化を観測し、上限価格を温存しながら売り手の再評価を待ちます。',
    factors: ['24時間の市場観測', '需要トレンドが落ち着いた', `上限価格 ${yen(buyerMax)} を温存`],
    message: '市場の変化を確認するため、24時間待機して再評価します。',
  },
  {
    role: 'seller_agent',
    name: `${demoListing.sellerName} (Seller Agent)`,
    price: sellerReoffer,
    action: 'counter_offer',
    reasonSummary: '出品期間の長期化と需要低下を検知し、自発的に条件を見直します。',
    factors: [`最低価格 ${yen(sellerMin)} より ${yen(sellerReoffer - sellerMin)} 上`, '需要低下を検知', '購入意思を維持するための再提示'],
    message: `お待たせしました。条件を見直し、${yen(sellerReoffer)}までお下げします。`,
  },
  {
    role: 'buyer_agent',
    name: 'BARGAIN Buyer Agent',
    price: finalOffer,
    action: 'counter_offer',
    reasonSummary: '売り手の譲歩を受け、上限未満で成立するクロージング価格を提示します。',
    factors: [`上限価格 ${yen(buyerMax)} 未満`, `売り手最低価格 ${yen(sellerMin)} 超`, '即時決済条件を提示'],
    message: `ご配慮ありがとうございます。${yen(finalOffer)}でしたら今すぐ決済します。`,
  },
  {
    role: 'seller_agent',
    name: `${demoListing.sellerName} (Seller Agent)`,
    price: finalOffer,
    action: 'accept_offer',
    reasonSummary: '提示価格が最低許容価格を上回り、双方の条件がガードレール内で一致しました。',
    factors: [`最低販売価格 ${yen(sellerMin)} をクリア`, `売り手余剰 ${yen(finalOffer - sellerMin)}`, '安全な取引条件を確認'],
    message: `ありがとうございます。${yen(finalOffer)}でお取引させていただきます。`,
  },
];

export function startSwitchDemo() {
  return toPublicSession(createSwitchDemoSession());
}

export function advanceSwitchDemo(sessionId: string, stepIndex: number) {
  const session = getSession(sessionId);
  if (!session) throw new Error('SESSION_NOT_FOUND');
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
        summary: step.reasonSummary,
        marketMedian: listing.marketMedianPrice,
        daysListed: listing.daysListed,
        demandTrend: listing.recentDemand,
        acceptanceScore: step.action === 'accept_offer' ? 100 : Math.min(96, 60 + index * 6),
        factors: [...step.factors],
      },
      messageText: step.message,
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
