import { NextResponse } from 'next/server';
import { getDatabasePool } from '@/lib/negotiation/persistence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const database = getDatabasePool();
    if (!database) {
      return NextResponse.json({ ok: true, database: 'memory', environment: process.env.BARGAIN_ENV ?? 'unknown' });
    }
    await database.query('select 1');
    return NextResponse.json({ ok: true, database: 'postgresql', environment: process.env.BARGAIN_ENV ?? 'unknown' });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
