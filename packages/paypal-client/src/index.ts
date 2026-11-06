/**
 * @veripact/paypal-client — Orders v2, Payments v2, Disputes v1, webhooks.
 *
 * `PayPalClient` implements the `PayPalApi` seam once and routes every call
 * to `LIVE_PAYPAL_SANDBOX` (real REST + OAuth) or
 * `DETERMINISTIC_SANDBOX_REPLAY` (stateful in-memory engine). Mode `auto`
 * (default): live when `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` are
 * present, replay otherwise — so zero-key runs stay fully deterministic.
 *
 * Hardening (security-audit skill, guidance mode):
 * - The client secret crosses exactly one boundary (OAuth token fetch) and
 *   error paths never echo headers or bodies (`PayPalHttpError` carries
 *   method/path/status/server-snippet only). `toJSON()` redacts credentials.
 * - Every mutating call carries a `PayPal-Request-Id` idempotency key
 *   (caller-supplied or generated); the replay engine dedupes on it.
 * - A one-way authorization state lock (`AUTHORIZED` → terminal
 *   `CAPTURED` | `VOIDED`) is enforced in-session AND by the server/replay,
 *   so double-capture and capture-after-void fail at both layers.
 */
import { randomUUID } from 'node:crypto';
import { NotImplementedError } from '@veripact/core';
import {
  AuthorizationStateConflictError,
  buildCaptureInvoiceId,
  captureAuthorizationExact,
  voidAuthorization,
  type CaptureAuthInput,
  type CaptureResult,
  type VoidAuthInput,
  type VoidResult,
} from './authorizations';
import {
  acceptDisputeClaim,
  adjudicateDisputeSandbox,
  escalateDisputeToClaim,
  getDispute,
  listDisputes,
  provideDisputeEvidence,
  requireDisputeEvidence,
  type AdjudicationOutcome,
  type DisputeLink,
  type DisputeRecord,
  type HateoasActionMap,
  type ProvideEvidenceInput,
  type RequireEvidenceAction,
} from './disputes';
import { resolvePaypalCredentials } from './env';
import {
  fetchAccessToken,
  nodeHttpTransport,
  parseJsonResponse,
  PayPalHttpError,
  resolveProxyForUrl,
  TokenCache,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
  type PayPalApi,
  type PayPalEnvelope,
  type RequestOpts,
  type TransportMode,
} from './oauth';
import {
  authorizeOrder,
  buildAmountPatch,
  buildAuthorizeOrderBody,
  createAuthorizeOrder,
  DEFAULT_UNIT_AMOUNT_PATH,
  getOrder,
  patchOrderShippingAndTax,
  toMoneyValue,
  toPaypalMoney,
  type AmountBreakdown,
  type AuthorizeOrderBody,
  type AuthorizeOrderInput,
  type CreateOrderInput,
  type OrderRecord,
  type PatchOperation,
  type PaypalMoney,
  type ShippingTaxBreakdown,
} from './orders';
import {
  approveVaultPaymentToken,
  createVaultSetupToken,
  type VaultApproveInput,
  type VaultSetupInput,
  type VaultSetupRecord,
  type VaultTokenRecord,
} from './vault';
import {
  refundCapturedPayment,
  RefundStateConflictError,
  type RefundCaptureInput,
  type RefundResult,
} from './refunds';
import {
  buildReportingFallback,
  mapReportingStatusCode,
  REPORTING_INDEXING_DELAY_DISCLOSURE,
  ReportingRangeExceededError,
  searchTransactions,
  validateSearchWindow,
  type ReportingRecord,
  type ReportingScopeStatus,
  type ReportingStatusCode,
  type TransactionSearchInput,
  type TransactionSearchResult,
  type ValidatedSearchWindow,
} from './reporting';
import {
  legacyUnwitnessedFixtures,
  syncAccountPayments,
  type LiveOrderReceipt,
  type SyncAccountPaymentsInput,
  type SyncAccountPaymentsResult,
} from './payment-sync';
import { createSandboxReplayEngine, type SandboxReplayEngine } from './sandbox-replay';
import {
  verifyPayPalWebhookSignature,
  type WebhookVerifyInput,
  type WebhookVerifyResult,
} from './webhooks';

