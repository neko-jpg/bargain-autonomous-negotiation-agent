import { NextRequest, NextResponse } from 'next/server';
import { CreateNegotiationRequestSchema } from '@/lib/negotiation/schemas';
import { findListing, toViewerSession } from '@/lib/negotiation/sessionStore';
import { createPersistedNegotiationSession } from '@/lib/negotiation/persistence';
import { attachActorCookie, ActorAuthError, createActor } from '@/lib/auth/actor';
import { getRequestLocale } from '@/lib/i18n/server';
import { apiErrorMessage } from '@/lib/i18n/api';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const locale = await getRequestLocale();
  let actor: ReturnType<typeof createActor>['actor'];
  let isNew = false;
  try {
    const created = createActor(request);
    actor = created.actor;
    isNew = created.isNew;
  } catch (error) {
    const code = error instanceof ActorAuthError ? error.code : 'INVALID_ACTOR';
    return NextResponse.json({ error: code, message: apiErrorMessage(locale, code), }, { status: code === 'AUTH_NOT_CONFIGURED' ? 503 : code === 'CROSS_SITE_REQUEST' ? 403 : 401 });
  }
  if (actor.role !== 'buyer') {
    return NextResponse.json({ error: 'INVALID_ROLE', message: apiErrorMessage(locale, 'INVALID_ROLE') }, { status: 403 });
  }
  const parsed = CreateNegotiationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_REQUEST', message: apiErrorMessage(locale, 'INVALID_REQUEST') }, { status: 422 });
  }

  const listing = findListing(parsed.data.listingId);
  if (!listing) {
    return NextResponse.json({ error: 'LISTING_NOT_FOUND', message: apiErrorMessage(locale, 'LISTING_NOT_FOUND') }, { status: 404 });
  }

  try {
    // The negotiation records the language it is conducted in, so agent prompts
    // and generated messages match the viewer who started it.
    const session = await createPersistedNegotiationSession(listing, parsed.data.buyerPolicy, parsed.data.buyerTerms, { buyerId: actor.id, locale });
    const response = NextResponse.json({ session: toViewerSession(session, actor.id, 'buyer') }, { status: 201 });
    if (isNew) attachActorCookie(response, actor.id);
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === 'DATABASE_REQUIRED_IN_PRODUCTION') {
      return NextResponse.json({ error: 'PERSISTENCE_NOT_CONFIGURED', message: apiErrorMessage(locale, 'PERSISTENCE_NOT_CONFIGURED') }, { status: 503 });
    }
    throw error;
  }
}
