/**
 * @veripact/paypal-client deterministic sandbox replay engine.
 *
 * OpenAPI-accurate, stateful, zero-network stand-in for the PayPal Sandbox
 * used when credentials are absent or `mode === 'replay'` (unit tests, CLI
 * demos, zero-key judge inspection). Every response is labeled
 * `DETERMINISTIC_SANDBOX_REPLAY` by the client (Rule 3); nothing here is
 * ever presented as live evidence. IDs and disputes are deterministic
 * (`ORD-VP-…`, `PP-D-CASE-B-FORGERY`); timestamps use the real clock and
 * tests must assert shape, not exact time.
 */
import { AuthorizationStateConflictError } from './authorizations';
import { DisputeActionNotPermittedByHateoasError, type DisputeLink } from './disputes';
import type { AuthorizeOrderBody, PatchOperation, PaypalMoney } from './orders';

/* ------------------------------------------------------------------ */
/* Orders v2 + Payments v2 records                                      */
/* ------------------------------------------------------------------ */

export type ReplayOrderStatus = 'CREATED' | 'APPROVED' | 'COMPLETED' | 'VOIDED';
export type ReplayAuthorizationStatus = 'CREATED' | 'CAPTURED' | 'VOIDED';

export interface ReplayAmount {
  currency_code: string;
  value: string;
  breakdown: {
    item_total: PaypalMoney;
    shipping: PaypalMoney;
    tax_total: PaypalMoney;
  };
}

export interface ReplayOrderRecord {
  id: string;
  intent: 'AUTHORIZE';
  status: ReplayOrderStatus;
  purchase_units: Array<{
    reference_id: string;
    custom_id: string;
    description: string;
    amount: ReplayAmount;
  }>;
  create_time: string;
  update_time: string;
  authorization_id?: string;
  links: DisputeLink[];
}

/**
 * Order HATEOAS links. `CREATED` orders advertise the buyer-approval popup
 * (the replay twin of PayPal's `checkoutnow` approve link); approved and
 * completed orders only carry `self`.
 */
export function orderLinksFor(order: Pick<ReplayOrderRecord, 'id' | 'status'>): DisputeLink[] {
  const self: DisputeLink = {
    rel: 'self',
    href: `https://api-m.sandbox.paypal.com/v2/checkout/orders/${order.id}`,
    method: 'GET',
  };
  if (order.status !== 'CREATED') {
    return [self];
  }
  return [
    self,
    {
      rel: 'approve',
      href: `/sandbox/paypal-checkout?token=${order.id}`,
      method: 'GET',
    },
  ];
}

export interface ReplayAuthorizationRecord {
  id: string;
  order_id: string;
  status: ReplayAuthorizationStatus;
  amount: PaypalMoney;
  custom_id: string;
  create_time: string;
  update_time: string;
  capture_id?: string;
  invoice_id?: string;
  note_to_payer?: string;
}

export interface ReplayCaptureRecord {
  id: string;
  authorization_id: string;
  amount: PaypalMoney;
  invoice_id: string;
  final_capture: boolean;
  note_to_payer?: string;
  create_time: string;
}

export interface ReplayCaptureInput {
  amount?: PaypalMoney;
  invoice_id: string;
  final_capture: boolean;
  note_to_payer?: string;
}

/* ------------------------------------------------------------------ */
/* Disputes v1 records                                                  */
/* ------------------------------------------------------------------ */

export type ReplayDisputeStage = 'INQUIRY' | 'CHARGEBACK';
export type ReplayDisputeState =
  | 'OPEN_INQUIRIES'
  | 'REQUIRED_ACTION'
  | 'REQUIRED_OTHER_PARTY_ACTION'
  | 'UNDER_PAYPAL_REVIEW'
  | 'RESOLVED';

export interface ReplayDisputeEvidence {
  evidence_type: string;
  notes: string;
  submitted_at: string;
}

export interface ReplayDisputeRecord {
  dispute_id: string;
  status: 'OPEN' | 'RESOLVED';
  dispute_state: ReplayDisputeState;
  dispute_life_cycle_stage: ReplayDisputeStage;
  reason: string;
  dispute_amount: PaypalMoney;
  create_time: string;
  update_time: string;
  evidence: ReplayDisputeEvidence[];
  awaiting?: 'BUYER_EVIDENCE' | 'SELLER_EVIDENCE';
  evidence_provided?: boolean;
  outcome?: 'BUYER_FAVOR' | 'SELLER_FAVOR';
  links: DisputeLink[];
}

