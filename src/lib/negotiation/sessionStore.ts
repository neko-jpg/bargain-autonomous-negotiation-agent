import { randomUUID } from 'node:crypto';
import {
  BuyerPolicy,
  Listing,
  NegotiationOffer,
  NegotiationSession,
  NegotiationTerms,
  PublicNegotiationSession,
  SellerPolicy,
} from '@/types/negotiation';
import {
  DEFAULT_BUYER_POLICY_DEMO,
  DEFAULT_SELLER_POLICY_DEMO,
  INITIAL_LISTINGS,
} from '@/lib/mockData';
import { DEMO_CATALOG_ID, findCatalogListing } from '@/lib/catalog/catalogAdapter';
import { defaultNegotiationTerms, normalizeNegotiationTerms } from '@/lib/negotiation/terms';

/**
 * Adapter-shaped local repository for the self-contained demo. The public API
 * never accepts a full session; production wiring can replace these maps with
 * the Postgres schema in docs/POSTGRES_SCHEMA.sql without changing UI contracts.
 */

export interface SessionEvent {
  sequence: number;
  type: 'session.created' | 'session.updated';
  session: PublicNegotiationSession;
  occurredAt: string;
}

type SessionListener = (event: SessionEvent) => void;

interface BargainGlobalState {
  sessions?: Map<string, NegotiationSession>;
  events?: Map<string, SessionEvent[]>;
  listeners?: Map<string, Set<SessionListener>>;
  idempotency?: Map<string, { sessionId: string; version: number; response: PublicNegotiationSession }>;
}

const globalState = globalThis as typeof globalThis & { __bargain?: BargainGlobalState };
const state = (globalState.__bargain ??= {});
const sessions: Map<string, NegotiationSession> = (state.sessions ??= new Map<string, NegotiationSession>());
const events: Map<string, SessionEvent[]> = (state.events ??= new Map<string, SessionEvent[]>());
const listeners: Map<string, Set<SessionListener>> = (state.listeners ??= new Map<string, Set<SessionListener>>());
const idempotency: Map<string, { sessionId: string; version: number; response: PublicNegotiationSession }> =
  (state.idempotency ??= new Map<string, { sessionId: string; version: number; response: PublicNegotiationSession }>());

const clone = <T>(value: T): T => structuredClone(value);

const roundToHundred = (value: number) => Math.round(value / 100) * 100;

export function findListing(listingId: string): Listing | undefined {
  const normalizedId = listingId === 'listing-switch-demo' ? DEMO_CATALOG_ID : listingId;
  const listing = findCatalogListing(normalizedId) ?? INITIAL_LISTINGS.find((candidate) => candidate.id === normalizedId);
  return listing ? clone({ ...listing, images: listing.images ?? [listing.imageUrl] }) : undefined;
}

