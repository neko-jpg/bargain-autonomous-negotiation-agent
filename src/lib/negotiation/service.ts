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
import { NegotiationOffer, NegotiationSession } from '@/types/negotiation';
import { effectiveSellerFloor, sanitizeOfferByPolicy } from '@/lib/negotiation/policyEngine';
import {
  commitPersistedSession,
  getPersistedIdempotentAction,
  getPersistedSession,
  PersistedApprovalSeed,
  PersistedApprovalResolution,
} from '@/lib/negotiation/persistence';
import { ensureApprovalTaskForOffer } from '@/lib/negotiation/workflowStore';
import { ActorContext } from '@/lib/auth/actor';
import { buildPublicOfferMessage } from '@/lib/negotiation/messages';

export class NegotiationServiceError extends Error {
  constructor(
    public readonly code: string
  ) {
    super(code);
  }
}

async function assertSession(sessionId: string, actor?: ActorContext) {
  const session = await getPersistedSession(sessionId);
  if (!session) throw new NegotiationServiceError('SESSION_NOT_FOUND');
  if (actor && actor.role !== 'operator' && !(
    (actor.role === 'buyer' && session.buyerId === actor.id)
    || (actor.role === 'seller' && session.sellerId === actor.id)
  )) {
    throw new NegotiationServiceError('SESSION_FORBIDDEN');
  }
  return session;
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
    buyerSavedPercent: Math.round((buyerSaved / initialPrice) * 1000) / 10,
    sellerSurplus,
    totalRounds: session.offers.length,
    totalActions: session.offers.length,
    humanMessagesCount: session.offers.filter((offer) => offer.senderRole.includes('human')).length,
    completedAt: new Date().toISOString(),
  };
}

function appendHumanAcceptance(session: NegotiationSession, target: NegotiationOffer): NegotiationSession {
  const senderRole: NegotiationOffer['senderRole'] =
    session.currentTurn === 'buyer' ? 'buyer_human' : 'seller_human';
  const offer: NegotiationOffer = {
    id: `offer-human-${randomUUID()}`,
    version: 1,
    targetOfferId: target.id,
    targetOfferVersion: target.version ?? 1,
    round: session.offers.length + 1,
    timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
    senderRole,
    senderName: session.currentTurn === 'buyer' ? 'あなた（買い手）' : 'あなた（売り手）',
    price: target.price,
    terms: target.terms,
    actionType: 'accept_offer',
    messageText: buildPublicOfferMessage(session.currentTurn, 'accept_offer', target.price, target.terms ?? {
      quantity: 1,
      currency: 'JPY',
      taxIncluded: true,
      shippingCost: 0,
      deliveryDays: 3,
      paymentTerms: '即時決済',
      warranty: '商品説明に準拠',
      concessions: [],
    }),
  };
  offer.proposalHash = hashOffer(offer);
  return { ...session, offers: [...session.offers, offer], currentOfferPrice: target.price };
}

const terminalStatuses = new Set<NegotiationSession['status']>(['deal', 'rejected']);

function assertActionAllowed(session: NegotiationSession, type: NegotiationActionRequest['type']) {
  if (terminalStatuses.has(session.status)) throw new NegotiationServiceError('SESSION_ALREADY_FINISHED');
  const allowed: Record<NegotiationActionRequest['type'], NegotiationSession['status'][]> = {
    auto_step: ['active'],
    time_skip: ['waiting'],
    human_offer: ['active'],
    human_accept: ['active', 'paused_for_human'],
    human_reject: ['active', 'waiting', 'paused_for_human'],
    pause: ['active', 'waiting'],
    resume: ['paused_for_human'],
    stop: ['initializing', 'active', 'waiting', 'paused_for_human'],
    update_policy: ['initializing', 'active', 'waiting', 'paused_for_human'],
  };
  if (!allowed[type].includes(session.status)) {
    throw new NegotiationServiceError(`SESSION_NOT_${type.toUpperCase()}`);
  }
}

