/**
 * @veripact/workbench HTTP routes (agent 04).
 *
 * Single-process demo server: route groups keep Rule-2 key boundaries BY
 * CONSTRUCTION — each handler reads only its rung's env key via
 * `readRungKey` (buyer → /api/buyer/*, witness → /api/witness/*,
 * merchant+PayPal → /api/merchant/*). The bilateral demo routes
 * (/api/merchant/checkout, /api/merchant/disputes, /api/verify) are the
 * documented composition points: they sequence rungs so a judge can
 * complete a flow in one click (see README topology caption: logical
 * isolation packaged as one process for demo latency).
 *
 * Hardening (security-audit skill, guidance mode): strict security headers
 * on every response, 1MB request-body cap (RESOURCE-EXHAUSTION: bounded
 * buffering), JSON-only errors that never carry key material, and no
 * secret ever serialized into a response.
 */
import { readFileSync } from 'node:fs';
import {
  deriveEd25519KeyPairFromSeed,
  evaluateContestedDispute,
  signCanonicalPayload,
  verifyCanonicalPayload,
  type MandateSpec,
} from '@veripact/core';
import { createWitnessSnapshot } from '@veripact/witness-client';
import {
  createSandboxReplayEngine,
  DisputeActionNotPermittedByHateoasError,
  PayPalClient,
  type SandboxReplayEngine,
} from '@veripact/paypal-client';
import {
  buildDemoMandate,
  DEMO_BUYER_SEED,
  DEMO_CHANNEL3_CACHE,
  DEMO_MERCHANT_SEED,
  DEMO_WITNESS_SEED,
  defaultBenchmarkPaths,
  DISPUTE_CASE_NAMES,
  getScenario,
  runRegressionSuite,
  SCENARIO_NAMES,
  VeriPactClient,
  type DisputeCaseName,
  type ScenarioName,
} from '@veripact/sdk';
import { renderIndexPage } from './ui-template';
import { renderStorefront } from './storefront-template';

export const WORKBENCH_VERSION = '0.1.0';

/** Served routes. */
export const ROUTES = [
  '/health',
  '/',
  '/store/:scenarioId',
  '/api/buyer/mandate',
  '/api/witness/snapshot',
  '/api/merchant/checkout',
  '/api/merchant/disputes',
  '/api/merchant/disputes/resolve',
  '/api/merchant/disputes/action',
  '/api/verify',
  '/api/benchmark',
  '/api/demo/reset',
];

export interface HealthPayload {
  ok: boolean;
  service: string;
  transportMode: string;
  version: string;
}

/** Minimal body-stream surface (a subset of http.IncomingMessage). */
export interface WorkbenchBodyStream {
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

/** Minimal request surface (satisfied by http.IncomingMessage and test fakes). */
export interface WorkbenchRequest {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  /** Pre-read body (tests). The server fills this from the stream. */
  bodyText?: string;
  /** Stream surface of a live IncomingMessage (absent on test fakes). */
  on?: WorkbenchBodyStream['on'];
}

/** Minimal response surface (satisfied by http.ServerResponse and test fakes). */
export interface WorkbenchResponse {
  writeHead(code: number, headers: Record<string, string>): void;
  end(body: string): void;
}

/** Max request body: 1MB (bounded buffering per RESOURCE-EXHAUSTION). */
export const MAX_BODY_BYTES = 1_000_000;

/** Security headers applied to EVERY response. */
export function securityHeaders(contentType: string): Record<string, string> {
  return {
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  };
}

function sendJson(res: WorkbenchResponse, code: number, payload: unknown): void {
  res.writeHead(code, securityHeaders('application/json; charset=utf-8'));
  res.end(JSON.stringify(payload));
}

function sendHtml(res: WorkbenchResponse, code: number, html: string): void {
  res.writeHead(code, securityHeaders('text/html; charset=utf-8'));
  res.end(html);
}

/** HTTP error with a status code (message must never carry secrets). */
class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * Read the request body with a hard cap. Test fakes supply `bodyText`;
 * live requests stream with early abort past the cap.
 */
async function readBody(req: WorkbenchRequest): Promise<string> {
  if (typeof req.bodyText === 'string') {
    if (Buffer.byteLength(req.bodyText, 'utf8') > MAX_BODY_BYTES) {
      throw new HttpError(413, 'request body too large');
    }
    return req.bodyText;
  }
  if (typeof req.on !== 'function') {
    return '';
  }
  const on = req.on;
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (e: Error): void => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    };
    on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new HttpError(413, 'request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    on('error', (e: Error) => fail(e));
  });
}

