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
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  deriveEd25519KeyPairFromSeed,
  evaluateContestedDispute,
  repoPath,
  sha256Hex,
  signCanonicalPayload,
  verifyCanonicalPayload,
  type MandateSpec,
} from '@veripact/core';
import { createWitnessSnapshot } from '@veripact/witness-client';
import {
  createSandboxReplayEngine,
  defaultEnvFilePath,
  DisputeActionNotPermittedByHateoasError,
  isPlaceholderCredential,
  PayPalClient,
  resolvePaypalCredentials,
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
  loadScenarios,
  resolveKeysLenient,
  runRegressionSuite,
  SCENARIO_NAMES,
  VeriPactClient,
  type DisputeCaseName,
  type PriorApprovalData,
  type ScenarioName,
} from '@veripact/sdk';
import { renderApprovalPage } from './approval-template';
import { renderIndexPage } from './ui-template';
import { renderStorefront } from './storefront-template';

export const WORKBENCH_VERSION = '0.1.0';

/** Served routes. */
export const ROUTES = [
  '/health',
  '/',
  '/favicon.ico',
  '/favicon.svg',
  '/store/:scenarioId',
  '/api/buyer/mandate',
  '/api/witness/snapshot',
  '/api/merchant/checkout',
  '/api/merchant/disputes',
  '/api/merchant/disputes/resolve',
  '/api/merchant/disputes/action',
  '/api/merchant/checkout/finalize',
  '/api/sandbox/approve-order',
  '/sandbox/paypal-checkout',
  '/api/verify',
  '/api/benchmark',
  '/api/system/status',
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
export function securityHeaders(
  contentType: string,
  frame: 'DENY' | 'SAMEORIGIN' = 'DENY',
): Record<string, string> {
  return {
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
    'x-frame-options': frame,
    'referrer-policy': 'no-referrer',
  };
}

function sendJson(res: WorkbenchResponse, code: number, payload: unknown): void {
  res.writeHead(code, securityHeaders('application/json; charset=utf-8'));
  res.end(JSON.stringify(payload));
}

function sendHtml(
  res: WorkbenchResponse,
  code: number,
  html: string,
  frame: 'DENY' | 'SAMEORIGIN' = 'DENY',
): void {
  res.writeHead(code, securityHeaders('text/html; charset=utf-8', frame));
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
 * grep the call sites to audit the isolation boundary. A missing, empty,
 * or malformed value warns and falls back to that rung's demo seed: the
 * demo server stays up on half-edited environments (the strict refusal
 * lives on in `resolveKeys` for SDK embedders).
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
    console.warn(
      `veripact: ignoring malformed ${varName} (expected 64 lowercase hex) — demo seed engaged`,
    );
    const pair = deriveEd25519KeyPairFromSeed(fallback);
    return { publicKeyHex: pair.publicKeyHex, privateKeyHex: pair.privateKeyHex, demoKeys: true };
  }
  const pair = deriveEd25519KeyPairFromSeed(seed);
  return { publicKeyHex: pair.publicKeyHex, privateKeyHex: pair.privateKeyHex, demoKeys: seed === fallback };
}

/** Credential-aware PayPal mode label (no network calls). */
function paypalTransportMode(): string {
  if (liveFallbackEngaged()) {
    return 'DETERMINISTIC_SANDBOX_REPLAY';
  }
  const client = new PayPalClient({
    clientId: scrubEnvCredential(process.env['PAYPAL_CLIENT_ID']),
    clientSecret: scrubEnvCredential(process.env['PAYPAL_CLIENT_SECRET']),
  });
  return client.transportMode;
}

/* ------------------------------------------------------------------ */
/* Live → replay fallback latch                                       */
/* ------------------------------------------------------------------ */

/**
 * SHA-256 of the credential pair that already failed live auth. While set
 * (and while the pair is unchanged) every route serves deterministic
 * replay instead of retrying a broken live mode on each click.
 */
let liveAuthFailedStamp: string | null = null;

function credentialStamp(): string {
  const resolved = resolvePaypalCredentials({});
  return sha256Hex(`${resolved.clientId}\n${resolved.clientSecret}`);
}

/**
 * True when the CURRENT credential pair already failed live auth. Fresh
 * credentials (or a demo reset) unlatch automatically and earn one new
 * live attempt.
 */
function liveFallbackEngaged(): boolean {
  if (liveAuthFailedStamp === null) {
    return false;
  }
  if (credentialStamp() !== liveAuthFailedStamp) {
    liveAuthFailedStamp = null;
    return false;
  }
  return true;
}

