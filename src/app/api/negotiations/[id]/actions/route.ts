import { NextRequest, NextResponse } from 'next/server';
import { NegotiationActionRequestSchema } from '@/lib/negotiation/schemas';
import { executeNegotiationAction, publicError } from '@/lib/negotiation/service';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  const parsed = NegotiationActionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_REQUEST', message: '操作内容を確認してください。' }, { status: 422 });
  }

  try {
    const session = await executeNegotiationAction(params.id, parsed.data);
    return NextResponse.json({ session });
  } catch (error) {
    const safe = publicError(error);
    const status = safe.code === 'SESSION_NOT_FOUND' ? 404 : safe.code === 'SESSION_VERSION_CONFLICT' ? 409 : 422;
    return NextResponse.json({ error: safe.code, message: safe.message }, { status });
  }
}

