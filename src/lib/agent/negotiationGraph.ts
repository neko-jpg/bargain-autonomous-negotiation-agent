import { StateGraph, Annotation, END, START } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { randomUUID } from 'node:crypto';
import {
  NegotiationSession,
  NegotiationOffer,
  NegotiationGraphState,
  Listing,
  AgentActionType,
  ActionReasoning,
  GraphAssessment,
  NegotiationTerms,
  AgentAlternative,
} from '@/types/negotiation';
import { MarketSimulator } from '@/lib/engine/marketSimulator';
import { NegotiationGuardrails } from '@/lib/engine/guardrails';
import { LLMProviderService } from '@/lib/agent/llmProvider';
import { defaultNegotiationTerms } from '@/lib/negotiation/terms';
import { effectiveSellerFloor, sanitizeOfferByPolicy } from '@/lib/negotiation/policyEngine';
import { scoreAgentAlternatives } from '@/lib/agent/strategyScorer';
import { updateNegotiationMemory } from '@/lib/agent/memory';
import { recordAgentRun } from '@/lib/analytics/analyticsStore';

// LangGraph Annotation Definition
export const NegotiationGraphAnnotation = Annotation.Root({
  session: Annotation<NegotiationSession>(),
  currentRole: Annotation<'buyer' | 'seller'>(),
  currentListing: Annotation<Listing>(),
  visibleOffers: Annotation<NegotiationOffer[]>({
    reducer: (curr, update) => update ?? curr,
    default: () => [],
  }),
  privateReservationPrice: Annotation<number>(),
  privateFlexibility: Annotation<number>(),
  latestAssessment: Annotation<GraphAssessment | undefined>({
    reducer: (curr, update) => update ?? curr,
  }),
  plannedAction: Annotation<AgentActionType | undefined>({
    reducer: (curr, update) => update ?? curr,
  }),
  plannedPrice: Annotation<number | undefined>({
    reducer: (curr, update) => update ?? curr,
  }),
  plannedWaitHours: Annotation<number | undefined>({
    reducer: (curr, update) => update ?? curr,
  }),
  plannedTerms: Annotation<NegotiationTerms | undefined>({
    reducer: (curr, update) => update ?? curr,
  }),
  plannedAlternatives: Annotation<AgentAlternative[] | undefined>({
    reducer: (curr, update) => update ?? curr,
  }),
  reasoningDetails: Annotation<ActionReasoning | undefined>({
    reducer: (curr, update) => update ?? curr,
  }),
  explanationMessage: Annotation<string | undefined>({
    reducer: (curr, update) => update ?? curr,
  }),
  guardrailCorrection: Annotation<string | undefined>({
    reducer: (curr, update) => update ?? curr,
  }),
  requiresHumanApproval: Annotation<boolean>({
    reducer: (curr, update) => (update !== undefined ? update : curr),
    default: () => false,
  }),
  approvalReason: Annotation<string | undefined>({
    reducer: (curr, update) => update ?? curr,
  }),
  isDeal: Annotation<boolean>({
    reducer: (curr, update) => (update !== undefined ? update : curr),
    default: () => false,
  }),
  isTerminated: Annotation<boolean>({
    reducer: (curr, update) => (update !== undefined ? update : curr),
    default: () => false,
  }),
  error: Annotation<string | undefined>({
    reducer: (curr, update) => update ?? curr,
  }),
});

/**
 * 1. Observe Node: 環境と市場データ、相手の提示履歴を観測
 */
const observeNode = async (state: typeof NegotiationGraphAnnotation.State) => {
  const { session, currentRole } = state;
  const listing = session.listing;

  // 相手の提示履歴（サニタイズ済み）を抽出
  const visibleOffers = NegotiationGuardrails.filterPublicStateForOpponent(session.offers);

  return {
    currentListing: listing,
    visibleOffers,
  };
};

/**
 * 2. Assess Node: BATNA・成約確率・リスク評価
 */