/** True when an error looks like PayPal auth (401) or transport failure. */
export function isLiveAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP 401|invalid_client|unauthorized|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|fetch failed|getaddrinfo|socket hang up|self[ -]signed|CERT_/i.test(
    message,
  );
}

/** Test hooks: drive and observe the fallback latch deterministically. */
export function noteLiveAuthFailure(): void {
  liveAuthFailedStamp = credentialStamp();
}

export function clearLiveAuthFailure(): void {
  liveAuthFailedStamp = null;
}

export function isLiveFallbackEngaged(): boolean {
  return liveFallbackEngaged();
}

/**
 * Run a PayPal-touching operation; on live-auth/transport failure, latch
 * replay mode and retry the whole operation once against the deterministic
 * engine. Non-auth errors (400s, referee mismatches, bugs) propagate.
 */
async function withLiveFallback<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (e) {
    if (liveFallbackEngaged() || !isLiveAuthFailure(e)) {
      throw e;
    }
    console.warn(
      `veripact: live PayPal auth failed (${e instanceof Error ? e.message : String(e).slice(0, 120)}) — retrying once in deterministic replay`,
    );
    noteLiveAuthFailure();
    return op();
  }
}

/* ------------------------------------------------------------------ */
/* Shared demo engine (replay state persists across requests)           */
/* ------------------------------------------------------------------ */

let sharedEngine: SandboxReplayEngine | null = null;

