import { Checker } from '../support/check';
import { createPgliteDatabase } from '../support/pglite';
import { act, executedEffects, newFixture, seedSellerOffer, selectPlanner } from './harness';
import { runAttackSuite } from './attacks.test';
import { getDatabasePool, getPersistedSession, listAuditEntries, setDatabasePoolForTesting } from '../../src/lib/negotiation/persistence';
import { decideApprovalTask, listApprovalTasks } from '../../src/lib/negotiation/workflowStore';
import { verifyAuditChain } from '../../src/lib/negotiation/auditLog';
import { NegotiationSession } from '../../src/types/negotiation';

/**
 * Runs the PostgreSQL code path on PGlite: regressions for the two
 * database-only bugs found in review, durability, and the full attack suite.
 */
export async function runDatabaseSuite(): Promise<Checker[]> {
  console.log('\n--- 🐘 Running PostgreSQL (PGlite) Suite ---');
  const env = process.env as Record<string, string | undefined>;
  const previousKey = env.BARGAIN_PRIVATE_STATE_KEY;
  env.BARGAIN_PRIVATE_STATE_KEY = 'pglite-test-private-state-key-0123456789abcdef';
  const { pool, close } = await createPgliteDatabase();
  setDatabasePoolForTesting(pool);
  const check = new Checker('postgres');
  try {
    // R1 — review finding: time_skip wrote fractional days into an integer column.
    {
      const f = await newFixture({ persisted: true });
      selectPlanner('wait-forever');
      await act(f.session.id, { type: 'auto_step' }, f.buyer);
      selectPlanner(undefined);
      const skipped = await act(f.session.id, { type: 'time_skip', waitHours: 12 }, f.buyer);
      const stored = await getPersistedSession(f.session.id) as NegotiationSession;
      const catalogRow = await getDatabasePool()!.query('select days_listed from listings where id = $1', [stored.listing.id]);
      check.record('R1', 'time_skip with fractional days persists, and the shared catalog row is untouched',
        skipped.ok && !Number.isInteger(stored.listing.daysListed) && Number.isInteger(Number(catalogRow.rows[0]?.days_listed)),
        skipped.ok ? `snapshot daysListed=${stored.listing.daysListed}, catalog days_listed=${catalogRow.rows[0]?.days_listed}` : skipped.code);
    }

    // R2 — review finding: queue approvals always hit a stale session version in PostgreSQL.
    let approvedId = '';
    {
      const f = await newFixture({ persisted: true });
      await seedSellerOffer(f, 57_500);
      selectPlanner('accept-anything');
      await act(f.session.id, { type: 'auto_step' }, f.buyer);
      selectPlanner(undefined);
      const task = (await listApprovalTasks('pending', f.buyer.id)).find((item) => item.negotiationId === f.session.id && item.kind === 'commit');
      let resolved = 'no-task';
      if (task) resolved = (await decideApprovalTask(task.id, 'approve', task.version, 'pg-approve', { id: f.buyer.id, role: 'buyer' })).status;
      const stored = await getPersistedSession(f.session.id) as NegotiationSession;
      approvedId = f.session.id;
      check.record('R2', 'Approving from the queue commits the purchase in PostgreSQL', resolved === 'approved' && stored.status === 'deal' && (await executedEffects(f.session.id)).length === 1, `task=${resolved}, session=${stored.status}`);
    }

    // R3 — audit chain is intact and attributes every write to an actor.
    {
      const entries = await listAuditEntries(approvedId);
      const verification = verifyAuditChain(entries);
      check.record('R3', 'PostgreSQL audit chain verifies and records the acting identity',
        verification.valid && entries.length >= 4 && entries.every((entry) => entry.actorId !== null),
        `${entries.length} entries, valid=${verification.valid}`);
    }

    // R4 — the outbox primary key refuses a second row for the same intent.
    {
      const [effect] = await executedEffects(approvedId);
      let duplicateCode = 'inserted';
      try {
        await getDatabasePool()!.query(
          `insert into effect_outbox (intent_hash, effect_id, kind, subject_id, amount, currency, payload, authorization_record, executor, status, reserved_at)
           values ($1, 'effect-dup', 'purchase.commit', $2, 1, 'JPY', '{}', '{}', 'sandbox', 'executed', now())`,
          [effect?.intentHash, approvedId]
        );
      } catch (error) { duplicateCode = (error as { code?: string }).code ?? 'error'; }
      check.record('R4', 'The database itself refuses a second effect for the same intent', duplicateCode === '23505', `postgres error ${duplicateCode}`);
    }

    // R5 — a pending approval survives a process restart (cache wiped).
    {
      const f = await newFixture({ persisted: true });
      await seedSellerOffer(f, 57_500);
      selectPlanner('accept-anything');
      await act(f.session.id, { type: 'auto_step' }, f.buyer);
      selectPlanner(undefined);
      const state = globalThis as typeof globalThis & { __bargain?: { sessions?: Map<string, unknown> } };
      state.__bargain?.sessions?.clear();
      const reloaded = await getPersistedSession(f.session.id) as NegotiationSession;
      const approve = await act(f.session.id, { type: 'approve_commit', intentHash: reloaded.pendingCommit?.intentHash ?? '' }, f.buyer);
      check.record('R5', 'A pending purchase intent and its approval survive a restart',
        reloaded.status === 'awaiting_commit' && approve.ok && approve.session.status === 'deal',
        `reloaded=${reloaded.status}, after approval=${approve.ok ? approve.session.status : approve.code}`);
    }

    const attacks = await runAttackSuite();
    attacks.results.forEach((result) => { result.suite = 'attacks-postgres'; });
    return [check, attacks];
  } finally {
    setDatabasePoolForTesting(undefined);
    await close();
    if (previousKey === undefined) delete env.BARGAIN_PRIVATE_STATE_KEY; else env.BARGAIN_PRIVATE_STATE_KEY = previousKey;
  }
}
