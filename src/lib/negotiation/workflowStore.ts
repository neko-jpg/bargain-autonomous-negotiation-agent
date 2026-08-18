import { randomUUID } from 'node:crypto';
import {
  ApprovalTask,
  ContractClause,
  ContractDraft,
  NegotiationOffer,
  NegotiationSession,
  NegotiationTerms,
  PartySnapshot,
} from '@/types/negotiation';
import { defaultNegotiationTerms, totalOfferCost } from '@/lib/negotiation/terms';
import { getDatabasePool } from '@/lib/negotiation/persistence';

interface WorkflowState {
  approvals?: Map<string, ApprovalTask>;
  contracts?: Map<string, ContractDraft>;
  approvalIdempotency?: Map<string, ApprovalTask>;
}

const globalState = globalThis as typeof globalThis & { __bargainWorkflow?: WorkflowState };
const state = (globalState.__bargainWorkflow ??= {});
const approvals = (state.approvals ??= new Map<string, ApprovalTask>());
const contracts = (state.contracts ??= new Map<string, ContractDraft>());
const approvalIdempotency = (state.approvalIdempotency ??= new Map<string, ApprovalTask>());

const clone = <T>(value: T): T => structuredClone(value);

function rowJson<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
}

const party = (role: PartySnapshot['role'], name: string): PartySnapshot => ({
  id: role === 'buyer' ? 'buyer-local' : name,
  name,
  role,
});

function latestAcceptedOffer(session: NegotiationSession): NegotiationOffer | undefined {
  return [...session.offers].reverse().find((offer) => offer.actionType === 'accept_offer');
}