export { NotImplementedError };
export {
  approveVaultPaymentToken,
  AuthorizationStateConflictError,
  buildAmountPatch,
  buildAuthorizeOrderBody,
  buildCaptureInvoiceId,
  buildReportingFallback,
  captureAuthorizationExact,
  createSandboxReplayEngine,
  createVaultSetupToken,
  DEFAULT_UNIT_AMOUNT_PATH,
  fetchAccessToken,
  legacyUnwitnessedFixtures,
  mapReportingStatusCode,
  nodeHttpTransport,
  parseJsonResponse,
  PayPalHttpError,
  refundCapturedPayment,
  RefundStateConflictError,
  REPORTING_INDEXING_DELAY_DISCLOSURE,
  ReportingRangeExceededError,
  resolveProxyForUrl,
  searchTransactions,
  syncAccountPayments,
  TokenCache,
  toMoneyValue,
  toPaypalMoney,
  validateSearchWindow,
  voidAuthorization,
};
export {
  DisputeActionNotPermittedByHateoasError,
  toHateoasActionMap,
} from './disputes';
export {
  defaultEnvFilePath,
  isPlaceholderCredential,
  readDotEnvFile,
  resolvePaypalCredentials,
} from './env';
export type { ExplicitPayPalCredentials, ResolvedPayPalCredentials } from './env';
export { orderLinksFor } from './sandbox-replay';
export type {
  AdjudicationOutcome,
  AmountBreakdown,
  AuthorizeOrderBody,
  AuthorizeOrderInput,
  CaptureAuthInput,
  CaptureResult,
  CreateOrderInput,
  DisputeRecord,
  HateoasActionMap,
  DisputeLink,
  HttpRequest,
  HttpResponse,
  HttpTransport,
  OrderRecord,
  PatchOperation,
  PayPalApi,
  PayPalEnvelope,
  PaypalMoney,
  ProvideEvidenceInput,
  RequestOpts,
  RequireEvidenceAction,
  ShippingTaxBreakdown,
  TransportMode,
  VoidAuthInput,
  VoidResult,
  WebhookVerifyInput,
  WebhookVerifyResult,
};
export type {
  ReplayAuthorizationRecord,
  ReplayCaptureRecord,
  ReplayDisputeRecord,
  ReplayOrderRecord,
  ReplayRefundInput,
  ReplayRefundRecord,
  ReplayReportingDetail,
  ReplayVaultSetupRecord,
  ReplayVaultTokenRecord,
  SandboxReplayEngine,
} from './sandbox-replay';
export type {
  LiveOrderReceipt,
  RefundCaptureInput,
  RefundResult,
  ReportingRecord,
  ReportingScopeStatus,
  ReportingStatusCode,
  SyncAccountPaymentsInput,
  SyncAccountPaymentsResult,
  TransactionSearchInput,
  TransactionSearchResult,
  ValidatedSearchWindow,
  VaultApproveInput,
  VaultSetupInput,
  VaultSetupRecord,
  VaultTokenRecord,
};

/** PayPal Sandbox REST base URL — the only host the demo may call. */
export const PAYPAL_SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';

/** True for the official sandbox base URL (trailing slash tolerated). */
export function isSandboxBaseUrl(url: string): boolean {
  return url.replace(/\/+$/, '') === PAYPAL_SANDBOX_BASE_URL;
}

/** Client mode: explicit transports or credential-based auto-resolution. */
export type PayPalClientMode = 'auto' | 'live' | 'replay';

