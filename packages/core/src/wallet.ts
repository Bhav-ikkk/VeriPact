/**
 * @veripact/core v5 wallet domain — pairing, partitions, sync, connectors.
 *
 * Pure deterministic types + math for the Partitioned Agentic Wallet. No
 * I/O, no ambient env reads: the SDK owns persistence (disk-mirrored
 * `.veripact-wallet-state.json`), paypal-client owns money movement, and
 * this module owns the ledger formula every layer must agree on:
 *
 *   available = total - authorized - captured + voided + refunded
 *
 * GAP-10 note: `WalletOrderRecord` persists the exact `receiptCore` bytes
 * beside every order so `computeCommitment(receiptCore)` reproduces the
 * bound `VP1:` commitment bit-for-bit regardless of real-clock TSA
 * timestamps (which live OUTSIDE the committed core).
 */
import { computeCommitment, signCanonicalPayload, verifyCanonicalPayload } from './crypto';

/** Transport labels shared with paypal-client (inline: core owns no API deps). */
export type WalletTransportMode = 'LIVE_PAYPAL_SANDBOX' | 'DETERMINISTIC_SANDBOX_REPLAY';

/* ------------------------------------------------------------------ */
/* QR pairing                                                           */
/* ------------------------------------------------------------------ */

/** Phone-QR pairing ceremony lifecycle. */
export type PairingStatus = 'PENDING_SCAN' | 'APPROVED' | 'EXPIRED' | 'REVOKED';

/** One QR pairing session binding a phone approval to a wallet partition. */
export interface PairingSession {
  sessionId: string;
  qrPairUrl: string;
  pairingCode: string;
  status: PairingStatus;
  payerEmail?: string;
  vaultId?: string;
  createdAtUtc: string;
  expiresAtUtc: string;
  approvedAtUtc?: string;
  transportMode: WalletTransportMode;
}

/* ------------------------------------------------------------------ */
/* Partitioned sub-balance                                              */
/* ------------------------------------------------------------------ */

/** Buyer-signed agentic spending partition (Rung 1 SELF signs at creation). */
export interface PartitionSpec {
  partitionId: string;
  label: string;
  totalAllocatedUsd: number;
  maxPerOrderUsd: number;
  askHumanAboveUsd: number;
  authorizedUsd: number;
  capturedUsd: number;
  voidedUsd: number;
  refundedUsd: number;
  availableUsd: number;
  status: 'ACTIVE' | 'EXHAUSTED' | 'FROZEN';
  createdAtUtc: string;
  buyerSignatureHex: string;
  buyerPublicKeyHex: string;
}

/** The signed payload: every field except the signature + signer key. */
export type UnsignedPartitionSpec = Omit<PartitionSpec, 'buyerSignatureHex' | 'buyerPublicKeyHex'>;

/** Input to the deterministic pre-authorization spend check. */
export interface PartitionSpendCheckInput {
  partitionId: string;
  requestedAmountUsd: number;
  merchantName?: string;
  hasWitnessedReceipt: boolean;
}

