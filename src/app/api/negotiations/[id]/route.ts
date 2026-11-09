import { NextRequest, NextResponse } from 'next/server';
import { getPersistedSession } from '@/lib/negotiation/persistence';
import { requireActor, ActorAuthError } from '@/lib/auth/actor';
import { toPublicSession, toViewerSession } from '@/lib/negotiation/sessionStore';
import { apiErrorMessage } from '@/lib/i18n/api';
import { getRequestLocale } from '@/lib/i18n/server';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const locale = await getRequestLocale();
  const { id } = await params;
  let actor;
  try {
    actor = requireActor(_request);
  } catch (error) {
    const code = error instanceof ActorAuthError ? error.code : 'ACTOR_REQUIRED';
    return NextResponse.json({ error: code, message: apiErrorMessage(locale, code) }, { status: code === 'CROSS_SITE_REQUEST' ? 403 : 401 });
  }
  const session = await getPersistedSession(id);
  if (!session) {
    return NextResponse.json({ error: 'SESSION_NOT_FOUND', message: apiErrorMessage(locale, 'SESSION_NOT_FOUND') }, { status: 404 });
  }
  try {
    return NextResponse.json({ session: actor.role === 'operator' ? toPublicSession(session) : toViewerSession(session, actor.id, actor.role) });
  } catch {
    return NextResponse.json({ error: 'SESSION_FORBIDDEN', message: apiErrorMessage(locale, 'SESSION_FORBIDDEN') }, { status: 403 });
  }
}
