/**
 * Mutation testing for the safety layer.
 *
 * Each mutant re-introduces one realistic safety bug (most of them are the
 * kind of bug found in the original review) into a throw-away copy of the
 * repository, then runs the fast safety suite there. A mutant is "killed"
 * when the suite fails. A surviving mutant means the tests would not have
 * noticed that bug.
 *
 *   npx tsx scripts/mutation-test.ts            # all mutants
 *   MUTANTS=M01,M07 npx tsx scripts/mutation-test.ts
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export interface Mutant {
  id: string;
  title: string;
  edits: Array<{ file: string; find: string; replace: string }>;
}

export const MUTANTS: Mutant[] = [
  { id: 'M01', title: 'Drop the turn check (the review bypass: act for the other party)', edits: [
    { file: 'src/lib/negotiation/service.ts', find: "if (actor.role !== session.currentTurn) throw new NegotiationServiceError('NOT_YOUR_TURN');", replace: '' },
  ] },
  { id: 'M02', title: 'Drop the ownership check (act on anyone\'s negotiation)', edits: [
    { file: 'src/lib/negotiation/service.ts', find: "if (isParty(actor) && !ownsSession(session, actor)) throw new NegotiationServiceError('SESSION_FORBIDDEN');", replace: '' },
  ] },
  { id: 'M03', title: 'Gate executes even when approvals are missing', edits: [
    { file: 'src/lib/safety/commitGate.ts', find: "if (missing.length > 0) throw new SafetyError('APPROVAL_REQUIRED', { missing });", replace: '' },
  ] },
  { id: 'M04', title: 'Gate skips grant signature verification', edits: [
    { file: 'src/lib/safety/commitGate.ts', find: "if (typeof signature !== 'string' || !constantTimeEqualHex(signature, hmacHex(secret, grantSigningPayload(unsigned)))) return 'GRANT_SIGNATURE_INVALID';", replace: '' },
  ] },
  { id: 'M05', title: 'Grant is not bound to the intent hash', edits: [
    { file: 'src/lib/safety/commitGate.ts', find: "if (grant.intentHash !== intentHash) return 'GRANT_INTENT_MISMATCH';", replace: '' },
  ] },
  { id: 'M06', title: 'Gate forgets effects already executed (no exactly-once)', edits: [
    { file: 'src/lib/safety/commitGate.ts', find: "if (existing?.status === 'executed') return { receipt: toReceipt(existing), duplicate: true };", replace: '' },
    { file: 'src/lib/safety/commitGate.ts', find: "if (existing?.status === 'executed') return { outcome: 'executed' as const, entry: structuredClone(existing) };", replace: '' },
  ] },
  { id: 'M07', title: 'Gate ignores the kill switch', edits: [
    { file: 'src/lib/safety/commitGate.ts', find: "if (await deps.isKillSwitchEngaged()) throw new SafetyError('KILL_SWITCH_ENGAGED');", replace: '' },
  ] },
  { id: 'M08', title: 'Agent steps ignore the kill switch', edits: [
    { file: 'src/lib/negotiation/service.ts', find: "if (request.type === 'auto_step' && await isKillSwitchEngaged()) throw new NegotiationServiceError('KILL_SWITCH_ENGAGED');", replace: '' },
  ] },
  { id: 'M09', title: 'Invariant monitor disabled', edits: [
    { file: 'src/lib/negotiation/persistence.ts', find: "throw new SafetyError('INVARIANT_VIOLATION', { violations });", replace: '' },
  ] },
  { id: 'M10', title: 'Budget clamps removed from both the guardrail and the policy engine', edits: [
    { file: 'src/lib/engine/guardrails.ts', find: 'if (sanitizedPrice > reservationPrice) {', replace: 'if (false) {' },
    { file: 'src/lib/engine/guardrails.ts', find: 'if (sanitizedPrice > currentListingPrice) {', replace: 'if (false) {' },
    { file: 'src/lib/negotiation/policyEngine.ts', find: 'if (sanitizedPrice > maxItemPrice) {', replace: 'if (false) {' },
    { file: 'src/lib/negotiation/policyEngine.ts', find: 'if (sanitizedPrice > listing.price) {', replace: 'if (false) {' },
  ] },
  { id: 'M11', title: 'Seller-side approval requirement dropped', edits: [
    { file: 'src/lib/negotiation/commit.ts', find: "if (sellerReason) approvers.push({ id: session.sellerId, role: 'seller', reason: sellerReason });", replace: '' },
  ] },
  { id: 'M12', title: 'Expired purchase intents can still be approved', edits: [
    { file: 'src/lib/negotiation/commit.ts', find: "if (Date.parse(pending.expiresAt) <= now.getTime()) throw new SafetyError('COMMIT_EXPIRED');", replace: '' },
  ] },
  { id: 'M13', title: 'Approvals not bound to the pending intent (service and binding)', edits: [
    { file: 'src/lib/negotiation/service.ts', find: "if (current.pendingCommit?.intentHash !== request.intentHash) throw new NegotiationServiceError('COMMIT_INTENT_MISMATCH');\n        next = grantPurchaseApproval", replace: 'next = grantPurchaseApproval' },
    { file: 'src/lib/negotiation/commit.ts', find: "if (pending.intentHash !== expectedIntentHash) throw new SafetyError('COMMIT_INTENT_MISMATCH');", replace: '' },
  ] },
  { id: 'M14', title: 'Audit hash ignores the event payload', edits: [
    { file: 'src/lib/negotiation/auditLog.ts', find: '    payload: entry.payload,\n', replace: '' },
  ] },
  { id: 'M15', title: 'Superseded offers can be accepted', edits: [
    { file: 'src/lib/negotiation/service.ts', find: "if (latestPriced?.id !== target.id) throw new NegotiationServiceError('TARGET_OFFER_SUPERSEDED');", replace: '' },
  ] },
  { id: 'M16', title: 'Operators may approve purchases', edits: [
    { file: 'src/lib/negotiation/service.ts', find: "approve_commit: ['party'],", replace: "approve_commit: ['party', 'operator']," },
    { file: 'src/lib/negotiation/commit.ts', find: 'return requirement.approvers.find((approver) => approver.id === actor.id && approver.role === actor.role);', replace: "return actor.role === 'operator' ? requirement.approvers[0] : requirement.approvers.find((approver) => approver.id === actor.id && approver.role === actor.role);" },
  ] },
  { id: 'M17', title: 'Offers stay acceptable after their author lowers the budget (TOCTOU found by the fuzzer)', edits: [
    { file: 'src/lib/negotiation/service.ts', find: "if (!isOfferStillBinding(session, target)) throw new NegotiationServiceError('TARGET_OFFER_WITHDRAWN');", replace: '' },
    { file: 'src/lib/agent/negotiationGraph.ts', find: 'if (targetVersionMatches && isOfferStillBinding(session, target) && ', replace: 'if (targetVersionMatches && ' },
  ] },
  { id: 'M18', title: 'Operators may approve contracts on behalf of the buyer', edits: [
    { file: 'src/lib/negotiation/workflowStore.ts', find: "if (actor.role === 'operator' && decision === 'approve' && task.kind !== 'commit') throw new Error('APPROVAL_FORBIDDEN');", replace: '' },
  ] },
  { id: 'M19', title: 'No Origin / Sec-Fetch-Site check on state-changing requests (CSRF)', edits: [
    { file: 'src/lib/auth/actor.ts', find: 'if (SAFE_METHODS.has(request.method.toUpperCase())) return;', replace: 'return;' },
  ] },
  { id: 'M20', title: 'A party may reconcile (declare the outcome of) its own purchase', edits: [
    { file: 'src/lib/negotiation/service.ts', find: "reconcile_commit: ['operator'],", replace: "reconcile_commit: ['party', 'operator']," },
  ] },
  { id: 'M21', title: 'Reconciliation allowed while an attempt may still be running', edits: [
    { file: 'src/lib/safety/commitGate.ts', find: "if (entry.status !== 'failed' && !stale) throw new SafetyError('EFFECT_NOT_RECONCILABLE', { status: entry.status });", replace: '' },
  ] },
];

export interface MutantResult {
  id: string;
  title: string;
  killed: boolean;
  caughtBy: string[];
}

const ROOT = join(__dirname, '..');

function applyEdits(directory: string, mutant: Mutant) {
  for (const edit of mutant.edits) {
    const path = join(directory, edit.file);
    // Normalise line endings before searching. A Windows checkout with
    // core.autocrlf=true otherwise reads the same file as CRLF, and every
    // multi-line mutation target silently stops matching.
    const source = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    const occurrences = source.split(edit.find).length - 1;
    if (occurrences !== 1) throw new Error(`${mutant.id}: expected exactly one match in ${edit.file}, found ${occurrences}`);
    writeFileSync(path, source.replace(edit.find, edit.replace));
  }
}

function prepareCopy(base: string, label: string) {
  const directory = mkdtempSync(join(base, `bargain-${label}-`));
  for (const entry of ['src', 'test', 'docs', 'examples', 'tsconfig.json', 'package.json']) cpSync(join(ROOT, entry), join(directory, entry), { recursive: true });
  symlinkSync(join(ROOT, 'node_modules'), join(directory, 'node_modules'), 'dir');
  return directory;
}

function runQuickSuite(directory: string) {
  const run = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'test/safety/quick.ts'], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, SAFETY_FUZZ_SESSIONS: '150', SAFETY_EXPLORER_DEPTH: '2' },
    timeout: 300_000,
  });
  const output = `${run.stdout}\n${run.stderr}`;
  const failures = Array.from(new Set(output.split('\n').filter((line) => line.includes('[FAIL]')).map((line) => line.replace(/^.*\[FAIL\]\s*/, '').split(' — ')[0])));
  return { passed: run.status === 0, failures, output };
}

