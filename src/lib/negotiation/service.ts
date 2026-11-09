import { createHash, randomUUID } from 'node:crypto';
import { MarketSimulator } from '@/lib/engine/marketSimulator';
import { runNegotiationStep } from '@/lib/agent/negotiationGraph';
import {
  makeOffer,
  hashOffer,
  toPublicSession,
  toViewerSession,
  withSessionLock,
} from '@/lib/negotiation/sessionStore';
import { NegotiationActionRequest } from '@/lib/negotiation/schemas';
import { NegotiationOffer, NegotiationSession, PublicNegotiationSession } from '@/types/negotiation';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/config';
import { translate, type TranslationKey } from '@/lib/i18n/dictionary';
import { effectiveSellerFloor, isOfferStillBinding, sanitizeOfferByPolicy } from '@/lib/negotiation/policyEngine';
import {
  commitPersistedSession,
  getPersistedIdempotentAction,
  getPersistedSession,
} from '@/lib/negotiation/persistence';
import { syncCommitApprovalTasks } from '@/lib/negotiation/workflowStore';
import { ActorContext } from '@/lib/auth/actor';
import { buildPublicOfferMessage, buildPublicOfferMessageTemplate } from '@/lib/negotiation/messages';
import { executeIrreversibleEffect, reconcileEffect, SafetyError } from '@/lib/safety/commitGate';
import {
  beginPurchaseCommit,
  gateDependencies,
  grantPurchaseApproval,
  missingApprovals,
  requiredApproverFor,
} from '@/lib/negotiation/commit';
import { isKillSwitchEngaged } from '@/lib/negotiation/safetyControls';

export class NegotiationServiceError extends Error {
  constructor(
    public readonly code: string
  ) {
    super(code);
  }
}

/** In-process callers (evaluation harness, scheduled jobs) act as `system`. */
export type ServiceActor = ActorContext | { id: string; role: 'system' };
export const SYSTEM_ACTOR: ServiceActor = { id: 'system', role: 'system' };

type PartyActor = ActorContext & { role: 'buyer' | 'seller' };
type ActionType = NegotiationActionRequest['type'];

function isParty(actor: ServiceActor): actor is PartyActor {
  return actor.role === 'buyer' || actor.role === 'seller';
}

function ownsSession(session: NegotiationSession, actor: PartyActor) {
  return actor.role === 'buyer' ? session.buyerId === actor.id : session.sellerId === actor.id;
}

async function loadAuthorizedSession(sessionId: string, actor: ServiceActor) {
  const session = await getPersistedSession(sessionId);
  if (!session) throw new NegotiationServiceError('SESSION_NOT_FOUND');
  if (session.scriptedDemo) throw new NegotiationServiceError('SCRIPTED_DEMO_READ_ONLY');
  if (isParty(actor) && !ownsSession(session, actor)) throw new NegotiationServiceError('SESSION_FORBIDDEN');
  return session;
}

/**
 * Who may perform which action.
 *  - `turn_party`: only the authenticated party whose turn it is (never on the
 *    other side's behalf, never an operator).
 *  - Operators and the system can halt (pause/stop/reject a commit) but can
 *    never author offers or approve spending.
 */
type ActorRule = 'party' | 'turn_party' | 'buyer' | 'operator' | 'system';
const ACTOR_RULES: Record<ActionType, ActorRule[]> = {
  auto_step: ['party', 'operator', 'system'],
  time_skip: ['party', 'operator', 'system'],
  human_offer: ['turn_party'],
  human_accept: ['turn_party'],
  human_reject: ['party', 'operator'],
  pause: ['party', 'operator', 'system'],
  resume: ['party', 'operator', 'system'],
  stop: ['party', 'operator', 'system'],
  update_policy: ['buyer'],
  approve_commit: ['party'],
  reject_commit: ['party', 'operator'],
  retry_commit: ['party', 'operator', 'system'],
  // Verifying an ambiguous payment out of band is an operations duty. It never
  // runs the effect, and a party must not be able to declare their own outcome.
  reconcile_commit: ['operator'],
};

