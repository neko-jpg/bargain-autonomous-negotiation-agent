import { randomUUID } from 'node:crypto';
import { MarketSimulator } from '@/lib/engine/marketSimulator';
import { runNegotiationStep } from '@/lib/agent/negotiationGraph';
import {
  makeOffer,
  toPublicSession,
} from '@/lib/negotiation/sessionStore';
import { NegotiationActionRequest } from '@/lib/negotiation/schemas';
import { NegotiationOffer, NegotiationSession } from '@/types/negotiation';
import { effectiveSellerFloor, sanitizeOfferByPolicy } from '@/lib/negotiation/policyEngine';
import {
  commitPersistedSession,
  getPersistedIdempotentAction,
  getPersistedSession,
  rememberPersistedAction,
} from '@/lib/negotiation/persistence';
import { ensureApprovalTaskForOffer } from '@/lib/negotiation/workflowStore';

export class NegotiationServiceError extends Error {
  constructor(
    public readonly code: string
  ) {
    super(code);
  }
}

async function assertSession(sessionId: string) {
  const session = await getPersistedSession(sessionId);
  if (!session) throw new NegotiationServiceError('SESSION_NOT_FOUND');
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

function appendHumanAcceptance(
  session: NegotiationSession,
  price: number,
  terms: NegotiationOffer['terms']
): NegotiationSession {
  const senderRole: NegotiationOffer['senderRole'] =
    session.currentTurn === 'buyer' ? 'buyer_human' : 'seller_human';
  const offer: NegotiationOffer = {
    id: `offer-human-${randomUUID()}`,
    round: session.offers.length + 1,
    timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
    senderRole,
    senderName: session.currentTurn === 'buyer' ? 'あなた（買い手）' : 'あなた（売り手）',
    price,
    terms,
    actionType: 'accept_offer',
    messageText: `¥${price.toLocaleString()}で合意しました。`,
  };
  return { ...session, offers: [...session.offers, offer], currentOfferPrice: price };
}

export async function executeNegotiationAction(
  sessionId: string,
  request: NegotiationActionRequest
) {
  const storedResponse = await getPersistedIdempotentAction(request.idempotencyKey);
  if (storedResponse) return storedResponse.response;

  const current = await assertSession(sessionId);
  assertVersion(current, request.expectedVersion);
  let next = current;

  switch (request.type) {
    case 'auto_step': {
      if (current.status !== 'active') throw new NegotiationServiceError('SESSION_NOT_ACTIVE');
      next = await runNegotiationStep(current, undefined, { threadId: current.threadId });
      break;
    }
    case 'time_skip': {
      if (current.status !== 'waiting') throw new NegotiationServiceError('SESSION_NOT_WAITING');
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
      next.status = 'active';
      break;
    }
    case 'human_accept': {
      const lastOffer = current.offers.at(-1);
      if (!lastOffer) throw new NegotiationServiceError('NO_OFFER_TO_ACCEPT');
      const role = current.currentTurn;
      const policy = role === 'buyer' ? current.buyerPolicy : current.sellerPolicy;
      const decision = sanitizeOfferByPolicy(role, current.listing, policy, lastOffer.price, lastOffer.terms, 'accept_offer');
      if (decision.price !== lastOffer.price || decision.correctionReason) {
        throw new NegotiationServiceError('OFFER_OUT_OF_POLICY');
      }
      next = appendHumanAcceptance(current, decision.price, decision.terms);
      next.status = 'deal';
      next.dealSummary = makeDealSummary(next, decision.price);
      break;
    }
    case 'human_reject':
    case 'stop': {
      next = { ...current, status: 'rejected' };
      break;
    }
    case 'pause': {
      if (current.status === 'deal' || current.status === 'rejected') {
        throw new NegotiationServiceError('SESSION_ALREADY_FINISHED');
      }
      next = { ...current, status: 'paused_for_human' };
      break;
    }
    case 'resume': {
      if (current.status !== 'paused_for_human') {
        throw new NegotiationServiceError('SESSION_NOT_PAUSED');
      }
      next = { ...current, status: 'active' };
      break;
    }
    case 'update_policy': {
      if (current.status === 'deal' || current.status === 'rejected') {
        throw new NegotiationServiceError('SESSION_ALREADY_FINISHED');
      }
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

  const committed = await commitPersistedSession(next, request.expectedVersion);
  const response = toPublicSession(committed);
  const latestOffer = committed.offers.at(-1);
  if (latestOffer?.actionType === 'ask_user' || latestOffer?.decision?.requiresHumanApproval) {
    await ensureApprovalTaskForOffer(committed, latestOffer);
  }
  await rememberPersistedAction(request.idempotencyKey, sessionId, committed.version ?? 0, response);
  return response;
}

export function publicError(error: unknown) {
  if (error instanceof NegotiationServiceError) {
    const messages: Record<string, string> = {
      SESSION_NOT_FOUND: '交渉セッションが見つかりません。',
      SESSION_VERSION_CONFLICT: '画面が古くなっています。最新状態を読み込みました。',
      SESSION_NOT_ACTIVE: '現在は自動交渉を実行できません。',
      SESSION_NOT_WAITING: '現在は待機状態ではありません。',
      PRICE_OUT_OF_POLICY: '設定した価格ポリシーの範囲外です。',
      OFFER_OUT_OF_POLICY: '価格または取引条件が設定したポリシーの範囲外です。',
      NO_OFFER_TO_ACCEPT: '受諾できる提示がありません。',
      SESSION_ALREADY_FINISHED: 'この交渉はすでに終了しています。',
      SESSION_NOT_PAUSED: '現在は一時停止状態ではありません。',
    };
    return { code: error.code, message: messages[error.code] ?? '操作を完了できませんでした。' };
  }
  return { code: 'INTERNAL_ERROR', message: '一時的なエラーが発生しました。もう一度お試しください。' };
}
