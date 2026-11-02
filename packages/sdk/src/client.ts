/**
 * @veripact/sdk `VeriPactClient` — bilateral witnessed-checkout flows.
 *
 * Thin facade (agent 03): all domain logic lives in core / term-extractor /
 * witness-client / paypal-client; this file only sequences them. Zero-paid-
 * key operation: without env keys or PayPal credentials every flow runs
 * deterministically offline (demo Ed25519 seeds + `local` TSA + Channel3
 * demo cache + `DETERMINISTIC_SANDBOX_REPLAY`), and every result carries
 * `demoKeys` + `transportMode` labels so judges can see exactly what ran.
 *
 * Key boundaries (Rule 2): buyer/witness/merchant private keys are held in
 * three separate fields, never logged, and never cross into another rung's
 * signing call. Env keys always win over demo seeds; partial configuration
 * (some rungs env, some demo) is refused outright.
 */
import {
  canonicalizeJson,
  computeCommitment,
  deriveEd25519KeyPairFromSeed,
  evaluateContestedDispute,
  formatCommitmentPrefix,
  sha256Hex,
  signCanonicalPayload,
  verifyCanonicalPayload,
  type CaptureAddendum,
  type DisputeVerdict,
  type MandateSpec,
  type SignedReceipt,
} from '@veripact/core';
import { evaluatePostApprovalReGate, SufficiencyGate } from '@veripact/term-extractor';
import {
  createWitnessSnapshot,
  verifyTimestampAnchor,
  WitnessClient,
  type TimestampAnchor,
  type WitnessClientDeps,
  type WitnessSnapshotOutput,
} from '@veripact/witness-client';
import {
  PayPalClient,
  type PayPalClientOptions,
  type TransportMode,
} from '@veripact/paypal-client';
import {
  DEMO_BUYER_SEED,
  DEMO_CHANNEL3_CACHE,
  DEMO_MERCHANT_SEED,
  DEMO_WITNESS_SEED,
  getScenario,
  type ScenarioName,
  type StorefrontScenario,
} from './scenarios';

export { formatCommitmentPrefix, PayPalClient, SufficiencyGate, WitnessClient };
export type { PayPalClientOptions, WitnessClientDeps };
export type { WitnessSnapshotOutput } from '@veripact/witness-client';

/** SDK version (mirrors the workspace version). */
export const SDK_VERSION = '0.1.0';

/* ------------------------------------------------------------------ */
/* Key resolution                                                       */
/* ------------------------------------------------------------------ */

/** One rung's keypair (public + private hex). */
export interface RungKeys {
  publicKeyHex: string;
  privateKeyHex: string;
}

/** Explicit per-rung private keys (tests / embedders). Env vars otherwise. */
export interface ExplicitKeys {
  buyerPrivateKeyHex?: string;
  witnessPrivateKeyHex?: string;
  merchantPrivateKeyHex?: string;
}

/** Resolved keyset with an honest demo-keys label. */
export interface VeriPactKeys {
  buyer: RungKeys;
  witness: RungKeys;
  merchant: RungKeys;
  /** True only when all three rungs use deterministic demo seeds. */
  demoKeys: boolean;
}

const SEED_RE = /^[0-9a-f]{64}$/;

function keypairFromSeed(seedHex: string, rung: string): RungKeys {
  if (!SEED_RE.test(seedHex)) {
    throw new Error(`veripact: ${rung} private key must be 64 lowercase hex chars`);
  }
  const pair = deriveEd25519KeyPairFromSeed(seedHex);
  return { publicKeyHex: pair.publicKeyHex, privateKeyHex: pair.privateKeyHex };
}

/**
 * Resolve the three rung keys: explicit options first, then
 * `*_ED25519_PRIVATE_KEY` env vars, then deterministic demo seeds. Mixed
 * demo/env configuration is refused (fail closed, loudly).
 */
export function resolveKeys(explicit: ExplicitKeys = {}): VeriPactKeys {
  const buyerSeed = explicit.buyerPrivateKeyHex ?? process.env['BUYER_ED25519_PRIVATE_KEY'];
  const witnessSeed = explicit.witnessPrivateKeyHex ?? process.env['WITNESS_ED25519_PRIVATE_KEY'];
  const merchantSeed =
    explicit.merchantPrivateKeyHex ?? process.env['MERCHANT_ED25519_PRIVATE_KEY'];
  const provided = [buyerSeed, witnessSeed, merchantSeed].filter(
    (s) => s !== undefined && s !== '',
  ).length;
  if (provided !== 0 && provided !== 3) {
    throw new Error(
      'veripact: refusing partial key configuration — set all three rung keys or none (demo)',
    );
  }
  const demoKeys = provided === 0;
  return {
    buyer: keypairFromSeed(buyerSeed ?? DEMO_BUYER_SEED, 'buyer'),
    witness: keypairFromSeed(witnessSeed ?? DEMO_WITNESS_SEED, 'witness'),
    merchant: keypairFromSeed(merchantSeed ?? DEMO_MERCHANT_SEED, 'merchant'),
    demoKeys,
  };
}

