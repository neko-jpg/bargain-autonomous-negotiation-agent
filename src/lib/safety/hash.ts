import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Deterministic JSON: object keys are sorted and `undefined` members are
 * dropped, so the same logical value always produces the same bytes.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('NON_FINITE_NUMBER');
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

export function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function hashCanonical(value: unknown) {
  return sha256Hex(canonicalJson(value));
}

export function hmacHex(secret: string, value: string) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function constantTimeEqualHex(a: string, b: string) {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
