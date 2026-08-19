import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Client, Pool } from 'pg';
import type { QueryResult, QueryResultRow } from 'pg';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { isProductionEnvironment } from '@/lib/runtime/environment';
import {
  BuyerPolicy,
  ApprovalTaskKind,
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
  requestHash: string;
  response: ReturnType<typeof toPublicSession>;
};

type PrivateStateEnvelope = {
  buyer: PrivateState;
  seller: PrivateState;
  buyerPolicy: BuyerPolicy;
  sellerPolicy: SellerPolicy;
};

export type PersistedApprovalSeed = {
  id: string;
  ownerId: string;
  kind: ApprovalTaskKind;
  title: string;
  payload: unknown;
  subjectType: 'offer' | 'contract';
  subjectId: string;
  subjectVersion: number;
  proposalHash: string;
  requestedBy: string;
  expiresAt: string;
};

export type PersistedApprovalResolution = {
  id: string;
  expectedVersion: number;
  status: 'approved' | 'rejected';
  resolvedBy?: string;
};

export interface DatabaseClient {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  release(): Promise<void>;
}

export interface DatabasePool {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  connect(): Promise<DatabaseClient>;
}

type HyperdriveRuntimeEnv = {
  HYPERDRIVE?: {
    connectionString?: string;
  };
};

let localPool: Pool | undefined;
let databaseHandle: DatabasePool | undefined;
let databaseSource: string | undefined;

function getHyperdriveConnectionString() {
  try {
    const runtimeEnv = getCloudflareContext().env as HyperdriveRuntimeEnv;
    return runtimeEnv.HYPERDRIVE?.connectionString?.trim();
  } catch {
    // The Cloudflare context is unavailable during normal Node.js tests and
    // the Next.js build. In those environments, process.env is authoritative.
    return undefined;
  }
}

function getConnectionString() {
  return getHyperdriveConnectionString()
    || process.env.DATABASE_URL?.trim()
    || process.env.POSTGRES_URL?.trim()
    || process.env.NEON_DATABASE_URL?.trim();
}

/**
 * A production negotiation must have an authoritative database. Falling back
 * to a process-local Map would lose state on restart or across instances.
 */
export function assertPersistenceReady() {
  if (isProductionEnvironment() && !getConnectionString()) {
    throw new Error('DATABASE_REQUIRED_IN_PRODUCTION');
  }
}

function createNodeDatabase(pool: Pool): DatabasePool {
  return {
    query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
      return pool.query<T>(text, values);
    },
    async connect() {
      const client = await pool.connect();
      return {
        query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
          return client.query<T>(text, values);
        },
        async release() {
          client.release();
        },
      };
    },
  };
}

function createHyperdriveDatabase(connectionString: string): DatabasePool {
  const newClient = () => new Client({ connectionString });
  return {
    async query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
      const client = newClient();
      await client.connect();
      try {
        return await client.query<T>(text, values);
      } finally {
        await client.end();
      }
    },
    async connect() {
      const client = newClient();
      await client.connect();
      return {
        query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
          return client.query<T>(text, values);
        },
        release() {
          return client.end();
        },
      };
    },
  };
}

function getPool() {
  const connectionString = getConnectionString();
  if (!connectionString) return undefined;
  if (databaseHandle && databaseSource === connectionString) return databaseHandle;

  const hyperdriveConnectionString = getHyperdriveConnectionString();
  if (hyperdriveConnectionString) {
    databaseHandle = createHyperdriveDatabase(hyperdriveConnectionString);
  } else {
    localPool ??= new Pool({ connectionString, max: 5 });
    databaseHandle = createNodeDatabase(localPool);
  }
  databaseSource = connectionString;
  return databaseHandle;
}

