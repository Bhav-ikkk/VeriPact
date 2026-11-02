/**
 * @veripact/sdk 24-scenario regression suite (agent 05).
 *
 * Controlled, deterministic, zero-cost benchmark: each scenario in
 * `benchmark/scenarios/scenarios.json` runs through the REAL pipelines
 * (witness snapshot → gate → PayPal replay checkout → referee) 3 times
 * (72 runs), using the local deterministic TSA signer and the cached
 * Channel3 catalog. Per agent-05 boundaries this is reported as a
 * controlled regression suite with confidence intervals — never as an
 * independent field benchmark.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  deriveEd25519KeyPairFromSeed,
  evaluateContestedDispute,
  signCanonicalPayload,
  type DisputeVerdict,
  type GateDecision,
  type MandateSpec,
  type SignedReceipt,
} from '@veripact/core';
import type { TransportMode } from '@veripact/paypal-client';
import type { WitnessReceiptCore } from '@veripact/witness-client';
import { VeriPactClient } from './client';
import { DEMO_BUYER_SEED } from './scenarios';

/** Scenario groups: benign retail, fee/policy drift, adversarial/forgery. */
export type BenchmarkGroup = 'benign' | 'drift' | 'adversarial';

/** Post-purchase mutation for dispute-referee scenarios. */
export interface BenchmarkMutation {
  kind: 'seller_drift' | 'buyer_forgery';
  returnWindowDays?: number;
  restockingFeePct?: number;
  basePriceUsd?: number;
}

/** One entry of `benchmark/scenarios/scenarios.json`. */
export interface BenchmarkScenario {
  scenarioId: string;
  group: BenchmarkGroup;
  title: string;
  listingPath: string;
  html: string;
  mandate: {
    requiredCondition: string;
    maxAllInPriceUsd: number;
    minReturnWindowDays: number;
    maxRestockingFeePct: number;
  };
  callbackTotals: { shippingUsd: number; taxUsd: number };
  expected: {
    gate: GateDecision;
    postAuth: 'CAPTURE' | 'VOID' | null;
    verdict: DisputeVerdict | null;
  };
  mutation: BenchmarkMutation | null;
}

/** Default pass count: 24 scenarios × 3 = 72 runs. */
export const REGRESSION_PASSES_DEFAULT = 3;

/** Resolve benchmark file paths (repo-root aware, test + server safe). */
export function defaultBenchmarkPaths(): { scenariosPath: string; reportPath: string } {
  const candidates = [
    process.cwd(),
    join(__dirname, '..', '..', '..'),
  ];
  for (const root of candidates) {
    if (existsSync(join(root, 'benchmark', 'scenarios', 'scenarios.json'))) {
      return {
        scenariosPath: join(root, 'benchmark', 'scenarios', 'scenarios.json'),
        reportPath: join(root, 'benchmark', 'results', 'regression_benchmark_report.json'),
      };
    }
  }
  const fallback = candidates[0] ?? process.cwd();
  return {
    scenariosPath: join(fallback, 'benchmark', 'scenarios', 'scenarios.json'),
    reportPath: join(fallback, 'benchmark', 'results', 'regression_benchmark_report.json'),
  };
}

/** Load and structurally validate the scenario file. */
export function loadScenarios(scenariosPath?: string): BenchmarkScenario[] {
  const path = scenariosPath ?? defaultBenchmarkPaths().scenariosPath;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
    scenarios?: BenchmarkScenario[];
  };
  if (!Array.isArray(parsed.scenarios) || parsed.scenarios.length === 0) {
    throw new Error(`regression: no scenarios in ${path}`);
  }
  const seen = new Set<string>();
  for (const s of parsed.scenarios) {
    if (typeof s.scenarioId !== 'string' || typeof s.html !== 'string') {
      throw new Error(`regression: malformed scenario entry in ${path}`);
    }
    if (seen.has(s.scenarioId)) {
      throw new Error(`regression: duplicate scenarioId ${s.scenarioId}`);
    }
    seen.add(s.scenarioId);
  }
  return parsed.scenarios;
}

/** Accuracy stat with an exact 95% Wilson score interval. */
export interface AccuracyStat {
  successes: number;
  total: number;
  rate: number;
  ci95Lower: number;
  ci95Upper: number;
}

/**
 * Exact 95% Wilson score confidence interval (z = 1.96). Returns zeros on
 * an empty sample; bounds are clamped to [0, 1].
 */
export function wilsonConfidenceInterval95(
  successes: number,
  total: number,
): { rate: number; lower: number; upper: number } {
  if (total <= 0) {
    return { rate: 0, lower: 0, upper: 0 };
  }
  const z = 1.96;
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)) / denom;
  return {
    rate: p,
    lower: Math.max(0, center - half),
    upper: Math.min(1, center + half),
  };
}

function toAccuracy(successes: number, total: number): AccuracyStat {
  const { rate, lower, upper } = wilsonConfidenceInterval95(successes, total);
  return { successes, total, rate, ci95Lower: lower, ci95Upper: upper };
}