function parseJsonBody(text: string): Record<string, unknown> {
  if (text.trim().length === 0) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, 'request body must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    if (e instanceof HttpError) {
      throw e;
    }
    throw new HttpError(400, 'invalid JSON body');
  }
}

/* ------------------------------------------------------------------ */
/* Route-level key isolation                                            */
/* ------------------------------------------------------------------ */

type Rung = 'buyer' | 'witness' | 'merchant';

/**
 * Read exactly one rung's private key: env var wins, deterministic demo
 * seed otherwise. Each route calls this ONLY for the rung(s) it needs —
 * grep the call sites to audit the isolation boundary.
 */
export function readRungKey(rung: Rung): {
  publicKeyHex: string;
  privateKeyHex: string;
  demoKeys: boolean;
} {
  const varName =
    rung === 'buyer'
      ? 'BUYER_ED25519_PRIVATE_KEY'
      : rung === 'witness'
        ? 'WITNESS_ED25519_PRIVATE_KEY'
        : 'MERCHANT_ED25519_PRIVATE_KEY';
  const fallback =
    rung === 'buyer' ? DEMO_BUYER_SEED : rung === 'witness' ? DEMO_WITNESS_SEED : DEMO_MERCHANT_SEED;
  const raw = process.env[varName];
  const seed = raw !== undefined && raw !== '' ? raw : fallback;
  if (!/^[0-9a-f]{64}$/.test(seed)) {
    throw new HttpError(500, `server key misconfigured for rung ${rung}`);
  }
  const pair = deriveEd25519KeyPairFromSeed(seed);
  return { publicKeyHex: pair.publicKeyHex, privateKeyHex: pair.privateKeyHex, demoKeys: seed === fallback };
}

/** Credential-aware PayPal mode label (no network calls). */
function paypalTransportMode(): string {
  const client = new PayPalClient({
    clientId: process.env['PAYPAL_CLIENT_ID'],
    clientSecret: process.env['PAYPAL_CLIENT_SECRET'],
  });
  return client.transportMode;
}

/* ------------------------------------------------------------------ */
/* Shared demo engine (replay state persists across requests)           */
/* ------------------------------------------------------------------ */

let sharedEngine: SandboxReplayEngine | null = null;

function hasPaypalCredentials(): boolean {
  return (
    (process.env['PAYPAL_CLIENT_ID'] ?? '') !== '' &&
    (process.env['PAYPAL_CLIENT_SECRET'] ?? '') !== ''
  );
}

/**
 * Shared replay engine for the demo desk: granular HATEOAS actions
 * (require → provide → escalate → adjudicate) must observe each other's
 * state across HTTP requests, which per-request engines cannot do. Live
 * mode returns undefined (PayPal itself holds the state). Tests reset via
 * `resetDemoState()` in `beforeEach` for isolation.
 */
function demoEngine(): SandboxReplayEngine | undefined {
  if (hasPaypalCredentials()) {
    return undefined;
  }
  if (sharedEngine === null) {
    sharedEngine = createSandboxReplayEngine();
  }
  return sharedEngine;
}

/** Reset shared replay state (tests + POST /api/demo/reset). */
export function resetDemoState(): void {
  sharedEngine?.reset();
}

/** Demo SDK client bound to the shared engine (replay) or live PayPal. */
function demoClient(): VeriPactClient {
  return new VeriPactClient({
    paypal: {
      clientId: process.env['PAYPAL_CLIENT_ID'],
      clientSecret: process.env['PAYPAL_CLIENT_SECRET'],
      replay: demoEngine(),
    },
  });
}

/** Demo PayPal client for granular dispute actions (same shared engine). */
function demoPayPal(): PayPalClient {
  return new PayPalClient({
    clientId: process.env['PAYPAL_CLIENT_ID'],
    clientSecret: process.env['PAYPAL_CLIENT_SECRET'],
    replay: demoEngine(),
  });
}

