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
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  canonicalizeJson,
  deriveEd25519KeyPairFromSeed,
  evaluateContestedDispute,
  repoPath,
  sha256Hex,
  signCanonicalPayload,
  verifyCanonicalPayload,
  type CaptureAddendum,
  type MandateSpec,
} from '@veripact/core';
import {
  createWitnessSnapshot,
  loadChannel3CacheFromDisk,
  verifyWithChannel3Oracle,
  type Channel3CatalogCache,
} from '@veripact/witness-client';
import {
  createSandboxReplayEngine,
  defaultEnvFilePath,
  DisputeActionNotPermittedByHateoasError,
  fetchAccessToken,
  isPlaceholderCredential,
  nodeHttpTransport,
  PayPalClient,
  PAYPAL_SANDBOX_BASE_URL,
  resolvePaypalCredentials,
  type SandboxReplayEngine,
} from '@veripact/paypal-client';
import {
  evaluatePostApprovalReGate,
  evaluateSufficiencyGate,
  extractObservedTerms,
  scanMerchantHtml,
} from '@veripact/term-extractor';
import {
  buildDemoMandate,
  buildForensicNotes,
  DEMO_BUYER_SEED,
  DEMO_CHANNEL3_CACHE,
  DEMO_MERCHANT_SEED,
  DEMO_WITNESS_SEED,
  defaultBenchmarkPaths,
  DISPUTE_CASE_NAMES,
  getScenario,
  loadScenarios,
  resetWalletState,
  resolveKeysLenient,
  runRegressionSuite,
  SCENARIO_NAMES,
  VeriPactClient,
  type CheckoutFlowResult,
  type DisputeCaseName,
  type PriorApprovalData,
  type ScenarioName,
} from '@veripact/sdk';
import { renderApprovalPage } from './approval-template';
import { buildOpenApiSpec } from './openapi-route';
import { handleWalletRequest, WALLET_ROUTES } from './wallet-routes';
import { renderIndexPage } from './ui-template';
import { findCatalogProduct, renderStorefront } from './storefront-template';

export const WORKBENCH_VERSION = '0.1.0';

