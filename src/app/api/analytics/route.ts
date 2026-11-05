import { NextRequest, NextResponse } from 'next/server';
import { getAnalyticsOverview } from '@/lib/analytics/analyticsStore';
import { getWorkflowOverview } from '@/lib/negotiation/workflowStore';
import { requireActor, ActorAuthError } from '@/lib/auth/actor';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try { requireActor(request); } catch (error) {
    const code = error instanceof ActorAuthError ? error.code : 'ACTOR_REQUIRED';
    return NextResponse.json({ error: code, message: '認証情報が必要です。' }, { status: 401 });
  }
  return NextResponse.json({ analytics: await getAnalyticsOverview(), workflow: await getWorkflowOverview() });
}