export interface PayPalClientOptions {
  clientId?: string;
  clientSecret?: string;
  baseUrl?: string;
  mode?: PayPalClientMode;
  httpTransport?: HttpTransport;
  replay?: SandboxReplayEngine;
  timeoutMs?: number;
  /**
   * `.env` path for hot-reload credential fallback. Defaults to
   * `VERIPACT_ENV_FILE` or `<cwd>/.env`. Tests point this at an absent
   * file to stay hermetic.
   */
  envFilePath?: string;
}

/** In-session authorization states observed by this client instance. */
type SessionAuthState = 'AUTHORIZED' | 'CAPTURED' | 'VOIDED';

const MUTATING: ReadonlySet<HttpRequest['method']> = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function matchPath(path: string, re: RegExp): string | undefined {
  const m = re.exec(path);
  return m?.[1];
}

/**
 * Foundation-compatible PayPal client. Holds sandbox credentials, resolves
 * the transport mode, and exposes the full Orders/Payments/Disputes surface.
 * Constructor rejects non-sandbox hosts and live-mode-without-credentials.
 */
export class PayPalClient implements PayPalApi {
  readonly baseUrl: string;
  readonly transportMode: TransportMode;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly transport: HttpTransport;
  private readonly replay: SandboxReplayEngine;
  private readonly tokens = new TokenCache();
  private readonly timeoutMs: number;
  /** One-way in-session lock: AUTHORIZED → CAPTURED | VOIDED (terminal). */
  private readonly authStates = new Map<string, SessionAuthState>();
  /** One-way in-session refund lock: a capture refunds at most once. */
  private readonly refundedCaptures = new Set<string>();

