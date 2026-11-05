import { NextRequest, NextResponse } from 'next/server';
import { decideApprovalTask } from '@/lib/negotiation/workflowStore';
import { requireActor, ActorAuthError } from '@/lib/auth/actor';
import { httpStatusForError, publicError } from '@/lib/negotiation/service';
import { apiErrorKey, apiErrorMessage } from '@/lib/i18n/api';
import { getRequestLocale } from '@/lib/i18n/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const locale = await getRequestLocale();
  const { id } = await params;
  let actor;
  try { actor = requireActor(request); } catch (error) {
    const code = error instanceof ActorAuthError ? error.code : 'ACTOR_REQUIRED';
    return NextResponse.json({ error: code, message: apiErrorMessage(locale, code) }, { status: 401 });
  }
  const body = await request.json().catch(() => null) as {
    decision?: 'approve' | 'reject';
    expectedVersion?: number;
    idempotencyKey?: string;
  } | null;
  if (!body || (body.decision !== 'approve' && body.decision !== 'reject') || !Number.isInteger(body.expectedVersion) || !body.idempotencyKey) {
    return NextResponse.json({ error: 'INVALID_REQUEST', message: apiErrorMessage(locale, 'INVALID_REQUEST') }, { status: 422 });
  }
  const expectedVersion = body.expectedVersion as number;
  try {
    const task = await decideApprovalTask(id, body.decision, expectedVersion, body.idempotencyKey, actor);
    return NextResponse.json({ task });
  } catch (error) {
    const safe = publicError(error, locale);
    if (safe.code !== 'INTERNAL_ERROR') {
      return NextResponse.json({ error: safe.code, message: safe.message }, { status: httpStatusForError(safe.code) });
    }
    const code = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    const known = Boolean(apiErrorKey(code));
    const status = code === 'APPROVAL_NOT_FOUND' ? 404 : code === 'APPROVAL_FORBIDDEN' ? 403 : code === 'APPROVAL_VERSION_CONFLICT' || code === 'APPROVAL_SUBJECT_STALE' ? 409 : known ? 422 : 500;
    return NextResponse.json({
      error: code,
      message: known ? apiErrorMessage(locale, code) : apiErrorMessage(locale, code, 'api.approvalFailed'),
    }, { status });
  }
}
