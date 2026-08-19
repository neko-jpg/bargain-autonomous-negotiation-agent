import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { areDemoHeadersEnabled, isProductionEnvironment } from '@/lib/runtime/environment';

export type PartyRole = 'buyer' | 'seller' | 'operator';

export interface ActorContext {
  id: string;
  role: PartyRole;
}

export class ActorAuthError extends Error {
  constructor(public readonly code: 'ACTOR_REQUIRED' | 'INVALID_ACTOR' | 'AUTH_NOT_CONFIGURED') {
    super(code);
  }
}

const ACTOR_COOKIE = 'bargain_actor';
const SAFE_ACTOR_ID = /^[A-Za-z0-9:_-]{8,160}$/;

function sessionSecret() {
  const configured = process.env.BARGAIN_SESSION_SECRET?.trim();
  if (configured && configured.length >= 32 && !/^(your_|placeholder|replace_me|change_me)/i.test(configured)) return configured;
  if (isProductionEnvironment()) throw new ActorAuthError('AUTH_NOT_CONFIGURED');
  return 'development-only-bargain-session-secret';
}

function signActorId(id: string) {
  return createHmac('sha256', sessionSecret()).update(id).digest('base64url');
}

function encodeActorCookie(id: string) {
  return `${Buffer.from(id, 'utf8').toString('base64url')}.${signActorId(id)}`;
}

function decodeActorCookie(value: string) {
  const [encodedId, signature] = value.split('.');
  if (!encodedId || !signature) throw new ActorAuthError('INVALID_ACTOR');
  let id: string;
  try {
    id = Buffer.from(encodedId, 'base64url').toString('utf8');
  } catch {
    throw new ActorAuthError('INVALID_ACTOR');
  }
  if (!SAFE_ACTOR_ID.test(id)) throw new ActorAuthError('INVALID_ACTOR');
  const expected = Buffer.from(signActorId(id), 'utf8');
  const received = Buffer.from(signature, 'utf8');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new ActorAuthError('INVALID_ACTOR');
  }
  return id;
}

function cookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const value = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return value ? decodeURIComponent(value) : undefined;
}

function actorRole(request: Request): PartyRole {
  const operatorToken = process.env.BARGAIN_OPERATOR_TOKEN?.trim();
  const providedOperatorToken = request.headers.get('x-bargain-operator-token');
  if (operatorToken && providedOperatorToken) {
    const expected = Buffer.from(operatorToken, 'utf8');
    const received = Buffer.from(providedOperatorToken, 'utf8');
    if (expected.length === received.length && timingSafeEqual(expected, received)) return 'operator';
  }
  if (!areDemoHeadersEnabled()) return 'buyer';
  const value = request.headers.get('x-bargain-party-role');
  return value === 'seller' ? value : 'buyer';
}

export function getActor(request: Request): ActorContext | undefined {
  // Header identity is an explicit local/staging test switch only. It is
  // disabled by default and cannot be enabled in production.
  const headerIdentity = areDemoHeadersEnabled() ? request.headers.get('x-bargain-user-id')?.trim() : undefined;
  const rawCookie = cookieValue(request, ACTOR_COOKIE);
  const id = rawCookie ? decodeActorCookie(rawCookie) : headerIdentity;
  if (!id) return undefined;
  if (!SAFE_ACTOR_ID.test(id)) throw new ActorAuthError('INVALID_ACTOR');
  return { id, role: actorRole(request) };
}

export function requireActor(request: Request): ActorContext {
  const actor = getActor(request);
  if (!actor) throw new ActorAuthError('ACTOR_REQUIRED');
  return actor;
}

export function createActor(request: Request): { actor: ActorContext; isNew: boolean } {
  const existing = getActor(request);
  if (existing) return { actor: existing, isNew: false };
  sessionSecret();
  return { actor: { id: `user-${randomUUID()}`, role: actorRole(request) }, isNew: true };
}

export function attachActorCookie(response: { headers: Headers }, actorId: string) {
  const secure = isProductionEnvironment() ? '; Secure' : '';
  response.headers.append(
    'Set-Cookie',
    `${ACTOR_COOKIE}=${encodeActorCookie(actorId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`
  );
}
