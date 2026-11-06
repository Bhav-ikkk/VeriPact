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
  DEFAULT_PARTITION_ALLOCATION_USD,
  DEFAULT_PARTITION_ASK_HUMAN_ABOVE_USD,
  DEFAULT_PARTITION_MAX_PER_ORDER_USD,
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
  veripact wallet-pair [--email <addr>] [--approve --session-id <id>] [--json]
                                       Start (or approve) a QR pairing ceremony
  veripact wallet-sync [--json]        Sync legacy vs protected payments
  veripact partition-create [--label <t>] [--total <usd>] [--max-order <usd>] [--ask-above <usd>] [--json]
                                       Create a buyer-signed agentic partition
  veripact partition-list [--json]     List partitions with live availability

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
  label?: string;
  total?: string;
  maxOrder?: string;
  askAbove?: string;
  email?: string;
  approve: boolean;
  sessionId?: string;
  json: boolean;
  error?: string;
}

function valuedFlag(
  command: string,
  rest: string[],
  i: number,
  flag: string,
): { value?: string; next: number; error?: string } {
  const value = rest[i + 1];
  if (value === undefined) {
    return { next: i, error: `\`veripact ${command}\` requires a value for ${flag}` };
  }
  return { value, next: i + 1 };
}

function parseFlags(command: string, rest: string[]): ParsedArgs {
  const parsed: ParsedArgs = { approve: false, json: false };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === '--json') {
      parsed.json = true;
    } else if (flag === '--approve') {
      parsed.approve = true;
    } else if (
      flag === '--label' ||
      flag === '--total' ||
      flag === '--max-order' ||
      flag === '--ask-above' ||
      flag === '--email' ||
      flag === '--session-id'
    ) {
      const got = valuedFlag(command, rest, i, flag);
      if (got.error !== undefined) {
        parsed.error = got.error;
        return parsed;
      }
      i = got.next;
      if (flag === '--label') {
        parsed.label = got.value;
      } else if (flag === '--total') {
        parsed.total = got.value;
      } else if (flag === '--max-order') {
        parsed.maxOrder = got.value;
      } else if (flag === '--ask-above') {
        parsed.askAbove = got.value;
      } else if (flag === '--email') {
        parsed.email = got.value;
      } else {
        parsed.sessionId = got.value;
      }
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

function parseUsdFlag(raw: string | undefined, fallback: number, flag: string): number {
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`\`${flag}\` must be a USD amount > 0 (got ${raw})`);
  }
  return value;
}

async function runWalletPair(args: ParsedArgs): Promise<CliResult> {
  const client = new VeriPactClient();
  if (args.approve) {
    if (args.sessionId === undefined) {
      return fail('`veripact wallet-pair --approve` requires --session-id <id>');
    }
    if (args.email === undefined) {
      return fail('`veripact wallet-pair --approve` requires --email <addr>');
    }
    const approved = await client
      .wallet()
      .approvePairingCeremony({ sessionId: args.sessionId, payerEmail: args.email });
    if (args.json) {
      return ok(asJson('wallet-pair', approved));
    }
    return ok(
      [
        `veripact wallet-pair — ${approved.session.sessionId}: APPROVED`,
        `vault: ${approved.vaultId} (${approved.session.payerEmail ?? '?'})`,
        `partition: ${approved.partition.partitionId} ($${approved.partition.availableUsd.toFixed(2)} available)`,
        labelsLine(approved.demoKeys, approved.transportMode),
      ].join('\n') + '\n',
    );
  }
  const session = client.wallet().startPairingCeremony();
  if (args.json) {
    return ok(asJson('wallet-pair', session));
  }
  return ok(
    [
      `veripact wallet-pair — ${session.sessionId}: PENDING_SCAN`,
      `scan: ${session.qrPairUrl} (code ${session.pairingCode}, expires ${session.expiresAtUtc})`,
      'approve with: veripact wallet-pair --approve --session-id ' +
        `${session.sessionId} --email <addr>`,
      labelsLine(client.keys.demoKeys, session.transportMode),
    ].join('\n') + '\n',
  );
}

async function runWalletSync(args: ParsedArgs): Promise<CliResult> {
  const client = new VeriPactClient();
  const synced = client.wallet().syncWalletTransactions();
  if (args.json) {
    return ok(asJson('wallet-sync', synced));
  }
  const lines = [
    `veripact wallet-sync — ${synced.protectedCount} protected, ${synced.legacyCount} legacy`,
    ...synced.records.map(
      (r) =>
        `  - [${r.protectionClass}] ${r.orderId} $${r.amountUsd.toFixed(2)} ${r.status} (${r.transportMode})`,
    ),
    labelsLine(client.keys.demoKeys, client.paypal.transportMode),
  ];
  return ok(`${lines.join('\n')}\n`);
}

async function runPartitionCreate(args: ParsedArgs): Promise<CliResult> {
  let total: number;
  let maxOrder: number;
  let askAbove: number;
  try {
    total = parseUsdFlag(args.total, DEFAULT_PARTITION_ALLOCATION_USD, '--total');
    maxOrder = parseUsdFlag(args.maxOrder, DEFAULT_PARTITION_MAX_PER_ORDER_USD, '--max-order');
    askAbove = parseUsdFlag(args.askAbove, DEFAULT_PARTITION_ASK_HUMAN_ABOVE_USD, '--ask-above');
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  const client = new VeriPactClient();
  const spec = client.wallet().createOrUpdatePartition({
    label: args.label ?? 'Agentic Partition',
    totalAllocatedUsd: total,
    maxPerOrderUsd: maxOrder,
    askHumanAboveUsd: askAbove,
  });
  if (args.json) {
    return ok(asJson('partition-create', spec));
  }
  return ok(
    [
      `veripact partition-create — ${spec.partitionId} (${spec.status})`,
      `allocation: $${spec.totalAllocatedUsd.toFixed(2)}, per-order cap $${spec.maxPerOrderUsd.toFixed(2)}, ask-human above $${spec.askHumanAboveUsd.toFixed(2)}`,
      `available: $${spec.availableUsd.toFixed(2)} (buyer-signed ${spec.buyerPublicKeyHex.slice(0, 16)}…)`,
      labelsLine(client.keys.demoKeys, client.paypal.transportMode),
    ].join('\n') + '\n',
  );
}

async function runPartitionList(args: ParsedArgs): Promise<CliResult> {
  const client = new VeriPactClient();
  const partitions = client.wallet().listPartitions();
  if (args.json) {
    return ok(asJson('partition-list', { partitions }));
  }
  const lines = [
    `veripact partition-list — ${partitions.length} partition(s)`,
    ...partitions.map(
      (p) =>
        `  - ${p.partitionId} "${p.label}": $${p.availableUsd.toFixed(2)} available of $${p.totalAllocatedUsd.toFixed(2)} (${p.status})`,
    ),
    labelsLine(client.keys.demoKeys, client.paypal.transportMode),
  ];
  return ok(`${lines.join('\n')}\n`);
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
    command === 'verify' ||
    command === 'wallet-pair' ||
    command === 'wallet-sync' ||
    command === 'partition-create' ||
    command === 'partition-list'
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
            : command === 'verify'
              ? runVerify(args)
              : command === 'wallet-pair'
                ? runWalletPair(args)
                : command === 'wallet-sync'
                  ? runWalletSync(args)
                  : command === 'partition-create'
                    ? runPartitionCreate(args)
                    : runPartitionList(args);
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