  constructor(options: PayPalClientOptions = {}) {
    const baseUrl = options.baseUrl ?? PAYPAL_SANDBOX_BASE_URL;
    if (!isSandboxBaseUrl(baseUrl)) {
      throw new Error(`refusing non-sandbox PayPal host: ${baseUrl}`);
    }
    this.baseUrl = baseUrl;
    // Hot-reload: explicit options → process env → `.env` on disk, resolved
    // fresh at every construction so dropping credentials into `.env`
    // later flips the next client to live mode without a restart.
    const resolved = resolvePaypalCredentials(
      { clientId: options.clientId, clientSecret: options.clientSecret },
      options.envFilePath,
    );
    this.clientId = resolved.clientId;
    this.clientSecret = resolved.clientSecret;
    const mode = options.mode ?? 'auto';
    if (mode === 'live' && !this.hasCredentials()) {
      throw new Error('paypal: live mode requires PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET');
    }
    this.transportMode =
      mode === 'replay' ? 'DETERMINISTIC_SANDBOX_REPLAY'
      : mode === 'live' ? 'LIVE_PAYPAL_SANDBOX'
      : this.hasCredentials() ? 'LIVE_PAYPAL_SANDBOX'
      : 'DETERMINISTIC_SANDBOX_REPLAY';
    this.transport = options.httpTransport ?? nodeHttpTransport;
    this.replay = options.replay ?? createSandboxReplayEngine();
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  /** True when credential-shaped strings were supplied (length check only). */
  hasCredentials(): boolean {
    return this.clientId.length > 0 && this.clientSecret.length > 0;
  }

  /** Redacted serialization: credentials never appear in JSON output. */
  toJSON(): { baseUrl: string; transportMode: TransportMode; hasCredentials: boolean } {
    return {
      baseUrl: this.baseUrl,
      transportMode: this.transportMode,
      hasCredentials: this.hasCredentials(),
    };
  }

  /**
   * The `PayPalApi` seam: attach an idempotency key to mutating calls,
   * enforce the in-session authorization lock, and route live vs replay.
   */
  async request<T>(
    method: HttpRequest['method'],
    path: string,
    body?: unknown,
    opts?: RequestOpts,
  ): Promise<PayPalEnvelope<T>> {
    const requestId = MUTATING.has(method) ? (opts?.requestId ?? randomUUID()) : undefined;
    this.checkAuthLock(method, path);
    let envelope: PayPalEnvelope<T>;
    if (this.transportMode === 'LIVE_PAYPAL_SANDBOX') {
      envelope = await this.requestLive<T>(method, path, body, requestId);
    } else {
      envelope = this.requestReplay<T>(method, path, body, requestId);
    }
    this.recordAuthTransition(method, path);
    return envelope;
  }

  /* ---------------- in-session one-way auth lock ---------------- */

  private checkAuthLock(method: HttpRequest['method'], path: string): void {
    if (method !== 'POST') {
      return;
    }
    const captureId = matchPath(path, /^\/v2\/payments\/authorizations\/([^/]+)\/capture$/);
    if (captureId !== undefined) {
      const state = this.authStates.get(captureId);
      if (state === 'CAPTURED' || state === 'VOIDED') {
        throw new AuthorizationStateConflictError(captureId, state, 'CAPTURED');
      }
      return;
    }
    const voidId = matchPath(path, /^\/v2\/payments\/authorizations\/([^/]+)\/void$/);
    if (voidId !== undefined) {
      const state = this.authStates.get(voidId);
      if (state === 'CAPTURED' || state === 'VOIDED') {
        throw new AuthorizationStateConflictError(voidId, state, 'VOIDED');
      }
      return;
    }
    const refundId = matchPath(path, /^\/v2\/payments\/captures\/([^/]+)\/refund$/);
    if (refundId !== undefined && this.refundedCaptures.has(refundId)) {
      throw new RefundStateConflictError(refundId, 'capture already refunded in this session');
    }
  }

  private recordAuthTransition(method: HttpRequest['method'], path: string): void {
    if (method !== 'POST') {
      return;
    }
    const captureId = matchPath(path, /^\/v2\/payments\/authorizations\/([^/]+)\/capture$/);
    if (captureId !== undefined) {
      this.authStates.set(captureId, 'CAPTURED');
      return;
    }
    const voidId = matchPath(path, /^\/v2\/payments\/authorizations\/([^/]+)\/void$/);
    if (voidId !== undefined) {
      this.authStates.set(voidId, 'VOIDED');
      return;
    }
    const refundId = matchPath(path, /^\/v2\/payments\/captures\/([^/]+)\/refund$/);
    if (refundId !== undefined) {
      this.refundedCaptures.add(refundId);
    }
    // Successful authorizes are recorded by `authorizeOrder()` below, which
    // sees the parsed authorization id from the response body.
  }

  /* ---------------- live transport ---------------- */

  private async requestLive<T>(
    method: HttpRequest['method'],
    path: string,
    body: unknown,
    requestId: string | undefined,
  ): Promise<PayPalEnvelope<T>> {
    const token = await this.tokens.get(() =>
      fetchAccessToken({
        transport: this.transport,
        baseUrl: this.baseUrl,
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        timeoutMs: this.timeoutMs,
      }),
    );
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    if (requestId !== undefined) {
      headers['PayPal-Request-Id'] = requestId;
    }
    const res = await this.transport(this.baseUrl, {
      method,
      path,
      headers,
      bodyText: body === undefined ? undefined : JSON.stringify(body),
      timeoutMs: this.timeoutMs,
    });
    return parseJsonResponse<T>(method, path, res);
  }

  /* ---------------- replay routing ---------------- */

  private requestReplay<T>(
    method: HttpRequest['method'],
    path: string,
    body: unknown,
    requestId: string | undefined,
  ): PayPalEnvelope<T> {
    // Orders v2
    if (method === 'POST' && path === '/v2/checkout/orders') {
      const { order } = this.replay.createOrder(body as AuthorizeOrderBody, requestId);
      return { status: 201, data: order as T };
    }
    const orderId = matchPath(path, /^\/v2\/checkout\/orders\/([^/]+)$/);
    if (orderId !== undefined && method === 'GET') {
      return { status: 200, data: this.replay.getOrder(orderId) as T };
    }
    if (orderId !== undefined && method === 'PATCH') {
      this.replay.patchOrder(orderId, (body ?? []) as PatchOperation[]);
      return { status: 204, data: {} as T };
    }
    const authorizeId = matchPath(path, /^\/v2\/checkout\/orders\/([^/]+)\/authorize$/);
    if (authorizeId !== undefined && method === 'POST') {
      const { order, authorization } = this.replay.authorizeOrder(authorizeId, requestId);
      this.authStates.set(authorization.id, 'AUTHORIZED');
      const [unit] = order.purchase_units;
      const merged = {
        ...order,
        purchase_units: [
          {
            ...unit,
            payments: { authorizations: [{ id: authorization.id, status: authorization.status }] },
          },
        ],
      };
      return { status: 201, data: merged as T };
    }
    // Payments v2
    const captureId = matchPath(path, /^\/v2\/payments\/authorizations\/([^/]+)\/capture$/);
    if (captureId !== undefined && method === 'POST') {
      const b = (body ?? {}) as {
        amount?: PaypalMoney;
        invoice_id: string;
        final_capture: boolean;
        note_to_payer?: string;
      };
      const { capture } = this.replay.captureAuthorization(
        captureId,
        {
          amount: b.amount,
          invoice_id: b.invoice_id,
          final_capture: b.final_capture,
          note_to_payer: b.note_to_payer,
        },
        requestId,
      );
      return {
        status: 201,
        data: {
          id: capture.id,
          amount: capture.amount,
          invoice_id: capture.invoice_id,
          final_capture: capture.final_capture,
          create_time: capture.create_time,
        } as T,
      };
    }
    const voidId = matchPath(path, /^\/v2\/payments\/authorizations\/([^/]+)\/void$/);
    if (voidId !== undefined && method === 'POST') {
      this.replay.voidAuthorization(voidId, requestId);
      return { status: 204, data: {} as T };
    }
    // Disputes v1
    if (method === 'GET' && path === '/v1/customer/disputes') {
      return { status: 200, data: { items: this.replay.listDisputes() } as T };
    }
    const disputeId = matchPath(path, /^\/v1\/customer\/disputes\/([^/]+)$/);
    if (disputeId !== undefined && method === 'GET') {
      return { status: 200, data: this.replay.getDispute(disputeId) as T };
    }
    const disputeAction = matchPath(path, /^\/v1\/customer\/disputes\/([^/]+)\/([a-z-]+)$/);
    if (disputeAction !== undefined && method === 'POST') {
      return { status: 200, data: this.replayDisputeAction(path, body) as T };
    }
    // Webhooks
    if (method === 'POST' && path === '/v1/notifications/verify-webhook-signature') {
      return { status: 200, data: this.replay.verifyWebhookSignature(true) as T };
    }
    // Vault v3 (v5 wallet pairing)
    if (method === 'POST' && path === '/v3/vault/setup-tokens') {
      const b = (body ?? {}) as {
        payment_source?: { paypal?: { email_address?: string } };
      };
      const { setupToken } = this.replay.setupVaultToken(
        { payer_email: b.payment_source?.paypal?.email_address ?? '' },
        requestId,
      );
      return {
        status: 201,
        data: { id: setupToken.id, status: setupToken.status, links: setupToken.links } as T,
      };
    }
    if (method === 'POST' && path === '/v3/vault/payment-tokens') {
      const b = (body ?? {}) as { payment_source?: { token?: { id?: string } } };
      const setupTokenId = b.payment_source?.token?.id ?? '';
      const setup = this.replay.getVaultSetup(setupTokenId);
      const { token } = this.replay.approveVaultToken(setupTokenId, setup.payer_email, requestId);
      return {
        status: 201,
        data: { id: token.id, customer: { id: setup.payer_email } } as T,
      };
    }
    // Refunds (v5 partition Undo)
    const refundCaptureId = matchPath(path, /^\/v2\/payments\/captures\/([^/]+)\/refund$/);
    if (refundCaptureId !== undefined && method === 'POST') {
      const b = (body ?? {}) as {
        amount?: PaypalMoney;
        invoice_id?: string;
        note_to_payer?: string;
      };
      const { refund } = this.replay.refundCapture(
        refundCaptureId,
        { amount: b.amount, invoice_id: b.invoice_id, note_to_payer: b.note_to_payer },
        requestId,
      );
      return {
        status: 201,
        data: {
          id: refund.id,
          amount: refund.amount,
          invoice_id: refund.invoice_id,
          note_to_payer: refund.note_to_payer,
          status: refund.status,
          create_time: refund.create_time,
        } as T,
      };
    }
    // Reporting (v5 payment sync; query string carries the window)
    if (method === 'GET' && path.startsWith('/v1/reporting/transactions')) {
      const query = path.includes('?') ? path.slice(path.indexOf('?') + 1) : '';
      const params = new URLSearchParams(query);
      return {
        status: 200,
        data: this.replay.searchReportingTransactions({
          startIso: params.get('start_date') ?? new Date(0).toISOString(),
          endIso: params.get('end_date') ?? new Date().toISOString(),
          pageSize: Number(params.get('page_size') ?? '100'),
        }) as T,
      };
    }
    throw new Error(`paypal replay: unsupported call ${method} ${path}`);
  }

  private replayDisputeAction(path: string, body: unknown): unknown {
    const id = matchPath(path, /^\/v1\/customer\/disputes\/([^/]+)\/[a-z-]+$/);
    if (id === undefined) {
      throw new Error(`paypal replay: malformed dispute action path ${path}`);
    }
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/require-evidence')) {
      return this.replay.requireDisputeEvidence(id, b['action'] as 'BUYER_EVIDENCE' | 'SELLER_EVIDENCE');
    }
    if (path.endsWith('/provide-evidence')) {
      return this.replay.provideDisputeEvidence(
        id,
        b['evidence_type'] as string,
        b['notes'] as string,
      );
    }
    if (path.endsWith('/escalate')) {
      return this.replay.escalateDispute(id);
    }
    if (path.endsWith('/accept-claim')) {
      return this.replay.acceptDisputeClaim(id);
    }
    if (path.endsWith('/adjudicate')) {
      return this.replay.adjudicateDispute(
        id,
        b['adjudication_outcome'] as 'BUYER_FAVOR' | 'SELLER_FAVOR',
      );
    }
    throw new Error(`paypal replay: unsupported dispute action ${path}`);
  }

