import {
  ApprovalGrant,
  AuthorizationRequirement,
  EffectAuthorization,
  EffectExecutor,
  EffectLedger,
  GateDependencies,
  hashIntent,
  IrreversibleIntent,
  issueApprovalGrant,
  LedgerEntry,
  MemoryEffectLedger,
  RequiredApprover,
  SafetyError,
} from '@/lib/safety/commitGate';
import { hashCanonical } from '@/lib/safety/hash';
import { SandboxEffectExecutor, WebhookEffectExecutor } from '@/lib/safety/executors';
import { NegotiationOffer, NegotiationSession, PurchaseIntentPayload } from '@/types/negotiation';
import { defaultNegotiationTerms, totalOfferCost } from '@/lib/negotiation/terms';
import { buyerCommitApprovalReason, sellerCommitApprovalReason } from '@/lib/negotiation/policyEngine';
import { getDatabasePool } from '@/lib/negotiation/persistence';
import { isKillSwitchEngaged } from '@/lib/negotiation/safetyControls';
import { isProductionEnvironment } from '@/lib/runtime/environment';

/**
 * Binds the domain-agnostic Commit Gate to BARGAIN's one irreversible effect:
 * committing the buyer to a purchase (`purchase.commit`).
 *
 * Agents can only *reach agreement*. Agreement moves the session to
 * `awaiting_commit` with a hashed intent; the purchase itself runs through
 * executeIrreversibleEffect() in service.ts, never from agent code.
 */

export const PURCHASE_COMMIT_KIND = 'purchase.commit';
export const COMMIT_TTL_MS = 24 * 60 * 60 * 1000;
export const GRANT_TTL_MS = 15 * 60 * 1000;

export function buildPurchaseIntent(session: NegotiationSession, agreementOffer: NegotiationOffer): IrreversibleIntent<PurchaseIntentPayload> {
  const terms = agreementOffer.terms ?? defaultNegotiationTerms(session.listing);
  const total = totalOfferCost(agreementOffer.price, terms);
  return {
    kind: PURCHASE_COMMIT_KIND,
    subjectId: session.id,
    amount: total,
    currency: terms.currency,
    payload: {
      negotiationId: session.id,
      agreementOfferId: agreementOffer.id,
      acceptedOfferId: agreementOffer.targetOfferId,
      listingId: session.listing.id,
      buyerId: session.buyerId,
      sellerId: session.sellerId,
      price: agreementOffer.price,
      terms,
      total,
    },
  };
}

/** Deterministic: who (if anyone) must sign before the purchase may run. */
export function purchaseRequirement(session: NegotiationSession, payload: PurchaseIntentPayload): AuthorizationRequirement {
  const approvers: RequiredApprover[] = [];
  const buyerReason = buyerCommitApprovalReason(session.buyerPolicy, payload.total);
  if (buyerReason) approvers.push({ id: session.buyerId, role: 'buyer', reason: buyerReason });
  const sellerReason = sellerCommitApprovalReason(session.sellerPolicy, payload.price);
  if (sellerReason) approvers.push({ id: session.sellerId, role: 'seller', reason: sellerReason });
  if (approvers.length > 0) return { mode: 'human', approvers, reason: 'policy_requires_human_approval' };
  return {
    mode: 'policy',
    // Record exactly which policy values pre-authorized the purchase.
    policyId: `policy:${hashCanonical({
      buyer: { autoPurchase: session.buyerPolicy.autoPurchase, maxPrice: session.buyerPolicy.maxPrice, autoApprovalMaxPrice: session.buyerPolicy.autoApprovalMaxPrice },
      seller: { autoAccept: session.sellerPolicy.autoAccept, minPrice: session.sellerPolicy.minPrice, autoApprovalMinPrice: session.sellerPolicy.autoApprovalMinPrice },
    }).slice(0, 16)}`,
    reason: 'within_auto_approval_policy',
  };
}

/** Pure transition used by both the agent graph and human acceptance. */
export function beginPurchaseCommit(session: NegotiationSession, agreementOffer: NegotiationOffer, now = new Date()): NegotiationSession {
  const intent = buildPurchaseIntent(session, agreementOffer);
  const offerExpiry = agreementOffer.terms?.expiresAt ? Date.parse(agreementOffer.terms.expiresAt) : Number.NaN;
  const defaultExpiry = now.getTime() + COMMIT_TTL_MS;
  const expiresAt = new Date(Number.isFinite(offerExpiry) ? Math.min(offerExpiry, defaultExpiry) : defaultExpiry).toISOString();
  return {
    ...session,
    status: 'awaiting_commit',
    waitingUntilAt: undefined,
    waitingUntilHours: undefined,
    dealSummary: undefined,
    pendingCommit: {
      intent,
      intentHash: hashIntent(intent),
      requirement: purchaseRequirement(session, intent.payload),
      grants: [],
      createdAt: now.toISOString(),
      expiresAt,
    },
  };
}