const assessNode = async (state: typeof NegotiationGraphAnnotation.State) => {
  const { currentListing, currentRole, privateReservationPrice, visibleOffers, session } = state;

  const lastOffer = visibleOffers.length > 0 ? visibleOffers[visibleOffers.length - 1] : null;
  const referencePrice = lastOffer ? lastOffer.price : currentListing.price;

  const winProb = MarketSimulator.estimateWinProbability(
    referencePrice,
    currentListing.marketMedianPrice,
    currentListing.daysListed,
    currentListing.recentDemand,
    currentRole
  );

  const batna = MarketSimulator.calculateBATNA(
    currentListing,
    currentRole,
    privateReservationPrice
  );

  const assessment: GraphAssessment = {
    estimatedMarketPrice: currentListing.marketMedianPrice,
    winProbability: winProb,
    riskOfLoss: currentListing.recentDemand === 'high' ? 65 : 20,
    batna,
    recommendation: currentRole === 'buyer' ? 'counter_offer' : 'counter_offer',
    recommendedPrice: referencePrice,
    factors: [
      `相場中央値: ¥${currentListing.marketMedianPrice.toLocaleString()}`,
      `出品経過: ${currentListing.daysListed}日 (閲覧数: ${currentListing.viewsCount})`,
      `成約予測確率: ${winProb}%`,
    ],
  };

  return {
    latestAssessment: assessment,
  };
};

/**
 * 3. Plan Node: LLMまたは自律戦略エンジンによる意思決定
 */
const planNode = async (state: typeof NegotiationGraphAnnotation.State) => {
  const { session, currentRole, currentListing, privateReservationPrice, visibleOffers, latestAssessment } = state;

  const targetPrice = currentRole === 'buyer' ? session.buyerPolicy.targetPrice : session.sellerPolicy.targetPrice;
  const urgency = currentRole === 'seller' ? session.sellerPolicy.urgency : 'medium';
  const winProb = latestAssessment?.winProbability ?? 50;
  const batna = latestAssessment?.batna ?? currentListing.marketMedianPrice;

  const startedAt = Date.now();
  const planResult = await LLMProviderService.planNextAction(
    currentRole,
    currentListing,
    targetPrice,
    privateReservationPrice,
    urgency,
    visibleOffers,
    winProb,
    batna,
    visibleOffers.at(-1)?.terms ?? (currentRole === 'buyer'
      ? session.buyerPrivateState.preferredTerms
      : session.sellerPrivateState.preferredTerms)
  );

  const policy = currentRole === 'buyer' ? session.buyerPolicy : session.sellerPolicy;
  const alternatives = planResult.alternatives.length > 0
    ? planResult.alternatives
    : [{
        action: planResult.action,
        price: planResult.price,
        terms: planResult.terms,
        rationale: planResult.reasoning.summary,
        confidence: 0.5,
        risks: [],
      }];
  const scored = scoreAgentAlternatives(currentRole, currentListing, policy, visibleOffers, alternatives);
  const selected = scored.candidates[scored.selectedIndex] ?? scored.candidates[0];
  const selectedAction = selected?.action ?? planResult.action;
  const selectedPrice = selected?.price ?? planResult.price;
  const selectedTerms = selected?.terms ?? planResult.terms ?? defaultNegotiationTerms(currentListing);
  const selectedReasoning = selected && selected.rationale !== planResult.reasoning.summary
    ? { ...planResult.reasoning, summary: selected.rationale }
    : planResult.reasoning;

  recordAgentRun({
    negotiationId: session.id,
    provider: planResult.telemetry.provider,
    model: planResult.telemetry.model,
    latencyMs: Date.now() - startedAt,
    fallback: planResult.telemetry.fallback,
    candidateCount: scored.candidates.length,
    selectedCandidate: scored.selectedIndex,
    guardrailCorrections: scored.candidates.filter((candidate) => !candidate.isValid).length,
  });

  return {
    plannedAction: selectedAction,
    plannedPrice: selectedPrice,
    plannedWaitHours: planResult.waitHours,
    plannedTerms: selectedTerms,
    plannedAlternatives: scored.candidates,
    reasoningDetails: selectedReasoning,
    explanationMessage: planResult.explanationMessage,
  };
};