function lenientRung(
  rung: 'buyer' | 'witness' | 'merchant',
  seed: string | undefined,
  fallback: string,
): { keys: RungKeys; demo: boolean } {
  if (seed !== undefined && seed !== '' && SEED_RE.test(seed)) {
    return { keys: keypairFromSeed(seed, rung), demo: false };
  }
  if (seed !== undefined && seed !== '') {
    console.warn(
      `veripact: ignoring malformed ${rung} private key (expected 64 lowercase hex) — demo seed engaged`,
    );
  }
  return { keys: keypairFromSeed(fallback, rung), demo: true };
}

/**
 * Lenient per-rung key resolution for the always-on demo server: missing,
 * empty, or malformed rung values warn and fall back to that rung's
 * deterministic demo seed instead of throwing. `demoKeys` stays honest
 * (true only when every rung is demo). Embedders keep strict
 * `resolveKeys`; only the workbench opts into leniency.
 */
export function resolveKeysLenient(explicit: ExplicitKeys = {}): VeriPactKeys {
  const buyer = lenientRung(
    'buyer',
    explicit.buyerPrivateKeyHex ?? process.env['BUYER_ED25519_PRIVATE_KEY'],
    DEMO_BUYER_SEED,
  );
  const witness = lenientRung(
    'witness',
    explicit.witnessPrivateKeyHex ?? process.env['WITNESS_ED25519_PRIVATE_KEY'],
    DEMO_WITNESS_SEED,
  );
  const merchant = lenientRung(
    'merchant',
    explicit.merchantPrivateKeyHex ?? process.env['MERCHANT_ED25519_PRIVATE_KEY'],
    DEMO_MERCHANT_SEED,
  );
  return {
    buyer: buyer.keys,
    witness: witness.keys,
    merchant: merchant.keys,
    demoKeys: buyer.demo && witness.demo && merchant.demo,
  };
}

/* ------------------------------------------------------------------ */
/* Witnessed checkout flow                                              */
/* ------------------------------------------------------------------ */

/** Checkout flow outcome. */
export type CheckoutOutcome =
  | 'BLOCKED_PRE_CHECKOUT'
  | 'AWAITING_BUYER_APPROVAL'
  | 'CAPTURED'
  | 'AUTO_VOIDED';

export interface CheckoutFlowInput {
  /** Canonical scenario (fixtures) — or custom page fields below. */
  scenario?: ScenarioName;
  listingUrl?: string;
  html?: string;
  mandate?: MandateSpec;
  /** Shipping/tax the PayPal callback resolves (scenario default). */
  callbackTotals?: { shippingUsd: number; taxUsd: number };
  /**
   * Two-step mode: stop after order create + PATCH with
   * `AWAITING_BUYER_APPROVAL` (no auto-approve, no authorize yet) and let
   * the buyer approve via `approveUrl`, then `completeApprovedCheckout`.
   * Default false (1-click auto-approve in replay). Live mode always
   * returns AWAITING while the order status is CREATED.
   */
  twoStepApproval?: boolean;
}

export interface CheckoutFlowResult {
  outcome: CheckoutOutcome;
  scenario: ScenarioName | 'custom';
  transportMode: TransportMode;
  demoKeys: boolean;
  snapshot: WitnessSnapshotOutput;
  /** Buyer countersignature over the witnessed core (pre-authorize ack). */
  buyerApprovalSignatureHex?: string;
  /** Merchant SIGN-rung countersignature over the witnessed core. */
  merchantSignatureHex?: string;
  orderId?: string;
  authorizationId?: string;
  captureId?: string;
  finalTotalUsd?: number;
  voidReason?: string;
  addendum?: CaptureAddendum;
  addendumSignatureHex?: string;
  /** Buyer-approval URL (AWAITING step; replay popup or live checkoutnow). */
  approveUrl?: string;
  /** Re-gate preview computed at AWAITING time (deterministic). */
  expectedPostApprovalAction?: 'CAPTURE' | 'VOID';
  headroomRemainingUsd?: number;
}

/** Prior step-1 evidence echoed back so step 2 needs no re-witness. */
export interface PriorApprovalData {
  snapshot: WitnessSnapshotOutput;
  buyerApprovalSignatureHex: string;
  merchantSignatureHex: string;
}