const EVIDENCE_TYPE_RE = /^[0-9A-Z_]+$/;

function disputeLink(disputeId: string, rel: string, method: string, suffix = ''): DisputeLink {
  return {
    rel,
    href: `https://api-m.sandbox.paypal.com/v1/customer/disputes/${disputeId}${suffix}`,
    method,
  };
}

/**
 * HATEOAS links ARE the dispute state machine (paypal-api-context skill):
 * the rel set is derived purely from (stage, state, evidence_provided).
 */
export function disputeLinksFor(d: ReplayDisputeRecord): DisputeLink[] {
  const id = d.dispute_id;
  const self = disputeLink(id, 'self', 'GET');
  if (d.status === 'RESOLVED') {
    return [self];
  }
  if (d.dispute_life_cycle_stage === 'INQUIRY') {
    if (d.dispute_state === 'OPEN_INQUIRIES') {
      return [self, disputeLink(id, 'require-evidence', 'POST', '/require-evidence'),
        disputeLink(id, 'escalate', 'POST', '/escalate')];
    }
    if (d.dispute_state === 'REQUIRED_OTHER_PARTY_ACTION') {
      return [self, disputeLink(id, 'provide-evidence', 'POST', '/provide-evidence'),
        disputeLink(id, 'escalate', 'POST', '/escalate')];
    }
    return [self, disputeLink(id, 'escalate', 'POST', '/escalate')];
  }
  // CHARGEBACK
  if (d.dispute_state === 'REQUIRED_OTHER_PARTY_ACTION') {
    return [self, disputeLink(id, 'provide-evidence', 'POST', '/provide-evidence'),
      disputeLink(id, 'accept-claim', 'POST', '/accept-claim')];
  }
  if (d.evidence_provided === true) {
    return [self, disputeLink(id, 'accept-claim', 'POST', '/accept-claim'),
      disputeLink(id, 'adjudicate', 'POST', '/adjudicate')];
  }
  return [self, disputeLink(id, 'require-evidence', 'POST', '/require-evidence'),
    disputeLink(id, 'accept-claim', 'POST', '/accept-claim')];
}

/* ------------------------------------------------------------------ */
/* Engine                                                               */
/* ------------------------------------------------------------------ */

function nowIso(): string {
  return new Date().toISOString();
}

function pad(n: number): string {
  return String(n).padStart(4, '0');
}

function moneyValue(m: PaypalMoney): number {
  return Number(m.value);
}

function breakdownSums(amount: ReplayAmount): boolean {
  const { breakdown } = amount;
  const sum = moneyValue(breakdown.item_total) + moneyValue(breakdown.shipping) +
    moneyValue(breakdown.tax_total);
  return Math.abs(sum - moneyValue({ currency_code: amount.currency_code, value: amount.value })) <
    0.005;
}

function seedDispute(
  disputeId: string,
  reason: string,
  value: string,
): ReplayDisputeRecord {
  const d: ReplayDisputeRecord = {
    dispute_id: disputeId,
    status: 'OPEN',
    dispute_state: 'OPEN_INQUIRIES',
    dispute_life_cycle_stage: 'INQUIRY',
    reason,
    dispute_amount: { currency_code: 'USD', value },
    create_time: nowIso(),
    update_time: nowIso(),
    evidence: [],
    links: [],
  };
  d.links = disputeLinksFor(d);
  return d;
}

/** Stateful deterministic PayPal Sandbox. One instance per client/tests. */
export class SandboxReplayEngine {
  private orderSeq = 0;
  private authSeq = 0;
  private captureSeq = 0;
  private readonly orders = new Map<string, ReplayOrderRecord>();
  private readonly authorizations = new Map<string, ReplayAuthorizationRecord>();
  private readonly captures = new Map<string, ReplayCaptureRecord>();
  private readonly disputes = new Map<string, ReplayDisputeRecord>();
  /** Idempotency store: PayPal-Request-Id → stored response clone. */
  private readonly idempotent = new Map<string, unknown>();

  constructor() {
    this.reset();
  }

