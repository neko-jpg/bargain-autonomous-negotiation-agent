import { runEvaluationSuite } from '../src/lib/evaluation/runner';

export async function runEvaluationTests(): Promise<boolean> {
  console.log('\n--- 🧪 Running Deterministic Evaluation Scenarios ---');
  const evaluation = await runEvaluationSuite();
  for (const scenario of evaluation.results) {
    console.log(`${scenario.passed ? '✅' : '❌'} [${scenario.id}] ${scenario.detail}`);
  }
  console.log(`Metrics: constraintViolationRate=${evaluation.metrics.constraintViolationRate}% dealRate=${evaluation.metrics.dealRate}% averageDiscount=${evaluation.metrics.averageDiscountPercent}% averageRounds=${evaluation.metrics.averageRounds} apiCost=$${evaluation.metrics.apiCostUsd.toFixed(4)} fallbackRate=${evaluation.metrics.fallbackRate}%`);
  return evaluation.metrics.passedCount === evaluation.metrics.scenarioCount;
}