function assertActorAllowed(session: NegotiationSession, type: ActionType, actor: ServiceActor) {
  const rules = ACTOR_RULES[type];
  if (isParty(actor)) {
    if (rules.includes('party')) return;
    if (rules.includes('turn_party')) {
      if (actor.role !== session.currentTurn) throw new NegotiationServiceError('NOT_YOUR_TURN');
      return;
    }
    if (rules.includes('buyer') && actor.role === 'buyer') return;
    throw new NegotiationServiceError('ACTION_FORBIDDEN_FOR_ROLE');
  }
  if (!rules.includes(actor.role as ActorRule)) throw new NegotiationServiceError('ACTION_FORBIDDEN_FOR_ROLE');
}

const terminalStatuses = new Set<NegotiationSession['status']>(['deal', 'rejected']);
/** A negotiation that never converges is a control problem even when every step is legal. */
const MAX_NEGOTIATION_ROUNDS = 40;
const STATUS_RULES: Record<ActionType, NegotiationSession['status'][]> = {
  auto_step: ['active'],
  time_skip: ['waiting'],
  human_offer: ['active', 'paused_for_human'],
  human_accept: ['active', 'paused_for_human'],
  human_reject: ['active', 'waiting', 'paused_for_human', 'awaiting_commit'],
  pause: ['active', 'waiting'],
  resume: ['paused_for_human'],
  stop: ['initializing', 'active', 'waiting', 'paused_for_human', 'awaiting_commit'],
  update_policy: ['initializing', 'active', 'waiting', 'paused_for_human'],
  approve_commit: ['awaiting_commit'],
  reject_commit: ['awaiting_commit'],
  retry_commit: ['awaiting_commit'],
  reconcile_commit: ['awaiting_commit'],
};
/** Bound to an intent hash instead of the session version. */
const COMMIT_BOUND = new Set<ActionType>(['approve_commit', 'reject_commit', 'retry_commit', 'reconcile_commit']);

function assertActionAllowed(session: NegotiationSession, type: ActionType) {
  if (terminalStatuses.has(session.status)) throw new NegotiationServiceError('SESSION_ALREADY_FINISHED');
  if (!STATUS_RULES[type].includes(session.status)) {
    throw new NegotiationServiceError(`SESSION_NOT_${type.toUpperCase()}`);
  }
}

function assertVersion(session: NegotiationSession, expectedVersion: number) {
  if ((session.version ?? 0) !== expectedVersion) {
    throw new NegotiationServiceError('SESSION_VERSION_CONFLICT');
  }
}

function makeDealSummary(session: NegotiationSession, agreedPrice: number) {
  const initialPrice = session.listing.price;
  const buyerSaved = Math.max(0, initialPrice - agreedPrice);
  const sellerSurplus = Math.max(0, agreedPrice - effectiveSellerFloor(session.sellerPolicy));
  return {
    agreedPrice,
    initialPrice,
    buyerSaved,
    buyerSavedPercent: initialPrice > 0 ? Math.round((buyerSaved / initialPrice) * 1000) / 10 : 0,
    sellerSurplus,
    totalRounds: session.offers.filter((offer) => offer.actionType !== 'wait').length,
    totalActions: session.offers.length,
    humanMessagesCount: session.offers.filter((offer) => offer.senderRole.includes('human')).length,
    completedAt: new Date().toISOString(),
  };
}

function appendHumanAcceptance(session: NegotiationSession, target: NegotiationOffer, role: 'buyer' | 'seller'): NegotiationSession {
  const terms = target.terms ?? {
    quantity: 1,
    currency: 'JPY',
    taxIncluded: true,
    shippingCost: 0,
    deliveryDays: 3,
    paymentTerms: '即時決済',
    warranty: '商品説明に準拠',
    concessions: [],
  };
  const offer: NegotiationOffer = {
    id: `offer-human-${randomUUID()}`,
    version: 1,
    targetOfferId: target.id,
    targetOfferVersion: target.version ?? 1,
    round: session.offers.length + 1,
    timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
    senderRole: role === 'buyer' ? 'buyer_human' : 'seller_human',
    senderName: role === 'buyer' ? 'あなた（買い手）' : 'あなた（売り手）',
    senderKey: role === 'buyer' ? 'role.youBuyer' : 'role.youSeller',
    price: target.price,
    terms,
    actionType: 'accept_offer',
    messageText: buildPublicOfferMessage(role, 'accept_offer', target.price, terms),
    messageTemplate: buildPublicOfferMessageTemplate(role, 'accept_offer', target.price, terms),
  };
  offer.proposalHash = hashOffer(offer);
  return { ...session, offers: [...session.offers, offer], currentOfferPrice: target.price };
}

