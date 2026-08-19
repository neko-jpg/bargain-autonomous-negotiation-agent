import { NextRequest, NextResponse } from 'next/server';
import { getPersistedSession } from '@/lib/negotiation/persistence';
import { requireActor, ActorAuthError } from '@/lib/auth/actor';
import { toViewerSession } from '@/lib/negotiation/sessionStore';
import {
  buildContractDraft,
  createContractApproval,
  getContractDrafts,
  saveContractDraft,
} from '@/lib/negotiation/workflowStore';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let actor;
  try { actor = requireActor(_request); } catch (error) {
    const code = error instanceof ActorAuthError ? error.code : 'ACTOR_REQUIRED';
    return NextResponse.json({ error: code, message: '認証情報が必要です。' }, { status: 401 });
  }
  const session = await getPersistedSession(id);
  if (!session) return NextResponse.json({ error: 'SESSION_NOT_FOUND', message: '交渉セッションが見つかりません。' }, { status: 404 });
  if (actor.role !== 'operator') {
    try { toViewerSession(session, actor.id, actor.role); } catch {
      return NextResponse.json({ error: 'SESSION_FORBIDDEN', message: 'この交渉を閲覧する権限がありません。' }, { status: 403 });
    }
  }
  return NextResponse.json({ contracts: await getContractDrafts(id) });
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let actor;
  try { actor = requireActor(_request); } catch (error) {
    const code = error instanceof ActorAuthError ? error.code : 'ACTOR_REQUIRED';
    return NextResponse.json({ error: code, message: '認証情報が必要です。' }, { status: 401 });
  }
  const session = await getPersistedSession(id);
  if (!session) return NextResponse.json({ error: 'SESSION_NOT_FOUND', message: '交渉セッションが見つかりません。' }, { status: 404 });
  if (actor.role !== 'operator') {
    try { toViewerSession(session, actor.id, actor.role); } catch {
      return NextResponse.json({ error: 'SESSION_FORBIDDEN', message: 'この交渉を操作する権限がありません。' }, { status: 403 });
    }
  }
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
