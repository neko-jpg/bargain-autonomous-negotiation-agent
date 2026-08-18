import { NextResponse } from 'next/server';
import { getAnalyticsOverview } from '@/lib/analytics/analyticsStore';
import { getWorkflowOverview } from '@/lib/negotiation/workflowStore';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ analytics: await getAnalyticsOverview(), workflow: await getWorkflowOverview() });
}
