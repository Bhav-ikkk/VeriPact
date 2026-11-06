/**
 * @veripact/sdk `VeriPactWallet` — partitioned agentic wallet facade (v5).
 *
 * Sequences the leaf packages exactly like `VeriPactClient` does: core
 * owns partition math + signatures, paypal-client owns money movement,
 * witness-client owns snapshots. State (pairings, partitions, orders with
 * persisted `receiptCore`, connector hashes) lives in a disk-mirrored
 * store (`.veripact-wallet-state.json`, gitignored) so CLI/MCP processes
 * and the fake req/res harness share it with zero sockets (GAP-15).
 * Best-effort I/O throughout: a corrupt or missing file degrades to a
 * fresh wallet, never to a 500. Key material is never persisted — only
 * commitments, public keys, signatures, PayPal ids, and token hashes.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  canonicalizeJson,
  computePartitionAvailableUsd,
  evaluatePartitionSpendCheck,
  repoPath,
  sha256Hex,
  signPartitionSpec,
  type CaptureAddendum,
  type ConnectorScope,
  type MandateSpec,
  type PairingSession,
  type PartitionSpec,
  type PartitionSpendCheckVerdict,
  type SyncPaymentRecord,
  type WalletOrderRecord,
} from '@veripact/core';
import { evaluatePostApprovalReGate } from '@veripact/term-extractor';
import {
  createWitnessSnapshot,
  type WitnessSnapshotOutput,
} from '@veripact/witness-client';
import {
  PayPalClient,
  syncAccountPayments,
  type LiveOrderReceipt,
  type TransportMode,
} from '@veripact/paypal-client';
import { DEMO_CHANNEL3_CACHE, getScenario, type ScenarioName } from './scenarios';
import type { VeriPactKeys } from './client';

/** Default agentic partition minted on pairing approval. */
export const DEFAULT_PARTITION_ALLOCATION_USD = 350;
export const DEFAULT_PARTITION_MAX_PER_ORDER_USD = 320;
export const DEFAULT_PARTITION_ASK_HUMAN_ABOVE_USD = 300;

/** Pairing ceremony expiry (phone must approve within 15 minutes). */
const PAIRING_TTL_MS = 15 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Disk-mirrored wallet store (GAP-15)                                  */
/* ------------------------------------------------------------------ */

/** Persisted connector: public scope + token hash (never the bearer). */
export interface StoredConnectorScope extends ConnectorScope {
  tokenSha256: string;
}

/** Wallet state document (versioned for forward-compatible loads). */
export interface WalletStateDoc {
  version: 1;
  pairingSessions: PairingSession[];
  partitions: PartitionSpec[];
  orders: WalletOrderRecord[];
  connectors: StoredConnectorScope[];
  counters: { pairingSeq: number; partitionSeq: number; connectorSeq: number };
}

function freshStateDoc(): WalletStateDoc {
  return {
    version: 1,
    pairingSessions: [],
    partitions: [],
    orders: [],
    connectors: [],
    counters: { pairingSeq: 0, partitionSeq: 0, connectorSeq: 0 },
  };
}

/**
 * Resolve the wallet state file: explicit path →
 * `VERIPACT_WALLET_STATE_FILE` (hermetic tests) → repo-root default.
 */
export function resolveWalletStateFile(explicitPath?: string): string {
  if (explicitPath !== undefined && explicitPath.length > 0) {
    return explicitPath;
  }
  const override = process.env['VERIPACT_WALLET_STATE_FILE'];
  if (override !== undefined && override.length > 0) {
    return override;
  }
  return repoPath('.veripact-wallet-state.json');
}

