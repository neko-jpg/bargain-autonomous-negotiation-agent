import { NextRequest, NextResponse } from 'next/server';
import { getPersistedSession } from '@/lib/negotiation/persistence';
import { requireActor, ActorAuthError } from '@/lib/auth/actor';
import { toPublicSession, toViewerSession } from '@/lib/negotiation/sessionStore';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let actor;
  try {
    actor = requireActor(_request);
  } catch (error) {
    const code = error instanceof ActorAuthError ? error.code : 'ACTOR_REQUIRED';
    return NextResponse.json({ error: code, message: '認証情報が必要です。' }, { status: 401 });
  }
  const session = await getPersistedSession(id);
  if (!session) {
    return NextResponse.json({ error: 'SESSION_NOT_FOUND', message: '交渉セッションが見つかりません。' }, { status: 404 });
  }
  try {
    return NextResponse.json({ session: actor.role === 'operator' ? toPublicSession(session) : toViewerSession(session, actor.id, actor.role) });
  } catch {
    return NextResponse.json({ error: 'SESSION_FORBIDDEN', message: 'この交渉を閲覧する権限がありません。' }, { status: 403 });
  }
}
