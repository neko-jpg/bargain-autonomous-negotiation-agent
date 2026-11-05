import { NextRequest, NextResponse } from 'next/server';
import { requireActor, ActorAuthError } from '@/lib/auth/actor';
import { getKillSwitchState, setKillSwitch } from '@/lib/negotiation/safetyControls';
import { apiErrorMessage } from '@/lib/i18n/api';
import { getRequestLocale } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ killSwitch: await getKillSwitchState() });
}

/** Operator-only. Engaging halts every agent step and every irreversible effect. */
export async function POST(request: NextRequest) {
  const locale = await getRequestLocale();
  let actor;
  try { actor = requireActor(request); } catch (error) {
    const code = error instanceof ActorAuthError ? error.code : 'ACTOR_REQUIRED';
    return NextResponse.json({ error: code, message: apiErrorMessage(locale, code) }, { status: 401 });
  }
  if (actor.role !== 'operator') {
    return NextResponse.json({ error: 'OPERATOR_REQUIRED', message: apiErrorMessage(locale, 'OPERATOR_REQUIRED') }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { engaged?: unknown } | null;
  if (!body || typeof body.engaged !== 'boolean') {
    return NextResponse.json({ error: 'INVALID_REQUEST', message: apiErrorMessage(locale, 'INVALID_REQUEST', 'api.invalidEngaged') }, { status: 422 });
  }
  const current = await getKillSwitchState();
  if (current.source === 'environment' && !body.engaged) {
    return NextResponse.json({ error: 'KILL_SWITCH_LOCKED_BY_ENVIRONMENT', message: apiErrorMessage(locale, 'KILL_SWITCH_LOCKED_BY_ENVIRONMENT') }, { status: 409 });
  }
  return NextResponse.json({ killSwitch: await setKillSwitch(body.engaged, actor.id) });
}
