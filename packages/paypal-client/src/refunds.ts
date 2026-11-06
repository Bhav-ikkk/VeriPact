/**
 * @veripact/paypal-client Payments v2 refunds: capture refund (Undo).
 *
 * Refund Undo powers the partition credit path: a refunded capture flows
 * back into `refundedUsd`, restoring partition availability. One-way
 * capture→refund tracking is enforced at both layers — the client's
 * in-session lock and the server/replay truth — so double refunds and
 * refunds of unknown captures fail loudly. Mutations carry
 * `PayPal-Request-Id` like every other mutating call.
 */
import type { PayPalApi, TransportMode } from './oauth';
import { toMoneyValue, toPaypalMoney } from './orders';

/** Thrown when a refund violates the one-way capture→refund lock. */
export class RefundStateConflictError extends Error {
  readonly captureId: string;

  constructor(captureId: string, detail: string) {
    super(`paypal: illegal capture refund ${captureId}: ${detail}`);
    this.name = 'RefundStateConflictError';
    this.captureId = captureId;
  }
}

/** Input for a capture refund (omit amountUsd for a full refund). */
export interface RefundCaptureInput {
  captureId: string;
  /** Partial-refund amount; full capture amount when omitted. */
  amountUsd?: number;
  currencyCode?: string;
  noteToPayer?: string;
  invoiceId?: string;
  requestId?: string;
}

/** Normalized refund result (both transports). */
export interface RefundResult {
  transportMode: TransportMode;
  refundId: string;
  captureId: string;
  amountUsd: number;
  invoiceId?: string;
  noteToPayer?: string;
  status: 'COMPLETED';
  createTimeIso: string;
}

interface RawRefundJson {
  id: string;
  amount?: { value?: string };
  invoice_id?: string;
  note_to_payer?: string;
  status?: string;
  create_time?: string;
}

/**
 * Refund a captured payment, exactly once per capture. Field limits are
 * enforced before any transport call; unknown or already-refunded captures
 * are rejected by the client lock (repeat in-session) and the
 * server/replay (truth, incl. cross-instance repeats).
 */
export async function refundCapturedPayment(
  api: PayPalApi,
  input: RefundCaptureInput,
): Promise<RefundResult> {
  if (typeof input.captureId !== 'string' || input.captureId.length === 0) {
    throw new Error('paypal: captureId is required');
  }
  if (
    input.amountUsd !== undefined &&
    (typeof input.amountUsd !== 'number' ||
      !Number.isFinite(input.amountUsd) ||
      input.amountUsd <= 0)
  ) {
    throw new Error('paypal: amountUsd must be a finite USD amount > 0 when provided');
  }
  if (input.noteToPayer !== undefined && input.noteToPayer.length > 255) {
    throw new Error('paypal: note_to_payer must be <= 255 chars');
  }
  if (input.invoiceId !== undefined && (input.invoiceId.length === 0 || input.invoiceId.length > 127)) {
    throw new Error('paypal: invoice_id must be 1..127 chars when provided');
  }
  const body: Record<string, unknown> = {};
  if (input.amountUsd !== undefined) {
    body['amount'] = toPaypalMoney(input.amountUsd, input.currencyCode);
  }
  if (input.invoiceId !== undefined) {
    body['invoice_id'] = input.invoiceId;
  }
  if (input.noteToPayer !== undefined) {
    body['note_to_payer'] = input.noteToPayer;
  }
  const { data } = await api.request<RawRefundJson>(
    'POST',
    `/v2/payments/captures/${input.captureId}/refund`,
    body,
    { requestId: input.requestId },
  );
  return {
    transportMode: api.transportMode,
    refundId: data.id,
    captureId: input.captureId,
    amountUsd: Number(
      data.amount?.value ?? (input.amountUsd !== undefined ? toMoneyValue(input.amountUsd) : '0'),
    ),
    invoiceId: data.invoice_id ?? input.invoiceId,
    noteToPayer: data.note_to_payer ?? input.noteToPayer,
    status: 'COMPLETED',
    createTimeIso: data.create_time ?? '',
  };
}
