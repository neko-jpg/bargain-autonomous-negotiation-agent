import { NextRequest, NextResponse } from 'next/server';
import { getAnalyticsOverview } from '@/lib/analytics/analyticsStore';
import { getWorkflowOverview } from '@/lib/negotiation/workflowStore';
import { requireActor, ActorAuthError } from '@/lib/auth/actor';
import { apiErrorMessage } from '@/lib/i18n/api';
import { getRequestLocale } from '@/lib/i18n/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const locale = await getRequestLocale();
  try { requireActor(request); } catch (error) {
    const code = error instanceof ActorAuthError ? error.code : 'ACTOR_REQUIRED';
    return NextResponse.json({ error: code, message: apiErrorMessage(locale, code) }, { status: 401 });
  }
  return NextResponse.json({ analytics: await getAnalyticsOverview(), workflow: await getWorkflowOverview() });
}
