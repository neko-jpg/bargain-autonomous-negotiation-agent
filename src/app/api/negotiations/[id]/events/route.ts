import { NextRequest } from 'next/server';
import {
  listSessionEvents,
  subscribeSession,
} from '@/lib/negotiation/sessionStore';
import { getPersistedPublicSession } from '@/lib/negotiation/persistence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const current = await getPersistedPublicSession(params.id);
  if (!current) return new Response('Not found', { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // The browser may have already closed the connection.
        }
      };
      const send = (event: unknown, name = 'session.updated') => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(event)}\n\n`));
      };

      listSessionEvents(params.id).slice(-1).forEach((event) => send(event, event.type));
      const unsubscribe = subscribeSession(params.id, (event) => send(event, event.type));
      const heartbeat = setInterval(() => send({ at: new Date().toISOString() }, 'heartbeat'), 15_000);
      request.signal.addEventListener('abort', close);
    },
    cancel() {
      // AbortSignal cleanup handles the normal browser path.
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
