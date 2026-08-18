import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import {
  BuyerPolicy,
  Listing,
  NegotiationOffer,
  NegotiationSession,
  PrivateState,
  SellerPolicy,
} from '@/types/negotiation';
import {
  commitSession,
  createNegotiationSession,
  getIdempotentAction,
  getSession,
  hydrateSession,
  rememberIdempotentAction,
  toPublicSession,
} from '@/lib/negotiation/sessionStore';
import { NegotiationTerms } from '@/types/negotiation';

type PersistedIdempotentAction = {
  sessionId: string;
  version: number;
  response: ReturnType<typeof toPublicSession>;
};

let pool: Pool | undefined;

function getConnectionString() {
  return process.env.DATABASE_URL?.trim()
    || process.env.POSTGRES_URL?.trim()
    || process.env.NEON_DATABASE_URL?.trim();
}

function getPool() {
  const connectionString = getConnectionString();
  if (!connectionString) return undefined;
  if (!pool) pool = new Pool({ connectionString, max: 5 });
  return pool;
}

/** Shared optional pool for workflow repositories that use the same schema. */
export function getDatabasePool() {
  return getPool();
}

export function isDatabaseConfigured() {
  return Boolean(getConnectionString());
}

function getPrivateStateKey() {
  const raw = process.env.BARGAIN_PRIVATE_STATE_KEY?.trim();
  if (!raw || /^(your_|placeholder|replace_me|change_me)/i.test(raw)) {
    throw new Error('PRIVATE_STATE_ENCRYPTION_KEY_REQUIRED');
  }
  return /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : createHash('sha256').update(raw).digest();
}

function encryptPrivateState(value: { buyer: PrivateState; seller: PrivateState }) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getPrivateStateKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function decryptPrivateState(value: Buffer | string): { buyer: PrivateState; seller: PrivateState } {
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(value, 'base64');
  const iv = payload.subarray(0, 12);
  const authTag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', getPrivateStateKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  return JSON.parse(decrypted) as { buyer: PrivateState; seller: PrivateState };
}

function jsonValue(value: unknown) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function iso(value: unknown, fallback: string) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

async function upsertListing(client: PoolClient, listing: Listing) {
  await client.query(
    `insert into listings (
      id, title, price_jpy, category, image_url, description, days_listed,
      likes_count, views_count, market_median_price_jpy, competing_listings_count,
      recent_demand, seller_name, condition
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    on conflict (id) do update set
      title = excluded.title,
      price_jpy = excluded.price_jpy,
      image_url = excluded.image_url,
      description = excluded.description,
      days_listed = excluded.days_listed,
      likes_count = excluded.likes_count,
      views_count = excluded.views_count,
      market_median_price_jpy = excluded.market_median_price_jpy,
      competing_listings_count = excluded.competing_listings_count,
      recent_demand = excluded.recent_demand,
      seller_name = excluded.seller_name,
      condition = excluded.condition,
      updated_at = now()` ,
    [
      listing.id,
      listing.title,
      listing.price,
      listing.category,
      listing.imageUrl,
      listing.description,
      listing.daysListed,
      listing.likesCount,
      listing.viewsCount,
      listing.marketMedianPrice,
      listing.competingListingsCount,
      listing.recentDemand,
      listing.sellerName,
      listing.condition,
    ]
  );
}

async function insertOffer(client: PoolClient, session: NegotiationSession, offer: NegotiationOffer) {
  await client.query(
    `insert into negotiation_offers (
      id, negotiation_id, round, sender_role, sender_name, action_type, price_jpy,
      wait_time_hours, public_message, terms, reasoning, decision, alternatives
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    on conflict (id) do nothing`,
    [
      offer.id,
      session.id,
      offer.round,
      offer.senderRole,
      offer.senderName,
      offer.actionType,
      offer.price,
      offer.waitTimeHours ?? null,
      offer.messageText,
      jsonValue(offer.terms),
      jsonValue(offer.reasoning),
      jsonValue(offer.decision),
      jsonValue(offer.alternatives),
    ]
  );
}

async function insertEvent(client: PoolClient, session: NegotiationSession, eventType: string) {
  const sequence = await client.query<{ sequence: number }>(
    'select coalesce(max(sequence), 0) + 1 as sequence from negotiation_events where negotiation_id = $1',
    [session.id]
  );
  await client.query(
    `insert into negotiation_events (negotiation_id, sequence, event_type, actor_id, public_payload)
     values ($1,$2,$3,$4,$5)`,
    [session.id, sequence.rows[0]?.sequence ?? 1, eventType, null, jsonValue(toPublicSession(session))]
  );
}

