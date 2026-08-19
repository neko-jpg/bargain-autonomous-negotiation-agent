import { NextRequest } from 'next/server';
import {
  listSessionEvents,
  subscribeSession,
} from '@/lib/negotiation/sessionStore';
import { getPersistedSession, isDatabaseConfigured } from '@/lib/negotiation/persistence';
import { requireActor, ActorAuthError } from '@/lib/auth/actor';
import { toPublicSession, toViewerSession } from '@/lib/negotiation/sessionStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let actor;
  try {
    actor = requireActor(request);
  } catch (error) {
    const code = error instanceof ActorAuthError ? error.code : 'ACTOR_REQUIRED';
    return new Response(code, { status: 401 });
  }
  const internal = await getPersistedSession(id);
  if (!internal) return new Response('Not found', { status: 404 });
  let current;
  try {
    current = actor.role === 'operator' ? toPublicSession(internal) : toViewerSession(internal, actor.id, actor.role);
  } catch {
    return new Response('Forbidden', { status: 403 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let poller: ReturnType<typeof setInterval> | undefined;
      let unsubscribe = () => {};
      let lastVersion = current.version;
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (poller) clearInterval(poller);
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

      listSessionEvents(id).slice(-1).forEach((event) => send({ ...event, session: current }, event.type));
      if (isDatabaseConfigured()) {
        // In a multi-instance runtime the in-process subscription map is not
        // shared. Poll the authoritative version so another Worker instance
        // still reaches this open stream.
        poller = setInterval(() => {
          void getPersistedSession(id).then((latest) => {
            if (!latest || latest.version === lastVersion || closed) return;
            lastVersion = latest.version ?? lastVersion;
            const view = actor.role === 'operator' ? toPublicSession(latest) : toViewerSession(latest, actor.id, actor.role);
            send({ session: view }, 'session.updated');
          }).catch(() => close());
        }, 2_000);
      } else {
        unsubscribe = subscribeSession(id, (event) => send(event, event.type), actor.role === 'operator' ? undefined : { actorId: actor.id, role: actor.role });
      }
      heartbeat = setInterval(() => send({ at: new Date().toISOString() }, 'heartbeat'), 15_000);
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