export function createNegotiationSession(
  listing: Listing,
  buyerPolicy?: BuyerPolicy,
  buyerTerms?: Partial<NegotiationTerms>
): NegotiationSession {
  const now = new Date().toISOString();
  const isDemo = listing.id === DEMO_CATALOG_ID;
  const defaultBuyer: BuyerPolicy = isDemo
    ? { ...DEFAULT_BUYER_POLICY_DEMO }
    : {
        targetPrice: roundToHundred(listing.price * 0.85),
        maxPrice: roundToHundred(listing.price * 0.92),
        deadlineDays: 3,
        autoPurchase: false,
        autoNegotiate: true,
        delegationLevel: 2,
        maxDeliveryDays: 7,
        maxShippingCost: 0,
        minQuantity: 1,
        requiredCurrency: 'JPY',
        requireTaxIncluded: true,
        allowedPaymentTerms: ['即時決済'],
      };
  const defaultSeller: SellerPolicy = isDemo
    ? { ...DEFAULT_SELLER_POLICY_DEMO }
    : {
        targetPrice: roundToHundred(listing.price * 0.96),
        minPrice: roundToHundred(listing.price * 0.88),
        urgency: listing.recentDemand === 'low' ? 'high' : 'medium',
        deadlineDays: 7,
        autoAccept: false,
        costPrice: roundToHundred(listing.price * 0.78),
        minimumProfit: roundToHundred(listing.price * 0.10),
        minQuantity: 1,
        maxDeliveryDays: 7,
        maxShippingCost: 0,
        requiredCurrency: 'JPY',
        requireTaxIncluded: true,
        allowedPaymentTerms: ['即時決済'],
      };

  const buyer = { ...defaultBuyer, ...(buyerPolicy ?? {}) };
  const seller = { ...defaultSeller };
  const buyerPreferredTerms = normalizeNegotiationTerms(listing, buyerTerms);
  const sellerPreferredTerms = defaultNegotiationTerms(listing);
  const session: NegotiationSession = {
    id: `neg-${randomUUID()}`,
    threadId: `thread-${randomUUID()}`,
    version: 0,
    listing: clone({ ...listing, images: listing.images ?? [listing.imageUrl] }),
    buyerPolicy: { ...buyer },
    sellerPolicy: seller,
    buyerPrivateState: {
      reservationPrice: buyer.maxPrice,
      riskTolerance: 0.5,
      patienceScore: 0.8,
      batna: buyer.maxPrice,
      preferredTerms: buyerPreferredTerms,
    },
    sellerPrivateState: {
      reservationPrice: seller.minPrice,
      riskTolerance: 0.5,
      patienceScore: 0.5,
      batna: seller.minPrice,
      preferredTerms: sellerPreferredTerms,
    },
    offers: [],
    currentTurn: 'buyer',
    status: 'active',
    agentMemory: {
      acceptedConditions: [],
      rejectedConditions: [],
      concessionRoom: '交渉を開始したばかりです。相手の反応を観測します。',
      counterpartPattern: 'まだ十分な反応データがありません。',
      nextOptions: ['まずは相場と公開条件を確認する'],
      risks: [],
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };

  sessions.set(session.id, clone(session));
  publish(session, 'session.created');
  return clone(session);
}

export function createSwitchDemoSession(): NegotiationSession {
  const listing = findListing(DEMO_CATALOG_ID) ?? INITIAL_LISTINGS[0];
  const session = createNegotiationSession(listing, { ...DEFAULT_BUYER_POLICY_DEMO });
  const stored = sessions.get(session.id);
  if (stored) {
    stored.sellerPolicy = { ...DEFAULT_SELLER_POLICY_DEMO };
    stored.buyerPrivateState = { ...stored.buyerPrivateState, batna: DEFAULT_BUYER_POLICY_DEMO.maxPrice, riskTolerance: 0.4 };
    stored.sellerPrivateState = { ...stored.sellerPrivateState, batna: DEFAULT_SELLER_POLICY_DEMO.minPrice };
    sessions.set(stored.id, clone(stored));
  }
  return getSession(session.id) as NegotiationSession;
}

export function getSession(sessionId: string): NegotiationSession | undefined {
  const session = sessions.get(sessionId);
  return session ? clone(session) : undefined;
}

/** Database hydration hook. It intentionally does not publish an event. */
export function hydrateSession(session: NegotiationSession) {
  sessions.set(session.id, clone(session));
  return clone(session);
}

export function getPublicSession(sessionId: string): PublicNegotiationSession | undefined {
  const session = getSession(sessionId);
  return session ? toPublicSession(session) : undefined;
}

export function toPublicSession(session: NegotiationSession): PublicNegotiationSession {
  return {
    id: session.id,
    threadId: session.threadId ?? `thread-${session.id}`,
    version: session.version ?? 0,
    listing: clone(session.listing),
    buyerPolicy: clone(session.buyerPolicy),
    offers: clone(session.offers),
    currentTurn: session.currentTurn,
    currentOfferPrice: session.currentOfferPrice,
    status: session.status,
    waitingUntilHours: session.waitingUntilHours,
    waitingUntilAt: session.waitingUntilAt,
    simulationStep: session.simulationStep,
    agentMemory: clone(session.agentMemory),
    dealSummary: clone(session.dealSummary),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function commitSession(
  nextSession: NegotiationSession,
  expectedVersion: number,
  eventType: SessionEvent['type'] = 'session.updated'
): NegotiationSession {
  const current = sessions.get(nextSession.id);
  if (!current) throw new Error('SESSION_NOT_FOUND');
  const currentVersion = current.version ?? 0;
  if (currentVersion !== expectedVersion) throw new Error('SESSION_VERSION_CONFLICT');

  const committed: NegotiationSession = {
    ...clone(nextSession),
    threadId: current.threadId ?? nextSession.threadId ?? `thread-${nextSession.id}`,
    version: currentVersion + 1,
    updatedAt: new Date().toISOString(),
  };
  sessions.set(committed.id, clone(committed));
  publish(committed, eventType);
  return clone(committed);
}

export function rememberIdempotentAction(
  key: string,
  sessionId: string,
  version: number,
  response: PublicNegotiationSession
) {
  idempotency.set(key, { sessionId, version, response: clone(response) });
}

export function getIdempotentAction(key: string) {
  const item = idempotency.get(key);
  return item ? clone(item) : undefined;
}

export function listSessionEvents(sessionId: string): SessionEvent[] {
  return clone(events.get(sessionId) ?? []);
}

export function subscribeSession(sessionId: string, listener: SessionListener) {
  const bucket = listeners.get(sessionId) ?? new Set<SessionListener>();
  bucket.add(listener);
  listeners.set(sessionId, bucket);
  return () => {
    bucket.delete(listener);
    if (bucket.size === 0) listeners.delete(sessionId);
  };
}

function publish(session: NegotiationSession, type: SessionEvent['type']) {
  const bucket = events.get(session.id) ?? [];
  const event: SessionEvent = {
    sequence: bucket.length + 1,
    type,
    session: toPublicSession(session),
    occurredAt: new Date().toISOString(),
  };
  bucket.push(event);
  events.set(session.id, bucket.slice(-100));
  listeners.get(session.id)?.forEach((listener) => listener(clone(event)));
}

export function makeOffer(
  session: NegotiationSession,
  price: number,
  senderRole: NegotiationOffer['senderRole'],
  senderName: string,
  messageText: string,
  actionType: NegotiationOffer['actionType'] = 'counter_offer',
  terms?: NegotiationTerms
): NegotiationSession {
  const offer: NegotiationOffer = {
    id: `offer-${randomUUID()}`,
    round: session.offers.length + 1,
    timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
    senderRole,
    senderName,
    price,
    terms,
    actionType,
    messageText,
  };
  return {
    ...session,
    offers: [...session.offers, offer],
    currentOfferPrice: price,
    currentTurn: session.currentTurn === 'buyer' ? 'seller' : 'buyer',
  };
}
