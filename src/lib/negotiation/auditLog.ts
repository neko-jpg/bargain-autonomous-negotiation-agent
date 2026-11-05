import { canonicalJson, sha256Hex } from '@/lib/safety/hash';

/**
 * Tamper-evident audit chain. Each entry commits to the previous entry's hash,
 * so editing or deleting any past event breaks verification from that point.
 */

export interface AuditEntry {
  negotiationId: string;
  sequence: number;
  eventType: string;
  actorId: string | null;
  payload: unknown;
  prevHash: string;
  entryHash: string;
  createdAt: string;
}

export const GENESIS_HASH = '0'.repeat(64);

export function computeAuditHash(entry: Omit<AuditEntry, 'entryHash' | 'createdAt'>) {
  return sha256Hex(`${entry.prevHash}|${canonicalJson({
    negotiationId: entry.negotiationId,
    sequence: entry.sequence,
    eventType: entry.eventType,
    actorId: entry.actorId,
    payload: entry.payload,
  })}`);
}

export function verifyAuditChain(entries: AuditEntry[]): { valid: boolean; brokenAt?: number } {
  let prevHash = GENESIS_HASH;
  for (const [index, entry] of [...entries].sort((a, b) => a.sequence - b.sequence).entries()) {
    if (entry.sequence !== index + 1 || entry.prevHash !== prevHash || computeAuditHash(entry) !== entry.entryHash) {
      return { valid: false, brokenAt: entry.sequence };
    }
    prevHash = entry.entryHash;
  }
  return { valid: true };
}

const memoryState = globalThis as typeof globalThis & { __bargainAudit?: Map<string, AuditEntry[]> };
const memoryAudit = (memoryState.__bargainAudit ??= new Map<string, AuditEntry[]>());

export function appendMemoryAuditEntry(negotiationId: string, eventType: string, actorId: string | null, payload: unknown) {
  const entries = memoryAudit.get(negotiationId) ?? [];
  const prevHash = entries.at(-1)?.entryHash ?? GENESIS_HASH;
  const base = { negotiationId, sequence: entries.length + 1, eventType, actorId, payload: structuredClone(payload), prevHash };
  const entry: AuditEntry = { ...base, entryHash: computeAuditHash(base), createdAt: new Date().toISOString() };
  entries.push(entry);
  memoryAudit.set(negotiationId, entries);
  return structuredClone(entry);
}

export function listMemoryAuditEntries(negotiationId: string) {
  return structuredClone(memoryAudit.get(negotiationId) ?? []);
}

/** Test helper: simulates an attacker editing stored history. */
export function tamperMemoryAuditEntryForTesting(negotiationId: string, sequence: number, payload: unknown) {
  const entry = memoryAudit.get(negotiationId)?.find((item) => item.sequence === sequence);
  if (entry) entry.payload = payload;
}
