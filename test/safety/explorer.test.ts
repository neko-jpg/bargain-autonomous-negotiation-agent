import { Checker } from '../support/check';
import { act, executedEffects, Fixture, newFixture, oracleViolations, Outcome, resetKillSwitch, seedSellerOffer, selectPlanner } from './harness';
import { getPersistedSession } from '../../src/lib/negotiation/persistence';
import { effectiveSellerFloor } from '../../src/lib/negotiation/policyEngine';
import { isKillSwitchEngaged, setKillSwitch } from '../../src/lib/negotiation/safetyControls';
import { NegotiationSession } from '../../src/types/negotiation';
import { ServiceActor } from '../../src/lib/negotiation/service';

/**
 * Bounded exhaustive exploration ("model checking" over the real code).
 * Every sequence of `depth` moves from a finite alphabet of honest and
 * hostile moves is executed from each start state, and the oracles are
 * checked after every move. Within that bound, no reachable state is unsafe.
 */

type Move = { name: string; actor: (f: Fixture) => ServiceActor; run: (f: Fixture, s: NegotiationSession) => Promise<Outcome> };

const latestOpponent = (s: NegotiationSession, role: 'buyer' | 'seller') =>
  [...s.offers].reverse().find((offer) => !offer.senderRole.startsWith(role) && ['make_offer', 'counter_offer'].includes(offer.actionType))?.id ?? 'none';

const withPlanner = async <T>(name: string | undefined, work: () => Promise<T>) => {
  selectPlanner(name);
  try { return await work(); } finally { selectPlanner(undefined); }
};

export const MOVES: Move[] = [
  { name: 'buyer:auto_step(heuristic)', actor: (f) => f.buyer, run: (f) => act(f.session.id, { type: 'auto_step' }, f.buyer) },
  { name: 'buyer:auto_step(accept-anything)', actor: (f) => f.buyer, run: (f) => withPlanner('accept-anything', () => act(f.session.id, { type: 'auto_step' }, f.buyer)) },
  { name: 'buyer:auto_step(blow-the-budget)', actor: (f) => f.buyer, run: (f) => withPlanner('blow-the-budget', () => act(f.session.id, { type: 'auto_step' }, f.buyer)) },
  { name: 'buyer:auto_step(garbage)', actor: (f) => f.buyer, run: (f) => withPlanner('garbage-numbers', () => act(f.session.id, { type: 'auto_step' }, f.buyer)) },
  { name: 'buyer:offer(max)', actor: (f) => f.buyer, run: (f, s) => act(f.session.id, { type: 'human_offer', offerPrice: s.buyerPolicy.maxPrice }, f.buyer) },
  { name: 'buyer:offer(max+1)', actor: (f) => f.buyer, run: (f, s) => act(f.session.id, { type: 'human_offer', offerPrice: s.buyerPolicy.maxPrice + 1 }, f.buyer) },
  { name: 'seller:offer(floor)', actor: (f) => f.seller, run: (f, s) => act(f.session.id, { type: 'human_offer', offerPrice: effectiveSellerFloor(s.sellerPolicy) }, f.seller) },
  { name: 'seller:offer(floor-1)', actor: (f) => f.seller, run: (f, s) => act(f.session.id, { type: 'human_offer', offerPrice: effectiveSellerFloor(s.sellerPolicy) - 1 }, f.seller) },
  { name: 'buyer:accept(latest)', actor: (f) => f.buyer, run: (f, s) => act(f.session.id, { type: 'human_accept', targetOfferId: latestOpponent(s, 'buyer') }, f.buyer) },
  { name: 'seller:accept(latest)', actor: (f) => f.seller, run: (f, s) => act(f.session.id, { type: 'human_accept', targetOfferId: latestOpponent(s, 'seller') }, f.seller) },
  { name: 'buyer:approve_commit', actor: (f) => f.buyer, run: (f, s) => act(f.session.id, { type: 'approve_commit', intentHash: s.pendingCommit?.intentHash ?? 'a'.repeat(64) }, f.buyer) },
  { name: 'seller:approve_commit', actor: (f) => f.seller, run: (f, s) => act(f.session.id, { type: 'approve_commit', intentHash: s.pendingCommit?.intentHash ?? 'a'.repeat(64) }, f.seller) },
  { name: 'operator:approve_commit', actor: (f) => f.operator, run: (f, s) => act(f.session.id, { type: 'approve_commit', intentHash: s.pendingCommit?.intentHash ?? 'a'.repeat(64) }, f.operator) },
  { name: 'buyer:reject_commit', actor: (f) => f.buyer, run: (f, s) => act(f.session.id, { type: 'reject_commit', intentHash: s.pendingCommit?.intentHash ?? 'a'.repeat(64) }, f.buyer) },
  { name: 'stranger:auto_step', actor: (f) => f.stranger, run: (f) => act(f.session.id, { type: 'auto_step' }, f.stranger) },
  { name: 'operator:toggle-kill-switch', actor: (f) => f.operator, run: async (f) => { await setKillSwitch(!(await isKillSwitchEngaged()), 'explorer'); return { ok: true, session: (await getPersistedSession(f.session.id)) as never }; } },
  { name: 'buyer:resume', actor: (f) => f.buyer, run: (f) => act(f.session.id, { type: 'resume' }, f.buyer) },
  { name: 'system:stop', actor: (f) => f.system, run: (f) => act(f.session.id, { type: 'stop' }, f.system) },
];

