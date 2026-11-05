import { NextRequest, NextResponse } from 'next/server';
import { listApprovalTasks } from '@/lib/negotiation/workflowStore';
import { ApprovalTaskStatus } from '@/types/negotiation';
import { requireActor, ActorAuthError } from '@/lib/auth/actor';
import { apiErrorMessage } from '@/lib/i18n/api';
import { getRequestLocale } from '@/lib/i18n/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const locale = await getRequestLocale();
  let actor;
  try { actor = requireActor(request); } catch (error) {
    const code = error instanceof ActorAuthError ? error.code : 'ACTOR_REQUIRED';
    return NextResponse.json({ error: code, message: apiErrorMessage(locale, code) }, { status: 401 });
  }
  const status = request.nextUrl.searchParams.get('status') as ApprovalTaskStatus | null;
  const allowed: ApprovalTaskStatus[] = ['pending', 'approved', 'rejected', 'expired'];
  if (status && !allowed.includes(status)) {
    return NextResponse.json({ error: 'INVALID_STATUS', message: apiErrorMessage(locale, 'INVALID_STATUS') }, { status: 422 });
  }
  return NextResponse.json({ tasks: await listApprovalTasks(status ?? undefined, actor.role === 'operator' ? undefined : actor.id) });
}
