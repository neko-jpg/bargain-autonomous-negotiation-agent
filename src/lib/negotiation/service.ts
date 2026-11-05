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
import { effectiveSellerFloor, isOfferStillBinding, sanitizeOfferByPolicy } from '@/lib/negotiation/policyEngine';
import {
  commitPersistedSession,
  getPersistedIdempotentAction,
  getPersistedSession,
} from '@/lib/negotiation/persistence';
import { syncCommitApprovalTasks } from '@/lib/negotiation/workflowStore';
import { ActorContext } from '@/lib/auth/actor';
import { buildPublicOfferMessage } from '@/lib/negotiation/messages';
import { executeIrreversibleEffect, SafetyError } from '@/lib/safety/commitGate';
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
};
/** Bound to an intent hash instead of the session version. */
const COMMIT_BOUND = new Set<ActionType>(['approve_commit', 'reject_commit', 'retry_commit']);

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
    price: target.price,
    terms,
    actionType: 'accept_offer',
    messageText: buildPublicOfferMessage(role, 'accept_offer', target.price, terms),
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

function closePendingCommit(session: NegotiationSession, reason: 'rejected' | 'expired', by?: string): NegotiationSession {
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
        next = {
          ...makeOffer(
            current,
            decision.price,
            role === 'buyer' ? 'buyer_human' : 'seller_human',
            role === 'buyer' ? 'あなた（買い手）' : 'あなた（売り手）',
            request.messageText ?? `¥${decision.price.toLocaleString()}で提案します。`,
            current.offers.length === 0 ? 'make_offer' : 'counter_offer',
            decision.terms
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

const ERROR_MESSAGES: Record<string, string> = {
  SESSION_NOT_FOUND: '交渉セッションが見つかりません。',
  SESSION_VERSION_CONFLICT: '画面が古くなっています。最新状態を読み込みました。',
  SESSION_NOT_AUTO_STEP: '現在は自動交渉を実行できません。',
  SESSION_NOT_TIME_SKIP: '現在は待機時間を進められません。',
  SESSION_NOT_HUMAN_OFFER: '現在は手動オファーを送信できません。',
  SESSION_NOT_HUMAN_ACCEPT: '現在はオファーを受諾できません。',
  SESSION_NOT_HUMAN_REJECT: '現在はオファーを却下できません。',
  SESSION_NOT_PAUSE: '現在は一時停止できません。',
  SESSION_NOT_RESUME: '現在は再開できません。',
  SESSION_NOT_STOP: '現在は停止できません。',
  SESSION_NOT_UPDATE_POLICY: '現在はポリシーを変更できません。',
  SESSION_NOT_APPROVE_COMMIT: '承認待ちの購入確定がありません。',
  SESSION_NOT_REJECT_COMMIT: '承認待ちの購入確定がありません。',
  SESSION_NOT_RETRY_COMMIT: '再試行できる購入確定がありません。',
  SESSION_FORBIDDEN: 'この交渉を操作する権限がありません。',
  NOT_YOUR_TURN: '相手側の手番です。自分の手番でのみ提案・受諾できます。',
  ACTION_FORBIDDEN_FOR_ROLE: 'この操作を行う権限がありません。',
  SCRIPTED_DEMO_READ_ONLY: 'スクリプトデモのセッションは操作できません。',
  KILL_SWITCH_ENGAGED: '安全停止中のため、自動交渉と購入確定は実行できません。',
  IDEMPOTENCY_KEY_REUSE: '同じ冪等性キーに異なるリクエストは指定できません。',
  TARGET_OFFER_NOT_FOUND: '受諾対象のオファーが見つかりません。',
  TARGET_OFFER_NOT_OPPONENT: '相手が送信したオファーだけを受諾できます。',
  TARGET_OFFER_NOT_ACCEPTABLE: 'そのオファーは受諾可能な状態ではありません。',
  TARGET_OFFER_SUPERSEDED: 'より新しい提案があるため、このオファーは受諾できません。',
  TARGET_OFFER_VERSION_CONFLICT: '対象オファーが更新されています。再読み込みしてください。',
  TARGET_OFFER_EXPIRED: '対象オファーの有効期限が切れています。',
  TARGET_OFFER_WITHDRAWN: '提示者のポリシー変更により、このオファーは取り下げられています。',
  OFFER_OUT_OF_POLICY: '価格または取引条件が設定したポリシーの範囲外です。',
  SESSION_ALREADY_FINISHED: 'この交渉はすでに終了しています。',
  COMMIT_INTENT_MISMATCH: '購入内容が更新されています。最新の内容を確認してください。',
  COMMIT_APPROVER_FORBIDDEN: 'この購入確定を承認する権限がありません。',
  COMMIT_EXPIRED: '購入確定の有効期限が切れています。',
  NO_PENDING_COMMIT: '承認待ちの購入確定がありません。',
  INVARIANT_VIOLATION: '安全不変条件に反する更新のため、保存を拒否しました。',
};

export function publicError(error: unknown) {
  if (error instanceof NegotiationServiceError || error instanceof SafetyError) {
    return { code: error.code, message: ERROR_MESSAGES[error.code] ?? '操作を完了できませんでした。' };
  }
  if (error instanceof Error && error.message === 'DATABASE_REQUIRED_IN_PRODUCTION') {
    return { code: 'PERSISTENCE_NOT_CONFIGURED', message: '交渉サービスの永続化設定が完了していません。' };
  }
  if (error instanceof Error && error.message === 'SESSION_VERSION_CONFLICT') {
    return { code: 'SESSION_VERSION_CONFLICT', message: ERROR_MESSAGES.SESSION_VERSION_CONFLICT };
  }
  return { code: 'INTERNAL_ERROR', message: '一時的なエラーが発生しました。もう一度お試しください。' };
}

const FORBIDDEN = new Set(['SESSION_FORBIDDEN', 'NOT_YOUR_TURN', 'ACTION_FORBIDDEN_FOR_ROLE', 'COMMIT_APPROVER_FORBIDDEN']);
const CONFLICT = new Set(['SESSION_VERSION_CONFLICT', 'COMMIT_INTENT_MISMATCH', 'TARGET_OFFER_SUPERSEDED', 'TARGET_OFFER_VERSION_CONFLICT', 'INVARIANT_VIOLATION']);

export function httpStatusForError(code: string) {
  if (code === 'SESSION_NOT_FOUND') return 404;
  if (FORBIDDEN.has(code)) return 403;
  if (CONFLICT.has(code)) return 409;
  if (code === 'KILL_SWITCH_ENGAGED') return 423;
  if (code === 'PERSISTENCE_NOT_CONFIGURED') return 503;
  if (code === 'INTERNAL_ERROR') return 500;
  return 422;
}