/** Served routes. */
export const ROUTES = [
  '/health',
  '/',
  '/favicon.ico',
  '/favicon.svg',
  '/store/:scenarioId',
  '/api/catalog',
  '/api/buyer/mandate',
  '/api/buyer/mandate/update',
  '/api/witness/snapshot',
  '/api/witness/custom-html',
  '/api/merchant/checkout',
  '/api/merchant/disputes',
  '/api/merchant/disputes/resolve',
  '/api/merchant/disputes/action',
  '/api/merchant/disputes/create-from-order',
  '/api/system/credentials',
  '/api/ledger',
  '/vendor/ag-grid-community.min.js',
  '/vendor/ag-grid.min.css',
  '/vendor/ag-theme-quartz.min.css',
  '/api/merchant/checkout/finalize',
  '/api/sandbox/approve-order',
  '/sandbox/paypal-checkout',
  '/api/verify',
  '/api/benchmark',
  '/api/system/status',
  '/api/demo/reset',
  '/openapi.json',
  ...WALLET_ROUTES,
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

/** @internal Exported for the v5 wallet route module (same security headers). */
export function sendJson(res: WorkbenchResponse, code: number, payload: unknown): void {
  res.writeHead(code, securityHeaders('application/json; charset=utf-8'));
  res.end(JSON.stringify(payload));
}

/** @internal Exported for the v5 wallet route module (pairing ceremony page). */
export function sendHtml(
  res: WorkbenchResponse,
  code: number,
  html: string,
  frame: 'DENY' | 'SAMEORIGIN' = 'DENY',
): void {
  res.writeHead(code, securityHeaders('text/html; charset=utf-8', frame));
  res.end(html);
}

/** HTTP error with a status code (message must never carry secrets). */
export class HttpError extends Error {
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
/** @internal Exported for the v5 wallet route module (same 1MB cap). */
export async function readBody(req: WorkbenchRequest): Promise<string> {
  if (typeof req.bodyText === 'string') {
    if (Buffer.byteLength(req.bodyText, 'utf8') > MAX_BODY_BYTES) {
      throw new HttpError(413, 'request body too large');
    }
    return req.bodyText;
  }
  if (typeof req.on !== 'function') {
    return '';
  }
  const stream = req as WorkbenchRequest & { on: WorkbenchBodyStream['on'] };
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
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new HttpError(413, 'request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    stream.on('error', (e: Error) => fail(e));
  });
}

/** @internal Exported for the v5 wallet route module (same object-only rule). */
export function parseJsonBody(text: string): Record<string, unknown> {
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
  if (forceReplay || liveFallbackEngaged()) {
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

/** True when an error looks like PayPal auth (401/403) or transport failure. */
export function isLiveAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP 40[13]|invalid_client|unauthorized|NOT_AUTHORIZED|insufficient permissions|ENOTFOUND|EAI_AGAIN|EAI_FAIL|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|EHOSTDOWN|ENETUNREACH|ENETDOWN|EPIPE|EACCES|EPERM|fetch failed|getaddrinfo|socket hang up|timed? ?out|self[ -]signed|CERT_|proxy|CONNECT/i.test(
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
/** @internal Exported for the v5 wallet route module (hybrid harmony). */
export async function withLiveFallback<T>(op: () => Promise<T>): Promise<T> {
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
  if (forceReplay || liveFallbackEngaged()) {
    return false;
  }
  // Disk-aware (hot-swap): `.env` credentials count even before a restart.
  const resolved = resolvePaypalCredentials({});
  return resolved.clientId !== '' && resolved.clientSecret !== '';
}

/**
 * Shared deterministic engine for the demo desk: granular HATEOAS actions
 * (require → provide → escalate → adjudicate) must observe each other's
 * state across HTTP requests, which per-request engines cannot do. This
 * engine is ALWAYS available — even with live PayPal credentials on disk —
 * because the contested-dispute desk is a local simulation surface (PayPal
 * exposes no file-dispute API): filings from live-minted orders anchor to
 * their real orderId + VP1 commitment here and every record stays labeled
 * DETERMINISTIC_SANDBOX_REPLAY (Rule 3). Tests reset via `resetDemoState()`
 * in `beforeEach` for isolation.
 */
function demoEngine(): SandboxReplayEngine {
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
  sessionMandate = null;
  forceReplay = false;
  capturedOrders.clear();
  liveDisputes.clear();
  liveDisputeSeq = 0;
  ledger.length = 0;
  // v5 wallet store (pairings, partitions, orders, connectors) resets with
  // the demo so E2E and tests always start from a fresh wallet.
  resetWalletState();
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

/* ------------------------------------------------------------------ */
/* End-to-end session state (View 1 → View 2 production pipeline)      */
/* ------------------------------------------------------------------ */

/**
 * Buyer-global mandate override from POST /api/buyer/mandate/update
 * (signed with the buyer rung key). Null = fixture mandates. Applies to
 * every scenario: one buyer mandate is checked against any listing.
 */
let sessionMandate: MandateSpec | null = null;

/** In-memory force-replay switch (creds modal "use replay" — never touches .env). */
let forceReplay = false;

/** Mandate actually gated under: session override wins over the fixture. */
function effectiveMandate(scenario: ScenarioName): MandateSpec {
  return sessionMandate ?? getScenario(scenario).mandate;
}

/**
 * Captured-order evidence (orderId → receipt core + anchor). Recorded on
 * every CAPTURED outcome (1-click and finalize) so post-purchase dispute
 * filing anchors to the EXACT commitment bound into custom_id. Holds
 * receipts and signatures only — no keys, no PayPal secrets.
 */
interface CaptureContext {
  orderId: string;
  scenario: ScenarioName;
  receiptCore: Record<string, unknown>;
  commitment: string;
  witnessSignatureHex: string;
  witnessPublicKeyHex: string;
  provenance: Record<string, unknown>;
  captureId: string;
  finalTotalUsd: number;
  transportMode: string;
  capturedAtUtc: string;
}

const capturedOrders = new Map<string, CaptureContext>();

/** Live disputes filed from captured orders (case key → filing record). */
interface LiveDisputeEntry {
  caseKey: string;
  disputeId: string;
  orderId: string;
  kind: 'drift' | 'forgery';
  filedAtUtc: string;
}

const liveDisputes = new Map<string, LiveDisputeEntry>();
let liveDisputeSeq = 0;

/** Append-only cryptographic clearing ledger (one entry per state change). */
export interface LedgerEntry {
  seq: number;
  tsUtc: string;
  kind: string;
  summary: string;
  orderId?: string;
  disputeId?: string;
  commitment?: string;
}

const ledger: LedgerEntry[] = [];

/** @internal Exported for the v5 wallet route module (witness-signed export). */
export function appendLedger(entry: Omit<LedgerEntry, 'seq' | 'tsUtc'>): LedgerEntry {
  const row: LedgerEntry = {
    seq: ledger.length + 1,
    tsUtc: new Date().toISOString(),
    ...entry,
  };
  ledger.push(row);
  return row;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * Record a CAPTURED outcome's evidence so post-purchase dispute filing can
 * anchor to the exact commitment bound into the order's custom_id.
 */
function recordCapture(result: CheckoutFlowResult, scenario: ScenarioName): void {
  if (
    result.outcome !== 'CAPTURED' ||
    result.orderId === undefined ||
    result.captureId === undefined ||
    result.finalTotalUsd === undefined
  ) {
    return;
  }
  capturedOrders.set(result.orderId, {
    orderId: result.orderId,
    scenario,
    receiptCore: asRecord(result.snapshot.receiptCore),
    commitment: result.snapshot.commitment,
    witnessSignatureHex: result.snapshot.witnessSignatureHex,
    witnessPublicKeyHex: result.snapshot.witnessPublicKeyHex,
    provenance: asRecord(result.snapshot.provenance),
    captureId: result.captureId,
    finalTotalUsd: result.finalTotalUsd,
    transportMode: result.transportMode,
    capturedAtUtc: new Date().toISOString(),
  });
  appendLedger({
    kind: 'checkout-capture',
    summary: `${scenario} captured $${result.finalTotalUsd.toFixed(2)} (${result.orderId})`,
    orderId: result.orderId,
    commitment: result.snapshot.commitment,
  });
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

/** Per-request PayPal execution override for hybrid live/replay harmony. */
export type ExecutionMode = 'replay' | 'live' | 'auto';

/**
 * Parse `executionMode` from a request body (default `auto` = legacy
 * credential-aware routing). `replay` forces the fast deterministic engine
 * without touching `.env`; `live` forces the real PayPal Sandbox.
 */
/** @internal Exported for the v5 wallet route module (hybrid harmony). */
export function parseExecutionMode(body: Record<string, unknown>): ExecutionMode {
  const mode = body['executionMode'];
  if (mode === undefined) {
    return 'auto';
  }
  if (mode === 'replay' || mode === 'live' || mode === 'auto') {
    return mode;
  }
  throw new HttpError(400, "executionMode must be 'replay', 'live', or 'auto'");
}

/** True when the caller explicitly forced live execution (never falls back). */
function isExplicitLive(body: Record<string, unknown>): boolean {
  return body['executionMode'] === 'live';
}

/**
 * Build PayPal options for one execution mode. `replay` always binds the
 * shared deterministic engine (even with live credentials on disk) so
 * per-request replay checkouts share dispute/order state with the desk.
 * `live` without credentials is an honest 400, never a silent replay.
 */
function paypalOptionsFor(mode: ExecutionMode): {
  clientId: string | undefined;
  clientSecret: string | undefined;
  replay: SandboxReplayEngine;
  mode: 'replay' | 'live';
} | {
  clientId: string | undefined;
  clientSecret: string | undefined;
  replay: SandboxReplayEngine;
} {
  const base = {
    clientId: scrubEnvCredential(process.env['PAYPAL_CLIENT_ID']),
    clientSecret: scrubEnvCredential(process.env['PAYPAL_CLIENT_SECRET']),
    replay: demoEngine(),
  };
  if (mode === 'replay' || (mode === 'auto' && (forceReplay || liveFallbackEngaged()))) {
    return { ...base, mode: 'replay' as const };
  }
  if (mode === 'live') {
    if (base.clientId === undefined || base.clientSecret === undefined) {
      throw new HttpError(
        400,
        'live execution requires PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET in .env',
      );
    }
    return { ...base, mode: 'live' as const };
  }
  return base;
}

/** Demo SDK client for one execution mode (keys are mode-independent). */
/** @internal Exported for the v5 wallet route module (same shared engine). */
export function demoClientFor(mode: ExecutionMode): VeriPactClient {
  return new VeriPactClient({ lenientKeys: true, paypal: paypalOptionsFor(mode) });
}

/** Demo PayPal client for one execution mode (same shared engine). */
function demoPayPalFor(mode: ExecutionMode): PayPalClient {
  return new PayPalClient(paypalOptionsFor(mode));
}

/** Demo PayPal client for granular dispute actions (same shared engine). */
function demoPayPal(): PayPalClient {
  return demoPayPalFor('auto');
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

function asCredentialField(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    value === '' ||
    value.length > 512 ||
    /[\r\n\0]/.test(value)
  ) {
    throw new HttpError(400, `${field} must be a single-line string (1..512 chars)`);
  }
  if (isPlaceholderCredential(value)) {
    throw new HttpError(400, `${field} looks like a placeholder — paste real sandbox credentials`);
  }
  return value;
}

/**
 * Upsert the PayPal pair into the `.env` file, preserving every other
 * line (SANDBOX_URL, comments, …). Test-hermetic via VERIPACT_ENV_FILE.
 */
function upsertEnvCredentials(envPath: string, clientId: string, clientSecret: string): void {
  let lines: string[] = [];
  try {
    lines = readFileSync(envPath, 'utf8').split('\n');
  } catch {
    lines = [];
  }
  const kept = lines.filter((l) => !/^\s*(?:export\s+)?PAYPAL_CLIENT_(ID|SECRET)\s*=/.test(l));
  while (kept.length > 0 && (kept[kept.length - 1] as string).trim() === '') {
    kept.pop();
  }
  kept.push(`PAYPAL_CLIENT_ID=${clientId}`, `PAYPAL_CLIENT_SECRET=${clientSecret}`, '');
  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, kept.join('\n'), 'utf8');
}

/**
 * POST /api/system/credentials — persist sandbox credentials to `.env`
 * and verify OAuth immediately (short timeout). Unreachable/invalid
 * credentials latch the honest replay fallback instead of 500ing. With
 * `{ replay: true }` forces in-memory replay WITHOUT touching `.env`.
 * Responses never contain secret material (Rule 3).
 */
async function handleSystemCredentials(
  body: Record<string, unknown>,
  res: WorkbenchResponse,
): Promise<void> {
  if (body['replay'] === true) {
    forceReplay = true;
    appendLedger({
      kind: 'credentials-replay',
      summary: 'operator forced deterministic replay (in-memory, .env untouched)',
    });
    sendJson(res, 200, {
      mode: 'DETERMINISTIC_SANDBOX_REPLAY',
      verified: false,
      forced: true,
      boundary: 'SIGN',
    });
    return;
  }
  const clientId = asCredentialField(body['clientId'], 'clientId');
  const clientSecret = asCredentialField(body['clientSecret'], 'clientSecret');
  const envPath = defaultEnvFilePath();
  try {
    upsertEnvCredentials(envPath, clientId, clientSecret);
  } catch {
    throw new HttpError(500, `could not persist credentials to ${envPath}`);
  }
  forceReplay = false;
  clearLiveAuthFailure();
  const timeoutRaw = body['timeoutMs'];
  const timeoutMs =
    typeof timeoutRaw === 'number' && Number.isFinite(timeoutRaw)
      ? Math.min(Math.max(Math.floor(timeoutRaw), 50), 30000)
      : 8000;
  const scrub = (text: string): string =>
    text.split(clientId).join('<redacted>').split(clientSecret).join('<redacted>').slice(0, 300);
  try {
    const token = await fetchAccessToken({
      transport: nodeHttpTransport,
      baseUrl: PAYPAL_SANDBOX_BASE_URL,
      clientId,
      clientSecret,
      timeoutMs,
    });
    appendLedger({ kind: 'credentials-live', summary: 'sandbox credentials verified (OAuth) — live mode' });
    sendJson(res, 200, {
      mode: 'LIVE_PAYPAL_SANDBOX',
      verified: true,
      expiresInSec: token.expiresInSec,
      envFilePath: envPath,
      boundary: 'SIGN',
    });
  } catch (e) {
    const detail = scrub(e instanceof Error ? e.message : String(e));
    if (isLiveAuthFailure(e)) {
      noteLiveAuthFailure();
      appendLedger({
        kind: 'credentials-fallback',
        summary: `live OAuth failed (${detail}) — replay fallback latched`,
      });
      sendJson(res, 200, {
        mode: 'DETERMINISTIC_SANDBOX_REPLAY',
        verified: false,
        fallback: true,
        error: detail,
        envFilePath: envPath,
        boundary: 'SIGN',
      });
      return;
    }
    appendLedger({ kind: 'credentials-error', summary: `credential verify error (${detail})` });
    sendJson(res, 200, {
      mode: paypalTransportMode(),
      verified: false,
      error: detail,
      envFilePath: envPath,
      boundary: 'SIGN',
    });
  }
}

/** GET /api/ledger — the session clearing ledger, signed by the witness key. */
function handleLedger(res: WorkbenchResponse): void {
  const witness = readRungKey('witness');
  const payload = { entries: ledger, exportedAtUtc: new Date().toISOString() };
  sendJson(res, 200, {
    ...payload,
    witnessSignatureHex: signCanonicalPayload(payload, witness.privateKeyHex),
    witnessPublicKeyHex: witness.publicKeyHex,
  });
}

/**
 * Same-origin vendor assets (real AG Grid, zero CDN): served from the
 * installed `ag-grid-community` package. If the package is absent the
 * routes still return 200 with an honest stub so the page never 404s and
 * the native fallback grid engages.
 */
interface VendorSpec {
  segments: string[];
  contentType: string;
  fallback: string;
}

const VENDOR_FILES: Record<string, VendorSpec> = {
  '/vendor/ag-grid-community.min.js': {
    segments: ['node_modules', 'ag-grid-community', 'dist', 'ag-grid-community.min.js'],
    contentType: 'application/javascript; charset=utf-8',
    fallback:
      '/* veripact: ag-grid-community not installed — native fallback grid engaged */\nwindow.__vpGridMissing=true;\n',
  },
  '/vendor/ag-grid.min.css': {
    segments: ['node_modules', 'ag-grid-community', 'styles', 'ag-grid.min.css'],
    contentType: 'text/css; charset=utf-8',
    fallback: '/* veripact: grid css fallback (native engine) */\n',
  },
  '/vendor/ag-theme-quartz.min.css': {
    segments: ['node_modules', 'ag-grid-community', 'styles', 'ag-theme-quartz.min.css'],
    contentType: 'text/css; charset=utf-8',
    fallback: '/* veripact: grid theme fallback (native engine) */\n',
  },
};

function handleVendor(pathname: string, res: WorkbenchResponse): void {
  const spec: VendorSpec | undefined = VENDOR_FILES[pathname];
  if (spec === undefined) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  let body = spec.fallback;
  try {
    const path = repoPath(...spec.segments);
    if (existsSync(path)) {
      body = readFileSync(path, 'utf8');
    }
  } catch {
    // Unreadable install: honest stub, never a 500.
  }
  res.writeHead(200, {
    ...securityHeaders(spec.contentType),
    'cache-control': 'public, max-age=3600',
  });
  res.end(body);
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

async function handleStore(
  scenarioId: string,
  sku: string | undefined,
  res: WorkbenchResponse,
): Promise<void> {
  const scenario = asScenarioName(scenarioId);
  // SAMEORIGIN: the workbench embeds this preview in its own iframe; every
  // other surface keeps DENY (the approval popup is never framed).
  sendHtml(res, 200, await renderStorefront(scenario, sku), 'SAMEORIGIN');
}

function getCatalogCachePath(): string {
  return repoPath('benchmark', 'responses', 'channel3_catalog_cache.json');
}

function handleCatalog(res: WorkbenchResponse): void {
  const cache = loadChannel3CacheFromDisk(getCatalogCachePath());
  sendJson(res, 200, {
    products: cache.products,
    source: 'CHANNEL3_ORACLE_CATALOG',
  });
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

function asMandateNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(400, `${field} must be a finite number in [${min}, ${max}]`);
  }
  return value;
}

/**
 * POST /api/buyer/mandate/update — composition point (SELF sign + local
 * WIT re-gate, zero PayPal calls). Validates the four editable
 * constraints, signs a fresh buyer mandate (Rung 1), stores it as the
 * session override, and immediately re-gates it against the scenario
 * storefront so the UI can show the new decision inline.
 */
async function handleBuyerMandateUpdate(
  body: Record<string, unknown>,
  res: WorkbenchResponse,
): Promise<void> {
  const scenario = asRequestScenario(body);
  const buyer = readRungKey('buyer');
  const current = effectiveMandate(scenario);
  const requiredCondition = body['requiredCondition'] ?? body['required_condition'];
  if (requiredCondition !== 'NEW' && requiredCondition !== 'REFURBISHED') {
    throw new HttpError(400, 'requiredCondition must be NEW or REFURBISHED');
  }
  const capRaw = body['maxAllInPriceUsd'] ?? body['max_all_in_price_usd'];
  const daysRaw = body['minReturnWindowDays'] ?? body['min_free_return_days'];
  const feeRaw = body['maxRestockingFeePct'] ?? body['max_restocking_fee_pct'];
  const mandate: MandateSpec = {
    mandateId: `mnd_${Date.now().toString(36)}`,
    createdAtUtc: new Date().toISOString(),
    buyerId: current.buyerId,
    itemQuery: current.itemQuery,
    constraints: {
      requiredCondition,
      maxAllInPriceUsd: Number(asMandateNumber(capRaw, 'maxAllInPriceUsd', 1, 1000000).toFixed(2)),
      minReturnWindowDays: Math.floor(asMandateNumber(daysRaw, 'minReturnWindowDays', 0, 365)),
      maxRestockingFeePct: asMandateNumber(feeRaw, 'maxRestockingFeePct', 0, 100),
    },
    buyerPublicKeyHex: buyer.publicKeyHex,
    buyerSignatureHex: '',
  };
  mandate.buyerSignatureHex = signCanonicalPayload(
    { ...mandate, buyerSignatureHex: '' },
    buyer.privateKeyHex,
  );
  sessionMandate = mandate;
  const witness = readRungKey('witness');
  const page = getScenario(scenario);
  const snapshot = await createWitnessSnapshot({
    listingUrl: page.listingUrl,
    mandate,
    witnessKeys: { publicKeyHex: witness.publicKeyHex, privateKeyHex: witness.privateKeyHex },
    htmlFetcher: () => Promise.resolve({ status: 200, html: page.html, tlsVerified: false }),
    requirePublicHttps: false,
    tsaMode: 'local',
    channel3Mode: 'cache',
    channel3Cache: DEMO_CHANNEL3_CACHE,
  });
  appendLedger({
    kind: 'mandate-update',
    summary: `mandate re-signed: cap $${mandate.constraints.maxAllInPriceUsd.toFixed(2)}, ${requiredCondition}, ≥${mandate.constraints.minReturnWindowDays}d, ≤${mandate.constraints.maxRestockingFeePct}% → ${snapshot.gateResult.decision}`,
  });
  sendJson(res, 200, {
    mandate,
    scenario,
    boundary: 'SELF',
    demoKeys: buyer.demoKeys,
    gateResult: snapshot.gateResult,
    headroomUsd: snapshot.gateResult.headroomUsd,
    commitment: snapshot.commitment,
  });
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
  const sku = typeof body['sku'] === 'string' && body['sku'].length > 0 ? (body['sku'] as string) : undefined;
  const witness = readRungKey('witness');
  const page = getScenario(scenario);
  let channel3Cache: Channel3CatalogCache = DEMO_CHANNEL3_CACHE;
  try {
    channel3Cache = loadChannel3CacheFromDisk(getCatalogCachePath());
  } catch {
    // fallback
  }
  const snapshot = await createWitnessSnapshot({
    listingUrl: page.listingUrl,
    mandate: effectiveMandate(scenario),
    witnessKeys: { publicKeyHex: witness.publicKeyHex, privateKeyHex: witness.privateKeyHex },
    htmlFetcher: async () => {
      if (sku) {
        const html = await renderStorefront(scenario, sku);
        return { status: 200, html, tlsVerified: false };
      }
      return { status: 200, html: page.html, tlsVerified: false };
    },
    requirePublicHttps: false,
    tsaMode: 'local',
    channel3Mode: 'cache',
    channel3Cache,
  });
  appendLedger({
    kind: 'witness-snapshot',
    summary: `${scenario} (${sku ?? 'default'}) witnessed → ${snapshot.gateResult.decision}`,
    commitment: snapshot.commitment,
  });
  sendJson(res, 200, {
    scenario,
    sku: sku ?? 'APEX-27-4K-IPS',
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

/** Cap for pasted merchant HTML (the 1MB body cap still applies first). */
const MAX_CUSTOM_HTML_BYTES = 200_000;

/**
 * POST /api/witness/custom-html — WITNESS rung only. Scans judge-pasted
 * merchant HTML with the 13-rule DOM scanner + quote verifier, gates it
 * under the session mandate, and cross-checks the Channel3 cache. Zero
 * PayPal calls. Block/hidden lists are truncated for transport safety.
 */
async function handleWitnessCustomHtml(
  body: Record<string, unknown>,
  res: WorkbenchResponse,
): Promise<void> {
  const html = body['html'];
  if (typeof html !== 'string' || html.length === 0) {
    throw new HttpError(400, 'html must be a non-empty string');
  }
  if (Buffer.byteLength(html, 'utf8') > MAX_CUSTOM_HTML_BYTES) {
    throw new HttpError(400, `html exceeds the ${MAX_CUSTOM_HTML_BYTES}-byte inspector cap`);
  }
  const rawUrl = body['listingUrl'];
  const listingUrl =
    typeof rawUrl === 'string' && rawUrl !== ''
      ? rawUrl.slice(0, 500)
      : 'https://custom.merchant.invalid/listing';
  const mandate = sessionMandate ?? buildDemoMandate('Custom merchant listing');
  const scan = scanMerchantHtml(html);
  const observed = await extractObservedTerms(scan);
  const gateResult = evaluateSufficiencyGate(mandate, observed);
  const terms = observed as unknown as Record<string, { value?: unknown }>;
  const oracleResult = await verifyWithChannel3Oracle(
    {
      brandModel:
        typeof terms['itemTitle']?.value === 'string' ? terms['itemTitle'].value : undefined,
      condition:
        typeof terms['condition']?.value === 'string' ? terms['condition'].value : undefined,
      basePriceUsd:
        typeof terms['basePriceUsd']?.value === 'number' ? terms['basePriceUsd'].value : undefined,
    },
    { mode: 'cache', cache: DEMO_CHANNEL3_CACHE },
  );
  appendLedger({
    kind: 'custom-witness',
    summary:
      `custom HTML scanned: ${scan.visibleBlocks.length} visible blocks, ` +
      `${scan.hiddenFindings.length} hidden findings → ${gateResult.decision}`,
  });
  sendJson(res, 200, {
    boundary: 'WIT',
    listingUrl,
    blockCount: scan.visibleBlocks.length,
    visibleBlocks: scan.visibleBlocks.slice(0, 200),
    blocksTruncated: scan.visibleBlocks.length > 200,
    hiddenFindingCount: scan.hiddenFindings.length,
    hiddenFindings: scan.hiddenFindings.slice(0, 50),
    findingsTruncated: scan.hiddenFindings.length > 50,
    adversarialDomDetected: scan.adversarialDomDetected,
    observed,
    gateResult,
    oracleResult,
  });
}

/**
 * POST /api/merchant/checkout — documented composition point: runs the
 * full bilateral flow (needs all three rung keys + PayPal) so one click
 * completes checkout. Non-composition routes above stay single-rung.
 * Honors per-request `executionMode` (`replay` = instant deterministic,
 * `live` = real sandbox, `auto` = legacy credential-aware default).
 */
async function handleMerchantCheckout(
  body: Record<string, unknown>,
  res: WorkbenchResponse,
): Promise<void> {
  const scenario = asRequestScenario(body);
  const rawSku = body['sku'];
  const sku = typeof rawSku === 'string' && rawSku.trim().length > 0 ? rawSku.trim() : undefined;
  const client = demoClientFor(parseExecutionMode(body));

  if (!sku || sku === 'APEX-27-4K-IPS') {
    const result = await client.runWitnessedCheckoutFlow({
      scenario,
      mandate: effectiveMandate(scenario),
      twoStepApproval: body['twoStep'] === true,
    });
    recordCapture(result, scenario);
    if (result.outcome === 'AUTO_VOIDED') {
      appendLedger({
        kind: 'checkout-void',
        summary: `${scenario} auto-voided at $${(result.finalTotalUsd ?? 0).toFixed(2)} (cap exceeded)`,
        orderId: result.orderId,
        commitment: result.snapshot.commitment,
      });
    } else if (result.outcome === 'BLOCKED_PRE_CHECKOUT') {
      appendLedger({
        kind: 'checkout-block',
        summary: `${scenario} blocked pre-checkout (${result.snapshot.gateResult.decision})`,
      });
    } else if (result.outcome === 'AWAITING_BUYER_APPROVAL' && result.orderId !== undefined) {
      appendLedger({
        kind: 'order-create',
        summary: `${scenario} order ${result.orderId} awaiting buyer approval`,
        orderId: result.orderId,
        commitment: result.snapshot.commitment,
      });
    }
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
    return;
  }

  // Multi-product Channel3 SKU flow:
  const product = findCatalogProduct(sku);
  const html = await renderStorefront(scenario, sku);
  const mandate = effectiveMandate(scenario);
  const witness = readRungKey('witness');
  let channel3Cache: Channel3CatalogCache = DEMO_CHANNEL3_CACHE;
  try {
    channel3Cache = loadChannel3CacheFromDisk(getCatalogCachePath());
  } catch {
    // fallback
  }
  const snapshot = await createWitnessSnapshot({
    listingUrl: `https://store.apexdisplay.invalid/${scenario}?sku=${encodeURIComponent(sku)}`,
    mandate,
    witnessKeys: { publicKeyHex: witness.publicKeyHex, privateKeyHex: witness.privateKeyHex },
    htmlFetcher: async () => ({ status: 200, html, tlsVerified: false }),
    requirePublicHttps: false,
    tsaMode: 'local',
    channel3Mode: 'cache',
    channel3Cache,
  });

  const base: CheckoutFlowResult = {
    outcome: 'BLOCKED_PRE_CHECKOUT',
    scenario,
    transportMode: client.paypal.transportMode,
    demoKeys: client.keys.demoKeys,
    snapshot,
  };

  if (snapshot.gateResult.decision === 'BLOCK') {
    appendLedger({
      kind: 'checkout-block',
      summary: `${scenario} (${sku}) blocked pre-checkout (${snapshot.gateResult.decision})`,
    });
    sendJson(res, 200, { ...base, sku, boundary: 'SIGN', gateResult: snapshot.gateResult });
    return;
  }

  const basePriceUsd = product.priceUsd ?? 279;
  const shippingUsd = scenario === 'surcharge_void' ? 55.0 : 11.5;
  const taxUsd = 6.5;

  const buyerApprovalSignatureHex = signCanonicalPayload(
    snapshot.receiptCore,
    client.keys.buyer.privateKeyHex,
  );
  const merchantSignatureHex = signCanonicalPayload(
    snapshot.receiptCore,
    client.keys.merchant.privateKeyHex,
  );

  const order = await client.paypal.createAuthorizeOrder({
    commitment: snapshot.commitment,
    description: `VeriPact witnessed checkout: ${product.title}`,
    itemTotalUsd: basePriceUsd,
  });
  const patched = await client.paypal.patchOrderShippingAndTax(order.orderId, {
    itemTotalUsd: basePriceUsd,
    shippingUsd,
    taxUsd,
  });

  let liveCreated = false;
  if (client.paypal.transportMode === 'LIVE_PAYPAL_SANDBOX') {
    liveCreated = (await client.paypal.getOrder(order.orderId)).status === 'CREATED';
  }
  if (body['twoStep'] === true || liveCreated) {
    const preview = evaluatePostApprovalReGate(mandate, snapshot.termReceipt, {
      itemTotalUsd: basePriceUsd,
      shippingUsd,
      taxUsd,
      finalTotalUsd: patched.finalTotalUsd,
    });
    const approveUrl =
      order.approveUrl ?? (await client.paypal.getOrder(order.orderId)).approveUrl;
    appendLedger({
      kind: 'order-create',
      summary: `${scenario} (${sku}) order ${order.orderId} awaiting buyer approval`,
      orderId: order.orderId,
      commitment: snapshot.commitment,
    });
    pendingApprovals.set(order.orderId, {
      scenario,
      snapshot,
      buyerApprovalSignatureHex,
      merchantSignatureHex,
    });
    savePendingApprovals();
    sendJson(res, 200, {
      ...base,
      sku,
      boundary: 'SIGN',
      outcome: 'AWAITING_BUYER_APPROVAL',
      buyerApprovalSignatureHex,
      merchantSignatureHex,
      orderId: order.orderId,
      approveUrl,
      finalTotalUsd: patched.finalTotalUsd,
      expectedPostApprovalAction: preview.action,
      headroomRemainingUsd: preview.headroomRemainingUsd,
    });
    return;
  }

  if (client.paypal.transportMode === 'DETERMINISTIC_SANDBOX_REPLAY') {
    client.paypal.simulatePayerApproval(order.orderId);
  }
  const authorized = await client.paypal.authorizeOrder(order.orderId);
  const authorizationId = authorized.authorizationId;
  if (authorizationId === undefined) {
    throw new Error(`veripact: authorize returned no authorization id (${order.orderId})`);
  }

  const regate = evaluatePostApprovalReGate(mandate, snapshot.termReceipt, {
    itemTotalUsd: basePriceUsd,
    shippingUsd,
    taxUsd,
    finalTotalUsd: patched.finalTotalUsd,
  });

  if (regate.action === 'VOID') {
    await client.paypal.voidAuthorization({ authorizationId });
    appendLedger({
      kind: 'checkout-void',
      summary: `${scenario} (${sku}) auto-voided at $${patched.finalTotalUsd.toFixed(2)} (cap exceeded)`,
      orderId: order.orderId,
      commitment: snapshot.commitment,
    });
    sendJson(res, 200, {
      ...base,
      sku,
      boundary: 'SIGN',
      outcome: 'AUTO_VOIDED',
      buyerApprovalSignatureHex,
      merchantSignatureHex,
      orderId: order.orderId,
      authorizationId,
      finalTotalUsd: patched.finalTotalUsd,
      voidReason: regate.reason,
    });
    return;
  }

  const addendum: CaptureAddendum = {
    authorizationId,
    capturedTotalUsd: patched.finalTotalUsd,
    mandateCeilingUsd: mandate.constraints.maxAllInPriceUsd,
    decision: 'CAPTURE',
    decidedAtUtc: new Date().toISOString(),
  };
  const addendumSha256 = sha256Hex(canonicalizeJson(addendum));
  const capture = await client.paypal.captureAuthorizationExact({
    authorizationId,
    addendumSha256,
    amountUsd: patched.finalTotalUsd,
    noteToPayer: 'VeriPact Verified Capture',
  });

  const result: CheckoutFlowResult = {
    ...base,
    outcome: 'CAPTURED',
    buyerApprovalSignatureHex,
    merchantSignatureHex,
    orderId: order.orderId,
    authorizationId,
    captureId: capture.captureId,
    finalTotalUsd: patched.finalTotalUsd,
  };
  recordCapture(result, scenario);
  sendJson(res, 200, { ...result, sku, boundary: 'SIGN' });
}

/** Inspector copy for one dispute (server-owned so live cases render too). */
export interface DisputeMeta {
  label: string;
  blurb: string;
  buyerTerms: string;
  sellerTerms: string;
  witnessed: string;
  diffs: { field: string; left: string; right: string }[];
}

const CANNED_DISPUTE_META: Record<'buyer_forgery' | 'merchant_drift', DisputeMeta> = {
  buyer_forgery: {
    label: 'Case B — Buyer forgery',
    buyerTerms: '60-day returns (self-signed SELF receipt)',
    sellerTerms: 'Stands by witnessed terms',
    witnessed: '30-day returns · 0% fee',
    diffs: [{ field: 'return_window_days', left: '60', right: '30' }],
    blurb:
      'The buyer edited local JSON to claim 60-day returns. Signature verifies (self-signed) but the hash cannot match the PayPal-anchored commitment.',
  },
  merchant_drift: {
    label: 'Case A — Merchant drift',
    buyerTerms: '30-day free returns (matches witness)',
    sellerTerms: '14-day returns · 25% restocking fee',
    witnessed: '30-day returns · 0% fee',
    diffs: [
      { field: 'return_window_days', left: '30', right: '14' },
      { field: 'restocking_fee_pct', left: '0%', right: '25%' },
    ],
    blurb:
      'The seller changed the return policy after purchase. The buyer receipt still matches; the seller counter-claim diverges.',
  },
};

function disputedNumber(core: Record<string, unknown>, field: string): string {
  const terms = asRecord(core['observedTerms']);
  const criterion = asRecord(terms[field]);
  const value = criterion['value'];
  return typeof value === 'number' ? String(value) : '?';
}

function liveDisputeMeta(entry: LiveDisputeEntry, ctx: CaptureContext): DisputeMeta {
  const days = disputedNumber(ctx.receiptCore, 'returnWindowDays');
  const fee = disputedNumber(ctx.receiptCore, 'restockingFeePct');
  if (entry.kind === 'forgery') {
    return {
      label: `Live forgery — ${entry.disputeId}`,
      buyerTerms: '60-day returns + $50 rebate (tampered SELF receipt)',
      sellerTerms: 'Stands by witnessed terms',
      witnessed: `${days}-day returns · ${fee}% fee`,
      diffs: [{ field: 'return_window_days', left: '60', right: days }],
      blurb: `Filed from captured order ${entry.orderId}: the buyer re-signed a tampered receipt. The WIT signature and PayPal custom_id reject it.`,
    };
  }
  return {
    label: `Live drift — ${entry.disputeId}`,
    buyerTerms: `${days}-day returns (matches witness)`,
    sellerTerms: '14-day returns · 25% restocking fee (mutated listing)',
    witnessed: `${days}-day returns · ${fee}% fee`,
    diffs: [
      { field: 'return_window_days', left: days, right: '14' },
      { field: 'restocking_fee_pct', left: `${fee}%`, right: '25%' },
    ],
    blurb: `Filed from captured order ${entry.orderId}: the merchant silently mutated the return policy after the sale.`,
  };
}

interface ContestKeys {
  buyer: { publicKeyHex: string; privateKeyHex: string };
  merchant: { publicKeyHex: string; privateKeyHex: string };
}

/**
 * Shared contested-forensics builder (canned + live disputes): forges
 * (buyer_forgery) or drifts (merchant_drift) the disputed receipt, signs
 * both sides, and runs the core 3-way referee against the anchored
 * custom_id. Pure derivation — no PayPal calls, no state changes.
 */
function contestedForensics(
  core: Record<string, unknown>,
  customId: string,
  witnessReceipt: { payload: unknown; signatureHex: string; publicKeyHex: string },
  keys: ContestKeys,
  kind: 'buyer_forgery' | 'merchant_drift',
): ReturnType<typeof evaluateContestedDispute> {
  const terms = asRecord(core['observedTerms']);
  const mutated = {
    ...core,
    observedTerms:
      kind === 'buyer_forgery'
        ? { ...terms, returnWindowDays: { status: 'DETERMINATE', value: 60 } }
        : {
          ...terms,
          returnWindowDays: { status: 'DETERMINATE', value: 14 },
          restockingFeePct: { status: 'DETERMINATE', value: 25 },
        },
  };
  const buyerClaimReceipt =
    kind === 'buyer_forgery'
      ? {
        payload: mutated,
        signatureHex: signCanonicalPayload(mutated, keys.buyer.privateKeyHex),
        publicKeyHex: keys.buyer.publicKeyHex,
      }
      : {
        payload: core,
        signatureHex: signCanonicalPayload(core, keys.buyer.privateKeyHex),
        publicKeyHex: keys.buyer.publicKeyHex,
      };
  const sellerCounterClaimReceipt =
    kind === 'merchant_drift'
      ? {
        payload: mutated,
        signatureHex: signCanonicalPayload(mutated, keys.merchant.privateKeyHex),
        publicKeyHex: keys.merchant.publicKeyHex,
      }
      : witnessReceipt;
  return evaluateContestedDispute({
    paypalOrderCustomId: customId,
    witnessReceipt,
    buyerClaimReceipt,
    sellerCounterClaimReceipt,
  });
}

/**
 * GET /api/merchant/disputes — live filed disputes FIRST (newest first),
 * then Case B, then Case A, each with its live HATEOAS record plus
 * computed forensics (referee verdict, 3-way hash comparison,
 * provenance). Read-only: dispute state is never mutated here. The desk
 * ALWAYS runs on the shared deterministic engine (even with live PayPal
 * credentials on disk): the canned fixtures exist only there, and filings
 * from live-minted orders keep their real orderId + VP1 commitment in
 * `meta`/`live` while the HATEOAS record stays honestly labeled replay.
 */
async function handleMerchantDisputes(res: WorkbenchResponse): Promise<void> {
  const client = demoClientFor('replay');
  // Canned baseline always runs the FIXTURE mandate: the two seeded cases
  // are deterministic fixtures and must stay resolvable even while the
  // founder stress-tests a tighter session mandate in View 1.
  const checkout = await client.runWitnessedCheckoutFlow({ scenario: 'normal' });
  if (checkout.outcome !== 'CAPTURED' || checkout.orderId === undefined) {
    throw new HttpError(500, 'baseline checkout did not capture');
  }
  const order = await client.paypal.getOrder(checkout.orderId);
  const core = asRecord(checkout.snapshot.receiptCore);
  const witnessReceipt = {
    payload: core,
    signatureHex: checkout.snapshot.witnessSignatureHex,
    publicKeyHex: checkout.snapshot.witnessPublicKeyHex,
  };
  const keys = { buyer: client.keys.buyer, merchant: client.keys.merchant };
  const caseB = await client.paypal.getDispute('PP-D-CASE-B-FORGERY');
  const caseA = await client.paypal.getDispute('PP-D-CASE-A-DRIFT');
  const live: Record<string, unknown>[] = [];
  for (const entry of [...liveDisputes.values()].reverse()) {
    const ctx = capturedOrders.get(entry.orderId);
    if (ctx === undefined) {
      continue;
    }
    const record = await client.paypal.getDispute(entry.disputeId);
    const liveWitness = {
      payload: ctx.receiptCore,
      signatureHex: ctx.witnessSignatureHex,
      publicKeyHex: ctx.witnessPublicKeyHex,
    };
    live.push({
      case: entry.caseKey,
      record,
      forensics: contestedForensics(
        ctx.receiptCore,
        ctx.commitment,
        liveWitness,
        keys,
        entry.kind === 'forgery' ? 'buyer_forgery' : 'merchant_drift',
      ),
      meta: liveDisputeMeta(entry, ctx),
      live: {
        orderId: ctx.orderId,
        customId: ctx.commitment,
        captureId: ctx.captureId,
        provenance: ctx.provenance,
        kind: entry.kind,
        filedAtUtc: entry.filedAtUtc,
      },
    });
  }
  sendJson(res, 200, {
    boundary: 'SIGN',
    orderId: checkout.orderId,
    customId: order.customId,
    transportMode: client.paypal.transportMode,
    demoKeys: client.keys.demoKeys,
    provenance: checkout.snapshot.provenance,
    disputes: [
      ...live,
      {
        case: 'buyer_forgery',
        record: caseB,
        forensics: contestedForensics(
          core,
          order.customId,
          witnessReceipt,
          keys,
          'buyer_forgery',
        ),
        meta: CANNED_DISPUTE_META.buyer_forgery,
      },
      {
        case: 'merchant_drift',
        record: caseA,
        forensics: contestedForensics(
          core,
          order.customId,
          witnessReceipt,
          keys,
          'merchant_drift',
        ),
        meta: CANNED_DISPUTE_META.merchant_drift,
      },
    ],
  });
}

/** POST /api/merchant/disputes/resolve — drive one case to RESOLVED. */
async function handleDisputeResolve(
  body: Record<string, unknown>,
  res: WorkbenchResponse,
): Promise<void> {
  const rawCase = body['case'];
  if (typeof rawCase === 'string' && /^live_(drift|forgery)_[1-9][0-9]*$/.test(rawCase)) {
    await resolveLiveDispute(rawCase, res);
    return;
  }
  const disputeCase = asDisputeCase(body['case']);
  const client = demoClientFor('replay');
  const result = await client.auditAndResolveDispute({ case: disputeCase });
  sendJson(res, 200, { ...result, boundary: 'SIGN' });
}

/**
 * POST /api/merchant/disputes/create-from-order — file a NEW contested
 * dispute anchored to an order captured in THIS session (View 1 → View 2).
 * Works for replay AND live-minted orders: the filing registers in the
 * shared local dispute-desk engine anchored to the exact orderId + VP1
 * commitment. Honesty note (Rule 3): PayPal exposes no file-dispute API,
 * so this desk is a LOCAL SIMULATION surface — the HATEOAS record is
 * labeled DETERMINISTIC_SANDBOX_REPLAY even when the anchored order is a
 * real sandbox order. That is why this route returns 200 instead of an
 * honest-but-useless 400: the simulation is labeled, never a fake filing.
 */
async function handleDisputeCreateFromOrder(
  body: Record<string, unknown>,
  res: WorkbenchResponse,
): Promise<void> {
  const orderId = asOrderId(body['orderId']);
  const kind = body['kind'];
  if (kind !== 'drift' && kind !== 'forgery') {
    throw new HttpError(400, 'kind must be drift or forgery');
  }
  const ctx = capturedOrders.get(orderId);
  if (ctx === undefined) {
    throw new HttpError(
      404,
      `order not captured in this session: ${orderId} (run a 1-click checkout first)`,
    );
  }
  const engine = demoEngine();
  liveDisputeSeq += 1;
  const n = liveDisputeSeq;
  const disputeId = kind === 'drift' ? `PP-D-LIVE-DRIFT-${n}` : `PP-D-LIVE-FORGERY-${n}`;
  const caseKey = kind === 'drift' ? `live_drift_${n}` : `live_forgery_${n}`;
  const record = engine.fileDispute({
    disputeId,
    reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
    amountUsd: ctx.finalTotalUsd,
  });
  const entry: LiveDisputeEntry = {
    caseKey,
    disputeId,
    orderId,
    kind,
    filedAtUtc: new Date().toISOString(),
  };
  liveDisputes.set(caseKey, entry);
  const client = demoClientFor('replay');
  const forensics = contestedForensics(
    ctx.receiptCore,
    ctx.commitment,
    {
      payload: ctx.receiptCore,
      signatureHex: ctx.witnessSignatureHex,
      publicKeyHex: ctx.witnessPublicKeyHex,
    },
    { buyer: client.keys.buyer, merchant: client.keys.merchant },
    kind === 'forgery' ? 'buyer_forgery' : 'merchant_drift',
  );
  appendLedger({
    kind: 'dispute-file',
    summary: `${kind} dispute ${disputeId} filed from ${orderId} → ${forensics.verdict}`,
    orderId,
    disputeId,
    commitment: ctx.commitment,
  });
  sendJson(res, 200, {
    case: caseKey,
    disputeId,
    orderId,
    kind,
    verdict: forensics.verdict,
    reason: forensics.reason,
    record,
    forensics,
    meta: liveDisputeMeta(entry, ctx),
    /** Local simulation desk (PayPal exposes no file-dispute API). */
    simulationDesk: true,
    boundary: 'SIGN',
  });
}

/**
 * Resolve a live filed dispute through the HATEOAS evidence chain. Always
 * runs on the shared local desk engine (even for live-anchored filings):
 * the evidence chain is a labeled simulation, never a PayPal chargeback.
 */
async function resolveLiveDispute(caseKey: string, res: WorkbenchResponse): Promise<void> {
  const entry = liveDisputes.get(caseKey);
  if (entry === undefined) {
    throw new HttpError(404, `unknown live dispute case: ${caseKey}`);
  }
  const ctx = capturedOrders.get(entry.orderId);
  if (ctx === undefined) {
    throw new HttpError(409, `capture evidence for ${entry.orderId} is gone (demo was reset)`);
  }
  const paypal = demoPayPalFor('replay');
  const client = demoClientFor('replay');
  const forensics = contestedForensics(
    ctx.receiptCore,
    ctx.commitment,
    {
      payload: ctx.receiptCore,
      signatureHex: ctx.witnessSignatureHex,
      publicKeyHex: ctx.witnessPublicKeyHex,
    },
    { buyer: client.keys.buyer, merchant: client.keys.merchant },
    entry.kind === 'forgery' ? 'buyer_forgery' : 'merchant_drift',
  );
  const outcome =
    forensics.verdict === 'BUYER_FORGERY_DETECTED'
      ? ('SELLER_FAVOR' as const)
      : forensics.verdict === 'MERCHANT_DRIFT_CONFIRMED'
        ? ('BUYER_FAVOR' as const)
        : null;
  if (outcome === null) {
    throw new HttpError(409, `referee found ${forensics.verdict} — nothing to resolve`);
  }
  const steps: string[] = [`referee verdict: ${forensics.verdict} (${forensics.reason})`];
  const notes = buildForensicNotes({
    caseName: entry.kind === 'forgery' ? 'buyer_forgery' : 'merchant_drift',
    orderId: entry.orderId,
    commitment: ctx.commitment,
    verdict: forensics.verdict,
    refereeReason: forensics.reason,
  });
  // Same HATEOAS walk as the canned audit: drift concedes via accept-claim,
  // forgery must never accept and drives to a seller-favor adjudication.
  for (let i = 0; i < 8; i += 1) {
    const dispute = await paypal.getDispute(entry.disputeId);
    if (dispute.status === 'RESOLVED') {
      break;
    }
    const allowed = dispute.allowedActions;
    if (outcome === 'BUYER_FAVOR') {
      if (allowed.includes('accept-claim')) {
        await paypal.acceptDisputeClaim(entry.disputeId);
        steps.push('accept-claim: seller conceded, buyer wins');
        break;
      }
      if (allowed.includes('escalate')) {
        await paypal.escalateDisputeToClaim(entry.disputeId);
        steps.push('escalated INQUIRY → CHARGEBACK');
        continue;
      }
      if (allowed.includes('require-evidence')) {
        await paypal.requireDisputeEvidence(entry.disputeId, 'BUYER_EVIDENCE');
        steps.push('require-evidence: BUYER_EVIDENCE');
        continue;
      }
      if (allowed.includes('provide-evidence')) {
        await paypal.provideDisputeEvidence({
          disputeId: entry.disputeId,
          evidenceType: 'OTHER',
          notes,
        });
        steps.push('provide-evidence: buyer forensic report (OTHER)');
        continue;
      }
      if (allowed.includes('adjudicate')) {
        await paypal.adjudicateDisputeSandbox(entry.disputeId, 'BUYER_FAVOR');
        steps.push('adjudicate: BUYER_FAVOR');
        break;
      }
    } else {
      if (allowed.includes('require-evidence')) {
        await paypal.requireDisputeEvidence(entry.disputeId, 'SELLER_EVIDENCE');
        steps.push('require-evidence: SELLER_EVIDENCE');
        continue;
      }
      if (allowed.includes('provide-evidence')) {
        await paypal.provideDisputeEvidence({
          disputeId: entry.disputeId,
          evidenceType: 'OTHER',
          notes,
        });
        steps.push('provide-evidence: seller forensic report (OTHER)');
        continue;
      }
      if (allowed.includes('escalate')) {
        await paypal.escalateDisputeToClaim(entry.disputeId);
        steps.push('escalated INQUIRY → CHARGEBACK');
        continue;
      }
      if (allowed.includes('adjudicate')) {
        await paypal.adjudicateDisputeSandbox(entry.disputeId, 'SELLER_FAVOR');
        steps.push('adjudicate: SELLER_FAVOR');
        break;
      }
      if (allowed.includes('accept-claim')) {
        throw new HttpError(409, 'refusing accept-claim on a forged buyer claim');
      }
    }
    throw new HttpError(409, `no drivable dispute action from [${allowed.join(', ')}]`);
  }
  const final = await paypal.getDispute(entry.disputeId);
  if (final.status !== 'RESOLVED') {
    throw new HttpError(409, `dispute ${entry.disputeId} did not resolve (${final.disputeState})`);
  }
  appendLedger({
    kind: 'dispute-resolve',
    summary: `${entry.disputeId} resolved ${outcome} (${forensics.verdict})`,
    orderId: entry.orderId,
    disputeId: entry.disputeId,
  });
  sendJson(res, 200, {
    case: caseKey,
    disputeId: entry.disputeId,
    orderId: entry.orderId,
    verdict: forensics.verdict,
    anchorTrusted: forensics.anchorTrusted,
    refereeReason: forensics.reason,
    steps,
    finalState: {
      status: final.status,
      lifeCycleStage: final.lifeCycleStage,
      disputeState: final.disputeState,
    },
    boundary: 'SIGN',
  });
}

/**
 * POST /api/verify — independent bundle verification plus the raw
 * `receiptCore` and live `custom_id` read-back the browser auditor needs.
 * Honors per-request `executionMode` (the browser auditor pins `replay`
 * so first paint stays instant with live credentials on disk).
 */
async function handleVerify(body: Record<string, unknown>, res: WorkbenchResponse): Promise<void> {
  const scenario = asRequestScenario(body);
  const client = demoClientFor(parseExecutionMode(body));
  const checkout = await client.runWitnessedCheckoutFlow({
    scenario,
    mandate: effectiveMandate(scenario),
  });
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
 * Always the local desk engine: canned + PP-D-LIVE-* ids exist only there.
 */
async function handleDisputeAction(
  body: Record<string, unknown>,
  res: WorkbenchResponse,
): Promise<void> {
  const disputeId = body['disputeId'];
  const action = body['action'];
  if (typeof disputeId !== 'string' || !ORDER_TOKEN_RE.test(disputeId)) {
    // Token allowlist (mirrors orderId): disputeId is interpolated into
    // PayPal URL paths, so `..`, `/`, and control chars are rejected here.
    throw new HttpError(400, 'disputeId must be a non-empty token (letters, digits, _ -)');
  }
  if (typeof action !== 'string') {
    throw new HttpError(400, 'action is required');
  }
  const paypal = demoPayPalFor('replay');
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

/** POST /api/demo/reset — re-seed shared replay state + wallet state. */
function handleDemoReset(res: WorkbenchResponse): void {
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
  // Hybrid routing: deterministic ids always resolve against the shared
  // desk engine (even with live credentials on disk); anything else goes
  // to the credential-aware client (live 302-redirect when applicable).
  const paypal = token.startsWith('ORD-VP-') ? demoPayPalFor('replay') : demoPayPal();
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
  if (!orderId.startsWith('ORD-VP-')) {
    throw new HttpError(400, 'live orders approve at PayPal, not via the sandbox popup');
  }
  const paypal = demoPayPalFor('replay');
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
 * Honors per-request `executionMode` so step 2 runs on the same transport
 * as step 1 (the UI echoes the awaiting order's transport explicitly).
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
  const client = demoClientFor(parseExecutionMode(body));
  const result = await client.completeApprovedCheckout({
    orderId,
    scenario,
    prior,
    mandate: effectiveMandate(scenario),
  });
  recordCapture(result, scenario);
  if (result.outcome === 'AUTO_VOIDED') {
    appendLedger({
      kind: 'checkout-void',
      summary: `${scenario} finalized → auto-voided at $${(result.finalTotalUsd ?? 0).toFixed(2)}`,
      orderId,
      commitment: result.snapshot.commitment,
    });
  }
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
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
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
    if (method === 'GET' && pathname === '/api/catalog') {
      handleCatalog(res);
      return;
    }
    if (method === 'GET' && pathname.startsWith('/store/')) {
      const sku = url.searchParams.get('sku') ?? undefined;
      await handleStore(pathname.slice('/store/'.length), sku, res);
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
    if (method === 'GET' && pathname === '/api/ledger') {
      handleLedger(res);
      return;
    }
    if (method === 'GET' && pathname === '/openapi.json') {
      sendJson(res, 200, buildOpenApiSpec());
      return;
    }
    if (method === 'GET' && pathname.startsWith('/vendor/')) {
      handleVendor(pathname, res);
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
    if (method === 'POST' && pathname === '/api/buyer/mandate/update') {
      await handleBuyerMandateUpdate(parseJsonBody(await readBody(req)), res);
      return;
    }
    if (method === 'POST' && pathname === '/api/witness/custom-html') {
      await handleWitnessCustomHtml(parseJsonBody(await readBody(req)), res);
      return;
    }
    if (method === 'POST' && pathname === '/api/system/credentials') {
      await handleSystemCredentials(parseJsonBody(await readBody(req)), res);
      return;
    }
    if (method === 'POST' && pathname === '/api/witness/snapshot') {
      await handleWitnessSnapshot(parseJsonBody(await readBody(req)), res);
      return;
    }
    if (method === 'POST' && pathname === '/api/merchant/checkout') {
      const body = parseJsonBody(await readBody(req));
      // Explicit `live` never falls back: a forced live call that cannot
      // reach PayPal must surface honestly, not silently replay (Rule 3).
      if (isExplicitLive(body)) {
        await handleMerchantCheckout(body, res);
      } else {
        await withLiveFallback(() => handleMerchantCheckout(body, res));
      }
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
    if (method === 'POST' && pathname === '/api/merchant/disputes/create-from-order') {
      const body = parseJsonBody(await readBody(req));
      await withLiveFallback(() => handleDisputeCreateFromOrder(body, res));
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
      if (isExplicitLive(body)) {
        await handleCheckoutFinalize(body, res);
      } else {
        await withLiveFallback(() => handleCheckoutFinalize(body, res));
      }
      return;
    }
    if (method === 'POST' && pathname === '/api/verify') {
      const body = parseJsonBody(await readBody(req));
      if (isExplicitLive(body)) {
        await handleVerify(body, res);
      } else {
        await withLiveFallback(() => handleVerify(body, res));
      }
      return;
    }
    if (
      pathname === '/pair' ||
      pathname.startsWith('/pair/') ||
      pathname.startsWith('/api/wallet/')
    ) {
      if (await handleWalletRequest(req, res)) {
        return;
      }
    }
    const knownPaths = [
      '/health',
      '/',
      '/favicon.ico',
      '/favicon.svg',
      '/api/merchant/disputes',
      '/api/benchmark',
      '/api/buyer/mandate',
      '/api/buyer/mandate/update',
      '/api/witness/snapshot',
      '/api/witness/custom-html',
      '/api/merchant/checkout',
      '/api/merchant/disputes/resolve',
      '/api/merchant/disputes/action',
      '/api/merchant/disputes/create-from-order',
      '/api/merchant/checkout/finalize',
      '/api/sandbox/approve-order',
      '/sandbox/paypal-checkout',
      '/api/demo/reset',
      '/api/system/status',
      '/api/system/credentials',
      '/api/ledger',
      '/api/catalog',
      '/api/verify',
      '/openapi.json',
    ];
    if (
      knownPaths.includes(pathname) ||
      pathname.startsWith('/store/') ||
      pathname.startsWith('/vendor/')
    ) {
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
