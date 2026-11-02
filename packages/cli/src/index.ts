/**
 * @veripact/cli — `veripact` executable entry point.
 *
 * Thin adapter (agent 03): parses argv, delegates to `VeriPactClient`, and
 * formats human or `--json` output. `run()` is sync for `--help`/`--version`
 * and parse errors, async for flows — callers `await` uniformly. Key
 * material never appears in output: only commitments, public keys,
 * signatures, and PayPal ids are printed.
 */
import {
  DISPUTE_CASE_NAMES,
  SCENARIO_NAMES,
  SDK_VERSION,
  VeriPactClient,
  type AuditDisputeResult,
  type CheckoutFlowResult,
  type DisputeCaseName,
  type ScenarioName,
  type TransactionBundleResult,
  type WitnessSnapshotOutput,
} from '@veripact/sdk';

export const CLI_NAME = 'veripact';
export const CLI_VERSION = SDK_VERSION;

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const HELP = `veripact ${CLI_VERSION} — prove what the merchant promised.

Usage:
  veripact --help                      Show this help
  veripact --version                   Show the version
  veripact witness --scenario <name> [--json]
                                       Witness a scenario storefront (no PayPal calls)
  veripact checkout --scenario <name> [--json]
                                       Run a guarded witnessed checkout
  veripact audit-dispute --case <name> [--json]
                                       Audit a contested dispute to RESOLVED
  veripact verify --scenario <name> [--json]
                                       Verify a checkout transaction bundle

Scenarios: ${SCENARIO_NAMES.join(', ')}
Dispute cases: ${DISPUTE_CASE_NAMES.join(', ')}

Keys come from environment variables only (BUYER/WITNESS/MERCHANT keys,
PAYPAL credentials — see .env.example). Without them, every command runs
fully offline on deterministic demo fixtures (labeled demoKeys).
`;

function ok(stdout: string): CliResult {
  return { exitCode: 0, stdout, stderr: '' };
}

function fail(stderr: string): CliResult {
  return { exitCode: 1, stdout: '', stderr: `${stderr}\nRun \`veripact --help\` for usage.` };
}

function asJson(command: string, payload: unknown): string {
  return `${JSON.stringify({ ok: true, command, result: payload }, null, 2)}\n`;
}

interface ParsedArgs {
  scenario?: string;
  caseName?: string;
  json: boolean;
  error?: string;
}

function parseFlags(command: string, rest: string[]): ParsedArgs {
  const parsed: ParsedArgs = { json: false };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === '--json') {
      parsed.json = true;
    } else if (flag === '--scenario') {
      const value = rest[i + 1];
      if (value === undefined) {
        parsed.error = `\`veripact ${command}\` requires a value for --scenario`;
        return parsed;
      }
      parsed.scenario = value;
      i += 1;
    } else if (flag === '--case') {
      const value = rest[i + 1];
      if (value === undefined) {
        parsed.error = `\`veripact ${command}\` requires a value for --case`;
        return parsed;
      }
      parsed.caseName = value;
      i += 1;
    } else {
      parsed.error = `unknown flag for \`veripact ${command}\`: ${flag}`;
      return parsed;
    }
  }
  return parsed;
}

function isScenarioName(value: string): value is ScenarioName {
  return (SCENARIO_NAMES as string[]).includes(value);
}

function isDisputeCaseName(value: string): value is DisputeCaseName {
  return (DISPUTE_CASE_NAMES as string[]).includes(value);
}

function labelsLine(demoKeys: boolean, transportMode?: string): string {
  const keys = demoKeys ? 'demoKeys=true (deterministic demo)' : 'demoKeys=false (env keys)';
  return transportMode === undefined ? `labels: ${keys}` : `labels: ${keys}, paypal=${transportMode}`;
}