function requestHash(request: NegotiationActionRequest) {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

const PRICED_ACTIONS = new Set<NegotiationOffer['actionType']>(['make_offer', 'counter_offer']);

function assertAcceptableTarget(
  session: NegotiationSession,
  role: 'buyer' | 'seller',
  targetOfferId: string,
  targetOfferVersion?: number
) {
  const target = session.offers.find((offer) => offer.id === targetOfferId);
  if (!target) throw new NegotiationServiceError('TARGET_OFFER_NOT_FOUND');
  if (target.senderRole.startsWith(role)) throw new NegotiationServiceError('TARGET_OFFER_NOT_OPPONENT');
  if (!PRICED_ACTIONS.has(target.actionType)) throw new NegotiationServiceError('TARGET_OFFER_NOT_ACCEPTABLE');
  // Only the counterparty's latest live proposal can be accepted; a newer
  // proposal from either side supersedes it.
  const latestPriced = [...session.offers].reverse().find((offer) => PRICED_ACTIONS.has(offer.actionType));
  if (latestPriced?.id !== target.id) throw new NegotiationServiceError('TARGET_OFFER_SUPERSEDED');
  if (targetOfferVersion !== undefined && targetOfferVersion !== (target.version ?? 1)) throw new NegotiationServiceError('TARGET_OFFER_VERSION_CONFLICT');
  if (!isOfferStillBinding(session, target)) throw new NegotiationServiceError('TARGET_OFFER_WITHDRAWN');
  if (target.terms?.expiresAt) {
    const expiry = Date.parse(target.terms.expiresAt);
    if (Number.isFinite(expiry) && expiry <= Date.now()) throw new NegotiationServiceError('TARGET_OFFER_EXPIRED');
  }
  return target;
}

function viewFor(session: NegotiationSession, actor: ServiceActor): PublicNegotiationSession {
  return isParty(actor) ? toViewerSession(session, actor.id, actor.role) : toPublicSession(session);
}

function closePendingCommit(session: NegotiationSession, reason: 'rejected' | 'expired' | 'voided', by?: string): NegotiationSession {
  if (!session.pendingCommit) return session;
  return {
    ...session,
    pendingCommit: undefined,
    rejectedCommits: [
      ...(session.rejectedCommits ?? []),
      { intentHash: session.pendingCommit.intentHash, amount: session.pendingCommit.intent.amount, reason, by, at: new Date().toISOString() },
    ],
  };
}

/**
 * Runs the purchase through the Commit Gate once every required approval is
 * present. This is the only call site of executeIrreversibleEffect in the app.
 */
async function settlePendingCommit(session: NegotiationSession, actor: ServiceActor): Promise<NegotiationSession> {
  const pending = session.pendingCommit;
  if (session.status !== 'awaiting_commit' || !pending) return session;
  const commitActor = { id: actor.id, role: actor.role };
  if (Date.parse(pending.expiresAt) <= Date.now()) {
    return commitPersistedSession({ ...closePendingCommit(session, 'expired'), status: 'paused_for_human' }, session.version ?? 0, 'commit.expired', { actor: commitActor });
  }
  // Old persisted intents may have been policy-authorized before buyer approval
  // became mandatory. Never execute them under the obsolete requirement.
  if (pending.requirement.mode !== 'human' || !pending.requirement.approvers.some((approver) => approver.id === session.buyerId && approver.role === 'buyer')) {
    if (pending.blockedReason === 'COMMIT_REQUIRES_NEW_APPROVAL') return session;
    return commitPersistedSession({ ...session, pendingCommit: { ...pending, blockedReason: 'COMMIT_REQUIRES_NEW_APPROVAL' } }, session.version ?? 0, 'commit.blocked', { actor: commitActor });
  }
  if (missingApprovals(session).length > 0) return session;
  try {
    const { receipt } = await executeIrreversibleEffect(pending.intent, pending.requirement, pending.grants, gateDependencies());
    return await commitPersistedSession({
      ...session,
      status: 'deal',
      pendingCommit: undefined,
      commitReceipt: receipt,
      dealSummary: makeDealSummary(session, pending.intent.payload.price),
    }, session.version ?? 0, 'commit.executed', { actor: commitActor });
  } catch (error) {
    if (!(error instanceof SafetyError)) throw error;
    if (error.code === 'APPROVAL_REQUIRED' || pending.blockedReason === error.code) return session;
    return commitPersistedSession({ ...session, pendingCommit: { ...pending, blockedReason: error.code } }, session.version ?? 0, 'commit.blocked', { actor: commitActor });
  }
}

export async function executeNegotiationAction(
  sessionId: string,
  request: NegotiationActionRequest,
  actor: ServiceActor
) {
  return withSessionLock(sessionId, async () => {
    const current = await loadAuthorizedSession(sessionId, actor);
    const hash = requestHash(request);
    let storedResponse;
    try {
      storedResponse = await getPersistedIdempotentAction(sessionId, request.idempotencyKey, hash);
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSE') {
        throw new NegotiationServiceError('IDEMPOTENCY_KEY_REUSE');
      }
      throw error;
    }
    // A replay never re-executes; it returns the caller's view of the latest state.
    if (storedResponse) return viewFor(current, actor);

    assertActionAllowed(current, request.type);
    assertActorAllowed(current, request.type, actor);
    if (!COMMIT_BOUND.has(request.type)) assertVersion(current, request.expectedVersion);
    if (request.type === 'auto_step' && await isKillSwitchEngaged()) throw new NegotiationServiceError('KILL_SWITCH_ENGAGED');

    const commitActor = { id: actor.id, role: actor.role };
    let next = current;

    switch (request.type) {
      case 'auto_step': {
        // A session that never converges is a control problem even when every
        // single step is legal. Cap the agent rather than trusting it to stop.
        if (current.offers.length >= MAX_NEGOTIATION_ROUNDS) throw new NegotiationServiceError('ROUND_LIMIT_REACHED');
        next = await runNegotiationStep(current, undefined, { threadId: current.threadId });
        break;
      }
      case 'time_skip': {
        next = {
          ...current,
          listing: MarketSimulator.simulateTimePassed(current.listing, request.waitHours),
          status: 'active',
          waitingUntilHours: undefined,
          waitingUntilAt: undefined,
        };
        break;
      }
      case 'human_offer': {
        const role = (actor as PartyActor).role;
        const policy = role === 'buyer' ? current.buyerPolicy : current.sellerPolicy;
        const decision = sanitizeOfferByPolicy(role, current.listing, policy, request.offerPrice, request.terms, 'counter_offer');
        if (!Number.isInteger(request.offerPrice) || request.offerPrice <= 0 || decision.price !== request.offerPrice || decision.correctionReason) {
          throw new NegotiationServiceError('OFFER_OUT_OF_POLICY');
        }
        const requestedMessage = request.messageText?.trim();
        const humanAction = current.offers.length === 0 ? 'make_offer' as const : 'counter_offer' as const;
        next = {
          ...makeOffer(
            current,
            decision.price,
            role === 'buyer' ? 'buyer_human' : 'seller_human',
            role === 'buyer' ? 'あなた（買い手）' : 'あなた（売り手）',
            requestedMessage || buildPublicOfferMessage(role, humanAction, decision.price, decision.terms),
            humanAction,
            decision.terms,
            {
              senderKey: role === 'buyer' ? 'role.youBuyer' : 'role.youSeller',
              // Only generated text is re-rendered on locale switch; a message
              // typed by the human is shown exactly as written.
              messageTemplate: requestedMessage
                ? undefined
                : buildPublicOfferMessageTemplate(role, humanAction, decision.price, decision.terms),
            }
          ),
          status: 'active',
        };
        break;
      }
      case 'human_accept': {
        const role = (actor as PartyActor).role;
        const target = assertAcceptableTarget(current, role, request.targetOfferId, request.targetOfferVersion);
        const policy = role === 'buyer' ? current.buyerPolicy : current.sellerPolicy;
        const decision = sanitizeOfferByPolicy(role, current.listing, policy, target.price, target.terms, 'accept_offer');
        if (decision.price !== target.price || decision.correctionReason) {
          throw new NegotiationServiceError('OFFER_OUT_OF_POLICY');
        }
        const accepted = appendHumanAcceptance(current, target, role);
        next = beginPurchaseCommit(accepted, accepted.offers.at(-1) as NegotiationOffer);
        // The authenticated human accepted these exact terms; that act is
        // their signed approval for the resulting intent.
        if (requiredApproverFor(next, actor)) {
          next = grantPurchaseApproval(next, actor, next.pendingCommit?.intentHash ?? '');
        }
        break;
      }
      case 'human_reject':
      case 'stop': {
        next = {
          ...closePendingCommit(current, 'rejected', actor.id),
          status: 'rejected',
          waitingUntilAt: undefined,
          waitingUntilHours: undefined,
        };
        break;
      }
      case 'pause': {
        next = { ...current, status: 'paused_for_human' };
        break;
      }
      case 'resume': {
        next = { ...current, status: 'active' };
        break;
      }
      case 'update_policy': {
        const policy = request.buyerPolicy;
        next = {
          ...current,
          buyerPolicy: policy,
          buyerPrivateState: {
            ...current.buyerPrivateState,
            reservationPrice: policy.maxPrice,
            batna: Math.min(current.buyerPrivateState.batna, policy.maxPrice),
          },
        };
        break;
      }
      case 'approve_commit': {
        if (current.pendingCommit?.intentHash !== request.intentHash) throw new NegotiationServiceError('COMMIT_INTENT_MISMATCH');
        next = grantPurchaseApproval(current, actor, request.intentHash);
        break;
      }
      case 'reject_commit': {
        if (current.pendingCommit?.intentHash !== request.intentHash) throw new NegotiationServiceError('COMMIT_INTENT_MISMATCH');
        // Declining a purchase is not walking away: the negotiation pauses so
        // the human can counter, resume the agent, or stop.
        next = {
          ...closePendingCommit(current, 'rejected', actor.id),
          status: 'paused_for_human',
          currentTurn: isParty(actor) ? actor.role : current.currentTurn,
        };
        break;
      }
      case 'reconcile_commit': {
        const pending = current.pendingCommit;
        if (pending?.intentHash !== request.intentHash) throw new NegotiationServiceError('COMMIT_INTENT_MISMATCH');
        const { receipt } = await reconcileEffect(request.intentHash, {
          outcome: request.outcome,
          resolvedBy: actor.id,
          resolvedAt: new Date().toISOString(),
          note: request.note,
        }, { ledger: gateDependencies().ledger }, request.externalRef);
        next = receipt
          ? { ...current, status: 'deal', pendingCommit: undefined, commitReceipt: receipt, dealSummary: makeDealSummary(current, pending.intent.payload.price) }
          // Voided: nothing was bought. A new purchase needs a new acceptance,
          // hence a new intent hash and a new buyer approval.
          : { ...closePendingCommit(current, 'voided', actor.id), status: 'paused_for_human' };
        break;
      }
      case 'retry_commit': {
        const settled = await settlePendingCommit(current, actor);
        await syncCommitApprovalTasks(settled);
        return viewFor(settled, actor);
      }
    }

    let committed = await commitPersistedSession(next, current.version ?? 0, 'session.updated', {
      idempotency: { key: request.idempotencyKey, requestHash: hash },
      actor: commitActor,
    });
    if (committed.status === 'awaiting_commit') committed = await settlePendingCommit(committed, actor);
    await syncCommitApprovalTasks(committed);
    return viewFor(committed, actor);
  });
}

