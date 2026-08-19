import { NextRequest, NextResponse } from 'next/server';
import { CreateNegotiationRequestSchema } from '@/lib/negotiation/schemas';
import { findListing, toViewerSession } from '@/lib/negotiation/sessionStore';
import { createPersistedNegotiationSession } from '@/lib/negotiation/persistence';
import { attachActorCookie, ActorAuthError, createActor } from '@/lib/auth/actor';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  let actor: ReturnType<typeof createActor>['actor'];
  let isNew = false;
  try {
    const created = createActor(request);
    actor = created.actor;
    isNew = created.isNew;
  } catch (error) {
    const code = error instanceof ActorAuthError ? error.code : 'INVALID_ACTOR';
    return NextResponse.json({ error: code, message: code === 'AUTH_NOT_CONFIGURED' ? '認証設定が完了していません。' : '認証情報を確認してください。' }, { status: code === 'AUTH_NOT_CONFIGURED' ? 503 : 401 });
  }
  if (actor.role !== 'buyer') {
    return NextResponse.json({ error: 'INVALID_ROLE', message: '買い手として交渉を作成してください。' }, { status: 403 });
  }
  const parsed = CreateNegotiationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_REQUEST', message: '商品と交渉条件を確認してください。' }, { status: 422 });
  }

  const listing = findListing(parsed.data.listingId);
  if (!listing) {
    return NextResponse.json({ error: 'LISTING_NOT_FOUND', message: '商品が見つかりません。' }, { status: 404 });
  }

  try {
    const session = await createPersistedNegotiationSession(listing, parsed.data.buyerPolicy, parsed.data.buyerTerms, { buyerId: actor.id });
    const response = NextResponse.json({ session: toViewerSession(session, actor.id, 'buyer') }, { status: 201 });
    if (isNew) attachActorCookie(response, actor.id);
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === 'DATABASE_REQUIRED_IN_PRODUCTION') {
      return NextResponse.json({ error: 'PERSISTENCE_NOT_CONFIGURED', message: '交渉サービスの永続化設定が完了していません。' }, { status: 503 });
    }
    throw error;
  }
}
