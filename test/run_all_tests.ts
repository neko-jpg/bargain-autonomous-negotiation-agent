import { runGuardrailsTests } from './unit/guardrails.test';
import { runMarketSimulatorTests } from './unit/marketSimulator.test';
import { runSwitchDemoE2ETests } from './e2e/switchDemo.test';
import { runNegotiationServiceTests } from './unit/negotiationService.test';
import { runPolicyEngineTests } from './unit/policyEngine.test';
import { runCatalogTests } from './catalog.test';
import { runEvaluationTests } from './evaluation.test';
import { runWorkflowStoreTests } from './unit/workflowStore.test';
import { runActorAuthTests } from './unit/actor.test';

async function main() {
  console.log('====================================================');
  console.log('🚀 Project BARGAIN — Comprehensive Test Suite Runner');
  console.log('====================================================');

  const t1 = runGuardrailsTests();
  const t2 = runMarketSimulatorTests();
  const t3 = runSwitchDemoE2ETests();
  const t4 = await runNegotiationServiceTests();
  const t5 = runPolicyEngineTests();
  const t6 = runCatalogTests();
  const t7 = await runEvaluationTests();
  const t8 = await runWorkflowStoreTests();
  const t9 = runActorAuthTests();

  console.log('\n====================================================');
  if (t1 && t2 && t3 && t4 && t5 && t6 && t7 && t8 && t9) {
    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! (100% PASS RATE)');
    console.log('====================================================\n');
    process.exit(0);
  } else {
    console.error('❌ SOME TESTS FAILED.');
    console.log('====================================================\n');
    process.exit(1);
  }
}

main();