/** Build a deterministically-signed mandate for a benchmark scenario. */
export function buildScenarioMandate(scenario: BenchmarkScenario): MandateSpec {
  const buyer = deriveEd25519KeyPairFromSeed(DEMO_BUYER_SEED);
  const mandate: MandateSpec = {
    mandateId: `mnd_bench_${scenario.scenarioId.toLowerCase()}`,
    createdAtUtc: '2026-11-01T06:30:00.000Z',
    buyerId: 'buyer_bench_01',
    itemQuery: scenario.title,
    constraints: { ...scenario.mandate },
    buyerPublicKeyHex: buyer.publicKeyHex,
    buyerSignatureHex: '',
  };
  mandate.buyerSignatureHex = signCanonicalPayload(
    { ...mandate, buyerSignatureHex: '' },
    buyer.privateKeyHex,
  );
  return mandate;
}

/** 3×3 gate confusion matrix: expected → actual counts. */
export type GateConfusionMatrix = Record<GateDecision, Record<GateDecision, number>>;

/** One recorded failure (expected vs actual at a named stage). */
export interface RegressionFailure {
  scenarioId: string;
  pass: number;
  stage: 'gate' | 'postAuth' | 'verdict';
  expected: string;
  actual: string;
}

/** Per-scenario rollup across passes. */
export interface ScenarioSummary {
  scenarioId: string;
  group: BenchmarkGroup;
  title: string;
  passes: number;
  passed: number;
}

/** The committed benchmark report (JSON-serializable). */
export interface RegressionBenchmarkReport {
  generatedAtUtc: string;
  transportMode: TransportMode;
  scenarioCount: number;
  passes: number;
  runCount: number;
  gateConfusion: GateConfusionMatrix;
  gateAccuracy: AccuracyStat;
  postAuthAccuracy: AccuracyStat;
  refereeAccuracy: AccuracyStat;
  overallPassRate: AccuracyStat;
  byGroup: Record<BenchmarkGroup, AccuracyStat>;
  failures: RegressionFailure[];
  scenarios: ScenarioSummary[];
}

export interface RegressionRunOptions {
  scenariosPath?: string;
  passes?: number;
  listingBaseUrl?: string;
}

function emptyConfusion(): GateConfusionMatrix {
  return {
    PROCEED: { PROCEED: 0, ASK_HUMAN_DELTA: 0, BLOCK: 0 },
    ASK_HUMAN_DELTA: { PROCEED: 0, ASK_HUMAN_DELTA: 0, BLOCK: 0 },
    BLOCK: { PROCEED: 0, ASK_HUMAN_DELTA: 0, BLOCK: 0 },
  };
}

function applyMutation(
  core: WitnessReceiptCore,
  mutation: BenchmarkMutation,
): WitnessReceiptCore {
  const terms = { ...core.observedTerms };
  if (mutation.returnWindowDays !== undefined) {
    terms.returnWindowDays = { status: 'DETERMINATE', value: mutation.returnWindowDays };
  }
  if (mutation.restockingFeePct !== undefined) {
    terms.restockingFeePct = { status: 'DETERMINATE', value: mutation.restockingFeePct };
  }
  if (mutation.basePriceUsd !== undefined) {
    terms.basePriceUsd = { status: 'DETERMINATE', value: mutation.basePriceUsd };
  }
  return { ...core, observedTerms: terms };
}

/**
 * Run the full suite: every scenario × N passes through snapshot → gate →
 * checkout → referee. Each run gets a fresh zero-key client (fresh replay
 * engine), so runs are isolated and the suite is deterministic.
 */
