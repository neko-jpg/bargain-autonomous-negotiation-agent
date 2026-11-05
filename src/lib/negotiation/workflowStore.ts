import { createHash, randomUUID } from 'node:crypto';
import type { DatabasePool } from '@/lib/negotiation/persistence';
import {
  ApprovalTask,
  ApprovalTaskStatus,
  ContractClause,
  ContractDraft,
  NegotiationOffer,
  NegotiationSession,
  NegotiationTerms,
  PartySnapshot,
} from '@/types/negotiation';
import { defaultNegotiationTerms, totalOfferCost } from '@/lib/negotiation/terms';
import { describeExpiry, quoteUntrusted } from '@/lib/text/sanitize';
import { DEFAULT_LOCALE } from '@/lib/i18n/config';
import { translate, type TranslationKey, type TranslationParams } from '@/lib/i18n/dictionary';
import { getDatabasePool } from '@/lib/negotiation/persistence';
import { executeNegotiationAction, ServiceActor } from '@/lib/negotiation/service';
import { hasLiveGrant, missingApprovals } from '@/lib/negotiation/commit';

interface WorkflowState {
  approvals?: Map<string, ApprovalTask>;
  contracts?: Map<string, ContractDraft>;
}

const globalState = globalThis as typeof globalThis & { __bargainWorkflow?: WorkflowState };
const state = (globalState.__bargainWorkflow ??= {});
const approvals = (state.approvals ??= new Map<string, ApprovalTask>());
const contracts = (state.contracts ??= new Map<string, ContractDraft>());

const clone = <T>(value: T): T => structuredClone(value);

const TASK_COLUMNS = 'id, negotiation_id, owner_id, kind, status, title, payload, subject_type, subject_id, subject_version, proposal_hash, requested_by, expires_at, version, created_at, resolved_at, resolved_by';

function rowJson<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
}

function taskFromRow(row: Record<string, unknown>): ApprovalTask {
  return {
    id: String(row.id),
    negotiationId: String(row.negotiation_id),
    ownerId: String(row.owner_id),
    kind: row.kind as ApprovalTask['kind'],
    status: row.status as ApprovalTask['status'],
    title: String(row.title),
    payload: rowJson(row.payload),
    version: Number(row.version),
    subjectType: row.subject_type as ApprovalTask['subjectType'],
    subjectId: String(row.subject_id),
    subjectVersion: Number(row.subject_version),
    proposalHash: String(row.proposal_hash ?? ''),
    requestedBy: String(row.requested_by ?? ''),
    expiresAt: new Date(row.expires_at as string).toISOString(),
    createdAt: new Date(row.created_at as string).toISOString(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string).toISOString() : undefined,
    resolvedBy: row.resolved_by ? String(row.resolved_by) : undefined,
  };
}

function hashContractDraft(draft: ContractDraft) {
  return createHash('sha256').update(JSON.stringify({
    id: draft.id,
    version: draft.version,
    agreedPrice: draft.agreedPrice,
    terms: draft.terms,
  })).digest('hex');
}