const START_STATES: Array<{ name: string; build: () => Promise<Fixture> }> = [
  { name: 'fresh, both sides need human approval', build: () => newFixture({ buyerPolicy: { autoPurchase: false }, sellerPolicy: { autoAccept: false } }) },
  { name: 'seller offer on the table, buyer needs approval', build: async () => { const f = await newFixture({ buyerPolicy: { autoPurchase: false } }); await seedSellerOffer(f, 57_500); return f; } },
  { name: 'seller offer on the table, fully auto-approved policy', build: async () => { const f = await newFixture({ buyerPolicy: { autoPurchase: true } }); await seedSellerOffer(f, 57_500); return f; } },
];

export interface ExplorerMetrics {
  depth: number;
  alphabet: number;
  startStates: number;
  sequences: number;
  transitions: number;
  distinctStates: number;
  deals: number;
  violations: string[];
}

function signature(session: NegotiationSession, killSwitch: boolean) {
  return [session.status, session.currentTurn, session.offers.length, session.offers.at(-1)?.actionType ?? '-', session.offers.at(-1)?.senderRole ?? '-', session.pendingCommit?.requirement.mode ?? '-', session.pendingCommit?.grants.length ?? 0, session.pendingCommit?.blockedReason ?? '-', killSwitch ? 'K' : '-'].join('|');
}

export async function runExplorer(depth: number): Promise<{ check: Checker; metrics: ExplorerMetrics }> {
  console.log(`\n--- 🧭 Running Bounded Exhaustive Explorer (depth=${depth}, ${MOVES.length} moves, ${START_STATES.length} start states) ---`);
  const metrics: ExplorerMetrics = { depth, alphabet: MOVES.length, startStates: START_STATES.length, sequences: 0, transitions: 0, distinctStates: 0, deals: 0, violations: [] };
  const seen = new Set<string>();
  const total = MOVES.length ** depth;

  for (const start of START_STATES) {
    for (let code = 0; code < total; code += 1) {
      const sequence: Move[] = [];
      for (let position = 0, rest = code; position < depth; position += 1, rest = Math.floor(rest / MOVES.length)) sequence.push(MOVES[rest % MOVES.length]);
      const fixture = await start.build();
      metrics.sequences += 1;
      for (const [position, move] of sequence.entries()) {
        const before = await getPersistedSession(fixture.session.id) as NegotiationSession;
        const engagedBefore = await isKillSwitchEngaged();
        const effectsBefore = (await executedEffects(fixture.session.id)).length;
        const outcome = await move.run(fixture, before);
        metrics.transitions += 1;
        const after = await getPersistedSession(fixture.session.id) as NegotiationSession;
        seen.add(signature(after, await isKillSwitchEngaged()));
        const where = `${start.name} :: ${sequence.slice(0, position + 1).map((item) => item.name).join(' → ')}`;
        if (!outcome.ok && outcome.unexpected) metrics.violations.push(`unexpected ${outcome.code} at ${where}`);
        if ((before.status === 'deal' || before.status === 'rejected') && (after.version !== before.version)) metrics.violations.push(`terminal changed at ${where}`);
        const prefixIntact = before.offers.every((offer, index) => after.offers[index]?.id === offer.id && after.offers[index]?.price === offer.price);
        if (!prefixIntact) metrics.violations.push(`history rewritten at ${where}`);
        const actor = move.actor(fixture);
        for (const offer of after.offers.slice(before.offers.length)) {
          if (offer.senderRole.endsWith('_human') && !offer.senderRole.startsWith(actor.role)) metrics.violations.push(`party binding at ${where}`);
          if (engagedBefore && offer.senderRole.endsWith('_agent')) metrics.violations.push(`agent acted under kill switch at ${where}`);
        }
        const effectsAfter = (await executedEffects(fixture.session.id)).length;
        if (engagedBefore && effectsAfter > effectsBefore) metrics.violations.push(`effect executed under kill switch at ${where}`);
        if (after.status === 'deal' && before.status !== 'deal') metrics.deals += 1;
        for (const violation of await oracleViolations(fixture.session.id)) metrics.violations.push(`${violation} at ${where}`);
      }
      await resetKillSwitch();
    }
  }
  metrics.distinctStates = seen.size;
  const check = new Checker('explorer');
  check.record('X1', `All ${metrics.sequences.toLocaleString()} move sequences of length ${depth} keep every safety property`, metrics.violations.length === 0, metrics.violations.slice(0, 3).join('; ') || `${metrics.transitions.toLocaleString()} transitions, ${metrics.distinctStates} distinct abstract states`);
  check.record('X2', 'Exploration reaches committed purchases (the search is not vacuous)', metrics.deals > 0, `${metrics.deals} purchases committed`);
  return { check, metrics };
}