export function runMutationTests(selected = MUTANTS): MutantResult[] {
  const base = process.env.MUTATION_TMPDIR ?? tmpdir();
  // Control run: the unmodified copy must pass, otherwise "killed" would mean nothing.
  const control = prepareCopy(base, 'control');
  try {
    const result = runQuickSuite(control);
    if (!result.passed) {
      console.error(result.output.split('\n').slice(-30).join('\n'));
      throw new Error('Mutation testing aborted: the unmodified copy does not pass the suite.');
    }
    console.log('✅ control copy passes the suite');
  } finally {
    rmSync(control, { recursive: true, force: true });
  }

  const results: MutantResult[] = [];
  for (const mutant of selected) {
    const directory = prepareCopy(base, mutant.id);
    try {
      applyEdits(directory, mutant);
      const result = runQuickSuite(directory);
      const killed = !result.passed;
      // A kill must come from a failing check, not from a crash or type error.
      const caughtBy = result.failures;
      const validKill = killed && caughtBy.length > 0;
      results.push({ id: mutant.id, title: mutant.title, killed: validKill, caughtBy: validKill ? caughtBy : ['(no failing check: crashed)'] });
      console.log(`${validKill ? '💀 killed  ' : '🧟 SURVIVED'} ${mutant.id} ${mutant.title}${validKill ? ` ← ${caughtBy[0]}` : ''}`);
      if (killed && !validKill) console.error(result.output.split('\n').slice(-15).join('\n'));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  return results;
}

if (require.main === module) {
  const wanted = process.env.MUTANTS?.split(',').map((item) => item.trim());
  const results = runMutationTests(wanted ? MUTANTS.filter((mutant) => wanted.includes(mutant.id)) : MUTANTS);
  const survived = results.filter((result) => !result.killed);
  console.log(`\nMutation score: ${results.length - survived.length}/${results.length}`);
  process.exit(survived.length === 0 ? 0 : 1);
}
