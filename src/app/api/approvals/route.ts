import { NextRequest, NextResponse } from 'next/server';
import { listApprovalTasks } from '@/lib/negotiation/workflowStore';
import { ApprovalTaskStatus } from '@/types/negotiation';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get('status') as ApprovalTaskStatus | null;
  const allowed: ApprovalTaskStatus[] = ['pending', 'approved', 'rejected', 'expired'];
  if (status && !allowed.includes(status)) {
    return NextResponse.json({ error: 'INVALID_STATUS', message: '承認タスクの状態が不正です。' }, { status: 422 });
  }
  return NextResponse.json({ tasks: await listApprovalTasks(status ?? undefined) });
}