const ERROR_MESSAGE_KEYS: Record<string, TranslationKey> = {
  SESSION_NOT_FOUND: 'negotiation.error.sessionNotFound',
  SESSION_VERSION_CONFLICT: 'negotiation.error.sessionVersionConflict',
  SESSION_NOT_AUTO_STEP: 'negotiation.error.notAutoStep',
  SESSION_NOT_TIME_SKIP: 'negotiation.error.notTimeSkip',
  SESSION_NOT_HUMAN_OFFER: 'negotiation.error.notHumanOffer',
  SESSION_NOT_HUMAN_ACCEPT: 'negotiation.error.notHumanAccept',
  SESSION_NOT_HUMAN_REJECT: 'negotiation.error.notHumanReject',
  SESSION_NOT_PAUSE: 'negotiation.error.notPause',
  SESSION_NOT_RESUME: 'negotiation.error.notResume',
  SESSION_NOT_STOP: 'negotiation.error.notStop',
  SESSION_NOT_UPDATE_POLICY: 'negotiation.error.notUpdatePolicy',
  SESSION_NOT_APPROVE_COMMIT: 'negotiation.error.notApproveCommit',
  SESSION_NOT_REJECT_COMMIT: 'negotiation.error.notRejectCommit',
  SESSION_NOT_RETRY_COMMIT: 'negotiation.error.notRetryCommit',
  SESSION_FORBIDDEN: 'negotiation.error.forbidden',
  NOT_YOUR_TURN: 'negotiation.error.notYourTurn',
  ACTION_FORBIDDEN_FOR_ROLE: 'negotiation.error.actionForbidden',
  SCRIPTED_DEMO_READ_ONLY: 'negotiation.error.scriptedDemoReadOnly',
  KILL_SWITCH_ENGAGED: 'negotiation.error.killSwitchEngaged',
  IDEMPOTENCY_KEY_REUSE: 'negotiation.error.idempotencyKeyReuse',
  TARGET_OFFER_NOT_FOUND: 'negotiation.error.targetOfferNotFound',
  TARGET_OFFER_NOT_OPPONENT: 'negotiation.error.targetOfferNotOpponent',
  TARGET_OFFER_NOT_ACCEPTABLE: 'negotiation.error.targetOfferNotAcceptable',
  TARGET_OFFER_SUPERSEDED: 'negotiation.error.targetOfferSuperseded',
  TARGET_OFFER_VERSION_CONFLICT: 'negotiation.error.targetOfferVersionConflict',
  TARGET_OFFER_EXPIRED: 'negotiation.error.targetOfferExpired',
  TARGET_OFFER_WITHDRAWN: 'negotiation.error.targetOfferWithdrawn',
  OFFER_OUT_OF_POLICY: 'negotiation.error.offerOutOfPolicy',
  SESSION_ALREADY_FINISHED: 'negotiation.error.alreadyFinished',
  ROUND_LIMIT_REACHED: 'negotiation.error.roundLimitReached',
  COMMIT_INTENT_MISMATCH: 'negotiation.error.commitIntentMismatch',
  COMMIT_APPROVER_FORBIDDEN: 'negotiation.error.commitApproverForbidden',
  COMMIT_EXPIRED: 'negotiation.error.commitExpired',
  NO_PENDING_COMMIT: 'negotiation.error.notApproveCommit',
  SESSION_NOT_RECONCILE_COMMIT: 'negotiation.error.notReconcileCommit',
  EFFECT_NOT_RECONCILABLE: 'negotiation.error.effectNotReconcilable',
  EFFECT_VOIDED: 'negotiation.error.effectVoided',
  INVARIANT_VIOLATION: 'negotiation.error.invariantViolation',
};