function asScenarioName(value: unknown): ScenarioName {
  if (typeof value === 'string' && (SCENARIO_NAMES as string[]).includes(value)) {
    return value as ScenarioName;
  }
  throw new HttpError(400, `unknown scenario (expected one of ${SCENARIO_NAMES.join(', ')})`);
}

function asDisputeCase(value: unknown): DisputeCaseName {
  if (typeof value === 'string' && (DISPUTE_CASE_NAMES as string[]).includes(value)) {
    return value as DisputeCaseName;
  }
  throw new HttpError(400, `unknown case (expected one of ${DISPUTE_CASE_NAMES.join(', ')})`);
}

/* ------------------------------------------------------------------ */
/* Handlers                                                             */
/* ------------------------------------------------------------------ */

function handleHealth(res: WorkbenchResponse): void {
  const payload: HealthPayload = {
    ok: true,
    service: 'veripact-workbench',
    transportMode: paypalTransportMode(),
    version: WORKBENCH_VERSION,
  };
  sendJson(res, 200, payload);
}

function handleStore(scenarioId: string, res: WorkbenchResponse): void {
  const scenario = asScenarioName(scenarioId);
  sendHtml(res, 200, renderStorefront(scenario));
}

function isMandateSpec(value: unknown): value is MandateSpec {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const m = value as Record<string, unknown>;
  return (
    typeof m['mandateId'] === 'string' &&
    typeof m['buyerPublicKeyHex'] === 'string' &&
    typeof m['buyerSignatureHex'] === 'string' &&
    m['constraints'] !== null &&
    typeof m['constraints'] === 'object'
  );
}

/**
 * POST /api/buyer/mandate — BUYER rung only. With `{ mandate }` verifies
 * the buyer signature; otherwise signs a fresh mandate from the provided
 * (or default) constraints. Never touches witness/merchant keys.
 */
function handleBuyerMandate(body: Record<string, unknown>, res: WorkbenchResponse): void {
  const buyer = readRungKey('buyer');
  if (body['mandate'] !== undefined) {
    if (!isMandateSpec(body['mandate'])) {
      throw new HttpError(400, 'mandate must be a MandateSpec object');
    }
    const mandate = body['mandate'];
    const unsigned = { ...mandate, buyerSignatureHex: '' };
    const valid = verifyCanonicalPayload(
      unsigned,
      mandate.buyerSignatureHex,
      mandate.buyerPublicKeyHex,
    );
    sendJson(res, 200, { valid, mandateId: mandate.mandateId, boundary: 'SELF' });
    return;
  }
  const base = buildDemoMandate(
    typeof body['itemQuery'] === 'string' ? body['itemQuery'] : '27-inch 4K IPS Monitor',
  );
  const constraints = (body['constraints'] ?? {}) as Record<string, unknown>;
  const mandate: MandateSpec = {
    ...base,
    mandateId: `mnd_${Date.now().toString(36)}`,
    createdAtUtc: new Date().toISOString(),
    constraints: {
      requiredCondition:
        typeof constraints['requiredCondition'] === 'string'
          ? constraints['requiredCondition']
          : base.constraints.requiredCondition,
      maxAllInPriceUsd:
        typeof constraints['maxAllInPriceUsd'] === 'number'
          ? constraints['maxAllInPriceUsd']
          : base.constraints.maxAllInPriceUsd,
      minReturnWindowDays:
        typeof constraints['minReturnWindowDays'] === 'number'
          ? constraints['minReturnWindowDays']
          : base.constraints.minReturnWindowDays,
      maxRestockingFeePct:
        typeof constraints['maxRestockingFeePct'] === 'number'
          ? constraints['maxRestockingFeePct']
          : base.constraints.maxRestockingFeePct,
    },
    buyerPublicKeyHex: buyer.publicKeyHex,
    buyerSignatureHex: '',
  };
  mandate.buyerSignatureHex = signCanonicalPayload(
    { ...mandate, buyerSignatureHex: '' },
    buyer.privateKeyHex,
  );
  sendJson(res, 200, { mandate, boundary: 'SELF', demoKeys: buyer.demoKeys });
}

/**
 * POST /api/witness/snapshot — WITNESS rung only. Snapshots a scenario
 * storefront (in-memory HTML, local TSA, demo Channel3 cache). Zero PayPal
 * calls. Never touches buyer/merchant keys.
 */