/** Input for `completeApprovedCheckout` (step 2 of two-step approval). */
export interface CompleteCheckoutInput {
  orderId: string;
  /** Canonical scenario (also accepted as `scenarioId`). */
  scenario?: ScenarioName;
  scenarioId?: string;
  /**
   * Replay only: run `simulatePayerApproval` before authorize (default
   * true). Set false when the popup already approved the order.
   */
  approveInReplay?: boolean;
  /** Step-1 evidence (browser echo or server pending map). */
  prior?: PriorApprovalData;
}

interface ResolvedCheckoutPage {
  scenario: ScenarioName | 'custom';
  listingUrl: string;
  html: string;
  mandate: MandateSpec;
  callbackTotals: { shippingUsd: number; taxUsd: number };
}

function resolvePage(input: CheckoutFlowInput): ResolvedCheckoutPage {
  if (input.scenario !== undefined) {
    const s: StorefrontScenario = getScenario(input.scenario);
    return {
      scenario: s.name,
      listingUrl: s.listingUrl,
      html: s.html,
      mandate: s.mandate,
      callbackTotals: input.callbackTotals ?? s.callbackTotals,
    };
  }
  if (input.listingUrl === undefined || input.html === undefined || input.mandate === undefined) {
    throw new Error('veripact: custom checkout requires listingUrl + html + mandate');
  }
  return {
    scenario: 'custom',
    listingUrl: input.listingUrl,
    html: input.html,
    mandate: input.mandate,
    callbackTotals: input.callbackTotals ?? { shippingUsd: 0, taxUsd: 0 },
  };
}

/* ------------------------------------------------------------------ */
/* Dispute audit                                                        */
/* ------------------------------------------------------------------ */

/** Canonical contested cases (seeded replay disputes). */
export type DisputeCaseName = 'buyer_forgery' | 'merchant_drift';

export const DISPUTE_CASE_NAMES: DisputeCaseName[] = ['buyer_forgery', 'merchant_drift'];

export function disputeIdForCase(disputeCase: DisputeCaseName): string {
  return disputeCase === 'buyer_forgery' ? 'PP-D-CASE-B-FORGERY' : 'PP-D-CASE-A-DRIFT';
}

export interface AuditDisputeInput {
  case: DisputeCaseName;
  disputeId?: string;
}

export interface AuditDisputeResult {
  case: DisputeCaseName;
  disputeId: string;
  orderId: string;
  verdict: DisputeVerdict;
  anchorTrusted: boolean;
  refereeReason: string;
  steps: string[];
  finalState: {
    status: string;
    disputeState: string;
    lifeCycleStage: string;
    outcome?: string;
    evidenceCount: number;
  };
  transportMode: TransportMode;
  demoKeys: boolean;
}

/**
 * Build the ≤2000-char forensic evidence note submitted as `OTHER`.
 * Carries the verdict, the PayPal-anchored commitment, and the exact
 * mismatch the referee found — no key material, no PII beyond the order id.
 */
export function buildForensicNotes(args: {
  caseName: DisputeCaseName;
  orderId: string;
  commitment: string;
  verdict: DisputeVerdict;
  refereeReason: string;
}): string {
  const lines = [
    `VeriPact forensic report — case ${args.caseName}`,
    `PayPal order: ${args.orderId}`,
    `Anchored commitment (order custom_id): ${args.commitment}`,
    `Referee verdict: ${args.verdict}`,
    `Reason: ${args.refereeReason}`,
    args.caseName === 'buyer_forgery'
      ? 'Finding: the buyer-submitted receipt hash does not match the PayPal-anchored WIT commitment (claimed 60-day returns vs witnessed 30-day). Recommend SELLER_FAVOR.'
      : 'Finding: the seller counter-claim diverges from the PayPal-anchored WIT commitment (claimed 14-day/25% vs witnessed 30-day free). Recommend BUYER_FAVOR.',
  ];
  const notes = lines.join('\n');
  if (notes.length > 2000) {
    throw new Error('veripact: forensic notes exceed 2000 chars');
  }
  return notes;
}

/* ------------------------------------------------------------------ */
/* Transaction bundle verification                                      */
/* ------------------------------------------------------------------ */

/** Everything needed to re-verify one witnessed checkout offline. */
export interface TransactionBundleInput {
  receiptCore: unknown;
  buyerPublicKeyHex: string;
  buyerSignatureHex: string;
  witnessPublicKeyHex: string;
  witnessSignatureHex: string;
  merchantPublicKeyHex: string;
  merchantSignatureHex: string;
  paypalOrderCustomId: string;
  anchor?: TimestampAnchor;
  orderCreateTimeIso?: string;
}