function formatSnapshotHuman(snapshot: WitnessSnapshotOutput): string[] {
  const observed = snapshot.termReceipt.observedTerms;
  const price = observed.basePriceUsd.value !== undefined ? `$${observed.basePriceUsd.value.toFixed(2)}` : '?';
  const returnsDays = observed.returnWindowDays.value;
  return [
    `decision: ${snapshot.gateResult.decision}`,
    `commitment: ${snapshot.commitment}`,
    `product: ${observed.itemTitle.value ?? '?'} (${price}, ${observed.condition.value ?? '?'})`,
    `returns: ${returnsDays === undefined ? '?' : `${returnsDays}-day`}, restocking ${observed.restockingFeePct.value ?? '?'}%`,
    `channel3: ${snapshot.oracleResult.productId} (matched=${snapshot.oracleResult.matched}, ${snapshot.oracleResult.source})`,
    `tsa: ${snapshot.anchor.authority} @ ${new Date(snapshot.anchor.timestampMs).toISOString()}`,
  ];
}

function formatCheckoutHuman(result: CheckoutFlowResult): string {
  const lines = [
    `veripact checkout — ${result.scenario}: ${result.outcome}`,
    ...formatSnapshotHuman(result.snapshot),
  ];
  if (result.orderId !== undefined) {
    lines.push(`order: ${result.orderId}`);
  }
  if (result.authorizationId !== undefined) {
    lines.push(`authorization: ${result.authorizationId}`);
  }
  if (result.captureId !== undefined) {
    lines.push(`capture: ${result.captureId} ($${(result.finalTotalUsd ?? 0).toFixed(2)})`);
  }
  if (result.voidReason !== undefined) {
    lines.push(`void: ${result.voidReason}`);
  }
  lines.push(labelsLine(result.demoKeys, result.transportMode));
  return `${lines.join('\n')}\n`;
}

function formatAuditHuman(result: AuditDisputeResult): string {
  const lines = [
    `veripact audit-dispute — ${result.case}: ${result.verdict}`,
    `dispute: ${result.disputeId} → ${result.finalState.status} (${result.finalState.lifeCycleStage}, outcome=${result.finalState.outcome ?? 'n/a'})`,
    `order: ${result.orderId} (anchorTrusted=${result.anchorTrusted})`,
    ...result.steps.map((s) => `  - ${s}`),
    labelsLine(result.demoKeys, result.transportMode),
  ];
  return `${lines.join('\n')}\n`;
}

function formatVerifyHuman(
  scenario: string,
  bundle: TransactionBundleResult,
  transportMode: string,
  demoKeys: boolean,
): string {
  const lines = [
    `veripact verify — ${scenario}: ${bundle.allValid ? 'VALID' : 'INVALID'}`,
    `commitment: ${bundle.commitment} (custom_id match=${bundle.customIdMatch})`,
    `signatures: buyer=${bundle.buyerSignatureValid} witness=${bundle.witnessSignatureValid} merchant=${bundle.merchantSignatureValid}`,
    bundle.anchorChecked
      ? `anchor: valid=${bundle.anchorValid} (${bundle.anchorReason ?? 'n/a'})`
      : 'anchor: not checked',
    labelsLine(demoKeys, transportMode),
  ];
  return `${lines.join('\n')}\n`;
}

async function runWitness(args: ParsedArgs): Promise<CliResult> {
  if (args.scenario === undefined) {
    return fail('`veripact witness` requires --scenario <name>');
  }
  if (!isScenarioName(args.scenario)) {
    return fail(`unknown scenario: ${args.scenario} (expected one of ${SCENARIO_NAMES.join(', ')})`);
  }
  const client = new VeriPactClient();
  const result = await client.witnessScenario(args.scenario);
  if (args.json) {
    return ok(asJson('witness', result));
  }
  const lines = [
    `veripact witness — ${result.scenario}`,
    ...formatSnapshotHuman(result.snapshot),
    labelsLine(result.demoKeys),
  ];
  return ok(`${lines.join('\n')}\n`);
}

