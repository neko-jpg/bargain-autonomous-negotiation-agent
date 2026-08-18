import { NextRequest, NextResponse } from 'next/server';
import { getPersistedSession } from '@/lib/negotiation/persistence';
import {
  buildContractDraft,
  createContractApproval,
  getContractDrafts,
  saveContractDraft,
} from '@/lib/negotiation/workflowStore';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getPersistedSession(params.id);
  if (!session) return NextResponse.json({ error: 'SESSION_NOT_FOUND', message: '交渉セッションが見つかりません。' }, { status: 404 });
  return NextResponse.json({ contracts: await getContractDrafts(params.id) });
}

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getPersistedSession(params.id);
  if (!session) return NextResponse.json({ error: 'SESSION_NOT_FOUND', message: '交渉セッションが見つかりません。' }, { status: 404 });
  try {
    const draft = await saveContractDraft(buildContractDraft(session));
    const approval = await createContractApproval(session, draft);
    return NextResponse.json({ draft, approval }, { status: draft.version === 1 ? 201 : 200 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    const message = code === 'CONTRACT_REQUIRES_DEAL'
      ? '交渉成立後に契約ドラフトを作成できます。'
      : '契約ドラフトを作成できませんでした。';
    return NextResponse.json({ error: code, message }, { status: code === 'CONTRACT_REQUIRES_DEAL' ? 422 : 500 });
  }
}