export interface TransactionBundleResult {
  commitment: string;
  customIdMatch: boolean;
  buyerSignatureValid: boolean;
  witnessSignatureValid: boolean;
  merchantSignatureValid: boolean;
  anchorChecked: boolean;
  anchorValid: boolean;
  anchorReason?: string;
  allValid: boolean;
}

/**
 * Re-verify a transaction bundle: recompute the commitment, exact-match it
 * against the PayPal order `custom_id`, verify all three Ed25519
 * signatures, and check the RFC 3161 anchor (±5 min skew) when provided.
 */
export function verifyTransactionBundle(input: TransactionBundleInput): TransactionBundleResult {
  const commitment = computeCommitment(input.receiptCore);
  const customIdMatch = commitment === input.paypalOrderCustomId;
  const buyerSignatureValid = verifyCanonicalPayload(
    input.receiptCore,
    input.buyerSignatureHex,
    input.buyerPublicKeyHex,
  );
  const witnessSignatureValid = verifyCanonicalPayload(
    input.receiptCore,
    input.witnessSignatureHex,
    input.witnessPublicKeyHex,
  );
  const merchantSignatureValid = verifyCanonicalPayload(
    input.receiptCore,
    input.merchantSignatureHex,
    input.merchantPublicKeyHex,
  );
  let anchorChecked = false;
  let anchorValid = false;
  let anchorReason: string | undefined;
  if (input.anchor !== undefined) {
    anchorChecked = true;
    const checked = verifyTimestampAnchor(input.anchor, commitment.slice(4), {
      orderCreateTimeIso: input.orderCreateTimeIso,
    });
    anchorValid = checked.valid;
    anchorReason = checked.reason;
  }
  const allValid =
    customIdMatch &&
    buyerSignatureValid &&
    witnessSignatureValid &&
    merchantSignatureValid &&
    (!anchorChecked || anchorValid);
  return {
    commitment,
    customIdMatch,
    buyerSignatureValid,
    witnessSignatureValid,
    merchantSignatureValid,
    anchorChecked,
    anchorValid,
    anchorReason,
    allValid,
  };
}

/* ------------------------------------------------------------------ */
/* Client                                                               */
/* ------------------------------------------------------------------ */

export interface VeriPactClientOptions {
  paypal?: PayPalClientOptions;
  witness?: WitnessClientDeps;
  keys?: ExplicitKeys;
  /**
   * Opt into per-rung demo fallback for missing/malformed keys (the
   * workbench demo server). Default false: strict `resolveKeys` still
   * refuses partial or malformed configuration loudly.
   */
  lenientKeys?: boolean;
}

/**
 * Stable facade: the sufficiency gate is always available, PayPal defaults
 * to credential-aware auto mode (replay when zero-key), and key material
 * resolves via `resolveKeys` (env wins, demo seeds otherwise).
 */
export class VeriPactClient {
  readonly version = SDK_VERSION;
  readonly gate = new SufficiencyGate();
  readonly paypal: PayPalClient;
  readonly witness: WitnessClient | null;
  readonly keys: VeriPactKeys;

  constructor(options: VeriPactClientOptions = {}) {
    this.keys =
      options.lenientKeys === true ? resolveKeysLenient(options.keys) : resolveKeys(options.keys);
    this.paypal = new PayPalClient(options.paypal ?? {});
    this.witness = options.witness ? new WitnessClient(options.witness) : null;
  }

  /** Format a `VP1:` commitment (throws on malformed digests). */
  formatCommitment(sha256Hex: string): string {
    return formatCommitmentPrefix(sha256Hex);
  }

  /** Witness-only snapshot for a scenario: zero PayPal calls by construction. */
  async witnessScenario(scenario: ScenarioName): Promise<{
    scenario: ScenarioName;
    demoKeys: boolean;
    snapshot: WitnessSnapshotOutput;
  }> {
    const page = getScenario(scenario);
    return {
      scenario: page.name,
      demoKeys: this.keys.demoKeys,
      snapshot: await this.snapshotPage(page.listingUrl, page.html, page.mandate),
    };
  }

