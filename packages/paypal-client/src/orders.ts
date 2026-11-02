/**
 * @veripact/paypal-client Orders v2: AUTHORIZE create, amount PATCH,
 * authorize, and readback. Shapes follow `.agents/skills/paypal-api-context`
 * (spec-verified): `intent: "AUTHORIZE"`, single purchase unit
 * (`reference_id: "default"`), `custom_id` ≤ 255 chars carrying the 68-char
 * `VP1:` commitment, and the RFC 6901 amount-replace patch path.
 */
import { formatCommitmentPrefix } from '@veripact/core';
import type { PayPalApi, TransportMode } from './oauth';

/** PayPal money object (string value, 2dp). */
export interface PaypalMoney {
  currency_code: string;
  value: string;
}

/** Format a USD figure as a PayPal money value (`279` → `"279.00"`). */
export function toMoneyValue(amountUsd: number): string {
  return (Math.round((amountUsd + Number.EPSILON) * 100) / 100).toFixed(2);
}

/** Build a USD money object from a numeric figure. */
export function toPaypalMoney(amountUsd: number, currencyCode = 'USD'): PaypalMoney {
  return { currency_code: currencyCode, value: toMoneyValue(amountUsd) };
}

/** Input for a single-purchase-unit AUTHORIZE order. */
export interface AuthorizeOrderInput {
  receiptSha256Hex: string;
  description: string;
  itemTotal: string;
  currencyCode?: string;
}

/** Minimal create-order body (single purchase unit, AUTHORIZE intent). */
export interface AuthorizeOrderBody {
  intent: 'AUTHORIZE';
  purchase_units: Array<{
    reference_id: string;
    custom_id: string;
    description: string;
    amount: {
      currency_code: string;
      value: string;
      breakdown: {
        item_total: PaypalMoney;
        shipping: PaypalMoney;
        tax_total: PaypalMoney;
      };
    };
  }>;
}

/**
 * Build the POST /v2/checkout/orders body: intent AUTHORIZE, one purchase
 * unit, `VP1:` commitment in `custom_id`. Throws on a malformed digest.
 */
export function buildAuthorizeOrderBody(input: AuthorizeOrderInput): AuthorizeOrderBody {
  const currencyCode = input.currencyCode ?? 'USD';
  const zero: PaypalMoney = { currency_code: currencyCode, value: '0.00' };
  return {
    intent: 'AUTHORIZE',
    purchase_units: [
      {
        reference_id: 'default',
        custom_id: formatCommitmentPrefix(input.receiptSha256Hex),
        description: input.description,
        amount: {
          currency_code: currencyCode,
          value: input.itemTotal,
          breakdown: {
            item_total: { currency_code: currencyCode, value: input.itemTotal },
            shipping: zero,
            tax_total: zero,
          },
        },
      },
    ],
  };
}

/** JSON Patch operation for PATCH /v2/checkout/orders/{id}. */
export interface PatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
}

/** RFC 6901 pointer to the default unit's amount (spec-verified). */
export const DEFAULT_UNIT_AMOUNT_PATH = "/purchase_units/@reference_id=='default'/amount";

