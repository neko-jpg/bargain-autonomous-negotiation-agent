import { NextRequest, NextResponse } from 'next/server';
import { CreateNegotiationRequestSchema } from '@/lib/negotiation/schemas';
import { findListing, toPublicSession } from '@/lib/negotiation/sessionStore';
import { createPersistedNegotiationSession } from '@/lib/negotiation/persistence';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const parsed = CreateNegotiationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_REQUEST', message: '商品と交渉条件を確認してください。' }, { status: 422 });
  }

  const listing = findListing(parsed.data.listingId);
  if (!listing) {
    return NextResponse.json({ error: 'LISTING_NOT_FOUND', message: '商品が見つかりません。' }, { status: 404 });
  }

  const session = await createPersistedNegotiationSession(listing, parsed.data.buyerPolicy, parsed.data.buyerTerms);
  return NextResponse.json({ session: toPublicSession(session) }, { status: 201 });
}
