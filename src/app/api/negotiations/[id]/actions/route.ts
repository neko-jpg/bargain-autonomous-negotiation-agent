import { NextRequest, NextResponse } from 'next/server';
import { NegotiationActionRequestSchema } from '@/lib/negotiation/schemas';
import { executeNegotiationAction, httpStatusForError, publicError } from '@/lib/negotiation/service';
import { requireActor, ActorAuthError } from '@/lib/auth/actor';
import { apiErrorMessage } from '@/lib/i18n/api';
import { getRequestLocale } from '@/lib/i18n/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const locale = await getRequestLocale();
  const { id } = await params;
  let actor;
  try {
    actor = requireActor(request);
  } catch (error) {
    const code = error instanceof ActorAuthError ? error.code : 'ACTOR_REQUIRED';
    return NextResponse.json({ error: code, message: apiErrorMessage(locale, code) }, { status: code === 'CROSS_SITE_REQUEST' ? 403 : 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = NegotiationActionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_REQUEST', message: apiErrorMessage(locale, 'INVALID_REQUEST') }, { status: 422 });
  }

  try {
    const session = await executeNegotiationAction(id, parsed.data, actor);
    return NextResponse.json({ session });
  } catch (error) {
    const safe = publicError(error, locale);
    return NextResponse.json({ error: safe.code, message: safe.message }, { status: httpStatusForError(safe.code) });
  }
}