async function runCheckout(args: ParsedArgs): Promise<CliResult> {
  if (args.scenario === undefined) {
    return fail('`veripact checkout` requires --scenario <name>');
  }
  if (!isScenarioName(args.scenario)) {
    return fail(`unknown scenario: ${args.scenario} (expected one of ${SCENARIO_NAMES.join(', ')})`);
  }
  const client = new VeriPactClient();
  const result = await client.runWitnessedCheckoutFlow({ scenario: args.scenario });
  if (args.json) {
    return ok(asJson('checkout', result));
  }
  return ok(formatCheckoutHuman(result));
}

async function runAuditDispute(args: ParsedArgs): Promise<CliResult> {
  if (args.caseName === undefined) {
    return fail('`veripact audit-dispute` requires --case <name>');
  }
  if (!isDisputeCaseName(args.caseName)) {
    return fail(
      `unknown case: ${args.caseName} (expected one of ${DISPUTE_CASE_NAMES.join(', ')})`,
    );
  }
  const client = new VeriPactClient();
  const result = await client.auditAndResolveDispute({ case: args.caseName });
  if (args.json) {
    return ok(asJson('audit-dispute', result));
  }
  return ok(formatAuditHuman(result));
}

async function runVerify(args: ParsedArgs): Promise<CliResult> {
  if (args.scenario === undefined) {
    return fail('`veripact verify` requires --scenario <name>');
  }
  if (!isScenarioName(args.scenario)) {
    return fail(`unknown scenario: ${args.scenario} (expected one of ${SCENARIO_NAMES.join(', ')})`);
  }
  const client = new VeriPactClient();
  const checkout = await client.runWitnessedCheckoutFlow({ scenario: args.scenario });
  if (checkout.outcome !== 'CAPTURED') {
    return fail(
      `nothing to verify: scenario ${args.scenario} ended ${checkout.outcome} (need CAPTURED)`,
    );
  }
  const bundle = await client.verifyCheckoutBundle(checkout);
  if (args.json) {
    return ok(asJson('verify', { scenario: args.scenario, bundle }));
  }
  return ok(formatVerifyHuman(args.scenario, bundle, checkout.transportMode, checkout.demoKeys));
}

/**
 * Route argv (without node/script prefix) to a result. Sync for help/version
 * and parse errors; async for flows — `await` the return value uniformly.
 */
export function run(argv: string[]): CliResult | Promise<CliResult> {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h') {
    return ok(HELP);
  }
  if (command === '--version' || command === '-v') {
    return ok(`${CLI_NAME} ${CLI_VERSION}\n`);
  }
  if (
    command === 'witness' ||
    command === 'checkout' ||
    command === 'audit-dispute' ||
    command === 'verify'
  ) {
    const args = parseFlags(command, rest);
    if (args.error !== undefined) {
      return fail(args.error);
    }
    const task =
      command === 'witness'
        ? runWitness(args)
        : command === 'checkout'
          ? runCheckout(args)
          : command === 'audit-dispute'
            ? runAuditDispute(args)
            : runVerify(args);
    return task.then(
      (result) => result,
      (e: unknown) => fail(e instanceof Error ? e.message : String(e)),
    );
  }
  return fail(`unknown command: ${command}`);
}

/** Process wrapper: prints the result and sets the exit code. */
export function main(): void {
  Promise.resolve()
    .then(() => run(process.argv.slice(2)))
    .then(
      (result) => {
        if (result.stdout.length > 0) {
          process.stdout.write(result.stdout);
        }
        if (result.stderr.length > 0) {
          process.stderr.write(`${result.stderr}\n`);
        }
        process.exitCode = result.exitCode;
      },
      (e: unknown) => {
        process.stderr.write(`veripact: fatal: ${e instanceof Error ? e.message : String(e)}\n`);
        process.exitCode = 1;
      },
    );
}
