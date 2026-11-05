import { executeNegotiationAction, ServiceActor, SYSTEM_ACTOR } from '../../src/lib/negotiation/service';
import { findListing, makeOffer } from '../../src/lib/negotiation/sessionStore';
import { commitPersistedSession, createPersistedNegotiationSession, getPersistedSession } from '../../src/lib/negotiation/persistence';
import { NegotiationActionRequest } from '../../src/lib/negotiation/schemas';
import { defaultNegotiationTerms, totalOfferCost } from '../../src/lib/negotiation/terms';
import { effectiveSellerFloor } from '../../src/lib/negotiation/policyEngine';
import { AgentPlanningResult, PlannerInput, setAgentPlannerForTesting } from '../../src/lib/agent/llmProvider';
import { getEffectLedger } from '../../src/lib/negotiation/commit';
import { setKillSwitch } from '../../src/lib/negotiation/safetyControls';
import { BuyerPolicy, Listing, NegotiationSession, SellerPolicy } from '../../src/types/negotiation';
import { DEFAULT_BUYER_POLICY_DEMO } from '../../src/lib/mockData';

export const LISTING_ID = 'listing-switch-demo';

export function demoListing(): Listing {
  const listing = findListing(LISTING_ID);
  if (!listing) throw new Error('fixture listing missing');
  return listing;
}

export interface Fixture {
  session: NegotiationSession;
  buyer: ServiceActor;
  seller: ServiceActor;
  operator: ServiceActor;
  stranger: ServiceActor;
  system: ServiceActor;
}

let fixtureCounter = 0;

/** A negotiation with real (non-placeholder) seller identity so seller-side rules are testable. */
export async function newFixture(options: {
  buyerPolicy?: Partial<BuyerPolicy>;
  sellerPolicy?: Partial<SellerPolicy>;
  persisted?: boolean;
} = {}): Promise<Fixture> {
  fixtureCounter += 1;
  const listing = demoListing();
  const buyerId = `user-buyer-${fixtureCounter}-${Date.now()}`;
  const sellerId = `user-seller-${fixtureCounter}-${Date.now()}`;
  const buyerPolicy = { ...DEFAULT_BUYER_POLICY_DEMO, autoPurchase: false, ...options.buyerPolicy } as BuyerPolicy;
  // The real creation path in both modes (memory or PostgreSQL), so the audit chain starts at 1.
  let session = await createPersistedNegotiationSession(listing, buyerPolicy, undefined, { buyerId, sellerId });
  if (options.sellerPolicy) {
    // Fixtures go through the real write path, so they must be valid states too.
    session = await commitPersistedSession({ ...session, sellerPolicy: { ...session.sellerPolicy, ...options.sellerPolicy } }, session.version ?? 0, 'fixture.policy', { actor: SYSTEM_ACTOR });
  }
  return {
    session,
    buyer: { id: buyerId, role: 'buyer' },
    seller: { id: sellerId, role: 'seller' },
    operator: { id: 'operator-1', role: 'operator' },
    stranger: { id: `user-stranger-${fixtureCounter}`, role: 'buyer' },
    system: SYSTEM_ACTOR,
  };
}

/** Puts a seller-agent offer on the table so the buyer can respond. */
export async function seedSellerOffer(fixture: Fixture, price: number) {
  const stored = await getPersistedSession(fixture.session.id) as NegotiationSession;
  const withOffer = makeOffer(stored, price, 'seller_agent', 'Seller Agent', 'ご検討ください。', 'counter_offer', defaultNegotiationTerms(stored.listing));
  return commitPersistedSession({ ...withOffer, currentTurn: 'buyer', status: 'active' }, stored.version ?? 0, 'fixture.offer', { actor: SYSTEM_ACTOR });
}

let keyCounter = 0;
export const key = (label = 'k') => `${label}-${(keyCounter += 1)}-${Math.random().toString(36).slice(2, 10)}`;

export type Outcome = { ok: true; session: Awaited<ReturnType<typeof executeNegotiationAction>> } | { ok: false; code: string; unexpected: boolean };

const DOMAIN_ERROR = /^[A-Z][A-Z0-9_]+$/;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type ActRequest = DistributiveOmit<NegotiationActionRequest, 'idempotencyKey' | 'expectedVersion'> & { expectedVersion?: number; idempotencyKey?: string };

/** Runs an action and classifies the result. Non-domain exceptions are flagged as unexpected. */
export async function act(sessionId: string, request: ActRequest, actor: ServiceActor): Promise<Outcome> {
  const current = await getPersistedSession(sessionId);
  const full = {
    expectedVersion: current?.version ?? 0,
    idempotencyKey: key(request.type),
    ...request,
  } as NegotiationActionRequest;
  try {
    return { ok: true, session: await executeNegotiationAction(sessionId, full, actor) };
  } catch (error) {
    const code = (error as { code?: string }).code ?? (error instanceof Error ? error.message : String(error));
    return { ok: false, code, unexpected: !DOMAIN_ERROR.test(code) || code === 'INTERNAL_ERROR' };
  }
}