  /** Clear all state and re-seed the two contested disputes. */
  reset(): void {
    this.orderSeq = 0;
    this.authSeq = 0;
    this.captureSeq = 0;
    this.orders.clear();
    this.authorizations.clear();
    this.captures.clear();
    this.disputes.clear();
    this.idempotent.clear();
    this.disputes.set(
      'PP-D-CASE-B-FORGERY',
      seedDispute('PP-D-CASE-B-FORGERY', 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', '279.00'),
    );
    this.disputes.set(
      'PP-D-CASE-A-DRIFT',
      seedDispute('PP-D-CASE-A-DRIFT', 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', '279.00'),
    );
  }

  private dedupe<T>(requestId: string | undefined, produce: () => T): { value: T; replayed: boolean } {
    if (requestId !== undefined) {
      const stored = this.idempotent.get(requestId);
      if (stored !== undefined) {
        return { value: structuredClone(stored) as T, replayed: true };
      }
      const value = produce();
      this.idempotent.set(requestId, structuredClone(value));
      return { value, replayed: false };
    }
    return { value: produce(), replayed: false };
  }

  /* ---------------- Orders v2 ---------------- */

  createOrder(body: AuthorizeOrderBody, requestId?: string): { order: ReplayOrderRecord; replayed: boolean } {
    const { value, replayed } = this.dedupe(requestId, (): ReplayOrderRecord => {
      if (body.intent !== 'AUTHORIZE') {
        throw new Error('replay: only intent AUTHORIZE is supported');
      }
      if (body.purchase_units.length !== 1) {
        throw new Error('replay: exactly one purchase unit is required');
      }
      const unit = body.purchase_units[0];
      if (unit === undefined || unit.reference_id !== 'default') {
        throw new Error("replay: purchase unit reference_id must be 'default'");
      }
      if (unit.custom_id.length === 0 || unit.custom_id.length > 255) {
        throw new Error('replay: custom_id must be 1..255 chars');
      }
      this.orderSeq += 1;
      const order: ReplayOrderRecord = {
        id: `ORD-VP-${pad(this.orderSeq)}`,
        intent: 'AUTHORIZE',
        status: 'CREATED',
        purchase_units: [
          {
            reference_id: unit.reference_id,
            custom_id: unit.custom_id,
            description: unit.description,
            amount: {
              currency_code: unit.amount.currency_code,
              value: unit.amount.value,
              breakdown: { ...unit.amount.breakdown },
            },
          },
        ],
        create_time: nowIso(),
        update_time: nowIso(),
        links: [],
      };
      this.orders.set(order.id, order);
      return this.stamped(order);
    });
    return { order: value, replayed };
  }

  getOrder(orderId: string): ReplayOrderRecord {
    const order = this.orders.get(orderId);
    if (order === undefined) {
      throw new Error(`replay: order not found: ${orderId}`);
    }
    return this.stamped(order);
  }

  /** Refresh HATEOAS links for the current status and return a safe clone. */
  private stamped(order: ReplayOrderRecord): ReplayOrderRecord {
    order.links = orderLinksFor(order);
    return structuredClone(order);
  }

  patchOrder(orderId: string, ops: PatchOperation[]): void {
    const order = this.orders.get(orderId);
    if (order === undefined) {
      throw new Error(`replay: order not found: ${orderId}`);
    }
    if (order.status !== 'CREATED' && order.status !== 'APPROVED') {
      throw new Error(`replay: cannot patch order in status ${order.status}`);
    }
    for (const op of ops) {
      if (op.op !== 'replace' || op.path !== "/purchase_units/@reference_id=='default'/amount") {
        throw new Error(`replay: unsupported patch op ${op.op} ${op.path}`);
      }
      const amount = op.value as ReplayAmount | undefined;
      if (amount === undefined || typeof amount.value !== 'string' || amount.breakdown === undefined) {
        throw new Error('replay: patch amount must carry value + breakdown');
      }
      if (!breakdownSums(amount)) {
        throw new Error('replay: patch breakdown does not sum to value');
      }
      const unit = order.purchase_units[0];
      if (unit === undefined) {
        throw new Error('replay: order has no purchase units');
      }
      unit.amount = {
        currency_code: amount.currency_code,
        value: amount.value,
        breakdown: { ...amount.breakdown },
      };
    }
    order.update_time = nowIso();
  }

  /** Honestly-labeled payer-approval simulation (replaces the browser redirect). */
  simulatePayerApproval(orderId: string): ReplayOrderRecord {
    const order = this.orders.get(orderId);
    if (order === undefined) {
      throw new Error(`replay: order not found: ${orderId}`);
    }
    if (order.status !== 'CREATED') {
      throw new Error(`replay: only CREATED orders can be approved (got ${order.status})`);
    }
    order.status = 'APPROVED';
    order.update_time = nowIso();
    return this.stamped(order);
  }

  authorizeOrder(
    orderId: string,
    requestId?: string,
  ): { order: ReplayOrderRecord; authorization: ReplayAuthorizationRecord; replayed: boolean } {
    const { value, replayed } = this.dedupe(
      requestId,
      (): { order: ReplayOrderRecord; authorization: ReplayAuthorizationRecord } => {
      const order = this.orders.get(orderId);
      if (order === undefined) {
        throw new Error(`replay: order not found: ${orderId}`);
      }
      if (order.status !== 'APPROVED') {
        throw new Error(`replay: only APPROVED orders can be authorized (got ${order.status})`);
      }
      const unit = order.purchase_units[0];
      if (unit === undefined) {
        throw new Error('replay: order has no purchase units');
      }
      this.authSeq += 1;
      const authorization: ReplayAuthorizationRecord = {
        id: `AUTH-VP-${pad(this.authSeq)}`,
        order_id: orderId,
        status: 'CREATED',
        amount: { currency_code: unit.amount.currency_code, value: unit.amount.value },
        custom_id: unit.custom_id,
        create_time: nowIso(),
        update_time: nowIso(),
      };
      order.status = 'COMPLETED';
      order.authorization_id = authorization.id;
      order.update_time = nowIso();
      this.authorizations.set(authorization.id, authorization);
      return {
        order: this.stamped(order),
        authorization: structuredClone(authorization),
      };
    },
    );
    return { order: value.order, authorization: value.authorization, replayed };
  }

  /* ---------------- Payments v2 ---------------- */

  captureAuthorization(
    authorizationId: string,
    input: ReplayCaptureInput,
    requestId?: string,
  ): { capture: ReplayCaptureRecord; replayed: boolean } {
    const { value, replayed } = this.dedupe(requestId, (): ReplayCaptureRecord => {
      const auth = this.authorizations.get(authorizationId);
      if (auth === undefined) {
        throw new Error(`replay: authorization not found: ${authorizationId}`);
      }
      // One-way server-side lock: CREATED -> CAPTURED | VOIDED, terminal.
      if (auth.status !== 'CREATED') {
        throw new AuthorizationStateConflictError(authorizationId, auth.status, 'CAPTURED');
      }
      if (input.invoice_id.length === 0 || input.invoice_id.length > 127) {
        throw new Error('replay: invoice_id must be 1..127 chars');
      }
      if (input.note_to_payer !== undefined && input.note_to_payer.length > 255) {
        throw new Error('replay: note_to_payer must be <= 255 chars');
      }
      this.captureSeq += 1;
      const capture: ReplayCaptureRecord = {
        id: `CAP-VP-${pad(this.captureSeq)}`,
        authorization_id: authorizationId,
        amount: input.amount ?? { ...auth.amount },
        invoice_id: input.invoice_id,
        final_capture: input.final_capture,
        note_to_payer: input.note_to_payer,
        create_time: nowIso(),
      };
      auth.status = 'CAPTURED';
      auth.capture_id = capture.id;
      auth.invoice_id = capture.invoice_id;
      auth.note_to_payer = capture.note_to_payer;
      auth.update_time = nowIso();
      this.captures.set(capture.id, capture);
      return structuredClone(capture);
    });
    return { capture: value, replayed };
  }

  voidAuthorization(authorizationId: string, requestId?: string): { replayed: boolean } {
    const { replayed } = this.dedupe(requestId, (): true => {
      const auth = this.authorizations.get(authorizationId);
      if (auth === undefined) {
        throw new Error(`replay: authorization not found: ${authorizationId}`);
      }
      if (auth.status !== 'CREATED') {
        throw new AuthorizationStateConflictError(authorizationId, auth.status, 'VOIDED');
      }
      auth.status = 'VOIDED';
      auth.update_time = nowIso();
      return true;
    });
    return { replayed };
  }

  getAuthorization(authorizationId: string): ReplayAuthorizationRecord {
    const auth = this.authorizations.get(authorizationId);
    if (auth === undefined) {
      throw new Error(`replay: authorization not found: ${authorizationId}`);
    }
    return structuredClone(auth);
  }

  /* ---------------- Disputes v1 ---------------- */

  listDisputes(): ReplayDisputeRecord[] {
    return [...this.disputes.values()].map((d) => structuredClone(d));
  }

  getDispute(disputeId: string): ReplayDisputeRecord {
    const d = this.disputes.get(disputeId);
    if (d === undefined) {
      throw new Error(`replay: dispute not found: ${disputeId}`);
    }
    return structuredClone(d);
  }

  private requireRel(d: ReplayDisputeRecord, rel: string): void {
    if (!d.links.some((l) => l.rel === rel)) {
      throw new DisputeActionNotPermittedByHateoasError(d.dispute_id, rel);
    }
  }

  private touch(d: ReplayDisputeRecord): ReplayDisputeRecord {
    d.update_time = nowIso();
    d.links = disputeLinksFor(d);
    return structuredClone(d);
  }

  requireDisputeEvidence(
    disputeId: string,
    action: 'BUYER_EVIDENCE' | 'SELLER_EVIDENCE',
  ): ReplayDisputeRecord {
    const d = this.disputes.get(disputeId);
    if (d === undefined) {
      throw new Error(`replay: dispute not found: ${disputeId}`);
    }
    this.requireRel(d, 'require-evidence');
    d.awaiting = action;
    d.dispute_state = 'REQUIRED_OTHER_PARTY_ACTION';
    return this.touch(d);
  }

  provideDisputeEvidence(
    disputeId: string,
    evidenceType: string,
    notes: string,
  ): ReplayDisputeRecord {
    const d = this.disputes.get(disputeId);
    if (d === undefined) {
      throw new Error(`replay: dispute not found: ${disputeId}`);
    }
    this.requireRel(d, 'provide-evidence');
    if (!EVIDENCE_TYPE_RE.test(evidenceType) || evidenceType.length > 255) {
      throw new Error('replay: evidence_type must match ^[0-9A-Z_]+$ and be <= 255 chars');
    }
    if (notes.length > 2000) {
      throw new Error('replay: evidence notes must be <= 2000 chars');
    }
    d.evidence.push({ evidence_type: evidenceType, notes, submitted_at: nowIso() });
    if (d.dispute_life_cycle_stage === 'INQUIRY') {
      d.dispute_state = 'UNDER_PAYPAL_REVIEW';
    } else {
      d.dispute_state = 'REQUIRED_ACTION';
      d.evidence_provided = true;
    }
    return this.touch(d);
  }

  escalateDispute(disputeId: string): ReplayDisputeRecord {
    const d = this.disputes.get(disputeId);
    if (d === undefined) {
      throw new Error(`replay: dispute not found: ${disputeId}`);
    }
    this.requireRel(d, 'escalate');
    d.dispute_life_cycle_stage = 'CHARGEBACK';
    d.dispute_state = 'REQUIRED_ACTION';
    d.awaiting = undefined;
    return this.touch(d);
  }

  acceptDisputeClaim(disputeId: string): ReplayDisputeRecord {
    const d = this.disputes.get(disputeId);
    if (d === undefined) {
      throw new Error(`replay: dispute not found: ${disputeId}`);
    }
    this.requireRel(d, 'accept-claim');
    d.status = 'RESOLVED';
    d.dispute_state = 'RESOLVED';
    d.outcome = 'BUYER_FAVOR';
    return this.touch(d);
  }

  adjudicateDispute(
    disputeId: string,
    outcome: 'BUYER_FAVOR' | 'SELLER_FAVOR',
  ): ReplayDisputeRecord {
    const d = this.disputes.get(disputeId);
    if (d === undefined) {
      throw new Error(`replay: dispute not found: ${disputeId}`);
    }
    this.requireRel(d, 'adjudicate');
    d.status = 'RESOLVED';
    d.dispute_state = 'RESOLVED';
    d.outcome = outcome;
    return this.touch(d);
  }

  /* ---------------- Webhooks ---------------- */

  verifyWebhookSignature(present: boolean): { verification_status: 'SUCCESS' | 'FAILURE' } {
    return { verification_status: present ? 'SUCCESS' : 'FAILURE' };
  }

  /** Engine stats for tests (e.g. asserting zero PayPal calls pre-checkout). */
  stats(): { orders: number; authorizations: number; captures: number } {
    return {
      orders: this.orders.size,
      authorizations: this.authorizations.size,
      captures: this.captures.size,
    };
  }
}

/** Factory for a fresh, independently-seeded replay engine. */
export function createSandboxReplayEngine(): SandboxReplayEngine {
  return new SandboxReplayEngine();
}