export function grantSecret() {
  const configured = (process.env.BARGAIN_GRANT_SECRET ?? process.env.BARGAIN_SESSION_SECRET)?.trim();
  if (configured && configured.length >= 32 && !/^(your_|placeholder|replace_me|change_me)/i.test(configured)) return configured;
  if (isProductionEnvironment()) throw new SafetyError('GRANT_SECRET_NOT_CONFIGURED');
  return 'development-only-bargain-grant-secret';
}

export function requiredApproverFor(session: NegotiationSession, actor: { id: string; role: string }) {
  const requirement = session.pendingCommit?.requirement;
  if (!requirement || requirement.mode !== 'human') return undefined;
  return requirement.approvers.find((approver) => approver.id === actor.id && approver.role === actor.role);
}

/**
 * Records a human approval for the exact pending intent. Callers must have
 * authenticated `actor` and checked that it saw `expectedIntentHash`.
 */
export function grantPurchaseApproval(session: NegotiationSession, actor: { id: string; role: string }, expectedIntentHash: string, now = new Date()): NegotiationSession {
  const pending = session.pendingCommit;
  if (!pending) throw new SafetyError('NO_PENDING_COMMIT');
  if (pending.intentHash !== expectedIntentHash) throw new SafetyError('COMMIT_INTENT_MISMATCH');
  if (hashIntent(pending.intent) !== pending.intentHash) throw new SafetyError('COMMIT_INTENT_TAMPERED');
  if (Date.parse(pending.expiresAt) <= now.getTime()) throw new SafetyError('COMMIT_EXPIRED');
  const approver = requiredApproverFor(session, actor);
  if (!approver) throw new SafetyError('COMMIT_APPROVER_FORBIDDEN');
  const grant: ApprovalGrant = issueApprovalGrant({
    intentHash: pending.intentHash,
    approverId: approver.id,
    approverRole: approver.role,
    ttlMs: Math.max(1, Math.min(GRANT_TTL_MS, Date.parse(pending.expiresAt) - now.getTime())),
    secret: grantSecret(),
    now,
  });
  return {
    ...session,
    pendingCommit: {
      ...pending,
      grants: [...pending.grants.filter((item) => item.approverId !== approver.id || item.approverRole !== approver.role), grant],
      blockedReason: undefined,
    },
  };
}

export function hasLiveGrant(session: NegotiationSession, approver: { id: string; role: string }, now = new Date()) {
  return Boolean(session.pendingCommit?.grants.some((grant) => grant.approverId === approver.id
    && grant.approverRole === approver.role
    && Date.parse(grant.expiresAt) > now.getTime()));
}

export function missingApprovals(session: NegotiationSession, now = new Date()) {
  const pending = session.pendingCommit;
  if (!pending || pending.requirement.mode !== 'human') return [];
  return pending.requirement.approvers.filter((approver) => !hasLiveGrant(session, approver, now));
}

// ---------------------------------------------------------------------------
// Ledger and executor wiring
// ---------------------------------------------------------------------------

const ledgerState = globalThis as typeof globalThis & { __bargainEffectLedger?: MemoryEffectLedger };

function rowJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

function toEntry(row: Record<string, unknown>): LedgerEntry {
  const date = (value: unknown) => (value ? new Date(value as string).toISOString() : undefined);
  return {
    effectId: String(row.effect_id),
    intentHash: String(row.intent_hash),
    kind: String(row.kind),
    subjectId: String(row.subject_id),
    amount: Number(row.amount),
    currency: String(row.currency),
    payload: rowJson(row.payload),
    authorization: rowJson<EffectAuthorization>(row.authorization_record),
    executor: String(row.executor),
    status: row.status as LedgerEntry['status'],
    externalRef: row.external_ref ? String(row.external_ref) : undefined,
    error: row.error ? String(row.error) : undefined,
    createdAt: date(row.created_at) ?? new Date().toISOString(),
    reservedAt: date(row.reserved_at) ?? new Date().toISOString(),
    executedAt: date(row.executed_at),
  };
}