  /* ---------------- replay-only helpers ---------------- */

  /** Simulate payer approval (replay only — live uses the browser redirect). */
  simulatePayerApproval(orderId: string): OrderRecord {
    if (this.transportMode !== 'DETERMINISTIC_SANDBOX_REPLAY') {
      throw new Error('paypal: simulatePayerApproval is replay-only');
    }
    this.replay.simulatePayerApproval(orderId);
    return this.getOrderSync(orderId);
  }

  private getOrderSync(orderId: string): OrderRecord {
    const order = this.replay.getOrder(orderId);
    const [unit] = order.purchase_units;
    const breakdown = unit?.amount.breakdown;
    return {
      transportMode: this.transportMode,
      orderId: order.id,
      status: order.status,
      customId: unit?.custom_id ?? '',
      authorizationId: order.authorization_id,
      createTimeIso: order.create_time,
      amountBreakdown: {
        currencyCode: unit?.amount.currency_code ?? 'USD',
        itemTotalUsd: Number(breakdown?.item_total.value ?? '0'),
        shippingUsd: Number(breakdown?.shipping.value ?? '0'),
        taxUsd: Number(breakdown?.tax_total.value ?? '0'),
        totalUsd: Number(unit?.amount.value ?? '0'),
      },
    };
  }

  /** Reset replay state (replay only — test isolation). */
  resetReplay(): void {
    if (this.transportMode !== 'DETERMINISTIC_SANDBOX_REPLAY') {
      throw new Error('paypal: resetReplay is replay-only');
    }
    this.replay.reset();
    this.authStates.clear();
    this.refundedCaptures.clear();
  }