function contractClauses(session: NegotiationSession, terms: NegotiationTerms, agreedPrice: number): ContractClause[] {
  const total = totalOfferCost(agreedPrice, terms);
  return [
    { id: 'parties', title: '当事者', body: `買い手「あなた（買い手）」と売り手「${session.listing.sellerName}」の間で作成される取引ドラフトです。` },
    { id: 'listing', title: '商品・数量', body: `商品「${session.listing.title}」を${terms.quantity}個、合意価格¥${agreedPrice.toLocaleString('ja-JP')}で取り扱います。` },
    { id: 'amount', title: '支払総額', body: `商品価格、送料、税区分を反映した想定総額は¥${total.toLocaleString('ja-JP')}です。税区分は${terms.taxIncluded ? '税込' : '税別'}です。` },
    { id: 'delivery', title: '納期・配送', body: `合意納期は${terms.deliveryDays}日以内、送料は¥${terms.shippingCost.toLocaleString('ja-JP')}、配送条件は「${session.listing.shippingMethod ?? '出品者指定'}」です。` },
    { id: 'payment', title: '支払・保証', body: `支払条件は「${terms.paymentTerms}」、保証条件は「${terms.warranty}」です。` },
    { id: 'expiry', title: '有効期限', body: terms.expiresAt ? `この条件の有効期限は${terms.expiresAt}です。` : '有効期限は当事者の承認時点から個別に確認します。' },
    { id: 'notice', title: 'ドラフトの扱い', body: 'この文書はBARGAINが生成した確認用ドラフトであり、人間による承認と実際の決済・発送手続きが完了するまでは法的拘束力を持つ契約として扱いません。' },
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
    buyer: party('buyer', 'あなた（買い手）'),
    seller: party('seller', session.listing.sellerName),
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

export async function saveContractDraft(draft: ContractDraft) {
  const existing = Array.from(contracts.values()).find((item) => item.negotiationId === draft.negotiationId && item.status !== 'rejected');
  if (existing) return clone(existing);
  const database = getDatabasePool();
  if (database) {
    const stored = await database.query(
      'select draft from negotiation_contracts where negotiation_id = $1 and status <> $2 order by updated_at desc limit 1',
      [draft.negotiationId, 'rejected']
    );
    const existingDraft = rowJson<ContractDraft>(stored.rows[0]?.draft);
    if (existingDraft) {
      contracts.set(existingDraft.id, clone(existingDraft));
      return clone(existingDraft);
    }
    await database.query(
      `insert into negotiation_contracts (id, negotiation_id, version, status, draft, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`,
      [draft.id, draft.negotiationId, draft.version, draft.status, JSON.stringify(draft), new Date(draft.createdAt), new Date(draft.updatedAt)]
    );
  }
  contracts.set(draft.id, clone(draft));
  return clone(draft);
}

export async function getContractDrafts(negotiationId: string) {
  const database = getDatabasePool();
  if (database) {
    const result = await database.query('select draft from negotiation_contracts where negotiation_id = $1 order by updated_at desc', [negotiationId]);
    for (const row of result.rows) {
      const draft = rowJson<ContractDraft>(row.draft);
      if (draft) contracts.set(draft.id, clone(draft));
    }
  }
  return Array.from(contracts.values())
    .filter((draft) => draft.negotiationId === negotiationId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(clone);
}

export async function ensureApprovalTask(input: {
  negotiationId: string;
  kind: ApprovalTask['kind'];
  title: string;
  payload: unknown;
}) {
  const existing = Array.from(approvals.values()).find((task) => task.negotiationId === input.negotiationId && task.kind === input.kind && task.status === 'pending');
  if (existing) return clone(existing);
  const database = getDatabasePool();
  if (database) {
    const stored = await database.query(
      'select id, negotiation_id, kind, status, title, payload, version, created_at, resolved_at from approval_tasks where negotiation_id = $1 and kind = $2 and status = $3 order by created_at desc limit 1',
      [input.negotiationId, input.kind, 'pending']
    );
    const row = stored.rows[0];
    if (row) {
      const task: ApprovalTask = {
        id: String(row.id), negotiationId: String(row.negotiation_id), kind: row.kind, status: row.status,
        title: String(row.title), payload: rowJson(row.payload), version: Number(row.version),
        createdAt: new Date(row.created_at).toISOString(), resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : undefined,
      };
      approvals.set(task.id, clone(task));
      return clone(task);
    }
  }
  const now = new Date().toISOString();
  const task: ApprovalTask = {
    id: `approval-${randomUUID()}`,
    negotiationId: input.negotiationId,
    kind: input.kind,
    status: 'pending',
    title: input.title,
    payload: clone(input.payload),
    version: 1,
    createdAt: now,
  };
  if (database) {
    await database.query(
      `insert into approval_tasks (id, negotiation_id, kind, status, title, payload, version, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do nothing`,
      [task.id, task.negotiationId, task.kind, task.status, task.title, JSON.stringify(task.payload), task.version, new Date(task.createdAt)]
    );
  }
  approvals.set(task.id, clone(task));
  return clone(task);
}

export async function ensureApprovalTaskForOffer(session: NegotiationSession, offer: NegotiationOffer) {
  return ensureApprovalTask({
    negotiationId: session.id,
    kind: 'reply',
    title: 'AI提案の確認が必要です',
    payload: {
      offerId: offer.id,
      actionType: offer.actionType,
      price: offer.price,
      terms: offer.terms,
      messageText: offer.messageText,
      decision: offer.decision,
    },
  });
}

export async function listApprovalTasks(status?: ApprovalTask['status']) {
  const database = getDatabasePool();
  if (database) {
    const result = await database.query(
      `select id, negotiation_id, kind, status, title, payload, version, created_at, resolved_at
       from approval_tasks ${status ? 'where status = $1' : ''} order by created_at desc`,
      status ? [status] : []
    );
    for (const row of result.rows) {
      const task: ApprovalTask = {
        id: String(row.id), negotiationId: String(row.negotiation_id), kind: row.kind, status: row.status,
        title: String(row.title), payload: rowJson(row.payload), version: Number(row.version),
        createdAt: new Date(row.created_at).toISOString(), resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : undefined,
      };
      approvals.set(task.id, clone(task));
    }
  }
  return Array.from(approvals.values())
    .filter((task) => !status || task.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(clone);
}

export async function decideApprovalTask(
  taskId: string,
  decision: 'approve' | 'reject',
  expectedVersion: number,
  idempotencyKey?: string
) {
  if (idempotencyKey) {
    const stored = approvalIdempotency.get(idempotencyKey);
    if (stored) return clone(stored);
  }
  const database = getDatabasePool();
  let task = approvals.get(taskId);
  if (!task && database) {
    const stored = await database.query(
      'select id, negotiation_id, kind, status, title, payload, version, created_at, resolved_at from approval_tasks where id = $1',
      [taskId]
    );
    const row = stored.rows[0];
    if (row) {
      task = {
        id: String(row.id), negotiationId: String(row.negotiation_id), kind: row.kind, status: row.status,
        title: String(row.title), payload: rowJson(row.payload), version: Number(row.version),
        createdAt: new Date(row.created_at).toISOString(), resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : undefined,
      };
      approvals.set(task.id, clone(task));
    }
  }
  if (!task) throw new Error('APPROVAL_NOT_FOUND');
  if (task.version !== expectedVersion) throw new Error('APPROVAL_VERSION_CONFLICT');
  if (task.status !== 'pending') throw new Error('APPROVAL_ALREADY_RESOLVED');

  const resolved: ApprovalTask = {
    ...task,
    status: decision === 'approve' ? 'approved' : 'rejected',
    version: task.version + 1,
    resolvedAt: new Date().toISOString(),
  };
  if (database) {
    const result = await database.query(
      `update approval_tasks set status = $2, version = version + 1, resolved_at = now()
       where id = $1 and status = 'pending' and version = $3
       returning id, negotiation_id, kind, status, title, payload, version, created_at, resolved_at`,
      [task.id, resolved.status, expectedVersion]
    );
    if (!result.rows[0]) throw new Error('APPROVAL_VERSION_CONFLICT');
    const row = result.rows[0];
    resolved.version = Number(row.version);
    resolved.resolvedAt = row.resolved_at ? new Date(row.resolved_at).toISOString() : resolved.resolvedAt;
  }
  approvals.set(task.id, clone(resolved));

  const payload = task.payload as { contractId?: string };
  if (task.kind === 'contract' && payload.contractId) {
    const draft = contracts.get(payload.contractId);
    if (draft) {
      contracts.set(draft.id, clone({
        ...draft,
        status: decision === 'approve' ? 'approved' : 'rejected',
        approvedAt: decision === 'approve' ? new Date().toISOString() : undefined,
        updatedAt: new Date().toISOString(),
      }));
      if (database) {
        await database.query(
          `update negotiation_contracts set status = $2, draft = $3, updated_at = now(), approved_at = $4 where id = $1`,
          [draft.id, decision === 'approve' ? 'approved' : 'rejected', JSON.stringify(contracts.get(draft.id)), decision === 'approve' ? new Date() : null]
        );
      }
    }
  }
  if (idempotencyKey) approvalIdempotency.set(idempotencyKey, clone(resolved));
  return clone(resolved);
}

export async function createContractApproval(session: NegotiationSession, draft: ContractDraft) {
  return ensureApprovalTask({
    negotiationId: session.id,
    kind: 'contract',
    title: '契約書ドラフトを承認してください',
    payload: {
      contractId: draft.id,
      agreedPrice: draft.agreedPrice,
      totalAmount: draft.totalAmount,
      clauseCount: draft.clauses.length,
    },
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