/** Spend-check verdict (Mandate-conjunction style, promise-aware). */
export interface PartitionSpendCheckVerdict {
  allowed: boolean;
  decision:
    | 'ALLOW_AUTONOMOUS'
    | 'ASK_HUMAN_OVER_THRESHOLD'
    | 'BLOCK_PARTITION_EXCEEDED'
    | 'BLOCK_PER_ORDER_CAP'
    | 'BLOCK_UNWITNESSED_MERCHANT'
    | 'BLOCK_PARTITION_FROZEN';
  availableBeforeUsd: number;
  availableAfterUsd: number;
  reason: string;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * Cent-safe partition availability. Clamp at zero: a partition can never
 * report negative headroom, so overruns always resolve to a hard block.
 */
export function computePartitionAvailableUsd(spec: {
  totalAllocatedUsd: number;
  authorizedUsd: number;
  capturedUsd: number;
  voidedUsd: number;
  refundedUsd: number;
}): number {
  return Math.max(
    0,
    round2(
      spec.totalAllocatedUsd -
        spec.authorizedUsd -
        spec.capturedUsd +
        spec.voidedUsd +
        spec.refundedUsd,
    ),
  );
}

/**
 * Deterministic spend-check conjunction (order matters — first hit wins):
 * ACTIVE → witnessed → within partition → within per-order cap →
 * within ask-human threshold → autonomous.
 */
export function evaluatePartitionSpendCheck(
  partition: PartitionSpec,
  input: PartitionSpendCheckInput,
): PartitionSpendCheckVerdict {
  if (
    typeof input.requestedAmountUsd !== 'number' ||
    !Number.isFinite(input.requestedAmountUsd) ||
    input.requestedAmountUsd <= 0
  ) {
    throw new Error('wallet: requestedAmountUsd must be a finite USD amount > 0');
  }
  const availableBeforeUsd = computePartitionAvailableUsd(partition);
  const blocked = (
    decision: PartitionSpendCheckVerdict['decision'],
    reason: string,
  ): PartitionSpendCheckVerdict => ({
    allowed: false,
    decision,
    availableBeforeUsd,
    availableAfterUsd: availableBeforeUsd,
    reason,
  });
  if (partition.status !== 'ACTIVE') {
    return blocked(
      'BLOCK_PARTITION_FROZEN',
      `partition ${partition.partitionId} is ${partition.status} (spend checks require ACTIVE)`,
    );
  }
  if (input.hasWitnessedReceipt !== true) {
    return blocked(
      'BLOCK_UNWITNESSED_MERCHANT',
      'agents cannot spend from a VeriPact partition without a Rung-2 WIT snapshot',
    );
  }
  if (input.requestedAmountUsd > availableBeforeUsd) {
    return blocked(
      'BLOCK_PARTITION_EXCEEDED',
      `requested $${input.requestedAmountUsd.toFixed(2)} exceeds partition availability $${availableBeforeUsd.toFixed(2)}`,
    );
  }
  if (input.requestedAmountUsd > partition.maxPerOrderUsd) {
    return blocked(
      'BLOCK_PER_ORDER_CAP',
      `requested $${input.requestedAmountUsd.toFixed(2)} exceeds per-order cap $${partition.maxPerOrderUsd.toFixed(2)}`,
    );
  }
  if (input.requestedAmountUsd > partition.askHumanAboveUsd) {
    return {
      allowed: false,
      decision: 'ASK_HUMAN_OVER_THRESHOLD',
      availableBeforeUsd,
      availableAfterUsd: round2(availableBeforeUsd - input.requestedAmountUsd),
      reason: `requested $${input.requestedAmountUsd.toFixed(2)} exceeds ask-human threshold $${partition.askHumanAboveUsd.toFixed(2)} — awaiting buyer approval`,
    };
  }
  return {
    allowed: true,
    decision: 'ALLOW_AUTONOMOUS',
    availableBeforeUsd,
    availableAfterUsd: round2(availableBeforeUsd - input.requestedAmountUsd),
    reason: `within partition ($${availableBeforeUsd.toFixed(2)} available), per-order cap, and ask-human threshold`,
  };
}

/** Extract the signable payload from a full spec (drops signer fields). */
export function partitionSigningPayload(spec: PartitionSpec): UnsignedPartitionSpec {
  return {
    partitionId: spec.partitionId,
    label: spec.label,
    totalAllocatedUsd: spec.totalAllocatedUsd,
    maxPerOrderUsd: spec.maxPerOrderUsd,
    askHumanAboveUsd: spec.askHumanAboveUsd,
    authorizedUsd: spec.authorizedUsd,
    capturedUsd: spec.capturedUsd,
    voidedUsd: spec.voidedUsd,
    refundedUsd: spec.refundedUsd,
    availableUsd: spec.availableUsd,
    status: spec.status,
    createdAtUtc: spec.createdAtUtc,
  };
}

/**
 * Buyer-sign a partition spec (Rung 1 SELF). The signature covers the
 * allocation + caps + ledger counters, so any tampering invalidates it.
 */
export function signPartitionSpec(
  unsigned: UnsignedPartitionSpec,
  buyerKeys: { publicKeyHex: string; privateKeyHex: string },
): PartitionSpec {
  return {
    ...unsigned,
    buyerPublicKeyHex: buyerKeys.publicKeyHex,
    buyerSignatureHex: signCanonicalPayload(unsigned, buyerKeys.privateKeyHex),
  };
}

/** Verify a partition's buyer signature against its own embedded key. */
export function verifyPartitionSpecSignature(spec: PartitionSpec): boolean {
  return verifyCanonicalPayload(
    partitionSigningPayload(spec),
    spec.buyerSignatureHex,
    spec.buyerPublicKeyHex,
  );
}

/* ------------------------------------------------------------------ */
/* Order records (GAP-10: persisted receiptCore → reproducible VP1)      */
/* ------------------------------------------------------------------ */

/**
 * Persisted wallet order record. `receiptCore` is the EXACT bytes the
 * `VP1:` commitment was computed over — stored beside the order so
 * `computeCommitment(receiptCore)` reproduces `commitment` forever,
 * independent of real-clock TSA timestamps.
 */
export interface WalletOrderRecord {
  orderId: string;
  scenarioId: string;
  receiptCore: unknown;
  commitment: string;
  authorizationId?: string;
  captureId?: string;
  amountUsd: number;
  status: 'CAPTURED' | 'CREATED' | 'VOIDED' | 'REFUNDED';
  createdAtUtc: string;
  transportMode: WalletTransportMode;
}

/** Recompute and compare: true only on a bit-identical commitment. */
export function verifyOrderCommitmentReproducible(record: WalletOrderRecord): boolean {
  try {
    return computeCommitment(record.receiptCore) === record.commitment;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Payment sync                                                         */
/* ------------------------------------------------------------------ */

/** Sync protection class: witnessed at checkout vs never witnessed. */
export type PaymentProtectionClass = 'VERIPACT_PROTECTED' | 'LEGACY_UNWITNESSED';

/** One synced payment row (history + live, labeled by protection class). */
export interface SyncPaymentRecord {
  transactionId: string;
  orderId: string;
  captureId?: string;
  merchantName: string;
  itemSummary: string;
  amountUsd: number;
  status: 'CAPTURED' | 'CREATED' | 'VOIDED' | 'REFUNDED';
  createdAtUtc: string;
  protectionClass: PaymentProtectionClass;
  commitment?: string;
  returnWindowDays?: number;
  restockingFeePct?: number;
  channel3ProductId?: string;
  driftRiskNote: string;
  transportMode: WalletTransportMode;
}

/* ------------------------------------------------------------------ */
/* External LLM connectors                                              */
/* ------------------------------------------------------------------ */

/** One scoped connector token binding a platform to a partition. */
export interface ConnectorScope {
  tokenId: string;
  platform: 'CHATGPT_ACTION' | 'CLAUDE_MCP' | 'CURSOR_MCP' | 'CUSTOM_AGENT';
  partitionId: string;
  maskedToken: string;
  openapiUrl: string;
  mcpCommand: string;
  createdAtUtc: string;
}