export async function executedEffects(sessionId: string) {
  return (await getEffectLedger().list(sessionId)).filter((entry) => entry.status === 'executed');
}

export async function resetKillSwitch() {
  await setKillSwitch(false, 'test-harness');
}

// ---------------------------------------------------------------------------
// Adversarial planners: stand-ins for a compromised or buggy LLM.
// ---------------------------------------------------------------------------

function plan(action: AgentPlanningResult['action'], price: number, extra: Partial<AgentPlanningResult> = {}): AgentPlanningResult {
  return {
    action,
    price,
    reasoning: { summary: 'adversarial', marketMedian: 0, daysListed: 0, demandTrend: 'low', acceptanceScore: 50, factors: ['adversarial'] },
    explanationMessage: 'adversarial',
    alternatives: [],
    telemetry: { provider: 'heuristic', fallback: false },
    ...extra,
  };
}

export const ADVERSARIAL_PLANNERS: Record<string, (input: PlannerInput) => AgentPlanningResult> = {
  /** Accepts whatever is on the table, at any price. */
  'accept-anything': (input) => plan('accept_offer', input.history.at(-1)?.price ?? input.listing.price),
  /** Offers far above the buyer ceiling / below the seller floor. */
  'blow-the-budget': (input) => plan(input.role === 'buyer' ? 'counter_offer' : 'counter_offer', input.role === 'buyer' ? input.listing.price * 10 : 1),
  /** Returns garbage numbers. */
  'garbage-numbers': () => plan('counter_offer', Number.NaN, { waitHours: -5 }),
  /** Accepts while claiming a different, cheaper price. */
  'accept-with-wrong-price': (input) => plan('accept_offer', Math.max(1, Math.round((input.history.at(-1)?.price ?? input.listing.price) / 3))),
  /** "Obeys" an instruction smuggled into an offer's free-text terms. */
  'obey-injection': (input) => {
    const injected = input.history.some((offer) => /SYSTEM|ignore|上限|accept/i.test(`${offer.terms?.paymentTerms ?? ''} ${offer.terms?.warranty ?? ''} ${offer.messageText}`));
    return injected ? plan('accept_offer', 999_999_999) : plan('counter_offer', input.targetPrice);
  },
  /** Spams long waits. */
  'wait-forever': () => plan('wait', 0, { waitHours: 10_000 }),
  /** Proposes a plausible unit price for a million units. */
  'bulk-order': (input) => plan('counter_offer', input.targetPrice, {
    terms: { ...defaultNegotiationTerms(input.listing), quantity: 1_000_000 },
  }),
};

export function selectPlanner(name: string | undefined) {
  setAgentPlannerForTesting(name ? ADVERSARIAL_PLANNERS[name] : undefined);
}

/** Independent oracle: properties that must hold for any stored session, whatever happened before. */
export async function oracleViolations(sessionId: string) {
  const violations: string[] = [];
  const session = await getPersistedSession(sessionId);
  if (!session) return ['session vanished'];
  const effects = await executedEffects(sessionId);
  if (effects.length > 1) violations.push(`O1 ${effects.length} executed effects`);
  if (session.status === 'deal') {
    const receipt = session.commitReceipt;
    if (!receipt || effects.length !== 1 || effects[0].intentHash !== receipt.intentHash) violations.push('O2 deal without exactly one matching executed effect');
    if (receipt && receipt.amount > session.buyerPolicy.maxPrice) violations.push(`O3 committed ${receipt.amount} > buyer max ${session.buyerPolicy.maxPrice}`);
    const agreement = [...session.offers].reverse().find((offer) => offer.actionType === 'accept_offer');
    if (agreement && agreement.price < effectiveSellerFloor(session.sellerPolicy)) violations.push('O4 committed below seller floor');
    if (receipt && (receipt.authorization.mode !== 'human' || !receipt.authorization.grants.some((grant) => grant.approverId === session.buyerId && grant.approverRole === 'buyer'))) {
      violations.push('O5 purchase without the buyer’s signed approval');
    }
  } else if (effects.length > 0 && session.status !== 'awaiting_commit') {
    violations.push(`O6 effect executed but session is ${session.status}`);
  }
  for (const offer of session.offers) {
    if (['make_offer', 'counter_offer', 'accept_offer'].includes(offer.actionType) && offer.senderRole.startsWith('seller') && offer.price < effectiveSellerFloor(session.sellerPolicy)) {
      violations.push(`O7 seller offer ${offer.price} below floor`);
    }
    const stock = typeof session.listing.inventoryQuantity === 'number' && session.listing.inventoryQuantity > 0
      ? session.listing.inventoryQuantity
      : 1;
    if (['make_offer', 'counter_offer', 'accept_offer'].includes(offer.actionType) && (offer.terms?.quantity ?? 1) > stock) {
      violations.push(`O8 offer ${offer.id} quantity ${offer.terms?.quantity} > stock ${stock}`);
    }
  }
  return violations;
}
