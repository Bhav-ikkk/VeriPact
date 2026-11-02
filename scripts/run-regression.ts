/**
 * `npm run regression` — run the 24-scenario suite and refresh the
 * committed report. Usage: `npm run regression [-- passes]` (default 3).
 * Zero network/API cost (local TSA + cached Channel3 + PayPal replay).
 */
import { runRegressionSuite, writeRegressionReport } from '@veripact/sdk';

async function main(): Promise<void> {
  const passes = Number(process.argv[2] ?? 3);
  if (!Number.isInteger(passes) || passes < 1 || passes > 10) {
    console.error('usage: npm run regression [-- passes]  (1..10, default 3)');
    process.exitCode = 1;
    return;
  }
  console.log(`VeriPact regression: 24 scenarios x ${passes} pass(es), deterministic replay…`);
  const report = await runRegressionSuite({ passes });
  const path = writeRegressionReport(report);
  const pct = (n: number): string => `${(100 * n).toFixed(1)}%`;
  const ci = (o: { ci95Lower: number; ci95Upper: number }): string =>
    `[${o.ci95Lower.toFixed(3)}, ${o.ci95Upper.toFixed(3)}]`;
  console.log(`gate      ${report.gateAccuracy.successes}/${report.gateAccuracy.total}  ${pct(report.gateAccuracy.rate)}  95% CI ${ci(report.gateAccuracy)}`);
  console.log(`post-auth ${report.postAuthAccuracy.successes}/${report.postAuthAccuracy.total}  ${pct(report.postAuthAccuracy.rate)}  95% CI ${ci(report.postAuthAccuracy)}`);
  console.log(`referee   ${report.refereeAccuracy.successes}/${report.refereeAccuracy.total}  ${pct(report.refereeAccuracy.rate)}  95% CI ${ci(report.refereeAccuracy)}`);
  console.log(`overall   ${report.overallPassRate.successes}/${report.overallPassRate.total}  ${pct(report.overallPassRate.rate)}  95% CI ${ci(report.overallPassRate)}`);
  console.log(`report: ${path}`);
  if (report.failures.length > 0) {
    console.error(`FAILURES: ${report.failures.length}`);
    for (const f of report.failures) {
      console.error(`  ${f.scenarioId} pass ${f.pass} [${f.stage}] expected ${f.expected}, got ${f.actual}`);
    }
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
