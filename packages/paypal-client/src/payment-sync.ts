/**
 * @veripact/paypal-client payment sync: legacy vs protected reconciliation.
 *
 * `syncAccountPayments` merges three honest sources into one labeled list:
 * pre-VeriPact legacy transactions (never witnessed — vulnerable to
 * merchant policy drift by construction), live seeded sandbox receipts,
 * and current-session wallet orders (receiptCore-persisted, VP1-bound).
 * Protection class is DERIVED from evidence presence, never asserted:
 * no commitment → `LEGACY_UNWITNESSED`, VP1-bound → `VERIPACT_PROTECTED`.
 */
import type {
  ObservedTermSheet,
  SyncPaymentRecord,
  WalletOrderRecord,
} from '@veripact/core';
import type { SandboxReplayEngine } from './sandbox-replay';

/** One parsed live receipt row (shape of `docs/sandbox-receipts.json`). */
export interface LiveOrderReceipt {
  orderId: string;
  customId?: string;
  readBackCustomId?: string;
  finalTotalUsd?: number;
  status?: string;
  scenario?: string;
}

export interface SyncAccountPaymentsInput {
  /** Live seeded receipts (best-effort read of the committed file). */
  liveOrderReceipts: LiveOrderReceipt[];
  /** Current-session wallet orders (receiptCore-persisted). */
  sessionOrders: WalletOrderRecord[];
  /** Optional replay engine: its orders join as protected session rows. */
  replayEngine?: SandboxReplayEngine;
}

export interface SyncAccountPaymentsResult {
  records: SyncPaymentRecord[];
  protectedCount: number;
  legacyCount: number;
}

const LEGACY_DRIFT_NOTE =
  'UNPROTECTED — No witness snapshot or custom_id hash recorded at checkout';
const PROTECTED_DRIFT_NOTE =
  'Witnessed at checkout — VP1 commitment bound in PayPal custom_id';

/**
 * Three pre-VeriPact legacy transactions. Fixed deterministic fixtures:
 * they represent history that predates witnessing, so `commitment` stays
 * `undefined` and the drift story is explicit, never inferred.
 */
export function legacyUnwitnessedFixtures(): SyncPaymentRecord[] {
  return [
    {
      transactionId: 'TXN-LEGACY-0001',
      orderId: 'LEGACY-ORDER-0001',
      merchantName: 'CircuitCity Surplus Outlet',
      itemSummary: 'Refurbished 4K projector (electronics)',
      amountUsd: 449.0,
      status: 'CAPTURED',
      createdAtUtc: '2025-09-14T18:02:11.000Z',
      protectionClass: 'LEGACY_UNWITNESSED',
      returnWindowDays: 14,
      restockingFeePct: 15,
      driftRiskNote:
        'UNPROTECTED — Merchant silently shortened returns from 30 days to 14 days after purchase; no witness snapshot or custom_id hash recorded at checkout',
      transportMode: 'DETERMINISTIC_SANDBOX_REPLAY',
    },
    {
      transactionId: 'TXN-LEGACY-0002',
      orderId: 'LEGACY-ORDER-0002',
      merchantName: 'Northwind Home Goods',
      itemSummary: 'Ceramic cookware set (home)',
      amountUsd: 189.99,
      status: 'CAPTURED',
      createdAtUtc: '2025-10-02T11:47:53.000Z',
      protectionClass: 'LEGACY_UNWITNESSED',
      returnWindowDays: 0,
      restockingFeePct: 20,
      driftRiskNote:
        'UNPROTECTED — Hidden 20% restocking fee added post-checkout ($37.99 disputed); no witness snapshot or custom_id hash recorded',
      transportMode: 'DETERMINISTIC_SANDBOX_REPLAY',
    },
    {
      transactionId: 'TXN-LEGACY-0003',
      orderId: 'LEGACY-ORDER-0003',
      merchantName: 'Pixel & Thread Apparel',
      itemSummary: 'Merino wound tour jacket (apparel)',
      amountUsd: 129.5,
      status: 'REFUNDED',
      createdAtUtc: '2025-10-28T09:15:44.000Z',
      protectionClass: 'LEGACY_UNWITNESSED',
      returnWindowDays: 0,
      restockingFeePct: 0,
      driftRiskNote:
        'UNPROTECTED — Unwitnessed coupon voided return policy ($129.50 disputed); merchant claimed final sale after checkout',
      transportMode: 'DETERMINISTIC_SANDBOX_REPLAY',
    },
  ];
}

