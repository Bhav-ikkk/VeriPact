/**
 * @veripact/workbench v5 wallet routes (Step 2).
 *
 * Mounted from `routes.ts` under the same security headers, 1MB body cap,
 * and redacted JSON errors. Rule-2 note: these handlers are composition
 * points like `/api/merchant/checkout` — they sequence buyer-signed
 * partitions (Rung 1 SELF), witness snapshots (Rung 2 WIT), and vaulted
 * PayPal orders (Rung 3 SIGN) through one `VeriPactClient` so a judge can
 * run the full agentic-wallet demo in one click. Each underlying call
 * still reads only its own rung key.
 *
 * State: the SDK wallet persists BEST_EFFORT to a gitignored disk mirror
 * (`.veripact-wallet-state.json`, overridable via
 * `VERIPACT_WALLET_STATE_FILE`, wiped by `resetDemoState`) so the
 * socket-free fake req/res harness and polling-first pairing observe the
 * same store across requests (GAP-15).
 */
import {
  evaluatePartitionSpendCheck,
  type ConnectorScope,
  type PartitionSpec,
} from '@veripact/core';
import { REPORTING_INDEXING_DELAY_DISCLOSURE } from '@veripact/paypal-client';
import {
  runAutonomousDealSniper,
  SCENARIO_NAMES,
  type ScenarioName,
  type VeriPactWallet,
} from '@veripact/sdk';
import { loadChannel3CacheFromDisk } from '@veripact/witness-client';
import {
  appendLedger,
  demoClientFor,
  effectiveMandate,
  getCatalogCachePath,
  HttpError,
  parseExecutionMode,
  parseJsonBody,
  readBody,
  sendHtml,
  sendJson,
  withLiveFallback,
  witnessSnapshotForSku,
  type ExecutionMode,
  type WorkbenchRequest,
  type WorkbenchResponse,
} from './routes';
import { PAIRING_PAYER_EMAIL, renderPairPage } from './wallet-template';
import { findCatalogProduct } from './storefront-template';
import {
  completeOnboarding,
  createSubAgent,
  getFleetSnapshot,
  resetFleetStore,
  triggerBackgroundPriceDrop,
  type CompleteOnboardingInput,
} from './fleet-store';

/** Reset in-memory / disk fleet state. Exported for workbench routes and tests. */
export function resetWalletRouteState(): void {
  resetFleetStore();
}

/** Wallet paths served by this module (mirrored in ROUTES). */
export const WALLET_ROUTES = [
  '/pair/:sessionId',
  '/api/wallet/pair/start',
  '/api/wallet/pair/status',
  '/api/wallet/pair/approve',
  '/api/wallet/partitions',
  '/api/wallet/spend-check',
  '/api/wallet/refund',
  '/api/wallet/sync',
  '/api/wallet/connectors',
  '/api/wallet/sniper',
  '/api/onboarding/state',
  '/api/onboarding/complete',
  '/api/agents/spawn',
  '/api/agents/webhook/price-drop',
];

/** Safe pairing-token shape (`400` on anything else — never a lookup). */
const PAIR_SESSION_RE = /^PAIR-VP-[A-Za-z0-9_-]+$/;

const CONNECTOR_PLATFORMS = ['CHATGPT_ACTION', 'CLAUDE_MCP', 'CURSOR_MCP'] as const;
type ConnectorPlatform = (typeof CONNECTOR_PLATFORMS)[number];

/** Wallet bound to one execution mode (lenient demo keys, shared engine). */
function walletFor(mode: ExecutionMode): VeriPactWallet {
  return demoClientFor(mode).wallet();
}

/** Map `wallet: …` domain errors to honest 400s (auth/transport bubble up). */
function asWalletInputError(e: unknown): HttpError | null {
  if (e instanceof HttpError) {
    return e;
  }
  if (e instanceof Error && e.message.startsWith('wallet: ')) {
    return new HttpError(400, e.message);
  }
  return null;
}

function asSessionId(value: unknown): string {
  if (typeof value !== 'string' || !PAIR_SESSION_RE.test(value)) {
    throw new HttpError(400, 'sessionId must match /^PAIR-VP-[A-Za-z0-9_-]+$/"');
  }
  return value;
}