function loadStateDoc(stateFile: string): WalletStateDoc {
  const fresh = freshStateDoc();
  if (!existsSync(stateFile)) {
    return fresh;
  }
  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8')) as Partial<WalletStateDoc>;
    if (parsed.version !== 1) {
      return fresh;
    }
    return {
      version: 1,
      pairingSessions: Array.isArray(parsed.pairingSessions) ? parsed.pairingSessions : [],
      partitions: Array.isArray(parsed.partitions) ? parsed.partitions : [],
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      connectors: Array.isArray(parsed.connectors) ? parsed.connectors : [],
      counters: {
        pairingSeq: parsed.counters?.pairingSeq ?? 0,
        partitionSeq: parsed.counters?.partitionSeq ?? 0,
        connectorSeq: parsed.counters?.connectorSeq ?? 0,
      },
    };
  } catch {
    return fresh;
  }
}

/**
 * Clear the default wallet store (memory callers drop their instance;
 * workbench `resetDemoState` calls this so demo resets wipe pairing +
 * partition + order state). Never throws.
 */
export function resetWalletState(stateFilePath?: string): void {
  try {
    unlinkSync(resolveWalletStateFile(stateFilePath));
  } catch {
    // Absent or unreadable file: nothing to clear, never a 500.
  }
}

/* ------------------------------------------------------------------ */
/* Wallet                                                               */
/* ------------------------------------------------------------------ */

export interface VeriPactWalletOptions {
  paypal: PayPalClient;
  keys: VeriPactKeys;
  /** State file override (tests); default is the gitignored repo file. */
  stateFilePath?: string;
}

export interface ApprovePairingInput {
  sessionId: string;
  payerEmail: string;
}

export interface ApprovePairingResult {
  session: PairingSession;
  partition: PartitionSpec;
  vaultId: string;
  setupTokenId: string;
  transportMode: TransportMode;
  demoKeys: boolean;
}

export interface UpsertPartitionInput {
  label: string;
  totalAllocatedUsd: number;
  maxPerOrderUsd: number;
  askHumanAboveUsd: number;
}

export type PartitionedPaymentOutcome =
  | 'CAPTURED'
  | 'AUTO_VOIDED_BY_PARTITION_WALL'
  | 'AUTO_VOIDED'
  | 'BLOCKED_PRE_CHECKOUT'
  | 'BLOCKED_BY_PARTITION_WALL'
  | 'BLOCKED_PARTITION_FROZEN'
  | 'ASK_HUMAN_OVER_THRESHOLD'
  | 'AWAITING_BUYER_APPROVAL';

export interface PartitionedPaymentInput {
  scenarioId: string;
  /** Override the scenario's deterministic callback total (stress tests). */
  requestedOverrideUsd?: number;
  /** Connector bearer token (verified by hash when provided). */
  agentToken?: string;
}

export interface PartitionedPaymentResult {
  outcome: PartitionedPaymentOutcome;
  scenarioId: ScenarioName;
  partitionId: string;
  verdict: PartitionSpendCheckVerdict;
  snapshot: WitnessSnapshotOutput;
  orderId?: string;
  authorizationId?: string;
  captureId?: string;
  finalTotalUsd?: number;
  approveUrl?: string;
  transportMode: TransportMode;
  demoKeys: boolean;
  partitionAvailableUsd: number;
}

export interface RefundPartitionPaymentResult {
  refundId: string;
  captureId: string;
  amountUsd: number;
  partitionId: string;
  partitionAvailableUsd: number;
  transportMode: TransportMode;
}

export interface MintConnectorTokenResult {
  scope: ConnectorScope;
  /** Bearer secret, returned ONCE — only its hash is persisted. */
  bearerToken: string;
}

function pad(n: number): string {
  return String(n).padStart(4, '0');
}

/** Deterministic 6-digit pairing code from the session counter. */
function pairingCodeFor(seq: number): string {
  return String(100000 + ((seq * 7919) % 900000));
}

function assertPositiveUsd(label: string, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`wallet: ${label} must be a finite USD amount > 0`);
  }
}

export class VeriPactWallet {
  readonly paypal: PayPalClient;
  readonly keys: VeriPactKeys;
  private readonly stateFile: string;
  private state: WalletStateDoc;