  /* ---------------- Orders v2 ---------------- */

  createAuthorizeOrder(input: CreateOrderInput): Promise<OrderRecord> {
    return createAuthorizeOrder(this, input);
  }

  patchOrderShippingAndTax(
    orderId: string,
    breakdown: ShippingTaxBreakdown,
    currencyCode?: string,
  ): Promise<{ orderId: string; finalTotalUsd: number; transportMode: TransportMode }> {
    return patchOrderShippingAndTax(this, orderId, breakdown, currencyCode);
  }

  async authorizeOrder(orderId: string): Promise<OrderRecord> {
    const record = await authorizeOrder(this, orderId);
    if (record.authorizationId !== undefined) {
      this.authStates.set(record.authorizationId, 'AUTHORIZED');
    }
    return record;
  }

  getOrder(orderId: string): Promise<OrderRecord> {
    return getOrder(this, orderId);
  }

  /* ---------------- Payments v2 ---------------- */

  captureAuthorizationExact(input: CaptureAuthInput): Promise<CaptureResult> {
    return captureAuthorizationExact(this, input);
  }

  voidAuthorization(input: VoidAuthInput): Promise<VoidResult> {
    return voidAuthorization(this, input);
  }

  /* ---------------- Disputes v1 ---------------- */

  listDisputes(): Promise<DisputeRecord[]> {
    return listDisputes(this);
  }

