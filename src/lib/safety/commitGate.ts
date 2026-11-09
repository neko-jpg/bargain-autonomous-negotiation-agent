import { randomUUID } from 'node:crypto';
import { canonicalJson, constantTimeEqualHex, hashCanonical, hmacHex } from '@/lib/safety/hash';

/**
 * Commit Gate — a small, domain-agnostic chokepoint for irreversible effects.
 *
 * An autonomous agent may *propose* an irreversible effect (pay, ship, sign,
 * delete, send). Only this gate may *execute* one, and only when:
 *
 *   1. the kill switch is released,
 *   2. every approver required by a deterministic policy holds a signed grant
 *      bound to the exact intent hash (or the policy pre-authorizes it), and
 *   3. the intent has not already been reserved (at most one attempt).
 *
 * Nothing here knows about negotiations; see src/lib/negotiation/commit.ts for
 * the purchase binding and examples/ for a second domain.
 */

export class SafetyError extends Error {
  constructor(public readonly code: string, public readonly detail?: Record<string, unknown>) {
    super(code);
  }
}

export interface IrreversibleIntent<P = unknown> {
  /** Effect type, e.g. `purchase.commit`. */
  kind: string;
  /** The aggregate the effect belongs to, e.g. a negotiation id. */
  subjectId: string;
  /** Money (or other quantity) at stake, used by policies and reports. */
  amount: number;
  currency: string;
  /** Everything the executor will act on. It is hashed, so it cannot drift. */
  payload: P;
}

export interface RequiredApprover {
  id: string;
  role: string;
  reason: string;
}

export type AuthorizationRequirement =
  | { mode: 'policy'; policyId: string; reason: string }
  | { mode: 'human'; approvers: RequiredApprover[]; reason: string };