async function handleWitnessSnapshot(
  body: Record<string, unknown>,
  res: WorkbenchResponse,
): Promise<void> {
  const scenario = asScenarioName(body['scenario']);
  const witness = readRungKey('witness');
  const page = getScenario(scenario);
  const snapshot = await createWitnessSnapshot({
    listingUrl: page.listingUrl,
    mandate: page.mandate,
    witnessKeys: { publicKeyHex: witness.publicKeyHex, privateKeyHex: witness.privateKeyHex },
    htmlFetcher: () => Promise.resolve({ status: 200, html: page.html, tlsVerified: false }),
    requirePublicHttps: false,
    tsaMode: 'local',
    channel3Mode: 'cache',
    channel3Cache: DEMO_CHANNEL3_CACHE,
  });
  sendJson(res, 200, {
    scenario,
    boundary: 'WIT',
    demoKeys: witness.demoKeys,
    termReceipt: snapshot.termReceipt,
    receiptCore: snapshot.receiptCore,
    commitment: snapshot.commitment,
    witnessSignatureHex: snapshot.witnessSignatureHex,
    witnessPublicKeyHex: snapshot.witnessPublicKeyHex,
    provenance: snapshot.provenance,
    gateResult: snapshot.gateResult,
    oracleResult: snapshot.oracleResult,
    anchor: snapshot.anchor,
  });
}

/**
 * POST /api/merchant/checkout — documented composition point: runs the
 * full bilateral flow (needs all three rung keys + PayPal) so one click
 * completes checkout. Non-composition routes above stay single-rung.
 */
async function handleMerchantCheckout(
  body: Record<string, unknown>,
  res: WorkbenchResponse,
): Promise<void> {
  const scenario = asScenarioName(body['scenario']);
  const client = demoClient();
  const result = await client.runWitnessedCheckoutFlow({ scenario });
  sendJson(res, 200, { ...result, boundary: 'SIGN' });
}

/**
 * GET /api/merchant/disputes — Case B FIRST, then Case A, each with its
 * live HATEOAS record plus computed forensics (referee verdict, 3-way hash
 * comparison, provenance). Read-only: dispute state is never mutated here.
 */
async function handleMerchantDisputes(res: WorkbenchResponse): Promise<void> {
  const client = demoClient();
  const checkout = await client.runWitnessedCheckoutFlow({ scenario: 'normal' });
  if (checkout.outcome !== 'CAPTURED' || checkout.orderId === undefined) {
    throw new HttpError(500, 'baseline checkout did not capture');
  }
  const order = await client.paypal.getOrder(checkout.orderId);
  const core = checkout.snapshot.receiptCore;
  const witnessReceipt = {
    payload: core,
    signatureHex: checkout.snapshot.witnessSignatureHex,
    publicKeyHex: checkout.snapshot.witnessPublicKeyHex,
  };
  const buildCase = (kind: 'buyer_forgery' | 'merchant_drift') => {
    const mutated =
      kind === 'buyer_forgery'
        ? {
            ...core,
            observedTerms: {
              ...core.observedTerms,
              returnWindowDays: { status: 'DETERMINATE', value: 60 },
            },
          }
        : {
            ...core,
            observedTerms: {
              ...core.observedTerms,
              returnWindowDays: { status: 'DETERMINATE', value: 14 },
              restockingFeePct: { status: 'DETERMINATE', value: 25 },
            },
          };
    const buyerClaimReceipt =
      kind === 'buyer_forgery'
        ? {
            payload: mutated,
            signatureHex: signCanonicalPayload(mutated, client.keys.buyer.privateKeyHex),
            publicKeyHex: client.keys.buyer.publicKeyHex,
          }
        : {
            payload: core,
            signatureHex: signCanonicalPayload(core, client.keys.buyer.privateKeyHex),
            publicKeyHex: client.keys.buyer.publicKeyHex,
          };
    const sellerCounterClaimReceipt =
      kind === 'merchant_drift'
        ? {
            payload: mutated,
            signatureHex: signCanonicalPayload(mutated, client.keys.merchant.privateKeyHex),
            publicKeyHex: client.keys.merchant.publicKeyHex,
          }
        : witnessReceipt;
    return evaluateContestedDispute({
      paypalOrderCustomId: order.customId,
      witnessReceipt,
      buyerClaimReceipt,
      sellerCounterClaimReceipt,
    });
  };
  const caseB = await client.paypal.getDispute('PP-D-CASE-B-FORGERY');
  const caseA = await client.paypal.getDispute('PP-D-CASE-A-DRIFT');
  const forensicsB = buildCase('buyer_forgery');
  const forensicsA = buildCase('merchant_drift');
  sendJson(res, 200, {
    boundary: 'SIGN',
    orderId: checkout.orderId,
    customId: order.customId,
    transportMode: client.paypal.transportMode,
    demoKeys: client.keys.demoKeys,
    provenance: checkout.snapshot.provenance,
    disputes: [
      { case: 'buyer_forgery', record: caseB, forensics: forensicsB },
      { case: 'merchant_drift', record: caseA, forensics: forensicsA },
    ],
  });
}

