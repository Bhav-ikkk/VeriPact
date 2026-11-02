/**
 * @veripact/paypal-client Payments v2: exact capture and void.
 *
 * Spec-verified constraints (paypal-api-context skill): `capture_request`
 * has NO `custom_id` — the capture-addendum hash travels in `invoice_id`
 * (≤127 chars) as `"VPA-" + sha256.slice(0, 28)`; `final_capture: true`
 * closes the authorization; `note_to_payer` ≤ 255 chars. Void takes no
 * body. Both calls carry `PayPal-Request-Id` (security-audit skill:
 * idempotent mutations) and pass through the client's one-way
 * AUTHORIZED → DECIDED → CAPTURED | VOIDED state lock.
 */
import type { PayPalApi, TransportMode } from './oauth';
import { toMoneyValue, toPaypalMoney } from './orders';

/** Thrown when a capture/void violates the one-way authorization lock. */
export class AuthorizationStateConflictError extends Error {
  readonly authorizationId: string;
  readonly fromStatus: string;
  readonly toStatus: string;

  constructor(authorizationId: string, fromStatus: string, toStatus: string) {
    super(
      `paypal: illegal authorization transition ${authorizationId}: ${fromStatus} -> ${toStatus}`,
    );
    this.name = 'AuthorizationStateConflictError';
    this.authorizationId = authorizationId;
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * Build the capture `invoice_id` from the addendum digest: 32 chars
 * (`VPA-` + 28 hex), well inside the 127-char limit.
 */
export function buildCaptureInvoiceId(addendumSha256: string): string {
  if (!SHA256_HEX_RE.test(addendumSha256)) {
    throw new Error('paypal: addendum digest must be 64 lowercase hex chars');
  }
  return `VPA-${addendumSha256.slice(0, 28)}`;
}

/** Input for an exact-amount final capture. */
export interface CaptureAuthInput {
  authorizationId: string;
  /** sha256 of the canonical `CaptureAddendum` → carried in `invoice_id`. */
  addendumSha256: string;
  /** Omit to capture the full authorized amount. */
  amountUsd?: number;
  currencyCode?: string;
  noteToPayer?: string;
  requestId?: string;
}

/** Normalized capture result (both transports). */
export interface CaptureResult {
  transportMode: TransportMode;
  captureId: string;
  authorizationId: string;
  invoiceId: string;
  amountUsd: number;
  finalCapture: boolean;
  createTimeIso: string;
}

interface RawCaptureJson {
  id: string;
  amount?: { value?: string };
  invoice_id?: string;
  final_capture?: boolean;
  create_time?: string;
}

/**
 * Capture an authorization exactly once (`final_capture: true`). Field
 * limits are enforced before any transport call; the one-way state lock is
 * enforced by the client (session guard) and the server/replay (truth).
 */
export async function captureAuthorizationExact(
  api: PayPalApi,
  input: CaptureAuthInput,
): Promise<CaptureResult> {
  const invoiceId = buildCaptureInvoiceId(input.addendumSha256);
  if (input.noteToPayer !== undefined && input.noteToPayer.length > 255) {
    throw new Error('paypal: note_to_payer must be <= 255 chars');
  }
  const body: Record<string, unknown> = {
    invoice_id: invoiceId,
    final_capture: true,
  };
  if (input.amountUsd !== undefined) {
    body['amount'] = toPaypalMoney(input.amountUsd, input.currencyCode);
  }
  if (input.noteToPayer !== undefined) {
    body['note_to_payer'] = input.noteToPayer;
  }
  const { data } = await api.request<RawCaptureJson>(
    'POST',
    `/v2/payments/authorizations/${input.authorizationId}/capture`,
    body,
    { requestId: input.requestId },
  );
  return {
    transportMode: api.transportMode,
    captureId: data.id,
    authorizationId: input.authorizationId,
    invoiceId: data.invoice_id ?? invoiceId,
    amountUsd: Number(data.amount?.value ?? (input.amountUsd !== undefined ? toMoneyValue(input.amountUsd) : '0')),
    finalCapture: data.final_capture ?? true,
    createTimeIso: data.create_time ?? '',
  };
}

/** Input for voiding an uncaptured authorization. */
export interface VoidAuthInput {
  authorizationId: string;
  requestId?: string;
}

/** Normalized void result (both transports). */
export interface VoidResult {
  transportMode: TransportMode;
  authorizationId: string;
  status: 'VOIDED';
}

/** Void an uncaptured authorization (no request body per spec). */
export async function voidAuthorization(api: PayPalApi, input: VoidAuthInput): Promise<VoidResult> {
  await api.request<unknown>(
    'POST',
    `/v2/payments/authorizations/${input.authorizationId}/void`,
    undefined,
    { requestId: input.requestId },
  );
  return {
    transportMode: api.transportMode,
    authorizationId: input.authorizationId,
    status: 'VOIDED',
  };
}