/** Build the amount-replace patch for the default purchase unit. */
export function buildAmountPatch(
  itemTotal: string,
  shipping: string,
  taxTotal: string,
  currencyCode = 'USD',
): PatchOperation[] {
  const total = (Number(itemTotal) + Number(shipping) + Number(taxTotal)).toFixed(2);
  return [
    {
      op: 'replace',
      path: DEFAULT_UNIT_AMOUNT_PATH,
      value: {
        currency_code: currencyCode,
        value: total,
        breakdown: {
          item_total: { currency_code: currencyCode, value: itemTotal },
          shipping: { currency_code: currencyCode, value: shipping },
          tax_total: { currency_code: currencyCode, value: taxTotal },
        },
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Executed lifecycle calls (live or replay via PayPalApi)              */
/* ------------------------------------------------------------------ */

/** `VP1:` + 64 lowercase hex. */
const COMMITMENT_RE = /^VP1:[0-9a-f]{64}$/;

/** Amount breakdown read back from an order record. */
export interface AmountBreakdown {
  currencyCode: string;
  itemTotalUsd: number;
  shippingUsd: number;
  taxUsd: number;
  totalUsd: number;
}

/** Normalized order view used by the SDK (both transports). */
export interface OrderRecord {
  transportMode: TransportMode;
  orderId: string;
  status: string;
  customId: string;
  authorizationId?: string;
  createTimeIso: string;
  amountBreakdown: AmountBreakdown;
}

/** Raw order JSON subset we parse (live shape and replay shape). */
interface RawOrderJson {
  id: string;
  status: string;
  create_time?: string;
  createTime?: string;
  purchase_units?: Array<{
    reference_id?: string;
    custom_id?: string;
    amount?: {
      currency_code?: string;
      value?: string;
      breakdown?: {
        item_total?: PaypalMoney;
        shipping?: PaypalMoney;
        tax_total?: PaypalMoney;
      };
    };
    payments?: {
      authorizations?: Array<{ id?: string; status?: string }>;
    };
  }>;
  authorization_id?: string;
}

/** Parse live/replay order JSON into the normalized `OrderRecord`. */
export function parseOrderRecord(mode: TransportMode, json: RawOrderJson): OrderRecord {
  const unit = json.purchase_units?.[0];
  const amount = unit?.amount;
  const breakdown = amount?.breakdown;
  const currencyCode = amount?.currency_code ?? 'USD';
  const itemTotalUsd = Number(breakdown?.item_total?.value ?? '0');
  const shippingUsd = Number(breakdown?.shipping?.value ?? '0');
  const taxUsd = Number(breakdown?.tax_total?.value ?? '0');
  return {
    transportMode: mode,
    orderId: json.id,
    status: json.status,
    customId: unit?.custom_id ?? '',
    authorizationId: unit?.payments?.authorizations?.[0]?.id ?? json.authorization_id,
    createTimeIso: json.create_time ?? json.createTime ?? '',
    amountBreakdown: {
      currencyCode,
      itemTotalUsd,
      shippingUsd,
      taxUsd,
      totalUsd: Number(amount?.value ?? '0'),
    },
  };
}

/** Input for `createAuthorizeOrder`: pre-validated commitment + totals. */
export interface CreateOrderInput {
  /** 68-char `VP1:` commitment — validated before any network call. */
  commitment: string;
  description: string;
  itemTotalUsd: number;
  currencyCode?: string;
  /** Idempotency key; generated by the client when omitted. */
  requestId?: string;
}

/**
 * Create an AUTHORIZE order binding `commitment` into `custom_id`.
 * The commitment regex is enforced before any transport call so malformed
 * bindings fail without touching PayPal (last-trusted-decision-point).
 */
export async function createAuthorizeOrder(
  api: PayPalApi,
  input: CreateOrderInput,
): Promise<OrderRecord> {
  if (!COMMITMENT_RE.test(input.commitment)) {
    throw new Error(
      `paypal: commitment must match VP1:<64 hex> (got ${input.commitment.length} chars)`,
    );
  }
  if (input.commitment.length > 255) {
    throw new Error('paypal: commitment exceeds custom_id maxLength 255');
  }
  const body = buildAuthorizeOrderBody({
    receiptSha256Hex: input.commitment.slice(4),
    description: input.description,
    itemTotal: toMoneyValue(input.itemTotalUsd),
    currencyCode: input.currencyCode,
  });
  // buildAuthorizeOrderBody re-derives the commitment from the digest; the
  // regex above already pinned the exact string, so this is a no-op guard.
  const unit = body.purchase_units[0];
  if (unit !== undefined) {
    unit.custom_id = input.commitment;
  }
  const { data } = await api.request<RawOrderJson>('POST', '/v2/checkout/orders', body, {
    requestId: input.requestId,
  });
  return parseOrderRecord(api.transportMode, data);
}

/** Resolved shipping/tax breakdown for the amount patch. */
export interface ShippingTaxBreakdown {
  itemTotalUsd: number;
  shippingUsd: number;
  taxUsd: number;
}

/**
 * PATCH the order amount after the shipping callback resolves totals.
 * Computes `finalTotalUsd` deterministically and replaces the default
 * unit's `amount` (value + item_total/shipping/tax_total breakdown).
 */
export async function patchOrderShippingAndTax(
  api: PayPalApi,
  orderId: string,
  breakdown: ShippingTaxBreakdown,
  currencyCode = 'USD',
): Promise<{ orderId: string; finalTotalUsd: number; transportMode: TransportMode }> {
  const finalTotalUsd = Number(
    (breakdown.itemTotalUsd + breakdown.shippingUsd + breakdown.taxUsd).toFixed(2),
  );
  const ops = buildAmountPatch(
    toMoneyValue(breakdown.itemTotalUsd),
    toMoneyValue(breakdown.shippingUsd),
    toMoneyValue(breakdown.taxUsd),
    currencyCode,
  );
  await api.request<unknown>('PATCH', `/v2/checkout/orders/${orderId}`, ops);
  return { orderId, finalTotalUsd, transportMode: api.transportMode };
}

/** Authorize an approved order; returns the normalized order + auth id. */
export async function authorizeOrder(api: PayPalApi, orderId: string): Promise<OrderRecord> {
  const { data } = await api.request<RawOrderJson>(
    'POST',
    `/v2/checkout/orders/${orderId}/authorize`,
    {},
  );
  return parseOrderRecord(api.transportMode, data);
}

/** Read back an order (custom_id, status, breakdown, authorization id). */
export async function getOrder(api: PayPalApi, orderId: string): Promise<OrderRecord> {
  const { data } = await api.request<RawOrderJson>('GET', `/v2/checkout/orders/${orderId}`);
  return parseOrderRecord(api.transportMode, data);
}
