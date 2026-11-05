import { randomUUID } from 'node:crypto';
import { Checker } from '../support/check';
import { executeIrreversibleEffect, type EffectLedger, type GateDependencies, type IrreversibleIntent } from '../../src/lib/safety/commitGate';

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
  return check;
}