  constructor(options: VeriPactWalletOptions) {
    this.paypal = options.paypal;
    this.keys = options.keys;
    this.stateFile = resolveWalletStateFile(options.stateFilePath);
    this.state = loadStateDoc(this.stateFile);
  }

  private save(): void {
    try {
      writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), 'utf8');
    } catch {
      // Best-effort: the in-memory state remains the primary store.
    }
  }

  /* ---------------- pairing ---------------- */

  /** Mint a QR pairing session (`PAIR-VP-…`, 6-digit code, 15-min TTL). */
  startPairingCeremony(): PairingSession {
    this.state.counters.pairingSeq += 1;
    const seq = this.state.counters.pairingSeq;
    const nowMs = Date.now();
    const session: PairingSession = {
      sessionId: `PAIR-VP-${pad(seq)}`,
      qrPairUrl: `/pair/PAIR-VP-${pad(seq)}`,
      pairingCode: pairingCodeFor(seq),
      status: 'PENDING_SCAN',
      createdAtUtc: new Date(nowMs).toISOString(),
      expiresAtUtc: new Date(nowMs + PAIRING_TTL_MS).toISOString(),
      transportMode: this.paypal.transportMode,
    };
    this.state.pairingSessions.push(session);
    this.save();
    return { ...session };
  }

  /**
   * Approve a pairing: vault the payer (setup token → payment token) and
   * initialize the default $350 agentic partition. Expired or unknown
   * sessions fail loudly; approvals are single-shot.
   */
  async approvePairingCeremony(input: ApprovePairingInput): Promise<ApprovePairingResult> {
    const session = this.state.pairingSessions.find((s) => s.sessionId === input.sessionId);
    if (session === undefined) {
      throw new Error(`wallet: unknown pairing session: ${input.sessionId}`);
    }
    if (session.status !== 'PENDING_SCAN') {
      throw new Error(`wallet: pairing session ${input.sessionId} is ${session.status} (need PENDING_SCAN)`);
    }
    if (Date.parse(session.expiresAtUtc) <= Date.now()) {
      session.status = 'EXPIRED';
      this.save();
      throw new Error(`wallet: pairing session ${input.sessionId} expired`);
    }
    const setup = await this.paypal.createVaultSetupToken({
      payerEmail: input.payerEmail,
      returnUrl: 'https://veripact-demo.onrender.com/pair/return',
      cancelUrl: 'https://veripact-demo.onrender.com/pair/cancel',
    });
    const vault = await this.paypal.approveVaultPaymentToken({
      setupTokenId: setup.setupTokenId,
      payerEmail: input.payerEmail,
    });
    session.status = 'APPROVED';
    session.payerEmail = input.payerEmail;
    session.vaultId = vault.vaultId;
    session.approvedAtUtc = new Date().toISOString();
    const partition = this.createOrUpdatePartition({
      label: 'Agentic Partition',
      totalAllocatedUsd: DEFAULT_PARTITION_ALLOCATION_USD,
      maxPerOrderUsd: DEFAULT_PARTITION_MAX_PER_ORDER_USD,
      askHumanAboveUsd: DEFAULT_PARTITION_ASK_HUMAN_ABOVE_USD,
    });
    this.save();
    return {
      session: { ...session },
      partition,
      vaultId: vault.vaultId,
      setupTokenId: setup.setupTokenId,
      transportMode: this.paypal.transportMode,
      demoKeys: this.keys.demoKeys,
    };
  }

  /* ---------------- partitions ---------------- */

  /**
   * Create (or update-by-label, preserving ledger counters) a buyer-signed
   * partition. The Rung-1 SELF signature covers allocation + caps +
   * counters, so tampering invalidates the spec.
   */
  createOrUpdatePartition(input: UpsertPartitionInput): PartitionSpec {
    if (typeof input.label !== 'string' || input.label.length === 0) {
      throw new Error('wallet: partition label is required');
    }
    assertPositiveUsd('totalAllocatedUsd', input.totalAllocatedUsd);
    assertPositiveUsd('maxPerOrderUsd', input.maxPerOrderUsd);
    assertPositiveUsd('askHumanAboveUsd', input.askHumanAboveUsd);
    const existing = this.state.partitions.find((p) => p.label === input.label);
    if (existing !== undefined) {
      const updated = signPartitionSpec(
        {
          ...existing,
          totalAllocatedUsd: input.totalAllocatedUsd,
          maxPerOrderUsd: input.maxPerOrderUsd,
          askHumanAboveUsd: input.askHumanAboveUsd,
          availableUsd: 0,
          status: existing.status === 'FROZEN' ? 'FROZEN' : 'ACTIVE',
        },
        this.keys.buyer,
      );
      updated.availableUsd = computePartitionAvailableUsd(updated);
      const index = this.state.partitions.indexOf(existing);
      this.state.partitions[index] = updated;
      this.save();
      return { ...updated };
    }
    this.state.counters.partitionSeq += 1;
    const unsigned = {
      partitionId: `PART-VP-${pad(this.state.counters.partitionSeq)}`,
      label: input.label,
      totalAllocatedUsd: input.totalAllocatedUsd,
      maxPerOrderUsd: input.maxPerOrderUsd,
      askHumanAboveUsd: input.askHumanAboveUsd,
      authorizedUsd: 0,
      capturedUsd: 0,
      voidedUsd: 0,
      refundedUsd: 0,
      availableUsd: input.totalAllocatedUsd,
      status: 'ACTIVE' as const,
      createdAtUtc: new Date().toISOString(),
    };
    const spec = signPartitionSpec(unsigned, this.keys.buyer);
    spec.availableUsd = computePartitionAvailableUsd(spec);
    this.state.partitions.push(spec);
    this.save();
    return { ...spec };
  }

  /** One pairing session by id (copy; undefined when unknown). */
  getPairingSession(sessionId: string): PairingSession | undefined {
    const found = this.state.pairingSessions.find((s) => s.sessionId === sessionId);
    return found === undefined ? undefined : { ...found };
  }

  /** All persisted wallet orders, oldest first (copies). */
  listOrders(): WalletOrderRecord[] {
    return this.state.orders.map((o) => ({ ...o }));
  }

  /** Active partition (or by id) with freshly recomputed availability. */
  getPartitionStatus(partitionId?: string): PartitionSpec {
    const found =
      partitionId === undefined
        ? [...this.state.partitions].reverse().find((p) => p.status === 'ACTIVE') ??
          this.state.partitions[this.state.partitions.length - 1]
        : this.state.partitions.find((p) => p.partitionId === partitionId);
    if (found === undefined) {
      throw new Error('wallet: no partition exists — pair a wallet first');
    }
    found.availableUsd = computePartitionAvailableUsd(found);
    if (found.status === 'ACTIVE' && found.availableUsd <= 0) {
      found.status = 'EXHAUSTED';
    }
    this.save();
    return { ...found };
  }

  /** All partitions with freshly recomputed availability (oldest first). */
  listPartitions(): PartitionSpec[] {
    for (const found of this.state.partitions) {
      found.availableUsd = computePartitionAvailableUsd(found);
      if (found.status === 'ACTIVE' && found.availableUsd <= 0) {
        found.status = 'EXHAUSTED';
      }
    }
    this.save();
    return this.state.partitions.map((p) => ({ ...p }));
  }

  private mutatePartition(partitionId: string, mutate: (p: PartitionSpec) => void): PartitionSpec {
    const found = this.state.partitions.find((p) => p.partitionId === partitionId);
    if (found === undefined) {
      throw new Error(`wallet: unknown partition: ${partitionId}`);
    }
    mutate(found);
    found.availableUsd = computePartitionAvailableUsd(found);
    if (found.status === 'ACTIVE' && found.availableUsd <= 0) {
      found.status = 'EXHAUSTED';
    }
    this.save();
    return { ...found };
  }

  /* ---------------- agent payments ---------------- */

  private async snapshotScenario(
    listingUrl: string,
    html: string,
    mandate: MandateSpec,
  ): Promise<WitnessSnapshotOutput> {
    return createWitnessSnapshot({
      listingUrl,
      mandate,
      witnessKeys: {
        publicKeyHex: this.keys.witness.publicKeyHex,
        privateKeyHex: this.keys.witness.privateKeyHex,
      },
      htmlFetcher: () => Promise.resolve({ status: 200, html, tlsVerified: false }),
      requirePublicHttps: false,
      tsaMode: 'local',
      channel3Mode: 'cache',
      channel3Cache: DEMO_CHANNEL3_CACHE,
    });
  }

  private resolveAgentPartition(agentToken: string | undefined): PartitionSpec {
    if (agentToken === undefined) {
      return this.getPartitionStatus();
    }
    const digest = sha256Hex(agentToken);
    const connector = this.state.connectors.find((c) => c.tokenSha256 === digest);
    if (connector === undefined) {
      throw new Error('wallet: unknown agent token (mint a connector token first)');
    }
    return this.getPartitionStatus(connector.partitionId);
  }

  private persistOrder(record: WalletOrderRecord): void {
    const index = this.state.orders.findIndex((o) => o.orderId === record.orderId);
    if (index >= 0) {
      this.state.orders[index] = record;
    } else {
      this.state.orders.push(record);
    }
    this.save();
  }

  /**
   * Partitioned agent payment: witness → preview total → spend check →
   * vaulted order + patch + capture (allowed) or partition-wall void
   * (exceeded/cap). BLOCK returns before the first PayPal call; live mode
   * never auto-approves (AWAITING) and pre-empts wall blocks pre-create.
   */
  async executePartitionedAgentPayment(
    input: PartitionedPaymentInput,
  ): Promise<PartitionedPaymentResult> {
    const partition = this.resolveAgentPartition(input.agentToken);
    const page = getScenario(input.scenarioId);
    const snapshot = await this.snapshotScenario(page.listingUrl, page.html, page.mandate);
    const base = {
      scenarioId: page.name,
      partitionId: partition.partitionId,
      snapshot,
      transportMode: this.paypal.transportMode,
      demoKeys: this.keys.demoKeys,
    };
    if (snapshot.gateResult.decision === 'BLOCK') {
      const verdict = evaluatePartitionSpendCheck(partition, {
        partitionId: partition.partitionId,
        requestedAmountUsd: 0.01,
        hasWitnessedReceipt: false,
      });
      return {
        ...base,
        outcome: 'BLOCKED_PRE_CHECKOUT',
        verdict,
        partitionAvailableUsd: partition.availableUsd,
      };
    }
    const observed = snapshot.termReceipt.observedTerms;
    if (observed.basePriceUsd.status !== 'DETERMINATE' || observed.basePriceUsd.value === undefined) {
      throw new Error('wallet: gate passed without a determinate base price');
    }
    // Deterministic pre-auth preview: base + callback shipping/tax
    // ($297.00 normal, $340.50 surcharge_void) or an explicit override.
    const previewTotalUsd =
      input.requestedOverrideUsd ??
      Number(
        (
          observed.basePriceUsd.value +
          page.callbackTotals.shippingUsd +
          page.callbackTotals.taxUsd
        ).toFixed(2),
      );
    const verdict = evaluatePartitionSpendCheck(partition, {
      partitionId: partition.partitionId,
      requestedAmountUsd: previewTotalUsd,
      merchantName: page.description,
      hasWitnessedReceipt: true,
    });
    if (verdict.decision === 'ASK_HUMAN_OVER_THRESHOLD') {
      return { ...base, outcome: 'ASK_HUMAN_OVER_THRESHOLD', verdict, partitionAvailableUsd: partition.availableUsd };
    }
    if (verdict.decision === 'BLOCK_PARTITION_FROZEN') {
      return { ...base, outcome: 'BLOCKED_PARTITION_FROZEN', verdict, partitionAvailableUsd: partition.availableUsd };
    }
    const walled =
      verdict.decision === 'BLOCK_PARTITION_EXCEEDED' ||
      verdict.decision === 'BLOCK_PER_ORDER_CAP' ||
      verdict.decision === 'BLOCK_UNWITNESSED_MERCHANT';
    if (walled && this.paypal.transportMode === 'LIVE_PAYPAL_SANDBOX') {
      // Live pre-emption: a walled spend never mints a live order ($0 risk).
      return { ...base, outcome: 'BLOCKED_BY_PARTITION_WALL', verdict, partitionAvailableUsd: partition.availableUsd };
    }
    const title =
      observed.itemTitle.status === 'DETERMINATE' && observed.itemTitle.value !== undefined
        ? observed.itemTitle.value
        : page.mandate.itemQuery;
    const order = await this.paypal.createAuthorizeOrder({
      commitment: snapshot.commitment,
      description: `VeriPact partitioned agent payment: ${title}`,
      itemTotalUsd: observed.basePriceUsd.value,
    });
    const patched = await this.paypal.patchOrderShippingAndTax(order.orderId, {
      itemTotalUsd: observed.basePriceUsd.value,
      shippingUsd: page.callbackTotals.shippingUsd,
      taxUsd: page.callbackTotals.taxUsd,
    });
    if (this.paypal.transportMode === 'LIVE_PAYPAL_SANDBOX') {
      const live = await this.paypal.getOrder(order.orderId);
      if (live.status === 'CREATED') {
        return {
          ...base,
          outcome: 'AWAITING_BUYER_APPROVAL',
          verdict,
          orderId: order.orderId,
          approveUrl: live.approveUrl,
          finalTotalUsd: patched.finalTotalUsd,
          partitionAvailableUsd: partition.availableUsd,
        };
      }
    }
    if (this.paypal.transportMode === 'DETERMINISTIC_SANDBOX_REPLAY') {
      this.paypal.simulatePayerApproval(order.orderId);
    }
    const authorized = await this.paypal.authorizeOrder(order.orderId);
    const authorizationId = authorized.authorizationId;
    if (authorizationId === undefined) {
      throw new Error(`wallet: authorize returned no authorization id (${order.orderId})`);
    }
    this.mutatePartition(partition.partitionId, (p) => {
      p.authorizedUsd = Number((p.authorizedUsd + patched.finalTotalUsd).toFixed(2));
    });
    if (walled) {
      // Partition wall: the hold is created then voided — capturedUsd
      // stays flat and availability nets to zero movement.
      await this.paypal.voidAuthorization({ authorizationId });
      this.mutatePartition(partition.partitionId, (p) => {
        p.voidedUsd = Number((p.voidedUsd + patched.finalTotalUsd).toFixed(2));
      });
      this.persistOrder({
        orderId: order.orderId,
        scenarioId: page.name,
        receiptCore: snapshot.receiptCore,
        commitment: snapshot.commitment,
        authorizationId,
        amountUsd: patched.finalTotalUsd,
        status: 'VOIDED',
        createdAtUtc: new Date().toISOString(),
        transportMode: this.paypal.transportMode,
      });
      return {
        ...base,
        outcome: 'AUTO_VOIDED_BY_PARTITION_WALL',
        verdict,
        orderId: order.orderId,
        authorizationId,
        finalTotalUsd: patched.finalTotalUsd,
        partitionAvailableUsd: this.getPartitionStatus(partition.partitionId).availableUsd,
      };
    }
    const regate = evaluatePostApprovalReGate(page.mandate, snapshot.termReceipt, {
      itemTotalUsd: observed.basePriceUsd.value,
      shippingUsd: page.callbackTotals.shippingUsd,
      taxUsd: page.callbackTotals.taxUsd,
      finalTotalUsd: patched.finalTotalUsd,
    });
    if (regate.action === 'VOID') {
      await this.paypal.voidAuthorization({ authorizationId });
      this.mutatePartition(partition.partitionId, (p) => {
        p.voidedUsd = Number((p.voidedUsd + patched.finalTotalUsd).toFixed(2));
      });
      this.persistOrder({
        orderId: order.orderId,
        scenarioId: page.name,
        receiptCore: snapshot.receiptCore,
        commitment: snapshot.commitment,
        authorizationId,
        amountUsd: patched.finalTotalUsd,
        status: 'VOIDED',
        createdAtUtc: new Date().toISOString(),
        transportMode: this.paypal.transportMode,
      });
      return {
        ...base,
        outcome: 'AUTO_VOIDED',
        verdict,
        orderId: order.orderId,
        authorizationId,
        finalTotalUsd: patched.finalTotalUsd,
        partitionAvailableUsd: this.getPartitionStatus(partition.partitionId).availableUsd,
      };
    }
    const addendum: CaptureAddendum = {
      authorizationId,
      capturedTotalUsd: patched.finalTotalUsd,
      mandateCeilingUsd: page.mandate.constraints.maxAllInPriceUsd,
      decision: 'CAPTURE',
      decidedAtUtc: new Date().toISOString(),
    };
    const addendumSha256 = sha256Hex(canonicalizeJson(addendum));
    const capture = await this.paypal.captureAuthorizationExact({
      authorizationId,
      addendumSha256,
      amountUsd: patched.finalTotalUsd,
      noteToPayer: 'VeriPact Partitioned Capture',
    });
    // Capture settles the hold: move the amount from authorized to
    // captured so the ledger formula counts it exactly once. (Voids keep
    // the hold in `authorized` and cancel it via `voided`; refunds cancel
    // `captured` via `refunded`.)
    this.mutatePartition(partition.partitionId, (p) => {
      p.authorizedUsd = Number((p.authorizedUsd - patched.finalTotalUsd).toFixed(2));
      p.capturedUsd = Number((p.capturedUsd + patched.finalTotalUsd).toFixed(2));
    });
    this.persistOrder({
      orderId: order.orderId,
      scenarioId: page.name,
      receiptCore: snapshot.receiptCore,
      commitment: snapshot.commitment,
      authorizationId,
      captureId: capture.captureId,
      amountUsd: patched.finalTotalUsd,
      status: 'CAPTURED',
      createdAtUtc: new Date().toISOString(),
      transportMode: this.paypal.transportMode,
    });
    return {
      ...base,
      outcome: 'CAPTURED',
      verdict,
      orderId: order.orderId,
      authorizationId,
      captureId: capture.captureId,
      finalTotalUsd: patched.finalTotalUsd,
      partitionAvailableUsd: this.getPartitionStatus(partition.partitionId).availableUsd,
    };
  }

  /* ---------------- refunds ---------------- */

  /**
   * Refund Undo: refund a session capture and credit the partition's
   * `refundedUsd`, restoring availability by the refunded amount.
   */
  async refundPartitionPayment(input: { captureId: string }): Promise<RefundPartitionPaymentResult> {
    const order = this.state.orders.find((o) => o.captureId === input.captureId);
    if (order === undefined) {
      throw new Error(`wallet: unknown wallet capture: ${input.captureId}`);
    }
    if (order.status === 'REFUNDED') {
      throw new Error(`wallet: capture already refunded: ${input.captureId}`);
    }
    const refund = await this.paypal.refundCapturedPayment({
      captureId: input.captureId,
      amountUsd: order.amountUsd,
      noteToPayer: 'VeriPact Partition Undo',
    });
    const partition = this.getPartitionStatus();
    this.mutatePartition(partition.partitionId, (p) => {
      p.refundedUsd = Number((p.refundedUsd + refund.amountUsd).toFixed(2));
    });
    order.status = 'REFUNDED';
    this.persistOrder(order);
    return {
      refundId: refund.refundId,
      captureId: input.captureId,
      amountUsd: refund.amountUsd,
      partitionId: partition.partitionId,
      partitionAvailableUsd: this.getPartitionStatus(partition.partitionId).availableUsd,
      transportMode: this.paypal.transportMode,
    };
  }

  /* ---------------- sync + connectors ---------------- */

  /**
   * Sync wallet transactions: legacy fixtures + live seeded receipts +
   * session wallet orders, each labeled by protection class.
   */
  syncWalletTransactions(): {
    records: SyncPaymentRecord[];
    protectedCount: number;
    legacyCount: number;
  } {
    return syncAccountPayments({
      liveOrderReceipts: readLiveOrderReceipts(),
      sessionOrders: [...this.state.orders],
    });
  }

  /**
   * Mint a scoped connector token for an external LLM platform. The
   * bearer is returned once; only its sha256 is persisted for later
   * `agentToken` verification on partitioned payments.
   */
  mintConnectorToken(input: {
    platform: ConnectorScope['platform'];
    partitionId?: string;
  }): MintConnectorTokenResult {
    const valid: ConnectorScope['platform'][] = ['CHATGPT_ACTION', 'CLAUDE_MCP', 'CURSOR_MCP', 'CUSTOM_AGENT'];
    if (!valid.includes(input.platform)) {
      throw new Error(`wallet: unknown connector platform: ${String(input.platform)}`);
    }
    const partition = this.getPartitionStatus(input.partitionId);
    this.state.counters.connectorSeq += 1;
    const seq = this.state.counters.connectorSeq;
    const bearerToken = `vp_${randomBytes(24).toString('hex')}`;
    const scope: ConnectorScope = {
      tokenId: `CONN-VP-${pad(seq)}`,
      platform: input.platform,
      partitionId: partition.partitionId,
      maskedToken: `vp_…${bearerToken.slice(-4)}`,
      openapiUrl: '/openapi.json',
      mcpCommand: 'node ./packages/mcp-server/dist/index.js',
      createdAtUtc: new Date().toISOString(),
    };
    const stored: StoredConnectorScope = {
      ...scope,
      tokenSha256: sha256Hex(bearerToken),
    };
    this.state.connectors.push(stored);
    this.save();
    return { scope: { ...scope }, bearerToken };
  }
}

/**
 * Best-effort read of the committed live receipts file. Missing or
 * corrupt files yield zero live rows (sync still returns legacy +
 * session rows) — never a throw.
 */
export function readLiveOrderReceipts(): LiveOrderReceipt[] {
  try {
    const path = repoPath('docs', 'sandbox-receipts.json');
    if (!existsSync(path)) {
      return [];
    }
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      orders?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(parsed.orders)) {
      return [];
    }
    return parsed.orders.flatMap((o): LiveOrderReceipt[] => {
      if (typeof o['orderId'] !== 'string') {
        return [];
      }
      return [
        {
          orderId: o['orderId'],
          customId: typeof o['customId'] === 'string' ? o['customId'] : undefined,
          readBackCustomId:
            typeof o['readBackCustomId'] === 'string' ? o['readBackCustomId'] : undefined,
          finalTotalUsd: typeof o['finalTotalUsd'] === 'number' ? o['finalTotalUsd'] : undefined,
          status: typeof o['status'] === 'string' ? o['status'] : undefined,
          scenario: typeof o['scenario'] === 'string' ? o['scenario'] : undefined,
        },
      ];
    });
  } catch {
    return [];
  }
}
