import { NextRequest, NextResponse } from 'next/server';
import { getPersistedPublicSession } from '@/lib/negotiation/persistence';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getPersistedPublicSession(params.id);
  if (!session) {
    return NextResponse.json({ error: 'SESSION_NOT_FOUND', message: '交渉セッションが見つかりません。' }, { status: 404 });
  }
  return NextResponse.json({ session });
}