/** Localised message for a negotiation error code. */
export function errorMessageFor(code: string, locale: Locale = DEFAULT_LOCALE) {
  const key = ERROR_MESSAGE_KEYS[code];
  return key ? translate(locale, key) : translate(locale, 'negotiation.error.generic');
}

export function publicError(error: unknown, locale: Locale = DEFAULT_LOCALE) {
  if (error instanceof NegotiationServiceError || error instanceof SafetyError) {
    return { code: error.code, message: errorMessageFor(error.code, locale) };
  }
  if (error instanceof Error && error.message === 'DATABASE_REQUIRED_IN_PRODUCTION') {
    return { code: 'PERSISTENCE_NOT_CONFIGURED', message: translate(locale, 'api.persistenceNotConfigured') };
  }
  if (error instanceof Error && error.message === 'SESSION_VERSION_CONFLICT') {
    return { code: 'SESSION_VERSION_CONFLICT', message: errorMessageFor('SESSION_VERSION_CONFLICT', locale) };
  }
  return { code: 'INTERNAL_ERROR', message: translate(locale, 'negotiation.error.internal') };
}

const FORBIDDEN = new Set(['SESSION_FORBIDDEN', 'NOT_YOUR_TURN', 'ACTION_FORBIDDEN_FOR_ROLE', 'COMMIT_APPROVER_FORBIDDEN']);
const CONFLICT = new Set(['SESSION_VERSION_CONFLICT', 'COMMIT_INTENT_MISMATCH', 'EFFECT_NOT_RECONCILABLE', 'LEDGER_STATE_CONFLICT', 'TARGET_OFFER_SUPERSEDED', 'TARGET_OFFER_VERSION_CONFLICT', 'INVARIANT_VIOLATION']);

export function httpStatusForError(code: string) {
  if (code === 'SESSION_NOT_FOUND') return 404;
  if (FORBIDDEN.has(code)) return 403;
  if (CONFLICT.has(code)) return 409;
  if (code === 'KILL_SWITCH_ENGAGED') return 423;
  if (code === 'PERSISTENCE_NOT_CONFIGURED') return 503;
  if (code === 'INTERNAL_ERROR') return 500;
  return 422;
}