function requestHash(request: NegotiationActionRequest) {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

function oppositeSenderRole(role: 'buyer' | 'seller', senderRole: NegotiationOffer['senderRole']) {
  return role === 'buyer' ? senderRole.includes('seller') : senderRole.includes('buyer');
}

function assertAcceptableTarget(
  session: NegotiationSession,
  targetOfferId: string,
  targetOfferVersion?: number
) {
  const target = session.offers.find((offer) => offer.id === targetOfferId);
  if (!target) throw new NegotiationServiceError('TARGET_OFFER_NOT_FOUND');
  if (!oppositeSenderRole(session.currentTurn, target.senderRole)) throw new NegotiationServiceError('TARGET_OFFER_NOT_OPPONENT');
  if (!['make_offer', 'counter_offer'].includes(target.actionType)) throw new NegotiationServiceError('TARGET_OFFER_NOT_ACCEPTABLE');
  if (targetOfferVersion !== undefined && targetOfferVersion !== (target.version ?? 1)) throw new NegotiationServiceError('TARGET_OFFER_VERSION_CONFLICT');
  if (target.terms?.expiresAt) {
    const expiry = Date.parse(target.terms.expiresAt);
    if (Number.isFinite(expiry) && expiry <= Date.now()) throw new NegotiationServiceError('TARGET_OFFER_EXPIRED');
  }
  return target;
}

function approvalSeedForOffer(session: NegotiationSession, offer: NegotiationOffer): PersistedApprovalSeed {
  return {
    id: `approval-${offer.id}`,
    ownerId: session.currentTurn === 'buyer' ? session.buyerId : session.sellerId,
    kind: 'reply',
    title: 'AI提案の確認が必要です',
    payload: {
      offerId: offer.id,
      targetOfferId: offer.targetOfferId,
      targetOfferVersion: offer.targetOfferVersion,
      expectedSessionVersion: session.version ?? 0,
      actionType: offer.actionType,
      price: offer.price,
      terms: offer.terms,
      messageText: offer.messageText,
      decision: offer.decision,
    },
    subjectType: 'offer',
    subjectId: offer.id,
    subjectVersion: offer.version ?? 1,
    proposalHash: offer.proposalHash ?? '',
    requestedBy: offer.senderRole,
    expiresAt: offer.terms?.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export async function executeNegotiationAction(
  sessionId: string,
  request: NegotiationActionRequest,
  actor?: ActorContext,
  context?: { approvalResolution?: PersistedApprovalResolution }
) {
  return withSessionLock(sessionId, async () => {
    const current = await assertSession(sessionId, actor);
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
    if (storedResponse) {
      if (actor && actor.role !== 'operator' && (current.version ?? 0) === storedResponse.version) {
        return toViewerSession(current, actor.id, actor.role);
      }
      return storedResponse.response;
    }

    assertVersion(current, request.expectedVersion);
    assertActionAllowed(current, request.type);
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
      const role = current.currentTurn;
      const policy = role === 'buyer' ? current.buyerPolicy : current.sellerPolicy;
      const decision = sanitizeOfferByPolicy(role, current.listing, policy, request.offerPrice, request.terms, 'counter_offer');
      if (!Number.isInteger(request.offerPrice) || request.offerPrice <= 0 || decision.price !== request.offerPrice || decision.correctionReason) {
        throw new NegotiationServiceError('OFFER_OUT_OF_POLICY');
      }
      next = makeOffer(
        current,
        decision.price,
        current.currentTurn === 'buyer' ? 'buyer_human' : 'seller_human',
        current.currentTurn === 'buyer' ? 'あなた（買い手）' : 'あなた（売り手）',
        request.messageText ?? `¥${decision.price.toLocaleString()}で提案します。`,
        current.offers.length === 0 ? 'make_offer' : 'counter_offer',
        decision.terms
      );
      break;
    }
    case 'human_accept': {
      const target = assertAcceptableTarget(current, request.targetOfferId, request.targetOfferVersion);
      const role = current.currentTurn;
      const policy = role === 'buyer' ? current.buyerPolicy : current.sellerPolicy;
      const decision = sanitizeOfferByPolicy(role, current.listing, policy, target.price, target.terms, 'accept_offer');
      if (decision.price !== target.price || decision.correctionReason) {
        throw new NegotiationServiceError('OFFER_OUT_OF_POLICY');
      }
      next = appendHumanAcceptance(current, target);
      next.status = 'deal';
      next.dealSummary = makeDealSummary(next, target.price);
      break;
    }
    case 'human_reject':
    case 'stop': {
      next = { ...current, status: 'rejected', waitingUntilAt: undefined, waitingUntilHours: undefined };
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
        },
      };
      break;
    }
  }

    const latestOffer = next.offers.at(-1);
    const approval = latestOffer && (latestOffer.actionType === 'ask_user' || latestOffer.decision?.requiresHumanApproval)
      ? approvalSeedForOffer(next, latestOffer)
      : undefined;
    const committed = await commitPersistedSession(next, request.expectedVersion, 'session.updated', {
      key: request.idempotencyKey,
      requestHash: hash,
      approval,
      approvalResolution: context?.approvalResolution,
    });
    const response = toPublicSession(committed);
    const committedOffer = committed.offers.at(-1);
    if (committedOffer?.actionType === 'ask_user' || committedOffer?.decision?.requiresHumanApproval) {
      await ensureApprovalTaskForOffer(committed, committedOffer);
    }
    return actor && actor.role !== 'operator'
      ? toViewerSession(committed, actor.id, actor.role)
      : response;
  });
}