function mapReceiptStatus(status: string | undefined): SyncPaymentRecord['status'] {
  switch ((status ?? 'CREATED').toUpperCase()) {
    case 'CAPTURED':
    case 'COMPLETED':
      return 'CAPTURED';
    case 'VOIDED':
      return 'VOIDED';
    case 'REFUNDED':
      return 'REFUNDED';
    default:
      return 'CREATED';
  }
}

function protectedFromLiveReceipt(receipt: LiveOrderReceipt): SyncPaymentRecord {
  const commitment =
    receipt.readBackCustomId !== undefined && receipt.readBackCustomId.length > 0
      ? receipt.readBackCustomId
      : undefined;
  return {
    transactionId: `TXN-LIVE-${receipt.orderId}`,
    orderId: receipt.orderId,
    merchantName: 'VeriPact witnessed storefront',
    itemSummary: `Seeded sandbox order (${receipt.scenario ?? 'normal'})`,
    amountUsd: receipt.finalTotalUsd ?? 0,
    status: mapReceiptStatus(receipt.status),
    createdAtUtc: new Date().toISOString(),
    protectionClass: commitment === undefined ? 'LEGACY_UNWITNESSED' : 'VERIPACT_PROTECTED',
    commitment,
    driftRiskNote: commitment === undefined ? LEGACY_DRIFT_NOTE : PROTECTED_DRIFT_NOTE,
    transportMode: 'LIVE_PAYPAL_SANDBOX',
  };
}

function determinate(value: { status: string; value?: number } | undefined): number | undefined {
  if (value === undefined || value.status !== 'DETERMINATE' || value.value === undefined) {
    return undefined;
  }
  return value.value;
}

function protectedFromSessionOrder(order: WalletOrderRecord): SyncPaymentRecord {
  const terms = (order.receiptCore as { observedTerms?: ObservedTermSheet } | null)?.observedTerms;
  return {
    transactionId: `TXN-SESSION-${order.orderId}`,
    orderId: order.orderId,
    captureId: order.captureId,
    merchantName: 'VeriPact witnessed storefront',
    itemSummary: `Wallet order (${order.scenarioId})`,
    amountUsd: order.amountUsd,
    status: order.status,
    createdAtUtc: order.createdAtUtc,
    protectionClass: 'VERIPACT_PROTECTED',
    commitment: order.commitment,
    returnWindowDays: determinate(terms?.returnWindowDays),
    restockingFeePct: determinate(terms?.restockingFeePct),
    driftRiskNote: PROTECTED_DRIFT_NOTE,
    transportMode: order.transportMode,
  };
}

/**
 * Combine legacy fixtures + live receipts + session orders (+ optional
 * replay-engine orders) into one protection-labeled sync list. Legacy
 * rows come first (the before/after story), then live receipts, then
 * session orders, then engine rows — deterministic, no network.
 */
export function syncAccountPayments(input: SyncAccountPaymentsInput): SyncAccountPaymentsResult {
  const records: SyncPaymentRecord[] = [...legacyUnwitnessedFixtures()];
  for (const receipt of input.liveOrderReceipts) {
    if (typeof receipt.orderId !== 'string' || receipt.orderId.length === 0) {
      continue;
    }
    records.push(protectedFromLiveReceipt(receipt));
  }
  for (const order of input.sessionOrders) {
    records.push(protectedFromSessionOrder(order));
  }
  const engine = input.replayEngine;
  if (engine !== undefined) {
    for (const replayOrder of engine.listOrders()) {
      const unit = replayOrder.purchase_units[0];
      const commitment = unit?.custom_id;
      const protected_ =
        typeof commitment === 'string' && commitment.startsWith('VP1:') && commitment.length === 68;
      records.push({
        transactionId: `TXN-REPLAY-${replayOrder.id}`,
        orderId: replayOrder.id,
        merchantName: 'VeriPact witnessed storefront',
        itemSummary: unit?.description ?? 'Replay engine order',
        amountUsd: Number(unit?.amount.value ?? '0'),
        status: mapReceiptStatus(replayOrder.status),
        createdAtUtc: replayOrder.create_time,
        protectionClass: protected_ ? 'VERIPACT_PROTECTED' : 'LEGACY_UNWITNESSED',
        commitment: protected_ ? commitment : undefined,
        driftRiskNote: protected_ ? PROTECTED_DRIFT_NOTE : LEGACY_DRIFT_NOTE,
        transportMode: 'DETERMINISTIC_SANDBOX_REPLAY',
      });
    }
  }
  return {
    records,
    protectedCount: records.filter((r) => r.protectionClass === 'VERIPACT_PROTECTED').length,
    legacyCount: records.filter((r) => r.protectionClass === 'LEGACY_UNWITNESSED').length,
  };
}
