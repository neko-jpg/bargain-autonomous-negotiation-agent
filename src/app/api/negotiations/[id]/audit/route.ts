import { NextRequest, NextResponse } from 'next/server';
import { requireActor, ActorAuthError } from '@/lib/auth/actor';
import { getPersistedSession, listAuditEntries } from '@/lib/negotiation/persistence';
import { toViewerSession } from '@/lib/negotiation/sessionStore';
import { verifyAuditChain } from '@/lib/negotiation/auditLog';
import { getEffectLedger } from '@/lib/negotiation/commit';
import { apiErrorMessage } from '@/lib/i18n/api';
import { getRequestLocale } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Hash-chained audit trail plus the effect ledger rows for one negotiation. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const locale = await getRequestLocale();
  const { id } = await params;
  let actor;
  try { actor = requireActor(request); } catch (error) {
    const code = error instanceof ActorAuthError ? error.code : 'ACTOR_REQUIRED';
    return NextResponse.json({ error: code, message: apiErrorMessage(locale, code) }, { status: 401 });
  }
  const session = await getPersistedSession(id);
  if (!session) return NextResponse.json({ error: 'SESSION_NOT_FOUND', message: apiErrorMessage(locale, 'SESSION_NOT_FOUND') }, { status: 404 });
  if (actor.role !== 'operator') {
    try { toViewerSession(session, actor.id, actor.role); } catch {
      return NextResponse.json({ error: 'SESSION_FORBIDDEN', message: apiErrorMessage(locale, 'SESSION_FORBIDDEN') }, { status: 403 });
    }
  }
  const entries = await listAuditEntries(id);
  const effects = await getEffectLedger().list(id);
  return NextResponse.json({
    verification: verifyAuditChain(entries),
    entries: entries.map(({ payload: _payload, ...entry }) => entry),
    effects: effects.map((effect) => ({
      effectId: effect.effectId,
      intentHash: effect.intentHash,
      kind: effect.kind,
      amount: effect.amount,
      currency: effect.currency,
      status: effect.status,
      authorizationMode: effect.authorization.mode,
      executor: effect.executor,
      executedAt: effect.executedAt,
    })),
  });
}
