import { NextRequest, NextResponse } from 'next/server';
import { getPersistedSession } from '@/lib/negotiation/persistence';
import { requireActor, ActorAuthError } from '@/lib/auth/actor';
import { toViewerSession } from '@/lib/negotiation/sessionStore';
import {
  buildContractDraft,
  createContractApproval,
  getContractDrafts,
  saveContractDraft,
} from '@/lib/negotiation/workflowStore';
import { apiErrorMessage } from '@/lib/i18n/api';
import { getRequestLocale } from '@/lib/i18n/server';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const locale = await getRequestLocale();
  const { id } = await params;
  let actor;
  try { actor = requireActor(_request); } catch (error) {
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
  return NextResponse.json({ contracts: await getContractDrafts(id) });
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const locale = await getRequestLocale();
  const { id } = await params;
  let actor;
  try { actor = requireActor(_request); } catch (error) {
    const code = error instanceof ActorAuthError ? error.code : 'ACTOR_REQUIRED';
    return NextResponse.json({ error: code, message: apiErrorMessage(locale, code) }, { status: 401 });
  }
  const session = await getPersistedSession(id);
  if (!session) return NextResponse.json({ error: 'SESSION_NOT_FOUND', message: apiErrorMessage(locale, 'SESSION_NOT_FOUND') }, { status: 404 });
  if (actor.role !== 'operator') {
    try { toViewerSession(session, actor.id, actor.role); } catch {
      return NextResponse.json({ error: 'SESSION_FORBIDDEN_OPERATE', message: apiErrorMessage(locale, 'SESSION_FORBIDDEN_OPERATE') }, { status: 403 });
    }
  }
  try {
    const { draft, created } = await saveContractDraft(buildContractDraft(session));
    const approval = await createContractApproval(session, draft);
    return NextResponse.json({ draft, approval }, { status: created ? 201 : 200 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    const message = code === 'CONTRACT_REQUIRES_DEAL'
      ? apiErrorMessage(locale, 'CONTRACT_REQUIRES_DEAL')
      : apiErrorMessage(locale, 'CONTRACT_FAILED');
    return NextResponse.json({ error: code, message }, { status: code === 'CONTRACT_REQUIRES_DEAL' ? 422 : 500 });
  }
}
