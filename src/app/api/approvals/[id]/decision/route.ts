import { NextRequest, NextResponse } from 'next/server';
import { decideApprovalTask } from '@/lib/negotiation/workflowStore';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
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
    const task = await decideApprovalTask(params.id, body.decision, expectedVersion, body.idempotencyKey);
    return NextResponse.json({ task });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    const messages: Record<string, string> = {
      APPROVAL_NOT_FOUND: '承認タスクが見つかりません。',
      APPROVAL_VERSION_CONFLICT: '承認タスクが更新されています。再読み込みしてください。',
      APPROVAL_ALREADY_RESOLVED: 'この承認タスクはすでに処理されています。',
    };
    const status = code === 'APPROVAL_NOT_FOUND' ? 404 : code === 'APPROVAL_VERSION_CONFLICT' ? 409 : 422;
    return NextResponse.json({ error: code, message: messages[code] ?? '承認処理に失敗しました。' }, { status });
  }
}
