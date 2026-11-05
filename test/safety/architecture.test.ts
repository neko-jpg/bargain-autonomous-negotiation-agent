import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Checker } from '../support/check';
import { setAgentPlannerForTesting } from '../../src/lib/agent/llmProvider';
import { setEffectExecutorForTesting } from '../../src/lib/negotiation/commit';
import { setDatabasePoolForTesting } from '../../src/lib/negotiation/persistence';

/**
 * Architecture fitness tests: keep the bypass closed for future changes.
 * They fail the build if someone adds a second path to an irreversible effect.
 */

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

function sourceFiles(directory = SRC): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function callers(pattern: RegExp, files: string[]) {
  return files
    .filter((file) => pattern.test(readFileSync(file, 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '')))
    .map((file) => relative(ROOT, file).replace(/\\/g, '/'));
}

export function runArchitectureSuite(): Checker {
  console.log('\n--- 🏛️ Running Architecture Fitness Tests ---');
  const check = new Checker('architecture');
  const files = sourceFiles();

  const effectCallers = callers(/executeIrreversibleEffect\(/, files).filter((file) => file !== 'src/lib/safety/commitGate.ts');
  check.record('S1', 'Exactly one call site executes irreversible effects (the service)',
    effectCallers.length === 1 && effectCallers[0] === 'src/lib/negotiation/service.ts', effectCallers.join(', '));

  const grantIssuers = callers(/issueApprovalGrant\(/, files).filter((file) => file !== 'src/lib/safety/commitGate.ts');
  check.record('S2', 'Only the purchase binding may issue approval grants',
    grantIssuers.length === 1 && grantIssuers[0] === 'src/lib/negotiation/commit.ts', grantIssuers.join(', '));

  const agentFiles = files.filter((file) => file.includes(`${join('src', 'lib', 'agent')}`) || file.includes(join('src', 'lib', 'engine')));
  const agentReach = callers(/grantPurchaseApproval|executeIrreversibleEffect|issueApprovalGrant|commitPersistedSession|setKillSwitch|getEffectExecutor|gateDependencies/, agentFiles);
  check.record('S3', 'Agent code cannot reach approvals, effects, storage or the kill switch', agentReach.length === 0, agentReach.join(', ') || 'agent → proposals only');

  const routeFiles = files.filter((file) => file.includes(join('src', 'app', 'api')) && file.endsWith('route.ts'));
  const unauthenticatedMutations = routeFiles.filter((file) => {
    const text = readFileSync(file, 'utf8');
    return /executeNegotiationAction|decideApprovalTask|setKillSwitch|saveContractDraft/.test(text) && !/requireActor\(/.test(text);
  }).map((file) => relative(ROOT, file));
  check.record('S4', 'Every API route that mutates negotiations authenticates the actor', unauthenticatedMutations.length === 0, unauthenticatedMutations.join(', ') || `${routeFiles.length} routes checked`);

  const directWriters = callers(/\bcommitSession\(/, files).filter((file) => !['src/lib/negotiation/sessionStore.ts', 'src/lib/negotiation/persistence.ts', 'src/lib/simulation/switchScenario.ts'].includes(file));
  check.record('S5', 'Session state is written only through the invariant-checked path', directWriters.length === 0, directWriters.join(', ') || 'persistence.ts (+ scripted demo, disabled in production)');

  const env = process.env as Record<string, string | undefined>;
  const previous = env.BARGAIN_ENV;
  env.BARGAIN_ENV = 'production';
  const hooks: Array<[string, () => void]> = [
    ['setAgentPlannerForTesting', () => setAgentPlannerForTesting(() => { throw new Error('unreachable'); })],
    ['setEffectExecutorForTesting', () => setEffectExecutorForTesting(undefined)],
    ['setDatabasePoolForTesting', () => setDatabasePoolForTesting(undefined)],
  ];
  const openHooks = hooks.filter(([, enable]) => { try { enable(); return true; } catch { return false; } }).map(([name]) => name);
  if (previous === undefined) delete env.BARGAIN_ENV; else env.BARGAIN_ENV = previous;
  check.record('S6', 'Test hooks are disabled in production', openHooks.length === 0, openHooks.join(', ') || `${hooks.length} hooks refuse`);

  return check;
}