export function publicError(error: unknown) {
  if (error instanceof NegotiationServiceError) {
    const messages: Record<string, string> = {
      SESSION_NOT_FOUND: '交渉セッションが見つかりません。',
      SESSION_VERSION_CONFLICT: '画面が古くなっています。最新状態を読み込みました。',
      SESSION_NOT_ACTIVE: '現在は自動交渉を実行できません。',
      SESSION_NOT_WAITING: '現在は待機状態ではありません。',
      SESSION_NOT_AUTO_STEP: '現在は自動交渉を実行できません。',
      SESSION_NOT_TIME_SKIP: '現在は待機時間を進められません。',
      SESSION_NOT_HUMAN_OFFER: '現在は手動オファーを送信できません。',
      SESSION_NOT_HUMAN_ACCEPT: '現在はオファーを受諾できません。',
      SESSION_NOT_HUMAN_REJECT: '現在はオファーを却下できません。',
      SESSION_NOT_PAUSE: '現在は一時停止できません。',
      SESSION_NOT_RESUME: '現在は再開できません。',
      SESSION_NOT_STOP: '現在は停止できません。',
      SESSION_NOT_UPDATE_POLICY: '現在はポリシーを変更できません。',
      SESSION_FORBIDDEN: 'この交渉を操作する権限がありません。',
      IDEMPOTENCY_KEY_REUSE: '同じ冪等性キーに異なるリクエストは指定できません。',
      TARGET_OFFER_NOT_FOUND: '受諾対象のオファーが見つかりません。',
      TARGET_OFFER_NOT_OPPONENT: '相手が送信したオファーだけを受諾できます。',
      TARGET_OFFER_NOT_ACCEPTABLE: 'そのオファーは受諾可能な状態ではありません。',
      TARGET_OFFER_VERSION_CONFLICT: '対象オファーが更新されています。再読み込みしてください。',
      TARGET_OFFER_EXPIRED: '対象オファーの有効期限が切れています。',
      PRICE_OUT_OF_POLICY: '設定した価格ポリシーの範囲外です。',
      OFFER_OUT_OF_POLICY: '価格または取引条件が設定したポリシーの範囲外です。',
      NO_OFFER_TO_ACCEPT: '受諾できる提示がありません。',
      SESSION_ALREADY_FINISHED: 'この交渉はすでに終了しています。',
      SESSION_NOT_PAUSED: '現在は一時停止状態ではありません。',
    };
    return { code: error.code, message: messages[error.code] ?? '操作を完了できませんでした。' };
  }
  if (error instanceof Error && error.message === 'DATABASE_REQUIRED_IN_PRODUCTION') {
    return { code: 'PERSISTENCE_NOT_CONFIGURED', message: '交渉サービスの永続化設定が完了していません。' };
  }
  return { code: 'INTERNAL_ERROR', message: '一時的なエラーが発生しました。もう一度お試しください。' };
}