function hasPaypalCredentials(): boolean {
  // Latched replay (after a live-auth failure) reports no credentials so
  // the UI, the mode pill, and demo-reset all follow the fallback.
  if (liveFallbackEngaged()) {
    return false;
  }
  // Disk-aware (hot-swap): `.env` credentials count even before a restart.
  const resolved = resolvePaypalCredentials({});
  return resolved.clientId !== '' && resolved.clientSecret !== '';
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

/**
 * Step-1 evidence awaiting buyer approval (orderId → snapshot + signatures),
 * so finalize can complete without a re-witness even when the caller cannot
 * echo step-1 data back. Cleared on reset alongside the replay engine.
 */
const pendingApprovals = new Map<string, { scenario: ScenarioName } & PriorApprovalData>();

/**
 * Disk mirror of `pendingApprovals` (gitignored): a server restart mid-popup
 * must never lose an awaiting checkout. Best-effort I/O — a corrupt or
 * missing file falls through to re-witness, never to a 500. Holds witness
 * snapshots + signatures only (no keys, no PayPal secrets).
 */
const PENDING_FILE = repoPath('.veripact-pending.json');

function savePendingApprovals(): void {
  try {
    writeFileSync(PENDING_FILE, JSON.stringify(Object.fromEntries(pendingApprovals)));
  } catch {
    // Best-effort: the in-memory map remains the primary store.
  }
}

function loadPendingApproval(orderId: string): ({ scenario: ScenarioName } & PriorApprovalData) | undefined {
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(PENDING_FILE, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
  if (doc === null || typeof doc !== 'object') {
    return undefined;
  }
  const entry = (doc as Record<string, unknown>)[orderId];
  if (entry === null || typeof entry !== 'object') {
    return undefined;
  }
  const scenario = (entry as Record<string, unknown>)['scenario'];
  if (typeof scenario !== 'string' || !(SCENARIO_NAMES as string[]).includes(scenario)) {
    return undefined;
  }
  if (!isPriorApprovalData(entry)) {
    return undefined;
  }
  const restored = { scenario: scenario as ScenarioName, ...entry };
  pendingApprovals.set(orderId, restored);
  return restored;
}

/** Reset shared replay state + pending approvals (tests + POST /api/demo/reset). */
export function resetDemoState(): void {
  // Fresh engine instance (never a live-mode reset call): identical
  // observable state, zero dependence on the previous engine's mode.
  sharedEngine = createSandboxReplayEngine();
  pendingApprovals.clear();
  clearLiveAuthFailure();
  try {
    unlinkSync(PENDING_FILE);
  } catch {
    // Absent or unreadable file: nothing to clear, never a 500.
  }
}

/**
 * Test hook: drop the in-memory map while keeping the disk mirror, so tests
 * can prove finalize survives a simulated server restart mid-popup.
 */
export function clearPendingApprovalsMemory(): void {
  pendingApprovals.clear();
}

/**
 * Scrub a human-edited credential before it becomes an explicit option:
 * placeholders must never flip a client into live mode (explicit options
 * bypass the env-layer filter by design, so the workbench filters first).
 */
function scrubEnvCredential(value: string | undefined): string | undefined {
  if (value === undefined || value === '' || isPlaceholderCredential(value)) {
    return undefined;
  }
  return value;
}

/** Demo SDK client bound to the shared engine (replay) or live PayPal. */
function demoClient(): VeriPactClient {
  return new VeriPactClient({
    lenientKeys: true,
    paypal: {
      clientId: scrubEnvCredential(process.env['PAYPAL_CLIENT_ID']),
      clientSecret: scrubEnvCredential(process.env['PAYPAL_CLIENT_SECRET']),
      replay: demoEngine(),
      ...(liveFallbackEngaged() ? { mode: 'replay' as const } : {}),
    },
  });
}

/** Demo PayPal client for granular dispute actions (same shared engine). */
function demoPayPal(): PayPalClient {
  return new PayPalClient({
    clientId: scrubEnvCredential(process.env['PAYPAL_CLIENT_ID']),
    clientSecret: scrubEnvCredential(process.env['PAYPAL_CLIENT_SECRET']),
    replay: demoEngine(),
    ...(liveFallbackEngaged() ? { mode: 'replay' as const } : {}),
  });
}

function asScenarioName(value: unknown): ScenarioName {
  if (typeof value === 'string' && (SCENARIO_NAMES as string[]).includes(value)) {
    return value as ScenarioName;
  }
  throw new HttpError(400, `unknown scenario (expected one of ${SCENARIO_NAMES.join(', ')})`);
}

/**
 * Scenario selector for witness/checkout/verify bodies: accepts both
 * `scenario` and `scenarioId`, defaulting to `normal` when omitted so a
 * parameter-name mismatch degrades to the flagship demo, never a 400.
 * Explicit unknown values still 400.
 */
function asRequestScenario(body: Record<string, unknown>): ScenarioName {
  const value = body['scenario'] ?? body['scenarioId'];
  if (value === undefined || value === null) {
    return 'normal';
  }
  return asScenarioName(value);
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

/** Credential-readiness + suite metadata. Fingerprints of PUBLIC keys only. */
export interface SystemStatusPayload {
  transportMode: 'LIVE_PAYPAL_SANDBOX' | 'DETERMINISTIC_SANDBOX_REPLAY';
  hasPayPalCredentials: boolean;
  envFilePath: string;
  keyFingerprints: { buyer: string; witness: string; merchant: string };
  totalScenarios: number;
  regressionPassRate: string;
}

function fingerprint16(publicKeyHex: string): string {
  return sha256Hex(publicKeyHex).slice(0, 16);
}

function regressionPassRate(): string {
  try {
    const { reportPath } = defaultBenchmarkPaths();
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      overallPassRate?: { successes?: unknown; total?: unknown; rate?: unknown };
    };
    const pass = report.overallPassRate;
    if (
      typeof pass?.successes === 'number' &&
      typeof pass?.total === 'number' &&
      typeof pass?.rate === 'number'
    ) {
      return `${pass.successes}/${pass.total} (${Math.round(pass.rate * 100)}%)`;
    }
  } catch {
    // Missing/unreadable report: honest fallback, never a 500.
  }
  return 'unavailable';
}

/** GET /api/system/status — zero-key/BYOK readiness probe (no secrets). */
function handleSystemStatus(res: WorkbenchResponse): void {
  // Keys only: resolve leniently without touching PayPal at all, so this
  // readiness probe can never 500 on key or credential state.
  const keys = resolveKeysLenient();
  const mode = paypalTransportMode();
  let totalScenarios = 0;
  try {
    totalScenarios = loadScenarios().length;
  } catch {
    // Missing suite file: report 0 honestly, never a 500.
  }
  const payload: SystemStatusPayload = {
    transportMode: mode === 'LIVE_PAYPAL_SANDBOX' ? 'LIVE_PAYPAL_SANDBOX' : 'DETERMINISTIC_SANDBOX_REPLAY',
    hasPayPalCredentials: hasPaypalCredentials(),
    envFilePath: defaultEnvFilePath(),
    keyFingerprints: {
      buyer: fingerprint16(keys.buyer.publicKeyHex),
      witness: fingerprint16(keys.witness.publicKeyHex),
      merchant: fingerprint16(keys.merchant.publicKeyHex),
    },
    totalScenarios,
    regressionPassRate: regressionPassRate(),
  };
  sendJson(res, 200, payload);
}

/** Two-tone VeriPact V-check emblem (same geometry as the header logo). */
const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 26" fill="none">' +
  '<path d="M3 8l7.5 10" stroke="#182230" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M10.5 18L23 5" stroke="#175cd3" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>';

/** GET /favicon.ico + /favicon.svg — SVG emblem (kills the 404 console error). */
function handleFavicon(res: WorkbenchResponse): void {
  res.writeHead(200, {
    ...securityHeaders('image/svg+xml; charset=utf-8'),
    'cache-control': 'public, max-age=86400',
  });
  res.end(FAVICON_SVG);
}

async function handleStore(scenarioId: string, res: WorkbenchResponse): Promise<void> {
  const scenario = asScenarioName(scenarioId);
  // SAMEORIGIN: the workbench embeds this preview in its own iframe; every
  // other surface keeps DENY (the approval popup is never framed).
  sendHtml(res, 200, await renderStorefront(scenario), 'SAMEORIGIN');
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
  const scenario = asRequestScenario(body);
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
  const scenario = asRequestScenario(body);
  const client = demoClient();
  const result = await client.runWitnessedCheckoutFlow({
    scenario,
    twoStepApproval: body['twoStep'] === true,
  });
  if (
    result.outcome === 'AWAITING_BUYER_APPROVAL' &&
    result.orderId !== undefined &&
    result.buyerApprovalSignatureHex !== undefined &&
    result.merchantSignatureHex !== undefined
  ) {
    pendingApprovals.set(result.orderId, {
      scenario,
      snapshot: result.snapshot,
      buyerApprovalSignatureHex: result.buyerApprovalSignatureHex,
      merchantSignatureHex: result.merchantSignatureHex,
    });
    savePendingApprovals();
  }
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
  const scenario = asRequestScenario(body);
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
  if (typeof disputeId !== 'string' || !ORDER_TOKEN_RE.test(disputeId)) {
    // Token allowlist (mirrors orderId): disputeId is interpolated into live
    // PayPal URL paths, so `..`, `/`, and control chars are rejected here.
    throw new HttpError(400, 'disputeId must be a non-empty token (letters, digits, _ -)');
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

const ORDER_TOKEN_RE = /^[A-Za-z0-9_-]+$/;

function asOrderId(value: unknown): string {
  if (typeof value === 'string' && ORDER_TOKEN_RE.test(value)) {
    return value;
  }
  throw new HttpError(400, 'orderId must be a non-empty token (letters, digits, _ -)');
}

/**
 * GET /sandbox/paypal-checkout?token=<orderId> — replay buyer-approval
 * popup. Live mode 302-redirects to PayPal's own approve URL instead.
 */
async function handleSandboxCheckout(req: WorkbenchRequest, res: WorkbenchResponse): Promise<void> {
  const token = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token') ?? '';
  if (!ORDER_TOKEN_RE.test(token)) {
    res.writeHead(400, securityHeaders('text/html; charset=utf-8'));
    res.end(
      renderApprovalPage({
        orderId: 'invalid-token',
        orderStatus: 'UNKNOWN',
        description: '',
        itemTotalUsd: 0,
        shippingUsd: 0,
        taxUsd: 0,
        finalTotalUsd: 0,
        customId: '',
        transportMode: '',
        scenario: 'custom',
        alreadyApproved: false,
        error: 'Missing or malformed ?token=<orderId>.',
      }),
    );
    return;
  }
  const paypal = demoPayPal();
  let order;
  try {
    order = await paypal.getOrder(token);
  } catch {
    res.writeHead(404, securityHeaders('text/html; charset=utf-8'));
    res.end(
      renderApprovalPage({
        orderId: token,
        orderStatus: 'UNKNOWN',
        description: '',
        itemTotalUsd: 0,
        shippingUsd: 0,
        taxUsd: 0,
        finalTotalUsd: 0,
        customId: '',
        transportMode: paypal.transportMode,
        scenario: 'custom',
        alreadyApproved: false,
        error: `Order ${token} was not found on ${paypal.transportMode}.`,
      }),
    );
    return;
  }
  if (
    paypal.transportMode === 'LIVE_PAYPAL_SANDBOX' &&
    order.approveUrl !== undefined &&
    order.approveUrl.startsWith('https://')
  ) {
    res.writeHead(302, { ...securityHeaders('text/plain; charset=utf-8'), location: order.approveUrl });
    res.end('Continue to PayPal sandbox approval.');
    return;
  }
  sendHtml(res, 200, renderApprovalPage({
    orderId: order.orderId,
    orderStatus: order.status,
    description: order.description ?? 'VeriPact witnessed checkout',
    itemTotalUsd: order.amountBreakdown.itemTotalUsd,
    shippingUsd: order.amountBreakdown.shippingUsd,
    taxUsd: order.amountBreakdown.taxUsd,
    finalTotalUsd: order.amountBreakdown.totalUsd,
    customId: order.customId,
    transportMode: order.transportMode,
    scenario: 'custom',
    alreadyApproved: order.status !== 'CREATED',
  }));
}

/** POST /api/sandbox/approve-order — replay buyer approval (idempotent). */
async function handleSandboxApprove(
  body: Record<string, unknown>,
  res: WorkbenchResponse,
): Promise<void> {
  const orderId = asOrderId(body['orderId']);
  const paypal = demoPayPal();
  if (paypal.transportMode !== 'DETERMINISTIC_SANDBOX_REPLAY') {
    throw new HttpError(400, 'live orders approve at PayPal, not via the sandbox popup');
  }
  let order;
  try {
    order = await paypal.getOrder(orderId);
  } catch {
    throw new HttpError(404, `order not found: ${orderId}`);
  }
  if (order.status !== 'CREATED') {
    sendJson(res, 200, { ok: true, orderId, status: order.status, already: true });
    return;
  }
  paypal.simulatePayerApproval(orderId);
  sendJson(res, 200, { ok: true, orderId, status: 'APPROVED', already: false });
}

function isPriorApprovalData(value: unknown): value is PriorApprovalData {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const p = value as Record<string, unknown>;
  const snapshot = p['snapshot'] as Record<string, unknown> | undefined;
  return (
    snapshot !== null &&
    typeof snapshot === 'object' &&
    snapshot['receiptCore'] !== undefined &&
    typeof snapshot['commitment'] === 'string' &&
    typeof p['buyerApprovalSignatureHex'] === 'string' &&
    (p['buyerApprovalSignatureHex'] as string).length > 0 &&
    typeof p['merchantSignatureHex'] === 'string' &&
    (p['merchantSignatureHex'] as string).length > 0
  );
}

/** Append (or refresh by orderId) one entry in docs/sandbox-receipts.json. */
function appendSandboxReceipt(entry: Record<string, unknown>): void {
  const path = repoPath('docs', 'sandbox-receipts.json');
  let doc: { generatedAtUtc: string; transportMode: unknown; orders: unknown[]; notes?: string } = {
    generatedAtUtc: new Date().toISOString(),
    transportMode: entry['transportMode'] ?? 'UNKNOWN',
    orders: [],
  };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<typeof doc>;
    if (Array.isArray(parsed.orders)) {
      doc = { ...doc, ...parsed, orders: parsed.orders };
    }
  } catch {
    // Missing or corrupt file: start fresh below.
  }
  doc.orders = [
    ...doc.orders.filter(
      (o) => (o as { orderId?: string }).orderId !== (entry['orderId'] as string),
    ),
    entry,
  ];
  doc.generatedAtUtc = new Date().toISOString();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

/**
 * POST /api/merchant/checkout/finalize — step 2: authorize the approved
 * order, re-gate, capture/void, and refresh the receipts file. Prior
 * evidence resolves browser echo → server pending map → re-witness.
 */
async function handleCheckoutFinalize(
  body: Record<string, unknown>,
  res: WorkbenchResponse,
): Promise<void> {
  const orderId = asOrderId(body['orderId']);
  const scenarioName = body['scenario'] ?? body['scenarioId'];
  const scenario = asScenarioName(scenarioName);
  const echo = body['prior'];
  const pending = pendingApprovals.get(orderId) ?? loadPendingApproval(orderId);
  const prior: PriorApprovalData | undefined = isPriorApprovalData(echo)
    ? echo
    : pending !== undefined
      ? {
        snapshot: pending.snapshot,
        buyerApprovalSignatureHex: pending.buyerApprovalSignatureHex,
        merchantSignatureHex: pending.merchantSignatureHex,
      }
      : undefined;
  const client = demoClient();
  const result = await client.completeApprovedCheckout({ orderId, scenario, prior });
  pendingApprovals.delete(orderId);
  savePendingApprovals();
  let receiptsWarning: string | undefined;
  try {
    appendSandboxReceipt({
      scenario,
      orderId,
      authorizationId: result.authorizationId,
      captureId: result.captureId,
      voidStatus: result.outcome === 'AUTO_VOIDED' ? 'VOIDED' : undefined,
      customId: result.snapshot.commitment,
      finalTotalUsd: result.finalTotalUsd,
      transportMode: result.transportMode,
      finalizedAtUtc: new Date().toISOString(),
    });
  } catch (e) {
    receiptsWarning = e instanceof Error ? e.message : 'receipts update failed';
  }
  sendJson(res, 200, {
    ...result,
    boundary: 'SIGN',
    ...(receiptsWarning !== undefined ? { receiptsWarning } : {}),
  });
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
    if (method === 'GET' && (pathname === '/favicon.ico' || pathname === '/favicon.svg')) {
      handleFavicon(res);
      return;
    }
    if (method === 'GET' && pathname.startsWith('/store/')) {
      await handleStore(pathname.slice('/store/'.length), res);
      return;
    }
    if (method === 'GET' && pathname === '/api/merchant/disputes') {
      await withLiveFallback(() => handleMerchantDisputes(res));
      return;
    }
    if (method === 'GET' && pathname === '/api/benchmark') {
      await handleBenchmark(res);
      return;
    }
    if (method === 'GET' && pathname === '/api/system/status') {
      handleSystemStatus(res);
      return;
    }
    if (method === 'GET' && pathname === '/sandbox/paypal-checkout') {
      await withLiveFallback(() => handleSandboxCheckout(req, res));
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
      const body = parseJsonBody(await readBody(req));
      await withLiveFallback(() => handleMerchantCheckout(body, res));
      return;
    }
    if (method === 'POST' && pathname === '/api/merchant/disputes/resolve') {
      const body = parseJsonBody(await readBody(req));
      await withLiveFallback(() => handleDisputeResolve(body, res));
      return;
    }
    if (method === 'POST' && pathname === '/api/merchant/disputes/action') {
      const body = parseJsonBody(await readBody(req));
      await withLiveFallback(() => handleDisputeAction(body, res));
      return;
    }
    if (method === 'POST' && pathname === '/api/demo/reset') {
      await readBody(req);
      handleDemoReset(res);
      return;
    }
    if (method === 'POST' && pathname === '/api/sandbox/approve-order') {
      const body = parseJsonBody(await readBody(req));
      await withLiveFallback(() => handleSandboxApprove(body, res));
      return;
    }
    if (method === 'POST' && pathname === '/api/merchant/checkout/finalize') {
      const body = parseJsonBody(await readBody(req));
      await withLiveFallback(() => handleCheckoutFinalize(body, res));
      return;
    }
    if (method === 'POST' && pathname === '/api/verify') {
      const body = parseJsonBody(await readBody(req));
      await withLiveFallback(() => handleVerify(body, res));
      return;
    }
    const knownPaths = [
      '/health',
      '/',
      '/favicon.ico',
      '/favicon.svg',
      '/api/merchant/disputes',
      '/api/benchmark',
      '/api/buyer/mandate',
      '/api/witness/snapshot',
      '/api/merchant/checkout',
      '/api/merchant/disputes/resolve',
      '/api/merchant/disputes/action',
      '/api/merchant/checkout/finalize',
      '/api/sandbox/approve-order',
      '/sandbox/paypal-checkout',
      '/api/demo/reset',
      '/api/system/status',
      '/api/verify',
    ];
    if (knownPaths.includes(pathname) || pathname.startsWith('/store/')) {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.status >= 500) {
        logServerError(req, e);
      }
      sendJson(res, e.status, { error: e.message });
      return;
    }
    if (e instanceof DisputeActionNotPermittedByHateoasError) {
      sendJson(res, 409, { error: e.message });
      return;
    }
    logServerError(req, e);
    sendJson(res, 500, { error: e instanceof Error ? e.message : 'internal error' });
  }
}

/** Diagnostic stderr log for 5xx outcomes (message + short stack, never secrets). */
function logServerError(req: WorkbenchRequest, e: unknown): void {
  const path = (req.url ?? '/').split('?')[0];
  const message = e instanceof Error ? e.message : String(e);
  console.error(`veripact: ${req.method ?? '?'} ${path} failed: ${message}`);
  if (process.env['NODE_ENV'] !== 'production' && e instanceof Error && typeof e.stack === 'string') {
    console.error(
      e.stack
        .split('\n')
        .slice(0, 4)
        .join('\n'),
    );
  }
}
