import { NextRequest, NextResponse } from 'next/server';
import { NegotiationActionRequestSchema } from '@/lib/negotiation/schemas';
import { executeNegotiationAction, publicError } from '@/lib/negotiation/service';
import { requireActor, ActorAuthError } from '@/lib/auth/actor';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let actor;
  try {
    actor = requireActor(request);
  } catch (error) {
    const code = error instanceof ActorAuthError ? error.code : 'ACTOR_REQUIRED';
    return NextResponse.json({ error: code, message: '認証情報が必要です。' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = NegotiationActionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_REQUEST', message: '操作内容を確認してください。' }, { status: 422 });
  }

  try {
    const session = await executeNegotiationAction(id, parsed.data, actor);
    return NextResponse.json({ session });
  } catch (error) {
    const safe = publicError(error);
    const status = safe.code === 'SESSION_NOT_FOUND' ? 404 : safe.code === 'SESSION_FORBIDDEN' ? 403 : safe.code === 'SESSION_VERSION_CONFLICT' ? 409 : safe.code === 'PERSISTENCE_NOT_CONFIGURED' ? 503 : 422;
    return NextResponse.json({ error: safe.code, message: safe.message }, { status });
  }
}
