/**
 * Reuse example: the same Commit Gate guarding a different irreversible
 * action — an infrastructure agent that deletes cloud resources.
 *
 *   npm run example:reuse
 *
 * Nothing here imports negotiation code. The four integration steps are:
 *   1. describe the effect as an IrreversibleIntent (hashed, so it cannot drift)
 *   2. write a deterministic requirement function (policy vs. human approvers)
 *   3. run the effect only through executeIrreversibleEffect()
 *   4. issue grants only from an authenticated human approval surface
 */
import {
  AuthorizationRequirement,
  executeIrreversibleEffect,
  hashIntent,
  IrreversibleIntent,
  issueApprovalGrant,
  MemoryEffectLedger,
  SafetyError,
} from '../../src/lib/safety/commitGate';

interface Resource { id: string; owner: string; tags: string[]; monthlyCostUsd: number; ageDays: number }

const inventory: Record<string, Resource> = {
  'ci-cache-123': { id: 'ci-cache-123', owner: 'platform-team', tags: ['ephemeral'], monthlyCostUsd: 4, ageDays: 30 },
  'staging-db': { id: 'staging-db', owner: 'alice', tags: ['database'], monthlyCostUsd: 120, ageDays: 400 },
  'prod-db-primary': { id: 'prod-db-primary', owner: 'alice', tags: ['database', 'production'], monthlyCostUsd: 900, ageDays: 900 },
};

// Step 1 — the intent. Everything the executor will act on is inside it.
const deletionIntent = (resource: Resource): IrreversibleIntent<{ resourceId: string; owner: string }> => ({
  kind: 'cloud.delete',
  subjectId: resource.id,
  amount: resource.monthlyCostUsd,
  currency: 'USD/month',
  payload: { resourceId: resource.id, owner: resource.owner },
});

// Step 2 — deterministic policy. The model never decides who must approve.
function deletionRequirement(resource: Resource): AuthorizationRequirement {
  const autoDeletable = resource.tags.includes('ephemeral') && !resource.tags.includes('production') && resource.ageDays >= 7 && resource.monthlyCostUsd <= 50;
  return autoDeletable
    ? { mode: 'policy', policyId: 'ephemeral-older-than-7-days', reason: 'ephemeral resource' }
    : { mode: 'human', approvers: [{ id: resource.owner, role: 'owner', reason: 'non-ephemeral resource' }], reason: 'owner approval required' };
}

const deleted: string[] = [];
let killSwitch = false;
const secret = 'example-only-signing-secret-0123456789';
const deps = {
  ledger: new MemoryEffectLedger(),
  executor: { name: 'fake-cloud', execute: async (intent: IrreversibleIntent) => { deleted.push(intent.subjectId); return { externalRef: `op-${deleted.length}` }; } },
  isKillSwitchEngaged: async () => killSwitch,
  secret,
};

// Step 3 — the only way to delete.
async function attempt(label: string, resourceId: string, grants: ReturnType<typeof issueApprovalGrant>[] = []) {
  const resource = inventory[resourceId];
  try {
    const { duplicate } = await executeIrreversibleEffect(deletionIntent(resource), deletionRequirement(resource), grants, deps);
    return { label, outcome: duplicate ? 'already done (not repeated)' : 'DELETED' };
  } catch (error) {
    return { label, outcome: `refused: ${error instanceof SafetyError ? error.code : String(error)}` };
  }
}

// Step 4 — grants come from an authenticated approval UI (simulated here).
const ownerApproves = (resourceId: string, approverId: string) =>
  issueApprovalGrant({ intentHash: hashIntent(deletionIntent(inventory[resourceId])), approverId, approverRole: 'owner', ttlMs: 10 * 60_000, secret });

async function main() {
  const rows = [
    await attempt('Agent deletes an old CI cache (policy allows)', 'ci-cache-123'),
    await attempt('Agent hallucinates "delete prod-db-primary"', 'prod-db-primary'),
    await attempt('Grant for staging-db replayed onto prod-db-primary', 'prod-db-primary', [ownerApproves('staging-db', 'alice')]),
    await attempt('Someone other than the owner approves prod-db-primary', 'prod-db-primary', [ownerApproves('prod-db-primary', 'mallory')]),
  ];
  killSwitch = true;
  rows.push(await attempt('Owner approves staging-db while the kill switch is on', 'staging-db', [ownerApproves('staging-db', 'alice')]));
  killSwitch = false;
  rows.push(await attempt('Owner approves staging-db after release', 'staging-db', [ownerApproves('staging-db', 'alice')]));
  rows.push(await attempt('The same approval is submitted again', 'staging-db', [ownerApproves('staging-db', 'alice')]));

  console.log('\nCommit Gate reuse example — cloud resource deletion\n');
  for (const row of rows) console.log(`${row.outcome.padEnd(42)} ${row.label}`);
  console.log(`\nActually deleted: ${deleted.join(', ') || 'nothing'}`);

  const expected = ['ci-cache-123', 'staging-db'];
  const ok = deleted.length === expected.length && expected.every((id, index) => deleted[index] === id);
  console.log(ok ? '\n✅ Only the policy-allowed cache and the owner-approved staging DB were deleted, each once.' : '\n❌ Unexpected deletions.');
  return ok;
}

export const runReuseExample = main;

if (require.main === module) {
  main().then((ok) => process.exit(ok ? 0 : 1));
}