export interface ApprovalGrant {
  id: string;
  intentHash: string;
  approverId: string;
  approverRole: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export type EffectAuthorization =
  | { mode: 'policy'; policyId: string }
  | { mode: 'human'; grants: Array<{ grantId: string; approverId: string; approverRole: string }> };

/** `voided`: a human confirmed the effect never happened. Terminal; never re-run. */
export type LedgerStatus = 'reserved' | 'executed' | 'failed' | 'voided';

export interface LedgerEntry {
  effectId: string;
  intentHash: string;
  kind: string;
  subjectId: string;
  amount: number;
  currency: string;
  payload: unknown;
  authorization: EffectAuthorization;
  executor: string;
  status: LedgerStatus;
  externalRef?: string;
  error?: string;
  createdAt: string;
  reservedAt: string;
  executedAt?: string;
  /** Set when a human reconciled an ambiguous attempt. */
  resolution?: EffectResolution;
}

export interface EffectResolution {
  outcome: 'executed' | 'not_executed';
  resolvedBy: string;
  resolvedAt: string;
  note: string;
}

export interface EffectReceipt {
  effectId: string;
  intentHash: string;
  kind: string;
  amount: number;
  currency: string;
  authorization: EffectAuthorization;
  executor: string;
  externalRef?: string;
  executedAt: string;
}

export interface EffectExecutor {
  readonly name: string;
  execute(intent: IrreversibleIntent, context: { effectId: string; intentHash: string; idempotencyKey: string }): Promise<{ externalRef?: string }>;
}

export interface EffectLedger {
  get(intentHash: string): Promise<LedgerEntry | undefined>;
  /**
   * Atomically claims an intent. `reserved` means the caller now owns the
   * execution; `executed` means it already happened; `in_progress` means
   * an earlier reservation or failed attempt requires reconciliation.
   */
  reserve(entry: LedgerEntry): Promise<{ outcome: 'reserved' | 'executed' | 'in_progress'; entry: LedgerEntry }>;
  markExecuted(intentHash: string, externalRef: string | undefined, executedAt: string): Promise<LedgerEntry>;
  markFailed(intentHash: string, error: string): Promise<void>;
  /**
   * Compare-and-set from `from` to the resolved status. Returns undefined when
   * the entry is no longer in `from` (someone else resolved or executed it).
   */
  resolve(intentHash: string, from: LedgerStatus, resolution: EffectResolution, externalRef?: string): Promise<LedgerEntry | undefined>;
  list(subjectId?: string): Promise<LedgerEntry[]>;
}

export function hashIntent(intent: IrreversibleIntent) {
  return hashCanonical({ kind: intent.kind, subjectId: intent.subjectId, amount: intent.amount, currency: intent.currency, payload: intent.payload });
}

function grantSigningPayload(grant: Omit<ApprovalGrant, 'signature'>) {
  return canonicalJson({
    id: grant.id,
    intentHash: grant.intentHash,
    approverId: grant.approverId,
    approverRole: grant.approverRole,
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
  });
}

/**
 * Issues a grant. Call this only from a code path that has authenticated a
 * human approver and shown them the exact intent. An architecture test keeps
 * agent code from importing it.
 */
export function issueApprovalGrant(input: {
  intentHash: string;
  approverId: string;
  approverRole: string;
  ttlMs: number;
  secret: string;
  now?: Date;
}): ApprovalGrant {
  const issuedAt = (input.now ?? new Date()).toISOString();
  const unsigned = {
    id: `grant-${randomUUID()}`,
    intentHash: input.intentHash,
    approverId: input.approverId,
    approverRole: input.approverRole,
    issuedAt,
    expiresAt: new Date(Date.parse(issuedAt) + input.ttlMs).toISOString(),
  };
  return { ...unsigned, signature: hmacHex(input.secret, grantSigningPayload(unsigned)) };
}

export function verifyApprovalGrant(grant: ApprovalGrant, intentHash: string, secret: string, now = new Date()) {
  const { signature, ...unsigned } = grant;
  if (typeof signature !== 'string' || !constantTimeEqualHex(signature, hmacHex(secret, grantSigningPayload(unsigned)))) return 'GRANT_SIGNATURE_INVALID';
  if (grant.intentHash !== intentHash) return 'GRANT_INTENT_MISMATCH';
  const expiresAt = Date.parse(grant.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return 'GRANT_EXPIRED';
  return undefined;
}

/** Returns the authorization record, or throws when a required approval is missing or invalid. */
export function authorizeIntent(
  intentHash: string,
  requirement: AuthorizationRequirement,
  grants: ApprovalGrant[],
  secret: string,
  now = new Date()
): EffectAuthorization {
  if (requirement.mode === 'policy') return { mode: 'policy', policyId: requirement.policyId };
  if (requirement.approvers.length === 0) throw new SafetyError('APPROVAL_REQUIREMENT_EMPTY');
  const accepted: Array<{ grantId: string; approverId: string; approverRole: string }> = [];
  const missing: string[] = [];
  for (const approver of requirement.approvers) {
    const candidates = grants.filter((grant) => grant.approverId === approver.id && grant.approverRole === approver.role);
    const valid = candidates.find((grant) => verifyApprovalGrant(grant, intentHash, secret, now) === undefined);
    if (!valid) {
      const reasons = candidates.map((grant) => verifyApprovalGrant(grant, intentHash, secret, now));
      missing.push(`${approver.role}:${reasons[0] ?? 'GRANT_MISSING'}`);
      continue;
    }
    accepted.push({ grantId: valid.id, approverId: valid.approverId, approverRole: valid.approverRole });
  }
  if (missing.length > 0) throw new SafetyError('APPROVAL_REQUIRED', { missing });
  return { mode: 'human', grants: accepted };
}

function toReceipt(entry: LedgerEntry): EffectReceipt {
  return {
    effectId: entry.effectId,
    intentHash: entry.intentHash,
    kind: entry.kind,
    amount: entry.amount,
    currency: entry.currency,
    authorization: entry.authorization,
    executor: entry.executor,
    externalRef: entry.externalRef,
    executedAt: entry.executedAt ?? entry.reservedAt,
  };
}

export interface GateDependencies {
  ledger: EffectLedger;
  executor: EffectExecutor;
  isKillSwitchEngaged: () => Promise<boolean>;
  secret: string;
  now?: () => Date;
}

/**
 * The only function that runs an irreversible effect.
 * Order matters: authorize → idempotent replay → kill switch → reserve → run.
 */
export async function executeIrreversibleEffect(
  intent: IrreversibleIntent,
  requirement: AuthorizationRequirement,
  grants: ApprovalGrant[],
  deps: GateDependencies
): Promise<{ receipt: EffectReceipt; duplicate: boolean }> {
  const now = deps.now?.() ?? new Date();
  const intentHash = hashIntent(intent);
  const authorization = authorizeIntent(intentHash, requirement, grants, deps.secret, now);

  const existing = await deps.ledger.get(intentHash);
  if (existing?.status === 'executed') return { receipt: toReceipt(existing), duplicate: true };
  if (existing?.status === 'failed') throw new SafetyError('EFFECT_RESULT_UNKNOWN');
  if (existing?.status === 'voided') throw new SafetyError('EFFECT_VOIDED');

  if (await deps.isKillSwitchEngaged()) throw new SafetyError('KILL_SWITCH_ENGAGED');

  const timestamp = now.toISOString();
  const reservation = await deps.ledger.reserve({
    effectId: existing?.effectId ?? `effect-${randomUUID()}`,
    intentHash,
    kind: intent.kind,
    subjectId: intent.subjectId,
    amount: intent.amount,
    currency: intent.currency,
    payload: intent.payload,
    authorization,
    executor: deps.executor.name,
    status: 'reserved',
    createdAt: existing?.createdAt ?? timestamp,
    reservedAt: timestamp,
  });
  if (reservation.outcome === 'executed') return { receipt: toReceipt(reservation.entry), duplicate: true };
  if (reservation.outcome === 'in_progress') throw new SafetyError('EFFECT_IN_PROGRESS');

  // Once reserved, never release automatically: a crash may have happened after
  // the external service acted. This also makes a late stop conservative.
  if (await deps.isKillSwitchEngaged()) {
    await deps.ledger.markFailed(intentHash, 'KILL_SWITCH_BEFORE_EXECUTION');
    throw new SafetyError('KILL_SWITCH_ENGAGED');
  }

  let externalRef: string | undefined;
  try {
    ({ externalRef } = await deps.executor.execute(intent, {
      effectId: reservation.entry.effectId,
      intentHash,
      idempotencyKey: intentHash,
    }));
  } catch (error) {
    await deps.ledger.markFailed(intentHash, error instanceof Error ? error.message : String(error));
    throw new SafetyError('EFFECT_EXECUTION_FAILED', { executor: deps.executor.name });
  }
  const executed = await deps.ledger.markExecuted(intentHash, externalRef, (deps.now?.() ?? new Date()).toISOString());
  return { receipt: toReceipt(executed), duplicate: false };
}

/** A reservation older than this with no outcome is treated as a crashed attempt. */
export const STALE_RESERVATION_MS = 5 * 60_000;

/**
 * Records what a human verified out of band (e.g. in the payment provider's
 * dashboard) about an attempt whose outcome the gate could not observe. It
 * never runs the executor: `executed` adopts the original authorization,
 * `not_executed` voids the intent so it can never run. Only failed or stale
 * reservations qualify, so it cannot be used to fabricate a purchase.
 */
export async function reconcileEffect(
  intentHash: string,
  resolution: EffectResolution,
  deps: { ledger: EffectLedger; now?: () => Date },
  externalRef?: string
): Promise<{ entry: LedgerEntry; receipt?: EffectReceipt }> {
  const entry = await deps.ledger.get(intentHash);
  if (!entry) throw new SafetyError('EFFECT_NOT_RECONCILABLE', { status: 'missing' });
  const target = resolution.outcome === 'executed' ? 'executed' : 'voided';
  // Repeating the same verdict is idempotent; contradicting a recorded one is not.
  if (entry.resolution && entry.status === target && entry.resolution.outcome === resolution.outcome) {
    return { entry, receipt: target === 'executed' ? toReceipt(entry) : undefined };
  }
  const now = (deps.now?.() ?? new Date()).getTime();
  const stale = entry.status === 'reserved' && now - Date.parse(entry.reservedAt) >= STALE_RESERVATION_MS;
  if (entry.status !== 'failed' && !stale) throw new SafetyError('EFFECT_NOT_RECONCILABLE', { status: entry.status });
  const resolved = await deps.ledger.resolve(intentHash, entry.status, resolution, externalRef);
  if (!resolved) throw new SafetyError('LEDGER_STATE_CONFLICT');
  return { entry: resolved, receipt: target === 'executed' ? toReceipt(resolved) : undefined };
}

/** Process-local ledger for development, tests and the reuse example. */
export class MemoryEffectLedger implements EffectLedger {
  private readonly entries = new Map<string, LedgerEntry>();

  async get(intentHash: string) {
    const entry = this.entries.get(intentHash);
    return entry ? structuredClone(entry) : undefined;
  }

  async reserve(entry: LedgerEntry) {
    const existing = this.entries.get(entry.intentHash);
    if (existing?.status === 'executed') return { outcome: 'executed' as const, entry: structuredClone(existing) };
    if (existing) return { outcome: 'in_progress' as const, entry: structuredClone(existing) };
    const reserved = { ...structuredClone(entry), status: 'reserved' as const, error: undefined };
    this.entries.set(entry.intentHash, reserved);
    return { outcome: 'reserved' as const, entry: structuredClone(reserved) };
  }

  async markExecuted(intentHash: string, externalRef: string | undefined, executedAt: string) {
    const entry = this.entries.get(intentHash);
    if (!entry) throw new SafetyError('LEDGER_ENTRY_MISSING');
    const executed = { ...entry, status: 'executed' as const, externalRef, executedAt };
    this.entries.set(intentHash, executed);
    return structuredClone(executed);
  }

  async markFailed(intentHash: string, error: string) {
    const entry = this.entries.get(intentHash);
    if (entry?.status === 'reserved') this.entries.set(intentHash, { ...entry, status: 'failed', error });
  }

  async resolve(intentHash: string, from: LedgerStatus, resolution: EffectResolution, externalRef?: string) {
    const entry = this.entries.get(intentHash);
    if (!entry || entry.status !== from) return undefined;
    const executed = resolution.outcome === 'executed';
    const resolved: LedgerEntry = {
      ...entry,
      status: executed ? 'executed' : 'voided',
      resolution: { ...resolution },
      externalRef: executed ? externalRef ?? entry.externalRef : entry.externalRef,
      executedAt: executed ? resolution.resolvedAt : entry.executedAt,
    };
    this.entries.set(intentHash, resolved);
    return structuredClone(resolved);
  }

  async list(subjectId?: string) {
    return Array.from(this.entries.values())
      .filter((entry) => !subjectId || entry.subjectId === subjectId)
      .map((entry) => structuredClone(entry));
  }
}