async function insertSession(client: PoolClient, session: NegotiationSession) {
  await upsertListing(client, session.listing);
  await client.query(
    `insert into negotiations (
      id, thread_id, listing_id, listing_snapshot, buyer_id, seller_id, status,
      current_turn, current_offer_price_jpy, deadline_at, waiting_until_at,
      version, deal_summary, agent_memory, created_at, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      session.id,
      session.threadId,
      session.listing.id,
      jsonValue(session.listing),
      'buyer-local',
      session.listing.sellerName,
      session.status,
      session.currentTurn,
      session.currentOfferPrice ?? null,
      new Date(Date.now() + session.buyerPolicy.deadlineDays * 86_400_000),
      session.waitingUntilAt ? new Date(session.waitingUntilAt) : null,
      session.version ?? 0,
      jsonValue(session.dealSummary),
      jsonValue(session.agentMemory),
      new Date(session.createdAt),
      new Date(session.updatedAt),
    ]
  );
  await client.query(
    `insert into negotiation_policies (negotiation_id, buyer_policy, seller_policy, encrypted_private_state)
     values ($1,$2,$3,$4)`,
    [
      session.id,
      jsonValue(session.buyerPolicy),
      jsonValue(session.sellerPolicy),
      encryptPrivateState({ buyer: session.buyerPrivateState, seller: session.sellerPrivateState }),
    ]
  );
  for (const offer of session.offers) await insertOffer(client, session, offer);
  await insertEvent(client, session, 'session.created');
}

function rowJson<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
}

async function loadSessionFromDatabase(sessionId: string) {
  const database = getPool();
  if (!database) return undefined;
  const client = await database.connect();
  try {
    const negotiation = await client.query(
      `select id, thread_id, listing_snapshot, status, current_turn,
        current_offer_price_jpy, waiting_until_at, version, deal_summary, agent_memory,
        created_at, updated_at
       from negotiations where id = $1`,
      [sessionId]
    );
    const row = negotiation.rows[0];
    if (!row) return undefined;

    const policies = await client.query(
      'select buyer_policy, seller_policy, encrypted_private_state from negotiation_policies where negotiation_id = $1',
      [sessionId]
    );
    const policyRow = policies.rows[0];
    if (!policyRow) throw new Error('NEGOTIATION_POLICY_NOT_FOUND');
    const privateState = decryptPrivateState(policyRow.encrypted_private_state);

    const offers = await client.query(
      `select id, round, sender_role, sender_name, action_type, price_jpy,
        wait_time_hours, public_message, terms, reasoning, decision, alternatives, created_at
       from negotiation_offers where negotiation_id = $1 order by round asc`,
      [sessionId]
    );

    const createdAt = iso(row.created_at, new Date().toISOString());
    const updatedAt = iso(row.updated_at, createdAt);
    const listing = rowJson<Listing>(row.listing_snapshot);
    if (!listing) throw new Error('NEGOTIATION_LISTING_SNAPSHOT_NOT_FOUND');

    const session: NegotiationSession = {
      id: String(row.id),
      threadId: String(row.thread_id),
      version: Number(row.version ?? 0),
      listing,
      buyerPolicy: rowJson<BuyerPolicy>(policyRow.buyer_policy) as BuyerPolicy,
      sellerPolicy: rowJson<SellerPolicy>(policyRow.seller_policy) as SellerPolicy,
      buyerPrivateState: privateState.buyer,
      sellerPrivateState: privateState.seller,
      offers: offers.rows.map((offer) => ({
        id: String(offer.id),
        round: Number(offer.round),
        timestamp: new Date(offer.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
        senderRole: offer.sender_role,
        senderName: offer.sender_name ?? offer.sender_role,
        price: Number(offer.price_jpy),
        terms: rowJson<NegotiationTerms>(offer.terms),
        actionType: offer.action_type,
        waitTimeHours: offer.wait_time_hours === null ? undefined : Number(offer.wait_time_hours),
        reasoning: rowJson<NegotiationOffer['reasoning']>(offer.reasoning),
        decision: rowJson<NegotiationOffer['decision']>(offer.decision),
        alternatives: rowJson<NegotiationOffer['alternatives']>(offer.alternatives),
        messageText: String(offer.public_message),
      })),
      currentTurn: row.current_turn,
      currentOfferPrice: row.current_offer_price_jpy === null ? undefined : Number(row.current_offer_price_jpy),
      status: row.status,
      waitingUntilAt: row.waiting_until_at ? iso(row.waiting_until_at, updatedAt) : undefined,
      agentMemory: rowJson<NegotiationSession['agentMemory']>(row.agent_memory),
      dealSummary: rowJson<NegotiationSession['dealSummary']>(row.deal_summary),
      createdAt,
      updatedAt,
    };
    return hydrateSession(session);
  } finally {
    client.release();
  }
}

export async function createPersistedNegotiationSession(
  listing: Listing,
  buyerPolicy?: BuyerPolicy,
  buyerTerms?: Partial<NegotiationTerms>
) {
  const session = createNegotiationSession(listing, buyerPolicy, buyerTerms);
  const database = getPool();
  if (!database) return session;
  const client = await database.connect();
  try {
    await client.query('begin');
    await insertSession(client, session);
    await client.query('commit');
    return session;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function getPersistedSession(sessionId: string) {
  const database = getPool();
  if (database) {
    const persisted = await loadSessionFromDatabase(sessionId);
    if (persisted) return persisted;
  }
  return getSession(sessionId);
}

export async function getPersistedPublicSession(sessionId: string) {
  const session = await getPersistedSession(sessionId);
  return session ? toPublicSession(session) : undefined;
}

export async function commitPersistedSession(
  nextSession: NegotiationSession,
  expectedVersion: number,
  eventType = 'session.updated'
) {
  const database = getPool();
  if (!database) return commitSession(nextSession, expectedVersion, eventType as 'session.updated');

  const current = await getPersistedSession(nextSession.id);
  if (!current) throw new Error('SESSION_NOT_FOUND');
  if ((current.version ?? 0) !== expectedVersion) throw new Error('SESSION_VERSION_CONFLICT');

  const committedVersion = expectedVersion + 1;
  const committedCandidate: NegotiationSession = {
    ...nextSession,
    version: committedVersion,
    threadId: current.threadId ?? nextSession.threadId,
    updatedAt: new Date().toISOString(),
  };
  const client = await database.connect();
  try {
    await client.query('begin');
    const locked = await client.query('select version from negotiations where id = $1 for update', [nextSession.id]);
    if (!locked.rows[0] || Number(locked.rows[0].version) !== expectedVersion) {
      throw new Error('SESSION_VERSION_CONFLICT');
    }
    await upsertListing(client, committedCandidate.listing);
    await client.query(
      `update negotiations set
        thread_id = $2, listing_id = $3, listing_snapshot = $4,
        status = $5, current_turn = $6, current_offer_price_jpy = $7,
        waiting_until_at = $8, version = $9, deal_summary = $10, agent_memory = $11, updated_at = $12
       where id = $1`,
      [
        committedCandidate.id,
        committedCandidate.threadId,
        committedCandidate.listing.id,
        jsonValue(committedCandidate.listing),
        committedCandidate.status,
        committedCandidate.currentTurn,
        committedCandidate.currentOfferPrice ?? null,
        committedCandidate.waitingUntilAt ? new Date(committedCandidate.waitingUntilAt) : null,
        committedVersion,
        jsonValue(committedCandidate.dealSummary),
        jsonValue(committedCandidate.agentMemory),
        new Date(committedCandidate.updatedAt),
      ]
    );
    await client.query(
      `update negotiation_policies set buyer_policy = $2, seller_policy = $3, encrypted_private_state = $4, updated_at = now()
       where negotiation_id = $1`,
      [
        committedCandidate.id,
        jsonValue(committedCandidate.buyerPolicy),
        jsonValue(committedCandidate.sellerPolicy),
        encryptPrivateState({ buyer: committedCandidate.buyerPrivateState, seller: committedCandidate.sellerPrivateState }),
      ]
    );
    for (const offer of committedCandidate.offers) await insertOffer(client, committedCandidate, offer);
    await insertEvent(client, committedCandidate, eventType);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }

  return commitSession(nextSession, expectedVersion, eventType as 'session.updated');
}

export async function getPersistedIdempotentAction(key: string): Promise<PersistedIdempotentAction | undefined> {
  const database = getPool();
  if (database) {
    const result = await database.query(
      'select negotiation_id, version, response from negotiation_idempotency where idempotency_key = $1',
      [key]
    );
    const row = result.rows[0];
    if (row) {
      const value: PersistedIdempotentAction = {
        sessionId: String(row.negotiation_id),
        version: Number(row.version),
        response: rowJson<PersistedIdempotentAction['response']>(row.response) as PersistedIdempotentAction['response'],
      };
      rememberIdempotentAction(key, value.sessionId, value.version, value.response);
      return value;
    }
  }
  return getIdempotentAction(key);
}

export async function rememberPersistedAction(
  key: string,
  sessionId: string,
  version: number,
  response: PersistedIdempotentAction['response']
) {
  rememberIdempotentAction(key, sessionId, version, response);
  const database = getPool();
  if (!database) return;
  await database.query(
    `insert into negotiation_idempotency (idempotency_key, negotiation_id, version, response)
     values ($1,$2,$3,$4)
     on conflict (idempotency_key) do nothing`,
    [key, sessionId, version, jsonValue(response)]
  );
}