/** POST /api/merchant/disputes/resolve — drive one case to RESOLVED. */
async function handleDisputeResolve(
  body: Record<string, unknown>,
  res: WorkbenchResponse,
): Promise<void> {
  const disputeCase = asDisputeCase(body['case']);
  const client = demoClient();
  const result = await client.auditAndResolveDispute({ case: disputeCase });
  sendJson(res, 200, { ...result, boundary: 'SIGN' });
}

/**
 * POST /api/verify — independent bundle verification plus the raw
 * `receiptCore` and live `custom_id` read-back the browser auditor needs.
 */
async function handleVerify(body: Record<string, unknown>, res: WorkbenchResponse): Promise<void> {
  const scenario = asScenarioName(body['scenario']);
  const client = demoClient();
  const checkout = await client.runWitnessedCheckoutFlow({ scenario });
  if (checkout.outcome !== 'CAPTURED' || checkout.orderId === undefined) {
    throw new HttpError(400, `nothing to verify: scenario ended ${checkout.outcome}`);
  }
  const bundle = await client.verifyCheckoutBundle(checkout);
  const order = await client.paypal.getOrder(checkout.orderId);
  sendJson(res, 200, {
    scenario,
    orderId: checkout.orderId,
    customId: order.customId,
    receiptCore: checkout.snapshot.receiptCore,
    witnessSignatureHex: checkout.snapshot.witnessSignatureHex,
    witnessPublicKeyHex: checkout.snapshot.witnessPublicKeyHex,
    anchor: checkout.snapshot.anchor,
    bundle,
    transportMode: checkout.transportMode,
    demoKeys: checkout.demoKeys,
  });
}

/**
 * POST /api/merchant/disputes/action — one granular HATEOAS-gated action.
 * Runs against the shared demo engine so multi-step chains persist across
 * requests. Gating is enforced inside paypal-client (rel must be advertised).
 */
async function handleDisputeAction(
  body: Record<string, unknown>,
  res: WorkbenchResponse,
): Promise<void> {
  const disputeId = body['disputeId'];
  const action = body['action'];
  if (typeof disputeId !== 'string' || disputeId.length === 0) {
    throw new HttpError(400, 'disputeId is required');
  }
  if (typeof action !== 'string') {
    throw new HttpError(400, 'action is required');
  }
  const paypal = demoPayPal();
  if (action === 'require-evidence') {
    const which = body['requireAction'];
    if (which !== 'BUYER_EVIDENCE' && which !== 'SELLER_EVIDENCE') {
      throw new HttpError(400, 'requireAction must be BUYER_EVIDENCE or SELLER_EVIDENCE');
    }
    sendJson(res, 200, { record: await paypal.requireDisputeEvidence(disputeId, which) });
    return;
  }
  if (action === 'provide-evidence') {
    if (typeof body['notes'] !== 'string' || body['notes'].length === 0) {
      throw new HttpError(400, 'notes are required for provide-evidence');
    }
    sendJson(res, 200, {
      record: await paypal.provideDisputeEvidence({
        disputeId,
        evidenceType: typeof body['evidenceType'] === 'string' ? body['evidenceType'] : 'OTHER',
        notes: body['notes'],
      }),
    });
    return;
  }
  if (action === 'escalate') {
    const note = typeof body['note'] === 'string' ? body['note'] : undefined;
    sendJson(res, 200, { record: await paypal.escalateDisputeToClaim(disputeId, note) });
    return;
  }
  if (action === 'accept-claim') {
    sendJson(res, 200, { record: await paypal.acceptDisputeClaim(disputeId) });
    return;
  }
  if (action === 'adjudicate') {
    const outcome = body['outcome'];
    if (outcome !== 'BUYER_FAVOR' && outcome !== 'SELLER_FAVOR') {
      throw new HttpError(400, 'outcome must be BUYER_FAVOR or SELLER_FAVOR');
    }
    sendJson(res, 200, { record: await paypal.adjudicateDisputeSandbox(disputeId, outcome) });
    return;
  }
  throw new HttpError(400, `unknown dispute action: ${action}`);
}

