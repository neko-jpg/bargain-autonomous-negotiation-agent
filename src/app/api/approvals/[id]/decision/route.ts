import { NextRequest, NextResponse } from 'next/server';
import { decideApprovalTask } from '@/lib/negotiation/workflowStore';
import { requireActor, ActorAuthError } from '@/lib/auth/actor';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let actor;
  try { actor = requireActor(request); } catch (error) {
    const code = error instanceof ActorAuthError ? error.code : 'ACTOR_REQUIRED';
    return NextResponse.json({ error: code, message: '認証情報が必要です。' }, { status: 401 });
  }
  const body = await request.json().catch(() => null) as {
    decision?: 'approve' | 'reject';
    expectedVersion?: number;
    idempotencyKey?: string;
  } | null;
  if (!body || (body.decision !== 'approve' && body.decision !== 'reject') || !Number.isInteger(body.expectedVersion) || !body.idempotencyKey) {
    return NextResponse.json({ error: 'INVALID_REQUEST', message: '承認内容を確認してください。' }, { status: 422 });
  }
  const expectedVersion = body.expectedVersion as number;
  try {
    const task = await decideApprovalTask(id, body.decision, expectedVersion, body.idempotencyKey, actor);
    return NextResponse.json({ task });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    const messages: Record<string, string> = {
      APPROVAL_NOT_FOUND: '承認タスクが見つかりません。',
      APPROVAL_VERSION_CONFLICT: '承認タスクが更新されています。再読み込みしてください。',
      APPROVAL_ALREADY_RESOLVED: 'この承認タスクはすでに処理されています。',
      APPROVAL_FORBIDDEN: 'この承認タスクを処理する権限がありません。',
      APPROVAL_EXPIRED: 'この承認タスクは期限切れです。',
      APPROVAL_SUBJECT_MISSING: '承認対象が見つかりません。',
      APPROVAL_SUBJECT_STALE: '承認対象が更新されています。再読み込みしてください。',
    };
    const status = code === 'APPROVAL_NOT_FOUND' ? 404 : code === 'APPROVAL_FORBIDDEN' ? 403 : code === 'APPROVAL_VERSION_CONFLICT' || code === 'APPROVAL_SUBJECT_STALE' ? 409 : 422;
    return NextResponse.json({ error: code, message: messages[code] ?? '承認処理に失敗しました。' }, { status });
  }
}