function asPayerEmail(value: unknown): string {
  if (value === undefined || value === null) {
    return PAIRING_PAYER_EMAIL;
  }
  if (typeof value !== 'string' || value === '' || value.length > 254 || /[\r\n\0]/.test(value)) {
    throw new HttpError(400, 'payerEmail must be a single-line string (1..254 chars)');
  }
  return value;
}

function asPositiveUsd(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new HttpError(400, `${field} must be a finite USD amount > 0`);
  }
  return value;
}

function asNonNegativeUsd(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new HttpError(400, `${field} must be a finite USD amount >= 0`);
  }
  return value;
}

const PARTITION_LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9 .,'()-]{0,119}$/;

function asLabel(value: unknown): string {
  if (typeof value !== 'string' || !PARTITION_LABEL_RE.test(value)) {
    throw new HttpError(400, 'label must be 1..120 letters, digits, or simple punctuation');
  }
  return value;
}

function asConnectorPlatform(value: unknown): ConnectorPlatform {
  if (
    typeof value !== 'string' ||
    !(CONNECTOR_PLATFORMS as readonly string[]).includes(value)
  ) {
    throw new HttpError(400, `platform must be one of ${CONNECTOR_PLATFORMS.join(', ')}`);
  }
  return value as ConnectorPlatform;
}

function asScenarioId(value: unknown): ScenarioName {
  if (value === undefined || value === null) {
    return 'normal';
  }
  if (typeof value !== 'string' || !(SCENARIO_NAMES as readonly string[]).includes(value)) {
    throw new HttpError(400, `unknown scenarioId (expected one of ${SCENARIO_NAMES.join(', ')})`);
  }
  return value as ScenarioName;
}