  getDispute(disputeId: string): Promise<DisputeRecord> {
    return getDispute(this, disputeId);
  }

  requireDisputeEvidence(disputeId: string, action: RequireEvidenceAction): Promise<DisputeRecord> {
    return requireDisputeEvidence(this, disputeId, action);
  }

  escalateDisputeToClaim(disputeId: string, note?: string): Promise<DisputeRecord> {
    return escalateDisputeToClaim(this, disputeId, note);
  }

  provideDisputeEvidence(input: ProvideEvidenceInput): Promise<DisputeRecord> {
    return provideDisputeEvidence(this, input);
  }

  acceptDisputeClaim(disputeId: string): Promise<DisputeRecord> {
    return acceptDisputeClaim(this, disputeId);
  }

  adjudicateDisputeSandbox(disputeId: string, outcome: AdjudicationOutcome): Promise<DisputeRecord> {
    return adjudicateDisputeSandbox(this, disputeId, outcome);
  }

  /* ---------------- Webhooks ---------------- */

  verifyWebhookSignature(input: WebhookVerifyInput): Promise<WebhookVerifyResult> {
    return verifyPayPalWebhookSignature(this, input);
  }

  /* ---------------- Vault v3 (v5 wallet pairing) ---------------- */

  createVaultSetupToken(input: VaultSetupInput): Promise<VaultSetupRecord> {
    return createVaultSetupToken(this, input);
  }

  approveVaultPaymentToken(input: VaultApproveInput): Promise<VaultTokenRecord> {
    return approveVaultPaymentToken(this, input);
  }

  /* ---------------- Refunds (v5 partition Undo) ---------------- */

  refundCapturedPayment(input: RefundCaptureInput): Promise<RefundResult> {
    return refundCapturedPayment(this, input);
  }

  /* ---------------- Reporting (v5 payment sync) ---------------- */

  /**
   * Transaction Search with honest live fallback: validation throws
   * before any transport call; a live 403 (missing reporting-search-read
   * scope) or transport failure returns replay + session-order records
   * labeled `FALLBACK_TO_REPLAY_AND_SESSION_ORDERS`, never live data.
   */
  async searchTransactions(input: TransactionSearchInput): Promise<TransactionSearchResult> {
    const window = validateSearchWindow(input);
    if (this.transportMode !== 'LIVE_PAYPAL_SANDBOX') {
      return searchTransactions(this, input);
    }
    try {
      return await searchTransactions(this, input);
    } catch {
      return buildReportingFallback(this.replay, window);
    }
  }
}
