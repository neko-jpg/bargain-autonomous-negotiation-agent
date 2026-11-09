import { randomUUID } from 'node:crypto';
import { Checker } from '../support/check';
import { executeIrreversibleEffect, hashIntent, reconcileEffect, STALE_RESERVATION_MS, type EffectLedger, type GateDependencies, type IrreversibleIntent } from '../../src/lib/safety/commitGate';

/** Plain-object view of a ledger, so one method can be overridden. */
function ledgerMethods(ledger: EffectLedger): EffectLedger {
  return {
    get: (hash) => ledger.get(hash), reserve: (entry) => ledger.reserve(entry),
    markExecuted: (hash, ref, at) => ledger.markExecuted(hash, ref, at), markFailed: (hash, error) => ledger.markFailed(hash, error),
    resolve: (hash, from, resolution, ref) => ledger.resolve(hash, from, resolution, ref), list: (subject) => ledger.list(subject),
  };
}

/** Exercise the same failure and timing scenarios against each ledger implementation. */
export async function runGateRegressions(ledger: EffectLedger, label: string): Promise<Checker> {
  console.log(`\n--- Gate failure regressions (${label}) ---`);
  const check = new Checker(`gate-${label}`);
  const requirement = { mode: 'policy' as const, policyId: 'test', reason: 'test' };
  const intent = (): IrreversibleIntent => ({ kind: 'test', subjectId: randomUUID(), amount: 1, currency: 'JPY', payload: {} });
  const codeOf = async (operation: () => Promise<unknown>) => {
    try { await operation(); return 'SUCCESS'; } catch (error) { return (error as { code?: string }).code ?? 'ERROR'; }
  };

  // The remote side may have completed the operation before the response was lost.
  {
    let calls = 0;
    const deps: GateDependencies = { ledger, secret: 'test', isKillSwitchEngaged: async () => false, executor: {
      name: 'timeout', execute: async () => { calls++; throw new Error('response lost'); },
    } };
    const action = intent();
    const first = await codeOf(() => executeIrreversibleEffect(action, requirement, [], deps));
    const second = await codeOf(() => executeIrreversibleEffect(action, requirement, [], deps));
    check.record('G1', 'An ambiguous executor failure never causes an automatic retry', first === 'EFFECT_EXECUTION_FAILED' && second === 'EFFECT_RESULT_UNKNOWN' && calls === 1, `first=${first}, retry=${second}, calls=${calls}`);
  }

  // Simulate a crash after a successful external call but before the ledger update.
  {
    let calls = 0;
    let now = new Date('2026-01-01T00:00:00Z');
    const failingLedger: EffectLedger = {
      get: (hash) => ledger.get(hash), reserve: (entry) => ledger.reserve(entry),
      markExecuted: async () => { throw new Error('database disconnected'); },
      markFailed: (hash, error) => ledger.markFailed(hash, error), list: (subject) => ledger.list(subject),
      resolve: (hash, from, resolution, ref) => ledger.resolve(hash, from, resolution, ref),
    };
    const deps: GateDependencies = { ledger: failingLedger, secret: 'test', now: () => now,
      isKillSwitchEngaged: async () => false, executor: { name: 'crash', execute: async () => { calls++; return {}; } } };
    const action = intent();
    const first = await codeOf(() => executeIrreversibleEffect(action, requirement, [], deps));
    now = new Date('2026-01-02T00:00:00Z');
    const second = await codeOf(() => executeIrreversibleEffect(action, requirement, [], deps));
    check.record('G2', 'A stale reservation is never automatically reclaimed after a crash', first === 'ERROR' && second === 'EFFECT_IN_PROGRESS' && calls === 1, `first=${first}, retry=${second}, calls=${calls}`);
  }

  // A switch activated after the initial check but before sending must still stop the call.
  {
    let checks = 0;
    let calls = 0;
    const deps: GateDependencies = { ledger, secret: 'test', isKillSwitchEngaged: async () => ++checks >= 2,
      executor: { name: 'late-stop', execute: async () => { calls++; return {}; } } };
    const action = intent();
    const first = await codeOf(() => executeIrreversibleEffect(action, requirement, [], deps));
    deps.isKillSwitchEngaged = async () => false;
    const second = await codeOf(() => executeIrreversibleEffect(action, requirement, [], deps));
    check.record('G3', 'A late kill switch prevents sending and leaves the reservation blocked', first === 'KILL_SWITCH_ENGAGED' && second === 'EFFECT_RESULT_UNKNOWN' && calls === 0, `first=${first}, retry=${second}, calls=${calls}`);
  }

  // A stop before reservation is safe to retry after the switch is released.
  {
    let engaged = true;
    let calls = 0;
    const deps: GateDependencies = { ledger, secret: 'test', isKillSwitchEngaged: async () => engaged,
      executor: { name: 'early-stop', execute: async () => { calls++; return {}; } } };
    const action = intent();
    const first = await codeOf(() => executeIrreversibleEffect(action, requirement, [], deps));
    engaged = false;
    const second = await codeOf(() => executeIrreversibleEffect(action, requirement, [], deps));
    check.record('G5', 'A stop before reservation can be retried after release', first === 'KILL_SWITCH_ENGAGED' && second === 'SUCCESS' && calls === 1, `first=${first}, retry=${second}, calls=${calls}`);
  }

  // Once an external call begins, a switch cannot undo it.
  {
    let engaged = false;
    let calls = 0;
    const deps: GateDependencies = { ledger, secret: 'test', isKillSwitchEngaged: async () => engaged,
      executor: { name: 'already-sent', execute: async () => { calls++; engaged = true; return {}; } } };
    const result = await codeOf(() => executeIrreversibleEffect(intent(), requirement, [], deps));
    check.record('G4', 'A kill switch cannot undo a call already in flight', result === 'SUCCESS' && calls === 1, `result=${result}, calls=${calls}`);
  }

  // Reconciling a crashed attempt: not while it may still be running, and a verdict cannot be flipped.
  {
    let now = new Date('2026-01-01T00:00:00Z');
    const crashingLedger: EffectLedger = { ...ledgerMethods(ledger), markExecuted: async () => { throw new Error('process died'); } };
    const deps: GateDependencies = { ledger: crashingLedger, secret: 'test', now: () => now,
      isKillSwitchEngaged: async () => false, executor: { name: 'crash', execute: async () => ({}) } };
    const action = intent();
    await codeOf(() => executeIrreversibleEffect(action, requirement, [], deps));
    const hash = hashIntent(action);
    const verdict = (outcome: 'executed' | 'not_executed') => ({ outcome, resolvedBy: 'operator-1', resolvedAt: now.toISOString(), note: 'checked provider' });
    now = new Date(now.getTime() + STALE_RESERVATION_MS - 1_000);
    const tooEarly = await codeOf(() => reconcileEffect(hash, verdict('not_executed'), { ledger, now: () => now }));
    now = new Date(now.getTime() + 2_000);
    const voided = await codeOf(() => reconcileEffect(hash, verdict('not_executed'), { ledger, now: () => now }));
    const repeated = await codeOf(() => reconcileEffect(hash, verdict('not_executed'), { ledger, now: () => now }));
    const flipped = await codeOf(() => reconcileEffect(hash, verdict('executed'), { ledger, now: () => now }));
    const rerun = await codeOf(() => executeIrreversibleEffect(action, requirement, [], { ...deps, ledger }));
    check.record('G6', 'A crashed attempt is reconcilable only once stale; the verdict is final and voided intents never run',
      tooEarly === 'EFFECT_NOT_RECONCILABLE' && voided === 'SUCCESS' && repeated === 'SUCCESS' && flipped === 'EFFECT_NOT_RECONCILABLE' && rerun === 'EFFECT_VOIDED',
      `before stale=${tooEarly}, after=${voided}, repeat=${repeated}, flip=${flipped}, re-run=${rerun}`);
  }
  return check;
}