/** Active partition, or `null` before pairing (never a throw for readers). */
function partitionOrNull(wallet: VeriPactWallet): PartitionSpec | null {
  try {
    return wallet.getPartitionStatus();
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('wallet: no partition')) {
      return null;
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Handlers                                                             */
/* ------------------------------------------------------------------ */

function handlePairPage(sessionId: string, res: WorkbenchResponse): void {
  const wallet = walletFor('auto');
  const session = wallet.getPairingSession(asSessionId(sessionId));
  if (session === undefined) {
    throw new HttpError(404, `unknown pairing session: ${sessionId}`);
  }
  sendHtml(res, 200, renderPairPage(session), 'SAMEORIGIN');
}

async function handlePairStart(res: WorkbenchResponse): Promise<void> {
  const wallet = walletFor('auto');
  const session = await wallet.runExclusive(async () => wallet.startPairingCeremony());
  appendLedger({ kind: 'wallet-pair-start', summary: `pairing ceremony started (${session.sessionId})` });
  sendJson(res, 200, {
    session,
    qrPairUrl: session.qrPairUrl,
    pairingCode: session.pairingCode,
  });
}

function handlePairStatus(req: WorkbenchRequest, res: WorkbenchResponse): void {
  const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const sessionId = asSessionId(query.get('sessionId'));
  const wallet = walletFor('auto');
  const session = wallet.getPairingSession(sessionId);
  if (session === undefined) {
    throw new HttpError(404, `unknown pairing session: ${sessionId}`);
  }
  sendJson(res, 200, { session, partition: partitionOrNull(wallet) });
}

async function handlePairApprove(body: Record<string, unknown>, res: WorkbenchResponse): Promise<void> {
  const mode = parseExecutionMode(body);
  const sessionId = asSessionId(body['sessionId']);
  const payerEmail = asPayerEmail(body['payerEmail']);
  const run = async (): Promise<void> => {
    try {
      const wallet = walletFor(mode);
      const result = await wallet.approvePairingCeremony({ sessionId, payerEmail });
      appendLedger({
        kind: 'wallet-pair-approve',
        summary:
          `pairing ${result.session.sessionId} approved for ${payerEmail}; ` +
          `vault ${result.vaultId}; partition ${result.partition.partitionId} ` +
          `($${result.partition.totalAllocatedUsd.toFixed(2)}) initialized`,
      });
      sendJson(res, 200, { session: result.session, partition: result.partition });
    } catch (e) {
      const inputError = asWalletInputError(e);
      if (inputError !== null) {
        throw inputError;
      }
      throw e;
    }
  };
  if (body['executionMode'] === 'live') {
    await run();
  } else {
    await withLiveFallback(run);
  }
}

function handlePartitionsGet(res: WorkbenchResponse): void {
  const wallet = walletFor('auto');
  sendJson(res, 200, { partition: partitionOrNull(wallet), orders: wallet.listOrders() });
}

async function handlePartitionsPost(body: Record<string, unknown>, res: WorkbenchResponse): Promise<void> {
  const wallet = walletFor('auto');
  try {
    const partition = await wallet.runExclusive(async () => wallet.createOrUpdatePartition({
      label: asLabel(body['label']),
      totalAllocatedUsd: asPositiveUsd(body['totalAllocatedUsd'], 'totalAllocatedUsd'),
      maxPerOrderUsd: asPositiveUsd(body['maxPerOrderUsd'], 'maxPerOrderUsd'),
      askHumanAboveUsd: asPositiveUsd(body['askHumanAboveUsd'], 'askHumanAboveUsd'),
    }));
    appendLedger({
      kind: 'wallet-partition-upsert',
      summary:
        `partition ${partition.partitionId} "${partition.label}" upserted ` +
        `($${partition.totalAllocatedUsd.toFixed(2)} cap, $${partition.availableUsd.toFixed(2)} avail)`,
    });
    sendJson(res, 200, partition);
  } catch (e) {
    const inputError = asWalletInputError(e);
    if (inputError !== null) {
      throw inputError;
    }
    throw e;
  }
}

async function handleSpendCheck(body: Record<string, unknown>, res: WorkbenchResponse): Promise<void> {
  const mode = parseExecutionMode(body);
  if (body['dryRun'] === true) {
    const wallet = walletFor(mode);
    const partitionId = body['partitionId'];
    if (partitionId !== undefined && typeof partitionId !== 'string') {
      throw new HttpError(400, 'partitionId must be a string');
    }
    try {
      const partition =
        partitionId === undefined ? wallet.getPartitionStatus() : wallet.getPartitionStatus(partitionId);
      const hasWitnessedReceipt = body['hasWitnessedReceipt'];
      if (typeof hasWitnessedReceipt !== 'boolean') {
        throw new HttpError(400, 'hasWitnessedReceipt must be a boolean');
      }
      const merchantName = body['merchantName'];
      if (merchantName !== undefined && typeof merchantName !== 'string') {
        throw new HttpError(400, 'merchantName must be a string');
      }
      const verdict = evaluatePartitionSpendCheck(partition, {
        partitionId: partition.partitionId,
        requestedAmountUsd: asNonNegativeUsd(body['requestedAmountUsd'], 'requestedAmountUsd'),
        merchantName: typeof merchantName === 'string' ? merchantName : undefined,
        hasWitnessedReceipt,
      });
      sendJson(res, 200, { verdict, partition });
    } catch (e) {
      const inputError = asWalletInputError(e);
      if (inputError !== null) {
        throw inputError;
      }
      throw e;
    }
    return;
  }
  const scenarioId = asScenarioId(body['scenarioId'] ?? body['scenario']);
  const rawSku = body['sku'];
  const sku = typeof rawSku === 'string' && rawSku.trim().length > 0 ? rawSku.trim() : undefined;
  let requestedOverrideUsd = body['requestedOverrideUsd'];
  if (requestedOverrideUsd !== undefined) {
    asPositiveUsd(requestedOverrideUsd, 'requestedOverrideUsd');
  } else if (sku && sku !== 'APEX-27-4K-IPS') {
    const product = findCatalogProduct(sku);
    requestedOverrideUsd = Number(((product.priceUsd ?? 279) + 11.50 + 6.50).toFixed(2));
  }
  const agentToken = body['agentToken'];
  if (agentToken !== undefined && (typeof agentToken !== 'string' || agentToken === '')) {
    throw new HttpError(400, 'agentToken must be a non-empty string');
  }
  const run = async (): Promise<void> => {
    try {
      const wallet = walletFor(mode);
      if (sku && sku !== 'APEX-27-4K-IPS') {
        const skuSnapshot = await witnessSnapshotForSku(scenarioId, sku);
        if (skuSnapshot.gateResult.decision === 'BLOCK') {
          const reason = skuSnapshot.gateResult.reasons.join('; ');
          appendLedger({
            kind: 'wallet-spend',
            summary: `partition spend ${scenarioId} (${sku}): BLOCKED_PRE_CHECKOUT (${skuSnapshot.gateResult.decision} — ${reason})`,
            commitment: skuSnapshot.commitment,
          });
          const partition = wallet.getPartitionStatus();
          sendJson(res, 200, {
            outcome: 'BLOCKED_PRE_CHECKOUT',
            reason,
            gateResult: skuSnapshot.gateResult,
            snapshot: skuSnapshot,
            partition,
            sku,
          });
          return;
        }
      }
      const result = await wallet.executePartitionedAgentPayment({
        scenarioId,
        requestedOverrideUsd:
          typeof requestedOverrideUsd === 'number' ? requestedOverrideUsd : undefined,
        agentToken: typeof agentToken === 'string' ? agentToken : undefined,
      });
      const partition = wallet.getPartitionStatus(result.partitionId);
      appendLedger({
        kind: 'wallet-spend',
        summary:
          `partition spend ${result.scenarioId}` +
          (sku ? ` (${sku})` : '') +
          `: ${result.outcome}` +
          (result.finalTotalUsd !== undefined ? ` $${result.finalTotalUsd.toFixed(2)}` : '') +
          (result.orderId !== undefined ? ` (${result.orderId})` : ' (no order)') +
          `; ${result.partitionId} → $${partition.availableUsd.toFixed(2)} avail`,
        orderId: result.orderId,
        commitment: result.snapshot.commitment,
      });
      sendJson(res, 200, { ...result, partition, sku });
    } catch (e) {
      const inputError = asWalletInputError(e);
      if (inputError !== null) {
        throw inputError;
      }
      throw e;
    }
  };
  if (body['executionMode'] === 'live') {
    await run();
  } else {
    await withLiveFallback(run);
  }
}

async function handleRefund(body: Record<string, unknown>, res: WorkbenchResponse): Promise<void> {
  const mode = parseExecutionMode(body);
  const captureId = body['captureId'];
  if (captureId !== undefined && (typeof captureId !== 'string' || captureId === '')) {
    throw new HttpError(400, 'captureId must be a non-empty string');
  }
  const run = async (): Promise<void> => {
    try {
      const wallet = walletFor(mode);
      const resolved =
        typeof captureId === 'string'
          ? captureId
          : [...wallet.listOrders()].reverse().find((o) => o.status === 'CAPTURED')?.captureId;
      if (resolved === undefined) {
        throw new HttpError(400, 'no captured wallet payment to refund (pass captureId)');
      }
      const refund = await wallet.refundPartitionPayment({ captureId: resolved });
      const partition = wallet.getPartitionStatus(refund.partitionId);
      appendLedger({
        kind: 'wallet-refund',
        summary:
          `refund ${refund.refundId} $${refund.amountUsd.toFixed(2)} on ${refund.captureId}; ` +
          `${refund.partitionId} → $${partition.availableUsd.toFixed(2)} avail`,
      });
      sendJson(res, 200, { refund, partition });
    } catch (e) {
      const inputError = asWalletInputError(e);
      if (inputError !== null) {
        throw inputError;
      }
      throw e;
    }
  };
  if (body['executionMode'] === 'live') {
    await run();
  } else {
    await withLiveFallback(run);
  }
}

function handleSync(res: WorkbenchResponse): void {
  const wallet = walletFor('auto');
  const { records, protectedCount, legacyCount } = wallet.syncWalletTransactions();
  // Honesty: this merge never calls PayPal Transaction Search — the rows
  // come from local origins (legacy fixtures, the committed live-receipts
  // file, session orders), so the scope says FALLBACK and the 3-hour
  // indexing disclosure rides along verbatim.
  sendJson(res, 200, {
    records,
    summary: {
      totalCount: records.length,
      protectedCount,
      legacyUnwitnessedCount: legacyCount,
    },
    indexingDelayDisclosure: REPORTING_INDEXING_DELAY_DISCLOSURE,
    reportingScopeStatus: 'FALLBACK_TO_REPLAY_AND_SESSION_ORDERS',
  });
}

function catalogHasSku(sku: string): boolean {
  try {
    const cache = loadChannel3CacheFromDisk(getCatalogCachePath());
    return cache.products.some((product) => product.productId === sku);
  } catch {
    return false;
  }
}

const SNIPER_SKU_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SNIPER_VOUCHER_RE = /^[A-Za-z0-9_-]{1,32}$/;
const RESERVED_VOUCHER_CODES = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * POST /api/wallet/sniper — run the six-candidate deal hunt and return
 * the DealSniperReport. The sixth candidate's witness snapshot is what
 * the wallet binds into PayPal custom_id.
 */
async function handleSniper(body: Record<string, unknown>, res: WorkbenchResponse): Promise<void> {
  const rawSku = body['sku'];
  let sku: string | undefined;
  if (rawSku !== undefined) {
    if (typeof rawSku !== 'string' || !SNIPER_SKU_RE.test(rawSku) || !catalogHasSku(rawSku)) {
      throw new HttpError(400, 'Invalid or unknown Channel3 SKU');
    }
    sku = rawSku;
  }
  const rawTarget = body['targetMaxAllInUsd'];
  let targetMaxAllInUsd: number | undefined;
  if (rawTarget !== undefined) {
    if (
      typeof rawTarget !== 'number' ||
      !Number.isFinite(rawTarget) ||
      rawTarget < 1 ||
      rawTarget > 10000
    ) {
      throw new HttpError(400, 'targetMaxAllInUsd must be between 1 and 10000');
    }
    targetMaxAllInUsd = rawTarget;
  }
  const rawVoucher = body['customVoucherCode'];
  let customVoucherCode: string | undefined;
  if (rawVoucher !== undefined) {
    if (
      typeof rawVoucher !== 'string' ||
      RESERVED_VOUCHER_CODES.has(rawVoucher) ||
      !SNIPER_VOUCHER_RE.test(rawVoucher)
    ) {
      throw new HttpError(400, 'Invalid voucher code format');
    }
    customVoucherCode = rawVoucher;
  }
  const rawMode = body['executionMode'];
  const mode = rawMode === 'live' ? 'live' : 'replay';
  const client = demoClientFor(mode);
  const report = await runAutonomousDealSniper(client, {
    ...(sku !== undefined ? { sku } : {}),
    ...(targetMaxAllInUsd !== undefined ? { targetMaxAllInUsd } : {}),
    mandate: effectiveMandate('normal'),
    ...(customVoucherCode !== undefined ? { customVoucherCode } : {}),
  });
  const winner = report.winningCandidate;
  appendLedger({
    kind: 'wallet_sniper_sweep',
    summary:
      `sniper ${report.sniperRunId} sku=${report.sku} target=${report.targetMaxAllInUsd.toFixed(2)} ` +
      `outcome=${report.outcome} traps=${report.trapsRejectedCount} ` +
      `capture=${winner?.captureId ?? 'none'}`,
    ...(winner?.orderId !== undefined ? { orderId: winner.orderId } : {}),
    ...(winner?.commitment !== undefined ? { commitment: winner.commitment } : {}),
  });
  sendJson(res, 200, report);
}

function handleConnectors(body: Record<string, unknown>, res: WorkbenchResponse): void {
  const wallet = walletFor('auto');
  const platform = asConnectorPlatform(body['platform']);
  try {
    const { scope, bearerToken } = wallet.mintConnectorToken({
      platform: platform as ConnectorScope['platform'],
    });
    // Ledger carries the masked token only — the raw one-time value
    // leaves the server exactly once, in this response body.
    appendLedger({
      kind: 'wallet-connector-mint',
      summary:
        `connector ${platform} ${scope.tokenId} (${scope.maskedToken}) minted ` +
        `for ${scope.partitionId}`,
    });
    sendJson(res, 200, { connector: scope, bearerTokenOnce: bearerToken });
  } catch (e) {
    const inputError = asWalletInputError(e);
    if (inputError !== null) {
      throw inputError;
    }
    throw e;
  }
}

function handleOnboardingState(res: WorkbenchResponse): void {
  const snapshot = getFleetSnapshot();
  sendJson(res, 200, snapshot);
}

async function handleOnboardingComplete(
  body: Record<string, unknown>,
  res: WorkbenchResponse,
): Promise<void> {
  const email = body['email'];
  if (typeof email !== 'string' || !email.includes('@')) {
    throw new HttpError(400, 'email must be a valid email string');
  }
  const displayName = body['displayName'];
  if (typeof displayName !== 'string' || displayName.trim().length === 0) {
    throw new HttpError(400, 'displayName must be a non-empty string');
  }
  const authProvider = body['authProvider'];
  if (
    authProvider !== 'CLERK_GOOGLE_OAUTH' &&
    authProvider !== 'CLERK_SESSION' &&
    authProvider !== 'DEMO_PASSKEY'
  ) {
    throw new HttpError(
      400,
      "authProvider must be 'CLERK_GOOGLE_OAUTH', 'CLERK_SESSION', or 'DEMO_PASSKEY'",
    );
  }
  const clerkToken = typeof body['clerkToken'] === 'string' ? body['clerkToken'] : undefined;
  const paypalPayerEmail =
    typeof body['paypalPayerEmail'] === 'string' ? body['paypalPayerEmail'] : undefined;
  const masterPartitionUsd =
    typeof body['masterPartitionUsd'] === 'number' && Number.isFinite(body['masterPartitionUsd'])
      ? body['masterPartitionUsd']
      : undefined;
  const initialAgents = Array.isArray(body['initialAgents'])
    ? (body['initialAgents'] as CompleteOnboardingInput['initialAgents'])
    : undefined;

  try {
    const fleet = await completeOnboarding({
      email,
      displayName,
      authProvider,
      clerkToken,
      paypalPayerEmail,
      masterPartitionUsd,
      initialAgents,
    });
    appendLedger({
      kind: 'onboarding-complete',
      summary: `User ${displayName} (${email}) completed onboarding (${authProvider}) with $${(masterPartitionUsd ?? 350).toFixed(2)} master partition`,
    });
    sendJson(res, 200, fleet);
  } catch (e) {
    const inputError = asWalletInputError(e);
    if (inputError !== null) {
      throw inputError;
    }
    throw e;
  }
}

function handleAgentsSpawn(body: Record<string, unknown>, res: WorkbenchResponse): void {
  const name = body['name'];
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new HttpError(400, 'wallet: sub-agent name is required');
  }
  const sku = body['sku'];
  if (typeof sku !== 'string' || sku.trim().length === 0) {
    throw new HttpError(400, 'wallet: sku is required');
  }
  const targetMaxAllInUsd = body['targetMaxAllInUsd'];
  if (
    typeof targetMaxAllInUsd !== 'number' ||
    !Number.isFinite(targetMaxAllInUsd) ||
    targetMaxAllInUsd <= 0
  ) {
    throw new HttpError(400, 'wallet: targetMaxAllInUsd must be greater than 0');
  }
  const subAllocationUsd = body['subAllocationUsd'];
  if (
    typeof subAllocationUsd !== 'number' ||
    !Number.isFinite(subAllocationUsd) ||
    subAllocationUsd <= 0
  ) {
    throw new HttpError(400, 'wallet: subAllocationUsd must be greater than 0');
  }
  const autoBuyEnabled =
    typeof body['autoBuyEnabled'] === 'boolean' ? body['autoBuyEnabled'] : true;

  try {
    const result = createSubAgent({
      name,
      sku,
      targetMaxAllInUsd,
      subAllocationUsd,
      autoBuyEnabled,
    });
    appendLedger({
      kind: 'agent-spawn',
      summary: `Sub-agent ${name} (${result.agent.agentId}) spawned for ${sku} ($${subAllocationUsd.toFixed(2)} sub-alloc, $${targetMaxAllInUsd.toFixed(2)} target)`,
    });
    sendJson(res, 200, result);
  } catch (e) {
    const inputError = asWalletInputError(e);
    if (inputError !== null) {
      throw inputError;
    }
    throw e;
  }
}

async function handlePriceDropWebhook(
  body: Record<string, unknown>,
  res: WorkbenchResponse,
): Promise<void> {
  const sku = body['sku'];
  if (typeof sku !== 'string' || sku.trim().length === 0) {
    throw new HttpError(400, 'wallet: sku is required');
  }
  const newBasePriceUsd =
    typeof body['newBasePriceUsd'] === 'number' && Number.isFinite(body['newBasePriceUsd'])
      ? body['newBasePriceUsd']
      : undefined;
  const allInUsd =
    typeof body['allInUsd'] === 'number' && Number.isFinite(body['allInUsd'])
      ? body['allInUsd']
      : undefined;
  const voucherCode =
    typeof body['voucherCode'] === 'string' ? body['voucherCode'] : undefined;
  const triggerType =
    body['triggerType'] === 'WATCHDOG_POLL_TICK'
      ? 'WATCHDOG_POLL_TICK'
      : 'CHANNEL3_PRICE_DROP_WEBHOOK';

  try {
    const result = await triggerBackgroundPriceDrop({
      sku,
      newBasePriceUsd,
      allInUsd,
      voucherCode,
      triggerType,
    });
    sendJson(res, 200, result);
  } catch (e) {
    const inputError = asWalletInputError(e);
    if (inputError !== null) {
      throw inputError;
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                             */
/* ------------------------------------------------------------------ */

/**
 * Handle wallet routes. Returns `true` when the path belongs to this
 * module (known path + wrong method answers 405 here); `false` lets the
 * main dispatcher fall through to its generic 404.
 */
export async function handleWalletRequest(
  req: WorkbenchRequest,
  res: WorkbenchResponse,
): Promise<boolean> {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  const method = (req.method ?? 'GET').toUpperCase();
  if (pathname === '/pair' || pathname.startsWith('/pair/')) {
    if (method !== 'GET') {
      sendJson(res, 405, { error: 'method not allowed' });
      return true;
    }
    handlePairPage(pathname.slice('/pair/'.length), res);
    return true;
  }
  switch (pathname) {
    case '/api/wallet/pair/start': {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return true;
      }
      await readBody(req);
      await handlePairStart(res);
      return true;
    }
    case '/api/wallet/pair/status': {
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'method not allowed' });
        return true;
      }
      handlePairStatus(req, res);
      return true;
    }
    case '/api/wallet/pair/approve': {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return true;
      }
      await handlePairApprove(parseJsonBody(await readBody(req)), res);
      return true;
    }
    case '/api/wallet/partitions': {
      if (method === 'GET') {
        handlePartitionsGet(res);
        return true;
      }
      if (method === 'POST') {
        await handlePartitionsPost(parseJsonBody(await readBody(req)), res);
        return true;
      }
      sendJson(res, 405, { error: 'method not allowed' });
      return true;
    }
    case '/api/wallet/spend-check': {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return true;
      }
      await handleSpendCheck(parseJsonBody(await readBody(req)), res);
      return true;
    }
    case '/api/wallet/refund': {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return true;
      }
      await handleRefund(parseJsonBody(await readBody(req)), res);
      return true;
    }
    case '/api/wallet/sync': {
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'method not allowed' });
        return true;
      }
      handleSync(res);
      return true;
    }
    case '/api/wallet/connectors': {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return true;
      }
      handleConnectors(parseJsonBody(await readBody(req)), res);
      return true;
    }
    case '/api/wallet/sniper': {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return true;
      }
      await handleSniper(parseJsonBody(await readBody(req)), res);
      return true;
    }
    case '/api/onboarding/state': {
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'method not allowed' });
        return true;
      }
      handleOnboardingState(res);
      return true;
    }
    case '/api/onboarding/complete': {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return true;
      }
      await handleOnboardingComplete(parseJsonBody(await readBody(req)), res);
      return true;
    }
    case '/api/agents/spawn': {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return true;
      }
      handleAgentsSpawn(parseJsonBody(await readBody(req)), res);
      return true;
    }
    case '/api/agents/webhook/price-drop': {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return true;
      }
      await handlePriceDropWebhook(parseJsonBody(await readBody(req)), res);
      return true;
    }
    default: {
      return false;
    }
  }
}