/** POST /api/demo/reset — re-seed shared replay state (replay only). */
function handleDemoReset(res: WorkbenchResponse): void {
  if (hasPaypalCredentials()) {
    throw new HttpError(400, 'demo reset is replay-only');
  }
  resetDemoState();
  sendJson(res, 200, { ok: true });
}

/** GET /api/benchmark — serve the committed 72-run report from disk. */
async function handleBenchmark(res: WorkbenchResponse): Promise<void> {
  const { reportPath } = defaultBenchmarkPaths();
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, unknown>;
    sendJson(res, 200, report);
    return;
  } catch {
    // Fall through to a live run when the committed file is missing.
  }
  const report = await runRegressionSuite();
  sendJson(res, 200, report);
}

/**
 * Route one request. Async (POST bodies + SDK flows); tests drive this
 * directly with `{ method, url, bodyText }` fakes — no sockets needed.
 */
export async function handleWorkbenchRequest(
  req: WorkbenchRequest,
  res: WorkbenchResponse,
): Promise<void> {
  try {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const method = (req.method ?? 'GET').toUpperCase();
    if (method === 'GET' && pathname === '/health') {
      handleHealth(res);
      return;
    }
    if (method === 'GET' && pathname === '/') {
      sendHtml(res, 200, renderIndexPage());
      return;
    }
    if (method === 'GET' && pathname.startsWith('/store/')) {
      handleStore(pathname.slice('/store/'.length), res);
      return;
    }
    if (method === 'GET' && pathname === '/api/merchant/disputes') {
      await handleMerchantDisputes(res);
      return;
    }
    if (method === 'GET' && pathname === '/api/benchmark') {
      await handleBenchmark(res);
      return;
    }
    if (method === 'POST' && pathname === '/api/buyer/mandate') {
      handleBuyerMandate(parseJsonBody(await readBody(req)), res);
      return;
    }
    if (method === 'POST' && pathname === '/api/witness/snapshot') {
      await handleWitnessSnapshot(parseJsonBody(await readBody(req)), res);
      return;
    }
    if (method === 'POST' && pathname === '/api/merchant/checkout') {
      await handleMerchantCheckout(parseJsonBody(await readBody(req)), res);
      return;
    }
    if (method === 'POST' && pathname === '/api/merchant/disputes/resolve') {
      await handleDisputeResolve(parseJsonBody(await readBody(req)), res);
      return;
    }
    if (method === 'POST' && pathname === '/api/merchant/disputes/action') {
      await handleDisputeAction(parseJsonBody(await readBody(req)), res);
      return;
    }
    if (method === 'POST' && pathname === '/api/demo/reset') {
      await readBody(req);
      handleDemoReset(res);
      return;
    }
    if (method === 'POST' && pathname === '/api/verify') {
      await handleVerify(parseJsonBody(await readBody(req)), res);
      return;
    }
    const knownPaths = [
      '/health',
      '/',
      '/api/merchant/disputes',
      '/api/benchmark',
      '/api/buyer/mandate',
      '/api/witness/snapshot',
      '/api/merchant/checkout',
      '/api/merchant/disputes/resolve',
      '/api/merchant/disputes/action',
      '/api/demo/reset',
      '/api/verify',
    ];
    if (knownPaths.includes(pathname) || pathname.startsWith('/store/')) {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    if (e instanceof HttpError) {
      sendJson(res, e.status, { error: e.message });
      return;
    }
    if (e instanceof DisputeActionNotPermittedByHateoasError) {
      sendJson(res, 409, { error: e.message });
      return;
    }
    sendJson(res, 500, { error: e instanceof Error ? e.message : 'internal error' });
  }
}