/**
 * 4. Guardrail Node: Private State遵守・金額制約の検証と補正
 */
const guardrailNode = async (state: typeof NegotiationGraphAnnotation.State) => {
  const {
    currentRole,
    plannedAction,
    plannedPrice,
    privateReservationPrice,
    session,
    visibleOffers,
    currentListing,
    plannedWaitHours,
    plannedTerms,
  } = state;

  if (!plannedAction || plannedPrice === undefined) {
    return { error: 'Invalid planning output' };
  }

  const targetPrice = currentRole === 'buyer' ? session.buyerPolicy.targetPrice : session.sellerPolicy.targetPrice;

  const sanitized = NegotiationGuardrails.validateAndSanitize(
    currentRole,
    plannedAction,
    plannedPrice,
    privateReservationPrice,
    targetPrice,
    visibleOffers,
    currentListing.price,
    plannedWaitHours
  );

  const policy = currentRole === 'buyer' ? session.buyerPolicy : session.sellerPolicy;
  const lastOpponentOffer = [...visibleOffers]
    .reverse()
    .find((offer) => (currentRole === 'buyer' ? offer.senderRole.includes('seller') : offer.senderRole.includes('buyer')));
  const policyDecision = sanitizeOfferByPolicy(
    currentRole,
    currentListing,
    policy,
    sanitized.sanitizedPrice,
    sanitized.sanitizedAction === 'accept_offer' ? lastOpponentOffer?.terms ?? plannedTerms : plannedTerms,
    sanitized.sanitizedAction
  );
  let finalAction = sanitized.sanitizedAction;
  let correctionReason = [sanitized.correctionReason, policyDecision.correctionReason].filter(Boolean).join(' ') || undefined;
  let requiresHumanApproval = policyDecision.requiresHumanApproval;
  let approvalReason = policyDecision.approvalReason;

  if (sanitized.sanitizedAction === 'accept_offer' && policyDecision.requiresHumanApproval) {
    finalAction = 'ask_user';
    correctionReason = [correctionReason, policyDecision.approvalReason].filter(Boolean).join(' ') || undefined;
  }

  return {
    plannedAction: finalAction,
    plannedPrice: policyDecision.price,
    plannedWaitHours: sanitized.sanitizedWaitHours,
    plannedTerms: policyDecision.terms,
    guardrailCorrection: correctionReason,
    requiresHumanApproval,
    approvalReason,
  };
};

/**
 * 5. Act Node: オファー確定・履歴更新・DEAL判定
 */
