/**
 * @veripact/paypal-client — Orders v2, webhooks, Disputes v1 HATEOAS engine.
 *
 * Request builders and the HATEOAS action map are real and tested.
 * Networked calls land in later prompts and MUST target the sandbox
 * base URL (AGENTS.md Rule 3).
 */
import { formatCommitmentPrefix, NotImplementedError } from '@veripact/core';

export { NotImplementedError };

/** PayPal Sandbox REST base URL — the only host the demo may call. */
export const PAYPAL_SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';

/** True for the official sandbox base URL (trailing slash tolerated). */
export function isSandboxBaseUrl(url: string): boolean {
  return url.replace(/\/+$/, '') === PAYPAL_SANDBOX_BASE_URL;
}

/** PayPal money object. */
export interface PaypalMoney {
  currency_code: string;
  value: string;
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
      path: "/purchase_units/@reference_id=='default'/amount",
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

/** One HATEOAS link from a PayPal dispute response. */
export interface DisputeLink {
  rel: string;
  href: string;
  method: string;
}

/** Action map keyed by link rel (e.g. `escalate`, `provide-evidence`). */
export type HateoasActionMap = Record<string, DisputeLink>;

/** Index dispute HATEOAS links by rel for gated action buttons. */
export function toHateoasActionMap(links: DisputeLink[]): HateoasActionMap {
  const map: HateoasActionMap = {};
  for (const link of links) {
    map[link.rel] = link;
  }
  return map;
}

export interface PayPalClientOptions {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
}

/**
 * Foundation stub: holds sandbox credentials; every networked method throws
 * until its prompt lands. Constructor rejects non-sandbox hosts.
 */
export class PayPalClient {
  readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(options: PayPalClientOptions) {
    const baseUrl = options.baseUrl ?? PAYPAL_SANDBOX_BASE_URL;
    if (!isSandboxBaseUrl(baseUrl)) {
      throw new Error(`refusing non-sandbox PayPal host: ${baseUrl}`);
    }
    this.baseUrl = baseUrl;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
  }

  /** True when credential-shaped strings were supplied (length check only). */
  hasCredentials(): boolean {
    return this.clientId.length > 0 && this.clientSecret.length > 0;
  }

  createAuthorizeOrder(_input: AuthorizeOrderInput): Promise<unknown> {
    return Promise.reject(new NotImplementedError('PayPalClient.createAuthorizeOrder'));
  }

  patchOrder(_orderId: string, _ops: PatchOperation[]): Promise<unknown> {
    return Promise.reject(new NotImplementedError('PayPalClient.patchOrder'));
  }

  captureAuthorization(_authorizationId: string, _amount: PaypalMoney): Promise<unknown> {
    return Promise.reject(new NotImplementedError('PayPalClient.captureAuthorization'));
  }

  voidAuthorization(_authorizationId: string): Promise<unknown> {
    return Promise.reject(new NotImplementedError('PayPalClient.voidAuthorization'));
  }

  getDispute(_disputeId: string): Promise<unknown> {
    return Promise.reject(new NotImplementedError('PayPalClient.getDispute'));
  }
}