/** Outbox ledger. The primary key on intent_hash makes double execution impossible across instances. */
export class PostgresEffectLedger implements EffectLedger {
  private database() {
    const database = getDatabasePool();
    if (!database) throw new SafetyError('LEDGER_DATABASE_UNAVAILABLE');
    return database;
  }

  async get(intentHash: string) {
    const result = await this.database().query('select * from effect_outbox where intent_hash = $1', [intentHash]);
    return result.rows[0] ? toEntry(result.rows[0]) : undefined;
  }

  async reserve(entry: LedgerEntry, leaseMs: number) {
    const database = this.database();
    const inserted = await database.query(
      `insert into effect_outbox (intent_hash, effect_id, kind, subject_id, amount, currency, payload, authorization_record, executor, status, created_at, reserved_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'reserved',$10,$11)
       on conflict (intent_hash) do nothing
       returning *`,
      [entry.intentHash, entry.effectId, entry.kind, entry.subjectId, entry.amount, entry.currency, JSON.stringify(entry.payload), JSON.stringify(entry.authorization), entry.executor, new Date(entry.createdAt), new Date(entry.reservedAt)]
    );
    if (inserted.rows[0]) return { outcome: 'reserved' as const, entry: toEntry(inserted.rows[0]) };
    const leaseCutoff = new Date(Date.parse(entry.reservedAt) - leaseMs);
    const retaken = await database.query(
      `update effect_outbox set status = 'reserved', reserved_at = $2, authorization_record = $3, executor = $4, error = null
       where intent_hash = $1 and (status = 'failed' or (status = 'reserved' and reserved_at <= $5))
       returning *`,
      [entry.intentHash, new Date(entry.reservedAt), JSON.stringify(entry.authorization), entry.executor, leaseCutoff]
    );
    if (retaken.rows[0]) return { outcome: 'reserved' as const, entry: toEntry(retaken.rows[0]) };
    const current = await this.get(entry.intentHash);
    if (!current) throw new SafetyError('LEDGER_ENTRY_MISSING');
    return { outcome: current.status === 'executed' ? 'executed' as const : 'in_progress' as const, entry: current };
  }

  async markExecuted(intentHash: string, externalRef: string | undefined, executedAt: string) {
    const result = await this.database().query(
      `update effect_outbox set status = 'executed', external_ref = $2, executed_at = $3, error = null
       where intent_hash = $1 and status = 'reserved' returning *`,
      [intentHash, externalRef ?? null, new Date(executedAt)]
    );
    if (!result.rows[0]) throw new SafetyError('LEDGER_STATE_CONFLICT');
    return toEntry(result.rows[0]);
  }

  async markFailed(intentHash: string, error: string) {
    await this.database().query(
      "update effect_outbox set status = 'failed', error = $2 where intent_hash = $1 and status = 'reserved'",
      [intentHash, error.slice(0, 500)]
    );
  }

  async list(subjectId?: string) {
    const result = subjectId
      ? await this.database().query('select * from effect_outbox where subject_id = $1 order by created_at asc', [subjectId])
      : await this.database().query('select * from effect_outbox order by created_at asc');
    return result.rows.map((row) => toEntry(row));
  }
}

export function getEffectLedger(): EffectLedger {
  if (getDatabasePool()) return new PostgresEffectLedger();
  return (ledgerState.__bargainEffectLedger ??= new MemoryEffectLedger());
}

let executorOverride: EffectExecutor | undefined;

/** Test hook: swap the executor (e.g. a webhook pointed at a local server). */
export function setEffectExecutorForTesting(executor: EffectExecutor | undefined) {
  if (isProductionEnvironment()) throw new SafetyError('TEST_HOOK_DISABLED_IN_PRODUCTION');
  executorOverride = executor;
}

export function getEffectExecutor(): EffectExecutor {
  if (executorOverride) return executorOverride;
  const url = process.env.BARGAIN_EFFECT_WEBHOOK_URL?.trim();
  if (url) {
    const secret = process.env.BARGAIN_EFFECT_WEBHOOK_SECRET?.trim();
    if (!secret || secret.length < 32) throw new SafetyError('EFFECT_WEBHOOK_SECRET_REQUIRED');
    return new WebhookEffectExecutor(url, secret);
  }
  return new SandboxEffectExecutor();
}

export function gateDependencies(): GateDependencies {
  return {
    ledger: getEffectLedger(),
    executor: getEffectExecutor(),
    isKillSwitchEngaged,
    secret: grantSecret(),
  };
}
