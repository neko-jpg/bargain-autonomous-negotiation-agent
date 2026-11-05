import { NextRequest, NextResponse } from 'next/server';
import { NegotiationActionRequestSchema } from '@/lib/negotiation/schemas';
import { executeNegotiationAction, httpStatusForError, publicError } from '@/lib/negotiation/service';
import { requireActor, ActorAuthError } from '@/lib/auth/actor';

export const runtime = 'nodejs';

/**
 * Backwards-compatible alias for older screens. New code should use
 * /api/negotiations/:id/actions.
 */
export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = requireActor(request);
  } catch (error) {
    const code = error instanceof ActorAuthError ? error.code : 'ACTOR_REQUIRED';
    return NextResponse.json({ error: code, message: '認証情報が必要です。' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const sessionId = body?.sessionId;
  if (typeof sessionId !== 'string') {
    return NextResponse.json(
      { error: 'SESSION_ID_REQUIRED', message: '交渉セッションIDが必要です。' },
      { status: 400 }
    );
  }

  const parsed = NegotiationActionRequestSchema.safeParse({
    ...body,
    type: body.action,
    idempotencyKey: body.idempotencyKey ?? `legacy-${crypto.randomUUID()}`,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_REQUEST', message: '操作内容を確認してください。' }, { status: 422 });
  }

  try {
    const session = await executeNegotiationAction(sessionId, parsed.data, actor);
    return NextResponse.json({ session });
  } catch (error) {
    const safe = publicError(error);
    return NextResponse.json({ error: safe.code, message: safe.message }, { status: httpStatusForError(safe.code) });
  }
}