export async function runRegressionSuite(
  options: RegressionRunOptions = {},
): Promise<RegressionBenchmarkReport> {
  const scenarios = loadScenarios(options.scenariosPath);
  const passes = options.passes ?? REGRESSION_PASSES_DEFAULT;
  const baseUrl = options.listingBaseUrl ?? 'https://veripact-demo.onrender.com';
  const confusion = emptyConfusion();
  const failures: RegressionFailure[] = [];
  const summaries = new Map<string, ScenarioSummary>();
  let gateOk = 0;
  let gateTotal = 0;
  let postOk = 0;
  let postTotal = 0;
  let refOk = 0;
  let refTotal = 0;
  let runOk = 0;
  let runTotal = 0;
  const groupOk: Record<BenchmarkGroup, number> = { benign: 0, drift: 0, adversarial: 0 };
  const groupTotal: Record<BenchmarkGroup, number> = { benign: 0, drift: 0, adversarial: 0 };

  for (let pass = 1; pass <= passes; pass += 1) {
    for (const scenario of scenarios) {
      const client = new VeriPactClient();
      const mandate = buildScenarioMandate(scenario);
      const flow = await client.runWitnessedCheckoutFlow({
        listingUrl: `${baseUrl}${scenario.listingPath}`,
        html: scenario.html,
        mandate,
        callbackTotals: scenario.callbackTotals,
      });
      let passed = true;
      // Stage 1: gate decision.
      const gateActual = flow.snapshot.gateResult.decision;
      confusion[scenario.expected.gate][gateActual] += 1;
      gateTotal += 1;
      if (gateActual === scenario.expected.gate) {
        gateOk += 1;
      } else {
        passed = false;
        failures.push({
          scenarioId: scenario.scenarioId,
          pass,
          stage: 'gate',
          expected: scenario.expected.gate,
          actual: gateActual,
        });
      }
      // Stage 2: post-approval re-gate outcome.
      if (scenario.expected.postAuth !== null) {
        postTotal += 1;
        const postActual =
          flow.outcome === 'CAPTURED' ? 'CAPTURE'
          : flow.outcome === 'AUTO_VOIDED' ? 'VOID'
          : 'BLOCKED_PRE_CHECKOUT';
        if (postActual === scenario.expected.postAuth) {
          postOk += 1;
        } else {
          passed = false;
          failures.push({
            scenarioId: scenario.scenarioId,
            pass,
            stage: 'postAuth',
            expected: scenario.expected.postAuth,
            actual: postActual,
          });
        }
      }
      // Stage 3: contested-dispute referee verdict.
      if (scenario.expected.verdict !== null) {
        refTotal += 1;
        let verdictActual = 'NO_CAPTURE';
        if (flow.outcome === 'CAPTURED' && flow.orderId !== undefined && scenario.mutation !== null) {
          const order = await client.paypal.getOrder(flow.orderId);
          const core = flow.snapshot.receiptCore;
          const witnessReceipt: SignedReceipt = {
            payload: core,
            signatureHex: flow.snapshot.witnessSignatureHex,
            publicKeyHex: flow.snapshot.witnessPublicKeyHex,
          };
          const mutated = applyMutation(core, scenario.mutation);
          const buyerClaimReceipt: SignedReceipt =
            scenario.mutation.kind === 'buyer_forgery'
              ? {
                  payload: mutated,
                  signatureHex: signCanonicalPayload(mutated, client.keys.buyer.privateKeyHex),
                  publicKeyHex: client.keys.buyer.publicKeyHex,
                }
              : {
                  payload: core,
                  signatureHex: signCanonicalPayload(core, client.keys.buyer.privateKeyHex),
                  publicKeyHex: client.keys.buyer.publicKeyHex,
                };
          const sellerCounterClaimReceipt: SignedReceipt =
            scenario.mutation.kind === 'seller_drift'
              ? {
                  payload: mutated,
                  signatureHex: signCanonicalPayload(mutated, client.keys.merchant.privateKeyHex),
                  publicKeyHex: client.keys.merchant.publicKeyHex,
                }
              : witnessReceipt;
          verdictActual = evaluateContestedDispute({
            paypalOrderCustomId: order.customId,
            witnessReceipt,
            buyerClaimReceipt,
            sellerCounterClaimReceipt,
          }).verdict;
        }
        if (verdictActual === scenario.expected.verdict) {
          refOk += 1;
        } else {
          passed = false;
          failures.push({
            scenarioId: scenario.scenarioId,
            pass,
            stage: 'verdict',
            expected: scenario.expected.verdict,
            actual: verdictActual,
          });
        }
      }
      runTotal += 1;
      groupTotal[scenario.group] += 1;
      if (passed) {
        runOk += 1;
        groupOk[scenario.group] += 1;
      }
      const summary = summaries.get(scenario.scenarioId) ?? {
        scenarioId: scenario.scenarioId,
        group: scenario.group,
        title: scenario.title,
        passes: 0,
        passed: 0,
      };
      summary.passes += 1;
      if (passed) {
        summary.passed += 1;
      }
      summaries.set(scenario.scenarioId, summary);
    }
  }

  return {
    generatedAtUtc: new Date().toISOString(),
    transportMode: 'DETERMINISTIC_SANDBOX_REPLAY',
    scenarioCount: scenarios.length,
    passes,
    runCount: runTotal,
    gateConfusion: confusion,
    gateAccuracy: toAccuracy(gateOk, gateTotal),
    postAuthAccuracy: toAccuracy(postOk, postTotal),
    refereeAccuracy: toAccuracy(refOk, refTotal),
    overallPassRate: toAccuracy(runOk, runTotal),
    byGroup: {
      benign: toAccuracy(groupOk.benign, groupTotal.benign),
      drift: toAccuracy(groupOk.drift, groupTotal.drift),
      adversarial: toAccuracy(groupOk.adversarial, groupTotal.adversarial),
    },
    failures,
    scenarios: [...summaries.values()],
  };
}

/** Write the report JSON to disk (creating directories), returning the path. */
export function writeRegressionReport(
  report: RegressionBenchmarkReport,
  reportPath?: string,
): string {
  const path = reportPath ?? defaultBenchmarkPaths().reportPath;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return path;
}