async function resolveContractApprovalInTransaction(
  database: DatabasePool,
  task: ApprovalTask,
  decision: 'approve' | 'reject',
  expectedVersion: number,
  actorId: string | undefined,
  expectedDraft: ContractDraft
) {
  const client = await database.connect();
  try {
    await client.query('begin');
    const taskResult = await client.query(
      `update approval_tasks
       set status = $2, version = version + 1, resolved_at = now(), resolved_by = $4
       where id = $1 and status = 'pending' and version = $3
       returning version, resolved_at`,
      [task.id, decision === 'approve' ? 'approved' : 'rejected', expectedVersion, actorId ?? null]
    );
    if (!taskResult.rows[0]) throw new Error('APPROVAL_VERSION_CONFLICT');

    const draftResult = await client.query(
      'select draft from negotiation_contracts where id = $1 and version = $2 for update',
      [expectedDraft.id, task.subjectVersion]
    );
    const draft = rowJson<ContractDraft>(draftResult.rows[0]?.draft);
    if (!draft || draft.version !== task.subjectVersion || hashContractDraft(draft) !== task.proposalHash) {
      throw new Error('APPROVAL_SUBJECT_STALE');
    }

    const updatedDraft: ContractDraft = {
      ...draft,
      status: decision === 'approve' ? 'approved' : 'rejected',
      approvedAt: decision === 'approve' ? new Date().toISOString() : undefined,
      updatedAt: new Date().toISOString(),
    };
    const contractResult = await client.query(
      `update negotiation_contracts
       set status = $2, draft = $3, updated_at = now(), approved_at = $4
       where id = $1 and version = $5`,
      [updatedDraft.id, updatedDraft.status, JSON.stringify(updatedDraft), decision === 'approve' ? new Date() : null, task.subjectVersion]
    );
    if (!contractResult.rowCount) throw new Error('APPROVAL_SUBJECT_STALE');
    await client.query('commit');
    return {
      version: Number(taskResult.rows[0].version),
      resolvedAt: taskResult.rows[0].resolved_at ? new Date(taskResult.rows[0].resolved_at).toISOString() : new Date().toISOString(),
      draft: updatedDraft,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.release();
  }
}

const party = (role: PartySnapshot['role'], id: string, name: string): PartySnapshot => ({ id, name, role });

function latestAcceptedOffer(session: NegotiationSession): NegotiationOffer | undefined {
  return [...session.offers].reverse().find((offer) => offer.actionType === 'accept_offer');
}

function contractClauses(session: NegotiationSession, terms: NegotiationTerms, agreedPrice: number): ContractClause[] {
  const total = totalOfferCost(agreedPrice, terms);
  const expiry = describeExpiry(terms.expiresAt);
  // Every value a counterparty can type is quoted, neutralised and labelled.
  // A clause body must never be able to look like a term this system wrote.
  //
  // Each clause keeps both its rendered text (for API clients and stored
  // drafts) and the dictionary key + parameters, so the UI can re-render the
  // same draft in whichever language the viewer is using.
  const clause = (
    id: string,
    titleKey: TranslationKey,
    bodyKey: TranslationKey,
    params: TranslationParams = {}
  ): ContractClause => ({
    id,
    title: translate(DEFAULT_LOCALE, titleKey, params),
    body: translate(DEFAULT_LOCALE, bodyKey, params),
    titleKey,
    bodyKey,
    params,
  });

  const shippingMethod = session.listing.shippingMethod;
  const deliveryParams: TranslationParams = { days: terms.deliveryDays, shipping: terms.shippingCost };
  if (shippingMethod) deliveryParams.method = quoteUntrusted(shippingMethod, 60);

  return [
    clause('parties', 'contract.clause.parties.title', 'contract.clause.parties.body', {
      seller: quoteUntrusted(session.listing.sellerName, 60),
    }),
    clause('listing', 'contract.clause.listing.title', 'contract.clause.listing.body', {
      title: quoteUntrusted(session.listing.title, 80),
      quantity: terms.quantity,
      price: agreedPrice,
    }),
    clause(
      'amount',
      'contract.clause.amount.title',
      terms.taxIncluded ? 'contract.clause.amount.bodyIncluded' : 'contract.clause.amount.bodyExcluded',
      { total }
    ),
    clause(
      'delivery',
      'contract.clause.delivery.title',
      shippingMethod ? 'contract.clause.delivery.body' : 'contract.clause.delivery.bodyNoMethod',
      deliveryParams
    ),
    clause('payment', 'contract.clause.payment.title', 'contract.clause.payment.body', {
      payment: quoteUntrusted(terms.paymentTerms, 80),
      warranty: quoteUntrusted(terms.warranty, 160),
    }),
    clause(
      'expiry',
      'contract.clause.expiry.title',
      expiry ? 'contract.clause.expiry.body' : 'contract.clause.expiry.none',
      expiry ? { date: expiry } : {}
    ),
    clause('notice', 'contract.clause.notice.title', 'contract.clause.notice.body'),
  ];
}

export function buildContractDraft(session: NegotiationSession): ContractDraft {
  if (session.status !== 'deal' || !session.dealSummary) {
    throw new Error('CONTRACT_REQUIRES_DEAL');
  }
  const accepted = latestAcceptedOffer(session);
  const terms = accepted?.terms ?? defaultNegotiationTerms(session.listing);
  const now = new Date().toISOString();
  const agreedPrice = session.dealSummary.agreedPrice;
  return {
    id: `contract-${randomUUID()}`,
    negotiationId: session.id,
    version: 1,
    status: 'pending_approval',
    buyer: party('buyer', session.buyerId, 'あなた（買い手）'),
    seller: party('seller', session.sellerId, session.listing.sellerName),
    listing: clone(session.listing),
    agreedPrice,
    totalAmount: totalOfferCost(agreedPrice, terms),
    terms: clone(terms),
    clauses: contractClauses(session, terms, agreedPrice),
    riskFlags: ['人間承認が必要', '実決済は未実行', '法的拘束力のない確認用ドラフト'],
    createdAt: now,
    updatedAt: now,
  };
}

/** Returns the existing open draft for the negotiation, or stores this one. */
export async function saveContractDraft(draft: ContractDraft): Promise<{ draft: ContractDraft; created: boolean }> {
  const database = getDatabasePool();
  if (database) {
    const stored = await database.query(
      'select draft from negotiation_contracts where negotiation_id = $1 and status <> $2 order by updated_at desc limit 1',
      [draft.negotiationId, 'rejected']
    );
    const existingDraft = rowJson<ContractDraft>(stored.rows[0]?.draft);
    if (existingDraft) {
      contracts.set(existingDraft.id, clone(existingDraft));
      return { draft: clone(existingDraft), created: false };
    }
    await database.query(
      `insert into negotiation_contracts (id, negotiation_id, version, status, draft, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`,
      [draft.id, draft.negotiationId, draft.version, draft.status, JSON.stringify(draft), new Date(draft.createdAt), new Date(draft.updatedAt)]
    );
  } else {
    const existing = Array.from(contracts.values()).find((item) => item.negotiationId === draft.negotiationId && item.status !== 'rejected');
    if (existing) return { draft: clone(existing), created: false };
  }
  contracts.set(draft.id, clone(draft));
  return { draft: clone(draft), created: true };
}

export async function getContractDrafts(negotiationId: string) {
  const database = getDatabasePool();
  const persistedDrafts: ContractDraft[] = [];
  if (database) {
    const result = await database.query('select draft from negotiation_contracts where negotiation_id = $1 order by updated_at desc', [negotiationId]);
    for (const row of result.rows) {
      const draft = rowJson<ContractDraft>(row.draft);
      if (draft) {
        contracts.set(draft.id, clone(draft));
        persistedDrafts.push(draft);
      }
    }
  }
  const source = database ? persistedDrafts : Array.from(contracts.values());
  return source
    .filter((draft) => draft.negotiationId === negotiationId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(clone);
}

type ApprovalInput = Omit<ApprovalTask, 'id' | 'status' | 'version' | 'createdAt' | 'resolvedAt' | 'resolvedBy'>;

/** Idempotent per (negotiation, kind, owner, subject hash): the same pending subject never gets two tasks. */
export async function ensureApprovalTask(input: ApprovalInput) {
  const database = getDatabasePool();
  if (database) {
    const stored = await database.query(
      `select ${TASK_COLUMNS} from approval_tasks
       where negotiation_id = $1 and kind = $2 and owner_id = $3 and proposal_hash = $4 and status = 'pending'
       order by created_at desc limit 1`,
      [input.negotiationId, input.kind, input.ownerId, input.proposalHash]
    );
    if (stored.rows[0]) {
      const task = taskFromRow(stored.rows[0]);
      approvals.set(task.id, clone(task));
      return clone(task);
    }
  } else {
    const existing = Array.from(approvals.values()).find((task) => task.negotiationId === input.negotiationId
      && task.kind === input.kind
      && task.ownerId === input.ownerId
      && task.proposalHash === input.proposalHash
      && task.status === 'pending');
    if (existing) return clone(existing);
  }
  const task: ApprovalTask = {
    ...clone(input),
    id: `approval-${randomUUID()}`,
    status: 'pending',
    version: 1,
    createdAt: new Date().toISOString(),
  };
  if (database) {
    await database.query(
      `insert into approval_tasks (id, negotiation_id, owner_id, kind, status, title, payload, subject_type, subject_id, subject_version, proposal_hash, requested_by, expires_at, version, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) on conflict (id) do nothing`,
      [task.id, task.negotiationId, task.ownerId, task.kind, task.status, task.title, JSON.stringify(task.payload), task.subjectType, task.subjectId, task.subjectVersion, task.proposalHash, task.requestedBy, new Date(task.expiresAt), task.version, new Date(task.createdAt)]
    );
  }
  approvals.set(task.id, clone(task));
  return clone(task);
}

async function getApprovalTask(taskId: string) {
  const database = getDatabasePool();
  if (database) {
    const result = await database.query(`select ${TASK_COLUMNS} from approval_tasks where id = $1`, [taskId]);
    if (!result.rows[0]) return undefined;
    const task = taskFromRow(result.rows[0]);
    approvals.set(task.id, clone(task));
    return task;
  }
  const task = approvals.get(taskId);
  return task ? clone(task) : undefined;
}

/** System-side resolution used when the subject itself moved on. */
async function closeApprovalTask(task: ApprovalTask, status: Exclude<ApprovalTaskStatus, 'pending'>, resolvedBy?: string) {
  const database = getDatabasePool();
  const resolvedAt = new Date().toISOString();
  if (database) {
    await database.query(
      `update approval_tasks set status = $2, version = version + 1, resolved_at = $3, resolved_by = $4
       where id = $1 and status = 'pending'`,
      [task.id, status, new Date(resolvedAt), resolvedBy ?? null]
    );
  }
  const current = approvals.get(task.id) ?? task;
  if (current.status === 'pending') {
    approvals.set(task.id, { ...current, status, version: current.version + 1, resolvedAt, resolvedBy });
  }
}

async function listPendingTasks(negotiationId: string, kind: ApprovalTask['kind']) {
  const database = getDatabasePool();
  if (database) {
    const result = await database.query(
      `select ${TASK_COLUMNS} from approval_tasks where negotiation_id = $1 and kind = $2 and status = 'pending'`,
      [negotiationId, kind]
    );
    return result.rows.map((row) => taskFromRow(row));
  }
  return Array.from(approvals.values()).filter((task) => task.negotiationId === negotiationId && task.kind === kind && task.status === 'pending').map(clone);
}

/**
 * Keeps the approval queue an exact mirror of the session's pending commit:
 * one task per missing approver, and every other pending commit task closed
 * (approved, rejected, or expired) the moment its intent is no longer pending.
 */
export async function syncCommitApprovalTasks(session: NegotiationSession) {
  const pending = session.status === 'awaiting_commit' ? session.pendingCommit : undefined;
  for (const task of await listPendingTasks(session.id, 'commit')) {
    const role = (task.payload as { approverRole?: string } | undefined)?.approverRole ?? (task.ownerId === session.buyerId ? 'buyer' : 'seller');
    if (pending && pending.intentHash === task.proposalHash) {
      if (hasLiveGrant(session, { id: task.ownerId, role })) await closeApprovalTask(task, 'approved', task.ownerId);
      continue;
    }
    const executed = session.commitReceipt?.intentHash === task.proposalHash;
    const rejection = session.rejectedCommits?.find((item) => item.intentHash === task.proposalHash);
    await closeApprovalTask(
      task,
      executed ? 'approved' : rejection?.reason === 'rejected' ? 'rejected' : 'expired',
      executed ? task.ownerId : rejection?.by
    );
  }
  if (!pending) return;
  for (const approver of missingApprovals(session)) {
    await ensureApprovalTask({
      negotiationId: session.id,
      ownerId: approver.id,
      kind: 'commit',
      title: approver.role === 'buyer' ? '購入確定の承認が必要です' : '売却確定の承認が必要です',
      payload: {
        intentHash: pending.intentHash,
        approverRole: approver.role,
        amount: pending.intent.amount,
        currency: pending.intent.currency,
        price: pending.intent.payload.price,
        shippingCost: pending.intent.payload.terms.shippingCost,
        listingTitle: session.listing.title,
        reason: approver.reason,
      },
      subjectType: 'commit',
      subjectId: pending.intent.payload.agreementOfferId,
      subjectVersion: 1,
      proposalHash: pending.intentHash,
      requestedBy: session.offers.find((offer) => offer.id === pending.intent.payload.agreementOfferId)?.senderRole ?? 'agent',
      expiresAt: pending.expiresAt,
    });
  }
}

export async function listApprovalTasks(status?: ApprovalTask['status'], ownerId?: string) {
  const database = getDatabasePool();
  const persistedTasks: ApprovalTask[] = [];
  if (database) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (status) { values.push(status); conditions.push(`status = $${values.length}`); }
    if (ownerId) { values.push(ownerId); conditions.push(`owner_id = $${values.length}`); }
    const result = await database.query(
      `select ${TASK_COLUMNS} from approval_tasks ${conditions.length ? `where ${conditions.join(' and ')}` : ''} order by created_at desc`,
      values
    );
    for (const row of result.rows) {
      const task = taskFromRow(row);
      approvals.set(task.id, clone(task));
      persistedTasks.push(task);
    }
  }
  const source = database ? persistedTasks : Array.from(approvals.values());
  return source
    .filter((task) => (!status || task.status === status) && (!ownerId || task.ownerId === ownerId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(clone);
}

export async function decideApprovalTask(
  taskId: string,
  decision: 'approve' | 'reject',
  expectedVersion: number,
  _idempotencyKey: string | undefined,
  actor: { id: string; role: 'buyer' | 'seller' | 'operator' }
) {
  const task = await getApprovalTask(taskId);
  if (!task) throw new Error('APPROVAL_NOT_FOUND');
  if (actor.role !== 'operator' && task.ownerId !== actor.id) throw new Error('APPROVAL_FORBIDDEN');
  const decidedStatus = decision === 'approve' ? 'approved' : 'rejected';
  // Replaying the same decision is a no-op that returns the resolved task.
  if (task.status === decidedStatus && task.version === expectedVersion + 1) return task;
  if (task.version !== expectedVersion) throw new Error('APPROVAL_VERSION_CONFLICT');
  if (task.status !== 'pending') throw new Error('APPROVAL_ALREADY_RESOLVED');
  if (Date.parse(task.expiresAt) <= Date.now()) throw new Error('APPROVAL_EXPIRED');

  if (task.kind === 'commit') {
    // The approval queue is just another surface for the same gated actions:
    // the service checks the approver, the intent hash and the expiry.
    await executeNegotiationAction(task.negotiationId, {
      type: decision === 'approve' ? 'approve_commit' : 'reject_commit',
      intentHash: task.proposalHash,
      expectedVersion: 0,
      idempotencyKey: `approval-${task.id}-${decision}`,
    }, actor as ServiceActor);
    const resolved = await getApprovalTask(task.id);
    if (!resolved) throw new Error('APPROVAL_NOT_FOUND');
    return resolved;
  }

  if (task.kind !== 'contract') throw new Error('APPROVAL_KIND_RETIRED');
  const payload = task.payload as { contractId?: string };
  if (!payload.contractId || payload.contractId !== task.subjectId) throw new Error('APPROVAL_SUBJECT_MISSING');
  const database = getDatabasePool();
  let contractDraft: ContractDraft | undefined;
  if (database) {
    const result = await database.query('select draft from negotiation_contracts where id = $1', [payload.contractId]);
    contractDraft = rowJson<ContractDraft>(result.rows[0]?.draft);
  } else {
    contractDraft = contracts.get(payload.contractId);
  }
  if (!contractDraft || contractDraft.version !== task.subjectVersion || hashContractDraft(contractDraft) !== task.proposalHash) {
    throw new Error('APPROVAL_SUBJECT_STALE');
  }

  const resolved: ApprovalTask = {
    ...task,
    status: decidedStatus,
    version: task.version + 1,
    resolvedAt: new Date().toISOString(),
    resolvedBy: actor.id,
  };
  if (database) {
    const result = await resolveContractApprovalInTransaction(database, task, decision, expectedVersion, actor.id, contractDraft);
    resolved.version = result.version;
    resolved.resolvedAt = result.resolvedAt;
    contracts.set(result.draft.id, clone(result.draft));
  } else {
    contracts.set(contractDraft.id, clone({
      ...contractDraft,
      status: decidedStatus,
      approvedAt: decision === 'approve' ? new Date().toISOString() : undefined,
      updatedAt: new Date().toISOString(),
    }));
  }
  approvals.set(task.id, clone(resolved));
  return clone(resolved);
}

export async function createContractApproval(session: NegotiationSession, draft: ContractDraft) {
  return ensureApprovalTask({
    negotiationId: session.id,
    ownerId: session.buyerId,
    kind: 'contract',
    title: '契約書ドラフトを承認してください',
    payload: {
      contractId: draft.id,
      agreedPrice: draft.agreedPrice,
      totalAmount: draft.totalAmount,
      clauseCount: draft.clauses.length,
    },
    subjectType: 'contract',
    subjectId: draft.id,
    subjectVersion: draft.version,
    proposalHash: hashContractDraft(draft),
    requestedBy: session.buyerId,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
}

export async function getWorkflowOverview() {
  const database = getDatabasePool();
  if (database) {
    const [approvalResult, totalApprovalResult, contractResult, approvedContractResult] = await Promise.all([
      database.query("select count(*)::int as count from approval_tasks where status = 'pending'"),
      database.query('select count(*)::int as count from approval_tasks'),
      database.query('select count(*)::int as count from negotiation_contracts'),
      database.query("select count(*)::int as count from negotiation_contracts where status = 'approved'"),
    ]);
    return {
      pendingApprovals: Number(approvalResult.rows[0]?.count ?? 0),
      totalApprovals: Number(totalApprovalResult.rows[0]?.count ?? 0),
      totalContracts: Number(contractResult.rows[0]?.count ?? 0),
      approvedContracts: Number(approvedContractResult.rows[0]?.count ?? 0),
    };
  }
  return {
    pendingApprovals: Array.from(approvals.values()).filter((task) => task.status === 'pending').length,
    totalApprovals: approvals.size,
    totalContracts: contracts.size,
    approvedContracts: Array.from(contracts.values()).filter((draft) => draft.status === 'approved').length,
  };
}