const actNode = async (state: typeof NegotiationGraphAnnotation.State) => {
  const {
    session,
    currentRole,
    plannedAction,
    plannedPrice,
    plannedWaitHours,
    reasoningDetails,
    explanationMessage,
    plannedTerms,
    guardrailCorrection,
    requiresHumanApproval,
    approvalReason,
    plannedAlternatives,
  } = state;

  const action = plannedAction || 'counter_offer';
  const price = plannedPrice ?? session.listing.price;
  const round = session.offers.length + 1;
  const senderRole = currentRole === 'buyer' ? 'buyer_agent' : 'seller_agent';
  const senderName = currentRole === 'buyer' ? 'BARGAIN Buyer Agent' : `${session.listing.sellerName} (Seller Agent)`;

  const newOffer: NegotiationOffer = {
    id: `offer-${randomUUID()}-${round}`,
    round,
    timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
    senderRole,
    senderName,
    price,
    terms: plannedTerms,
    actionType: action,
    reasoning: reasoningDetails,
    decision: {
      guardrailCorrection,
      requiresHumanApproval,
      approvalReason,
      candidateCount: plannedAlternatives?.length,
      selectedCandidate: plannedAlternatives?.findIndex((candidate) => (candidate.action === action || (action === 'ask_user' && candidate.action === 'accept_offer')) && candidate.price === price),
    },
    alternatives: plannedAlternatives,
    waitTimeHours: plannedWaitHours,
    messageText: explanationMessage || `¥${price.toLocaleString()}を提示しました。`,
  };

  const updatedOffers = [...session.offers, newOffer];
  let isDeal = false;
  let isTerminated = false;
  let updatedStatus = session.status;
  let dealSummary = session.dealSummary;

  if (action === 'accept_offer') {
    isDeal = true;
    updatedStatus = 'deal';

    const initialPrice = session.listing.price;
    const buyerSaved = initialPrice - price;
    const sellerSurplus = price - effectiveSellerFloor(session.sellerPolicy);

    dealSummary = {
      agreedPrice: price,
      initialPrice,
      buyerSaved: Math.max(0, buyerSaved),
      buyerSavedPercent: Math.round((Math.max(0, buyerSaved) / initialPrice) * 1000) / 10,
      sellerSurplus: Math.max(0, sellerSurplus),
      totalRounds: round,
      totalActions: updatedOffers.length,
      humanMessagesCount: updatedOffers.filter((o) => o.senderRole.includes('human')).length,
      completedAt: new Date().toISOString(),
    };
  } else if (action === 'reject_offer') {
    isTerminated = true;
    updatedStatus = 'rejected';
  } else if (action === 'wait') {
    updatedStatus = 'waiting';
  } else if (action === 'ask_user') {
    updatedStatus = 'paused_for_human';
  } else {
    updatedStatus = 'active';
  }

  const nextTurn = action === 'ask_user'
    ? currentRole
    : currentRole === 'buyer' ? 'seller' : 'buyer';

  const updatedSession: NegotiationSession = {
    ...session,
    offers: updatedOffers,
    currentOfferPrice: price,
    currentTurn: isDeal || isTerminated ? session.currentTurn : nextTurn,
    status: updatedStatus,
    agentMemory: updateNegotiationMemory({ ...session, offers: updatedOffers }, newOffer),
    waitingUntilHours: action === 'wait' ? plannedWaitHours : undefined,
    waitingUntilAt: action === 'wait' && plannedWaitHours
      ? new Date(Date.now() + plannedWaitHours * 60 * 60 * 1000).toISOString()
      : undefined,
    dealSummary,
    updatedAt: new Date().toISOString(),
  };

  return {
    session: updatedSession,
    isDeal,
    isTerminated,
  };
};

/**
 * LangGraph StateGraph の構築
 */
let compiledGraph: ReturnType<typeof StateGraph.prototype.compile> | undefined;
const checkpointer = new MemorySaver();

export const buildNegotiationGraph = () => {
  if (compiledGraph) return compiledGraph;

  const workflow = new StateGraph(NegotiationGraphAnnotation)
    .addNode('observe', observeNode)
    .addNode('assess', assessNode)
    .addNode('plan', planNode)
    .addNode('guardrail', guardrailNode)
    .addNode('act', actNode)
    .addEdge(START, 'observe')
    .addEdge('observe', 'assess')
    .addEdge('assess', 'plan')
    .addEdge('plan', 'guardrail')
    .addEdge('guardrail', 'act')
    .addEdge('act', END);

  compiledGraph = workflow.compile({ checkpointer });
  return compiledGraph;
};

/**
 * 1ターン実行するヘルパー関数
 */
export const runNegotiationStep = async (
  session: NegotiationSession,
  overrideRole?: 'buyer' | 'seller',
  options?: { threadId?: string }
): Promise<NegotiationSession> => {
  const currentRole = overrideRole || session.currentTurn;
  const privateReservationPrice =
    currentRole === 'buyer'
      ? session.buyerPrivateState.reservationPrice
      : session.sellerPrivateState.reservationPrice;

  const app = buildNegotiationGraph();

  const initialState = {
    session,
    currentRole,
    currentListing: session.listing,
    visibleOffers: session.offers,
    privateReservationPrice,
    privateFlexibility: currentRole === 'buyer' ? session.buyerPrivateState.patienceScore : session.sellerPrivateState.patienceScore,
    isDeal: session.status === 'deal',
    isTerminated: session.status === 'rejected',
  };

  const result = await app.invoke(initialState, {
    configurable: {
      thread_id: options?.threadId ?? session.threadId ?? session.id,
    },
  });
  return result.session;
};