/** Shared database handle for workflow repositories that use the same schema. */
export function getDatabasePool() {
  assertPersistenceReady();
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

function encryptPrivateState(value: PrivateStateEnvelope) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getPrivateStateKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function decryptPrivateState(value: Buffer | string): PrivateStateEnvelope {
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(value, 'base64');
  const iv = payload.subarray(0, 12);
  const authTag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', getPrivateStateKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  return JSON.parse(decrypted) as PrivateStateEnvelope;
}

function jsonValue(value: unknown) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function iso(value: unknown, fallback: string) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

async function upsertListing(client: DatabaseClient, listing: Listing) {
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

async function insertOffer(client: DatabaseClient, session: NegotiationSession, offer: NegotiationOffer) {
  await client.query(
    `insert into negotiation_offers (
      id, negotiation_id, version, proposal_hash, target_offer_id, target_offer_version,
      round, sender_role, sender_name, action_type, price_jpy,
      wait_time_hours, public_message, terms, reasoning, decision, alternatives
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    on conflict (id) do nothing`,
    [
      offer.id,
      session.id,
      offer.version ?? 1,
      offer.proposalHash ?? null,
      offer.targetOfferId ?? null,
      offer.targetOfferVersion ?? null,
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

async function insertEvent(client: DatabaseClient, session: NegotiationSession, eventType: string) {
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

async function insertSession(client: DatabaseClient, session: NegotiationSession) {
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
      session.buyerId,
      session.sellerId,
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
      null,
      null,
      encryptPrivateState({
        buyer: session.buyerPrivateState,
        seller: session.sellerPrivateState,
        buyerPolicy: session.buyerPolicy,
        sellerPolicy: session.sellerPolicy,
      }),
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
      `select id, thread_id, listing_snapshot, buyer_id, seller_id, status, current_turn,
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
      `select id, version, proposal_hash, target_offer_id, target_offer_version, round, sender_role, sender_name, action_type, price_jpy,
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
      buyerId: String(row.buyer_id),
      sellerId: String(row.seller_id),
      listing,
      buyerPolicy: privateState.buyerPolicy ?? rowJson<BuyerPolicy>(policyRow.buyer_policy) as BuyerPolicy,
      sellerPolicy: privateState.sellerPolicy ?? rowJson<SellerPolicy>(policyRow.seller_policy) as SellerPolicy,
      buyerPrivateState: privateState.buyer,
      sellerPrivateState: privateState.seller,
      offers: offers.rows.map((offer) => ({
        id: String(offer.id),
        version: Number(offer.version ?? 1),
        proposalHash: offer.proposal_hash ? String(offer.proposal_hash) : undefined,
        targetOfferId: offer.target_offer_id ? String(offer.target_offer_id) : undefined,
        targetOfferVersion: offer.target_offer_version === null ? undefined : Number(offer.target_offer_version),
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
    await client.release();
  }
}

export async function createPersistedNegotiationSession(
  listing: Listing,
  buyerPolicy?: BuyerPolicy,
  buyerTerms?: Partial<NegotiationTerms>,
  owners?: { buyerId?: string; sellerId?: string }
) {
  assertPersistenceReady();
  const session = createNegotiationSession(listing, buyerPolicy, buyerTerms, owners);
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
    await client.release();
  }
}

export async function getPersistedSession(sessionId: string) {
  assertPersistenceReady();
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
  eventType = 'session.updated',
  idempotency?: {
    key: string;
    requestHash: string;
    approval?: PersistedApprovalSeed;
    approvalResolution?: PersistedApprovalResolution;
  }
) {
  assertPersistenceReady();
  const database = getPool();
  if (!database) {
    const committed = commitSession(nextSession, expectedVersion, eventType as 'session.updated');
    if (idempotency) rememberIdempotentAction(idempotency.key, committed.id, committed.version ?? 0, toPublicSession(committed), idempotency.requestHash);
    return committed;
  }

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
        null,
        null,
        encryptPrivateState({
          buyer: committedCandidate.buyerPrivateState,
          seller: committedCandidate.sellerPrivateState,
          buyerPolicy: committedCandidate.buyerPolicy,
          sellerPolicy: committedCandidate.sellerPolicy,
        }),
      ]
    );
    for (const offer of committedCandidate.offers) await insertOffer(client, committedCandidate, offer);
    await insertEvent(client, committedCandidate, eventType);
    if (idempotency?.approval) {
      const approval = idempotency.approval;
      await client.query(
        `insert into approval_tasks (
          id, negotiation_id, owner_id, kind, status, title, payload,
          subject_type, subject_id, subject_version, proposal_hash,
          requested_by, expires_at, version, created_at
        ) values ($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9,$10,$11,$12,1,$13)
        on conflict (id) do nothing`,
        [
          approval.id,
          committedCandidate.id,
          approval.ownerId,
          approval.kind,
          approval.title,
          jsonValue(approval.payload),
          approval.subjectType,
          approval.subjectId,
          approval.subjectVersion,
          approval.proposalHash,
          approval.requestedBy,
          new Date(approval.expiresAt),
          new Date(committedCandidate.updatedAt),
        ]
      );
    }
    if (idempotency?.approvalResolution) {
      const resolution = idempotency.approvalResolution;
      const result = await client.query(
        `update approval_tasks
         set status = $2, version = version + 1, resolved_at = now(), resolved_by = $4
         where id = $1 and status = 'pending' and version = $3
         returning version, resolved_at`,
        [resolution.id, resolution.status, resolution.expectedVersion, resolution.resolvedBy ?? null]
      );
      if (!result.rows[0]) throw new Error('APPROVAL_VERSION_CONFLICT');
    }
    if (idempotency) {
      await client.query(
        `insert into negotiation_idempotency (idempotency_key, negotiation_id, version, request_hash, response)
         values ($1,$2,$3,$4,$5) on conflict (negotiation_id, idempotency_key) do nothing`,
        [idempotency.key, committedCandidate.id, committedVersion, idempotency.requestHash, jsonValue(toPublicSession(committedCandidate))]
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.release();
  }

  const committed = commitSession(nextSession, expectedVersion, eventType as 'session.updated');
  if (idempotency) rememberIdempotentAction(idempotency.key, committed.id, committed.version ?? 0, toPublicSession(committed), idempotency.requestHash);
  return committed;
}

export async function getPersistedIdempotentAction(
  sessionId: string,
  key: string,
  requestHash?: string
): Promise<PersistedIdempotentAction | undefined> {
  assertPersistenceReady();
  const database = getPool();
  if (database) {
    const result = await database.query(
      'select negotiation_id, version, request_hash, response from negotiation_idempotency where negotiation_id = $1 and idempotency_key = $2',
      [sessionId, key]
    );
    const row = result.rows[0];
    if (row) {
      const value: PersistedIdempotentAction = {
        sessionId: String(row.negotiation_id),
        version: Number(row.version),
        requestHash: String(row.request_hash ?? ''),
        response: rowJson<PersistedIdempotentAction['response']>(row.response) as PersistedIdempotentAction['response'],
      };
      rememberIdempotentAction(key, value.sessionId, value.version, value.response, value.requestHash);
      if (requestHash && value.requestHash && requestHash !== value.requestHash) throw new Error('IDEMPOTENCY_KEY_REUSE');
      return value;
    }
  }
  const cached = getIdempotentAction(sessionId, key);
  if (cached && requestHash && cached.requestHash && requestHash !== cached.requestHash) throw new Error('IDEMPOTENCY_KEY_REUSE');
  return cached;
}

export async function rememberPersistedAction(
  key: string,
  sessionId: string,
  version: number,
  response: PersistedIdempotentAction['response'],
  requestHash = ''
) {
  assertPersistenceReady();
  rememberIdempotentAction(key, sessionId, version, response, requestHash);
  const database = getPool();
  if (!database) return;
  await database.query(
    `insert into negotiation_idempotency (idempotency_key, negotiation_id, version, request_hash, response)
     values ($1,$2,$3,$4,$5)
     on conflict (negotiation_id, idempotency_key) do nothing`,
    [key, sessionId, version, requestHash, jsonValue(response)]
  );
}
