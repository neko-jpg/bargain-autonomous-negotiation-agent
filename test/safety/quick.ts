/** Fast safety gate used by `npm test` and by mutation testing. */
import { runArchitectureSuite } from './architecture.test';
import { runAttackSuite } from './attacks.test';
import { runFuzz } from './fuzz.test';
import { runExplorer } from './explorer.test';

export async function runQuickSafety() {
  const architecture = runArchitectureSuite();
  const attacks = await runAttackSuite();
  const fuzz = await runFuzz({ seed: 20261105, sessions: Number(process.env.SAFETY_FUZZ_SESSIONS ?? 150), steps: 20 });
  const explorer = await runExplorer(Number(process.env.SAFETY_EXPLORER_DEPTH ?? 2));
  return [architecture, attacks, fuzz.check, explorer.check];
}

if (require.main === module) {
  runQuickSafety().then((checks) => process.exit(checks.every((check) => check.passed) ? 0 : 1));
}