  private async snapshotPage(
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
      // In-memory fixture HTML: no network fetch, and honestly no TLS
      // session (`tlsVerified: false` — see WitnessProvenance docs).
      htmlFetcher: () => Promise.resolve({ status: 200, html, tlsVerified: false }),
      requirePublicHttps: false,
      tsaMode: 'local',
      channel3Mode: 'cache',
      channel3Cache: DEMO_CHANNEL3_CACHE,
    });
  }

  /**
   * Full bilateral witnessed checkout: snapshot → gate → SIGN → AUTHORIZE →
   * patch → authorize → post-approval re-gate → CAPTURE | VOID.
   *
   * `BLOCK` returns before the first PayPal call. `ASK_HUMAN_DELTA`
   * (shipping/tax indeterminate pre-checkout) proceeds by design: the
   * callback resolves the delta and the re-gate enforces the mandate cap.
   */
  async runWitnessedCheckoutFlow(input: CheckoutFlowInput): Promise<CheckoutFlowResult> {
    const page = resolvePage(input);
    const snapshot = await this.snapshotPage(page.listingUrl, page.html, page.mandate);
    const base: CheckoutFlowResult = {
      outcome: 'BLOCKED_PRE_CHECKOUT',
      scenario: page.scenario,
      transportMode: this.paypal.transportMode,
      demoKeys: this.keys.demoKeys,
      snapshot,
    };
    if (snapshot.gateResult.decision === 'BLOCK') {
      return base;
    }
    const observed = snapshot.termReceipt.observedTerms;
    if (observed.basePriceUsd.status !== 'DETERMINATE' || observed.basePriceUsd.value === undefined) {
      throw new Error('veripact: gate passed without a determinate base price');
    }
    const basePriceUsd = observed.basePriceUsd.value;
    const title =
      observed.itemTitle.status === 'DETERMINATE' && observed.itemTitle.value !== undefined
        ? observed.itemTitle.value
        : page.mandate.itemQuery;
    // Pre-authorize acknowledgements over the witnessed core.
    const buyerApprovalSignatureHex = signCanonicalPayload(
      snapshot.receiptCore,
      this.keys.buyer.privateKeyHex,
    );
    const merchantSignatureHex = signCanonicalPayload(
      snapshot.receiptCore,
      this.keys.merchant.privateKeyHex,
    );
    const order = await this.paypal.createAuthorizeOrder({
      commitment: snapshot.commitment,
      description: `VeriPact witnessed checkout: ${title}`,
      itemTotalUsd: basePriceUsd,
    });
    const patched = await this.paypal.patchOrderShippingAndTax(order.orderId, {
      itemTotalUsd: basePriceUsd,
      shippingUsd: page.callbackTotals.shippingUsd,
      taxUsd: page.callbackTotals.taxUsd,
    });
    // Two-step gate: explicit flag, or live orders still awaiting approval.
    // Either way we return BEFORE approve/authorize with a deterministic
    // re-gate preview — never simulate approval on the live path.
    let liveCreated = false;
    if (this.paypal.transportMode === 'LIVE_PAYPAL_SANDBOX') {
      liveCreated = (await this.paypal.getOrder(order.orderId)).status === 'CREATED';
    }
    if (input.twoStepApproval === true || liveCreated) {
      const preview = evaluatePostApprovalReGate(page.mandate, snapshot.termReceipt, {
        itemTotalUsd: basePriceUsd,
        shippingUsd: page.callbackTotals.shippingUsd,
        taxUsd: page.callbackTotals.taxUsd,
        finalTotalUsd: patched.finalTotalUsd,
      });
      const approveUrl =
        order.approveUrl ?? (await this.paypal.getOrder(order.orderId)).approveUrl;
      return {
        ...base,
        outcome: 'AWAITING_BUYER_APPROVAL',
        buyerApprovalSignatureHex,
        merchantSignatureHex,
        orderId: order.orderId,
        approveUrl,
        finalTotalUsd: patched.finalTotalUsd,
        expectedPostApprovalAction: preview.action,
        headroomRemainingUsd: preview.headroomRemainingUsd,
      };
    }
    if (this.paypal.transportMode === 'DETERMINISTIC_SANDBOX_REPLAY') {
      this.paypal.simulatePayerApproval(order.orderId);
    }
    const authorized = await this.paypal.authorizeOrder(order.orderId);
    const authorizationId = authorized.authorizationId;
    if (authorizationId === undefined) {
      throw new Error(`veripact: authorize returned no authorization id (${order.orderId})`);
    }
    const regate = evaluatePostApprovalReGate(page.mandate, snapshot.termReceipt, {
      itemTotalUsd: basePriceUsd,
      shippingUsd: page.callbackTotals.shippingUsd,
      taxUsd: page.callbackTotals.taxUsd,
      finalTotalUsd: patched.finalTotalUsd,
    });
    if (regate.action === 'VOID') {
      await this.paypal.voidAuthorization({ authorizationId });
      return {
        ...base,
        outcome: 'AUTO_VOIDED',
        buyerApprovalSignatureHex,
        merchantSignatureHex,
        orderId: order.orderId,
        authorizationId,
        finalTotalUsd: patched.finalTotalUsd,
        voidReason: regate.reason,
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
    const addendumSignatureHex = signCanonicalPayload(addendum, this.keys.merchant.privateKeyHex);
    const capture = await this.paypal.captureAuthorizationExact({
      authorizationId,
      addendumSha256,
      amountUsd: patched.finalTotalUsd,
      noteToPayer: 'VeriPact Verified Capture',
    });
    return {
      ...base,
      outcome: 'CAPTURED',
      buyerApprovalSignatureHex,
      merchantSignatureHex,
      orderId: order.orderId,
      authorizationId,
      captureId: capture.captureId,
      finalTotalUsd: patched.finalTotalUsd,
      addendum,
      addendumSignatureHex,
    };
  }

  /**
   * Step 2 of two-step approval: authorize an already buyer-approved order,
   * re-gate, and capture or void. Replay callers can fold the approval in
   * (`approveInReplay`, default true); live callers approve at PayPal first.
   * Pass step-1 `prior` evidence (or let the workbench pending map supply
   * it) so the returned bundle verifies without a re-witness.
   */
  async completeApprovedCheckout(input: CompleteCheckoutInput): Promise<CheckoutFlowResult> {
    const scenarioName = input.scenario ?? input.scenarioId;
    if (scenarioName === undefined) {
      throw new Error('veripact: completeApprovedCheckout requires scenario (or scenarioId)');
    }
    const page = getScenario(scenarioName);
    const prior = input.prior;
    const snapshot = prior?.snapshot ?? (await this.snapshotPage(page.listingUrl, page.html, page.mandate));
    const buyerApprovalSignatureHex =
      prior?.buyerApprovalSignatureHex ??
      signCanonicalPayload(snapshot.receiptCore, this.keys.buyer.privateKeyHex);
    const merchantSignatureHex =
      prior?.merchantSignatureHex ??
      signCanonicalPayload(snapshot.receiptCore, this.keys.merchant.privateKeyHex);
    // Verify echoed step-1 evidence against the live order record BEFORE
    // authorizing: only the receipt bound into custom_id may complete.
    const precheck = await this.paypal.getOrder(input.orderId);
    if (
      prior !== undefined &&
      computeCommitment(prior.snapshot.receiptCore) !== precheck.customId
    ) {
      throw new Error('veripact: step-1 receipt does not match the order custom_id');
    }
    if (
      this.paypal.transportMode === 'DETERMINISTIC_SANDBOX_REPLAY' &&
      input.approveInReplay !== false
    ) {
      try {
        this.paypal.simulatePayerApproval(input.orderId);
      } catch (e) {
        // Already approved (e.g. via the popup) — proceed to authorize.
        if (!(e instanceof Error) || !e.message.includes('only CREATED orders can be approved')) {
          throw e;
        }
      }
    }
    const authorized = await this.paypal.authorizeOrder(input.orderId);
    const authorizationId = authorized.authorizationId;
    if (authorizationId === undefined) {
      throw new Error(`veripact: authorize returned no authorization id (${input.orderId})`);
    }
    // Re-gate from the patched order breakdown (source of truth).
    const order = await this.paypal.getOrder(input.orderId);
    const regate = evaluatePostApprovalReGate(page.mandate, snapshot.termReceipt, {
      itemTotalUsd: order.amountBreakdown.itemTotalUsd,
      shippingUsd: order.amountBreakdown.shippingUsd,
      taxUsd: order.amountBreakdown.taxUsd,
      finalTotalUsd: order.amountBreakdown.totalUsd,
    });
    const base: CheckoutFlowResult = {
      outcome: 'AUTO_VOIDED',
      scenario: page.name,
      transportMode: this.paypal.transportMode,
      demoKeys: this.keys.demoKeys,
      snapshot,
      buyerApprovalSignatureHex,
      merchantSignatureHex,
      orderId: input.orderId,
      authorizationId,
      finalTotalUsd: order.amountBreakdown.totalUsd,
    };
    if (regate.action === 'VOID') {
      await this.paypal.voidAuthorization({ authorizationId });
      return { ...base, voidReason: regate.reason };
    }
    const addendum: CaptureAddendum = {
      authorizationId,
      capturedTotalUsd: order.amountBreakdown.totalUsd,
      mandateCeilingUsd: page.mandate.constraints.maxAllInPriceUsd,
      decision: 'CAPTURE',
      decidedAtUtc: new Date().toISOString(),
    };
    const addendumSha256 = sha256Hex(canonicalizeJson(addendum));
    const addendumSignatureHex = signCanonicalPayload(addendum, this.keys.merchant.privateKeyHex);
    const capture = await this.paypal.captureAuthorizationExact({
      authorizationId,
      addendumSha256,
      amountUsd: order.amountBreakdown.totalUsd,
      noteToPayer: 'VeriPact Verified Capture',
    });
    return {
      ...base,
      outcome: 'CAPTURED',
      captureId: capture.captureId,
      addendum,
      addendumSignatureHex,
    };
  }

  /**
   * Self-contained contested-dispute audit: mints an authentic snapshot via
   * the `normal` checkout, reads back the order `custom_id`, forges (Case B)
   * or drifts (Case A) the disputed receipt, runs the core referee, and
   * drives the seeded dispute to RESOLVED through HATEOAS-gated actions.
   */
  async auditAndResolveDispute(input: AuditDisputeInput): Promise<AuditDisputeResult> {
    const disputeId = input.disputeId ?? disputeIdForCase(input.case);
    const checkout = await this.runWitnessedCheckoutFlow({ scenario: 'normal' });
    if (checkout.outcome !== 'CAPTURED' || checkout.orderId === undefined) {
      throw new Error('veripact: baseline normal checkout did not capture');
    }
    const order = await this.paypal.getOrder(checkout.orderId);
    const core = checkout.snapshot.receiptCore;
    const witnessReceipt: SignedReceipt = {
      payload: core,
      signatureHex: checkout.snapshot.witnessSignatureHex,
      publicKeyHex: checkout.snapshot.witnessPublicKeyHex,
    };
    let buyerClaimReceipt: SignedReceipt;
    let sellerCounterClaimReceipt: SignedReceipt;
    if (input.case === 'buyer_forgery') {
      // Buyer self-signs a tampered 60-day core: signature verifies, but the
      // hash cannot match the PayPal-anchored commitment.
      const forged = {
        ...core,
        observedTerms: {
          ...core.observedTerms,
          returnWindowDays: { status: 'DETERMINATE', value: 60 },
        },
      };
      buyerClaimReceipt = {
        payload: forged,
        signatureHex: signCanonicalPayload(forged, this.keys.buyer.privateKeyHex),
        publicKeyHex: this.keys.buyer.publicKeyHex,
      };
      sellerCounterClaimReceipt = witnessReceipt;
    } else {
      const authentic = core;
      buyerClaimReceipt = {
        payload: authentic,
        signatureHex: signCanonicalPayload(authentic, this.keys.buyer.privateKeyHex),
        publicKeyHex: this.keys.buyer.publicKeyHex,
      };
      // Seller asserts drifted 14-day / 25% terms (merchant-signed page state).
      const drifted = {
        ...core,
        observedTerms: {
          ...core.observedTerms,
          returnWindowDays: { status: 'DETERMINATE', value: 14 },
          restockingFeePct: { status: 'DETERMINATE', value: 25 },
        },
      };
      sellerCounterClaimReceipt = {
        payload: drifted,
        signatureHex: signCanonicalPayload(drifted, this.keys.merchant.privateKeyHex),
        publicKeyHex: this.keys.merchant.publicKeyHex,
      };
    }
    const referee = evaluateContestedDispute({
      paypalOrderCustomId: order.customId,
      witnessReceipt,
      buyerClaimReceipt,
      sellerCounterClaimReceipt,
    });
    const expected: DisputeVerdict =
      input.case === 'buyer_forgery' ? 'BUYER_FORGERY_DETECTED' : 'MERCHANT_DRIFT_CONFIRMED';
    if (referee.verdict !== expected) {
      throw new Error(
        `veripact: case ${input.case} produced unexpected verdict ${referee.verdict}`,
      );
    }
    const steps: string[] = [`referee verdict: ${referee.verdict} (${referee.reason})`];
    for (let i = 0; i < 8; i += 1) {
      const dispute = await this.paypal.getDispute(disputeId);
      if (dispute.status === 'RESOLVED') {
        break;
      }
      const allowed = dispute.allowedActions;
      if (referee.verdict === 'MERCHANT_DRIFT_CONFIRMED') {
        if (allowed.includes('accept-claim')) {
          await this.paypal.acceptDisputeClaim(disputeId);
          steps.push('accept-claim: seller conceded, buyer wins');
          break;
        }
        if (allowed.includes('escalate')) {
          await this.paypal.escalateDisputeToClaim(disputeId);
          steps.push('escalated INQUIRY → CHARGEBACK');
          continue;
        }
        if (allowed.includes('require-evidence')) {
          await this.paypal.requireDisputeEvidence(disputeId, 'BUYER_EVIDENCE');
          steps.push('require-evidence: BUYER_EVIDENCE');
          continue;
        }
        if (allowed.includes('provide-evidence')) {
          await this.paypal.provideDisputeEvidence({
            disputeId,
            evidenceType: 'OTHER',
            notes: buildForensicNotes({
              caseName: input.case,
              orderId: checkout.orderId,
              commitment: order.customId,
              verdict: referee.verdict,
              refereeReason: referee.reason,
            }),
          });
          steps.push('provide-evidence: buyer forensic report (OTHER)');
          continue;
        }
        if (allowed.includes('adjudicate')) {
          await this.paypal.adjudicateDisputeSandbox(disputeId, 'BUYER_FAVOR');
          steps.push('adjudicate: BUYER_FAVOR');
          break;
        }
      } else {
        // BUYER_FORGERY_DETECTED: the seller must never accept; submit the
        // forensic mismatch and drive to a seller-favor adjudication.
        if (allowed.includes('require-evidence')) {
          await this.paypal.requireDisputeEvidence(disputeId, 'SELLER_EVIDENCE');
          steps.push('require-evidence: SELLER_EVIDENCE');
          continue;
        }
        if (allowed.includes('provide-evidence')) {
          await this.paypal.provideDisputeEvidence({
            disputeId,
            evidenceType: 'OTHER',
            notes: buildForensicNotes({
              caseName: input.case,
              orderId: checkout.orderId,
              commitment: order.customId,
              verdict: referee.verdict,
              refereeReason: referee.reason,
            }),
          });
          steps.push('provide-evidence: seller forensic report (OTHER)');
          continue;
        }
        if (allowed.includes('escalate')) {
          await this.paypal.escalateDisputeToClaim(disputeId);
          steps.push('escalated INQUIRY → CHARGEBACK');
          continue;
        }
        if (allowed.includes('adjudicate')) {
          await this.paypal.adjudicateDisputeSandbox(disputeId, 'SELLER_FAVOR');
          steps.push('adjudicate: SELLER_FAVOR');
          break;
        }
        if (allowed.includes('accept-claim')) {
          throw new Error('veripact: refusing accept-claim on a forged buyer claim');
        }
      }
      throw new Error(
        `veripact: no drivable dispute action from [${allowed.join(', ')}]`,
      );
    }
    const final = await this.paypal.getDispute(disputeId);
    if (final.status !== 'RESOLVED') {
      throw new Error(`veripact: dispute ${disputeId} did not resolve (${final.disputeState})`);
    }
    return {
      case: input.case,
      disputeId,
      orderId: checkout.orderId,
      verdict: referee.verdict,
      anchorTrusted: referee.anchorTrusted,
      refereeReason: referee.reason,
      steps,
      finalState: {
        status: final.status,
        disputeState: final.disputeState,
        lifeCycleStage: final.lifeCycleStage,
        outcome: final.outcome,
        evidenceCount: final.evidenceCount,
      },
      transportMode: this.paypal.transportMode,
      demoKeys: this.keys.demoKeys,
    };
  }

  /**
   * Verify the bundle behind a completed checkout: recompute the commitment
   * from the witnessed core, exact-match the PayPal order `custom_id`, and
   * verify buyer/witness/merchant signatures plus the TSA anchor.
   */
  async verifyCheckoutBundle(checkout: CheckoutFlowResult): Promise<TransactionBundleResult> {
    if (checkout.outcome !== 'CAPTURED' || checkout.orderId === undefined) {
      throw new Error('veripact: only CAPTURED checkouts carry a verifiable bundle');
    }
    if (checkout.buyerApprovalSignatureHex === undefined || checkout.merchantSignatureHex === undefined) {
      throw new Error('veripact: checkout bundle is missing countersignatures');
    }
    const order = await this.paypal.getOrder(checkout.orderId);
    return verifyTransactionBundle({
      receiptCore: checkout.snapshot.receiptCore,
      buyerPublicKeyHex: this.keys.buyer.publicKeyHex,
      buyerSignatureHex: checkout.buyerApprovalSignatureHex,
      witnessPublicKeyHex: checkout.snapshot.witnessPublicKeyHex,
      witnessSignatureHex: checkout.snapshot.witnessSignatureHex,
      merchantPublicKeyHex: this.keys.merchant.publicKeyHex,
      merchantSignatureHex: checkout.merchantSignatureHex,
      paypalOrderCustomId: order.customId,
      anchor: checkout.snapshot.anchor,
      orderCreateTimeIso: order.createTimeIso,
    });
  }
}