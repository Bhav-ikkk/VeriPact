import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  canonicalizeJson,
  COMMITMENT_PREFIX,
  sha256Hex,
  verifyCanonicalPayload,
  type MandateSpec,
} from '@veripact/core';
import { VeriPactClient } from '@veripact/sdk';
import {
  clearPendingApprovalsMemory,
  handleWorkbenchRequest,
  renderApprovalPage,
  renderIndexPage,
  resetDemoState,
  ROUTES,
  WORKBENCH_VERSION,
  type HealthPayload,
  type SystemStatusPayload,
  type WorkbenchResponse,
} from '../src/index';

interface CapturedResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

async function call(
  method: string,
  pathname: string,
  body?: unknown,
  rawBody?: string,
): Promise<CapturedResponse> {
  const captured: CapturedResponse = { status: 0, headers: {}, body: '' };
  const res: WorkbenchResponse = {
    writeHead(code: number, headers: Record<string, string>): void {
      captured.status = code;
      captured.headers = headers;
    },
    end(responseBody: string): void {
      captured.body = responseBody;
    },
  };
  await handleWorkbenchRequest(
    {
      method,
      url: pathname,
      bodyText: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    },
    res,
  );
  return captured;
}

const get = (pathname: string): Promise<CapturedResponse> => call('GET', pathname);
const post = (pathname: string, body?: unknown, rawBody?: string): Promise<CapturedResponse> =>
  call('POST', pathname, body, rawBody);

const ENV_VARS = [
  'BUYER_ED25519_PRIVATE_KEY',
  'WITNESS_ED25519_PRIVATE_KEY',
  'MERCHANT_ED25519_PRIVATE_KEY',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'VERIPACT_ENV_FILE',
] as const;

// Hermetic env: no ambient keys may flip routes into live mode, and the
// hot-reload hook aims at an absent path so a repo .env stays unread.
const ABSENT_ENV = join(process.cwd(), '.vitest-tmp', 'absent-credentials.env');
const RECEIPTS_PATH = join(process.cwd(), 'docs', 'sandbox-receipts.json');
const PENDING_PATH = join(process.cwd(), '.veripact-pending.json');

const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of ENV_VARS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.VERIPACT_ENV_FILE = ABSENT_ENV;
  resetDemoState();
});
afterEach(() => {
  for (const key of ENV_VARS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function json<T>(res: CapturedResponse): T {
  return JSON.parse(res.body) as T;
}

// Finalize tests refresh the committed receipts file; snapshot + restore it
// so every run leaves the working tree byte-identical.
function snapshotReceipts(): string | null {
  try {
    return readFileSync(RECEIPTS_PATH, 'utf8');
  } catch {
    return null;
  }
}

function restoreReceipts(snapshot: string | null): void {
  if (snapshot === null) {
    rmSync(RECEIPTS_PATH, { force: true });
  } else {
    writeFileSync(RECEIPTS_PATH, snapshot);
  }
}

interface AwaitingBody {
  outcome: string;
  orderId: string;
  approveUrl: string;
  finalTotalUsd: number;
  expectedPostApprovalAction: string;
  headroomRemainingUsd: number;
  snapshot: Record<string, unknown>;
  buyerApprovalSignatureHex: string;
  merchantSignatureHex: string;
}

describe('@veripact/workbench', () => {
  it('resolves @veripact/core across the workspace boundary', () => {
    expect(COMMITMENT_PREFIX).toBe('VP1:');
  });

  it('serves /health with service, transport mode, and security headers', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    const body = json<HealthPayload>(res);
    expect(body).toMatchObject({
      ok: true,
      service: 'veripact-workbench',
      transportMode: 'DETERMINISTIC_SANDBOX_REPLAY',
      version: WORKBENCH_VERSION,
    });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(ROUTES).toContain('/api/benchmark');
  });

  it('serves the Sequoia 2-view app with grids, auditor, and agent bar', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    for (const needle of [
      'view-checkout',
      'view-desk',
      'ag-live-disputes-grid',
      'ag-regression-benchmark-grid',
      'height:560px',
      'quote-badges',
      'auditor',
      'prompt-input',
      'Compare contested disputes by verification outcome',
      'Chart 24-scenario regression accuracy with 95% Wilson CIs',
      'ag-grid-community@32.3.9',
      'window.crypto.subtle',
      'twostep-toggle',
      'awaiting-card',
      'VERIPACT_ORDER_APPROVED',
      'Finalize approved order',
      'btn-popup',
      'btn-tour',
      'Run 60s Guided Demo Tour',
      'pipeline-ribbon',
      'rb-buyer-fp',
      'tour-status',
      'ContestedClaimInspectorWidget',
      'diff-pill',
      'JCS-PARITY',
      'sameOrigin',
    ]) {
      expect(res.body).toContain(needle);
    }
  });

  it('serves trademark-safe storefronts with SVG art and hidden injection', async () => {
    for (const scenario of ['normal', 'surcharge_void', 'adversarial_hidden_dom']) {
      const res = await get(`/store/${scenario}`);
      expect(res.status).toBe(200);
      expect(res.body).toContain('Apex Display Co.');
      expect(res.body).toContain('<svg');
      expect(res.body).toContain('$279.00');
    }
    const adversarial = await get('/store/adversarial_hidden_dom');
    expect(adversarial.body).toContain('display:none');
    expect(adversarial.body).toContain('paypal.me/attacker-sink');
    expect((await get('/store/nope')).status).toBe(400);
  });

  it('signs and verifies buyer mandates on the SELF boundary', async () => {
    const signed = await post('/api/buyer/mandate', {
      itemQuery: 'test query',
      constraints: { maxAllInPriceUsd: 100 },
    });
    expect(signed.status).toBe(200);
    const { mandate, boundary } = json<{ mandate: MandateSpec; boundary: string }>(signed);
    expect(boundary).toBe('SELF');
    expect(mandate.constraints.maxAllInPriceUsd).toBe(100);
    expect(
      verifyCanonicalPayload(
        { ...mandate, buyerSignatureHex: '' },
        mandate.buyerSignatureHex,
        mandate.buyerPublicKeyHex,
      ),
    ).toBe(true);
    const verified = await post('/api/buyer/mandate', { mandate });
    expect(json<{ valid: boolean }>(verified).valid).toBe(true);
    const tampered = await post('/api/buyer/mandate', {
      mandate: {
        ...mandate,
        constraints: { ...mandate.constraints, maxAllInPriceUsd: 101 },
      },
    });
    expect(json<{ valid: boolean }>(tampered).valid).toBe(false);
  });

  it('snapshots offers on the WIT boundary with zero PayPal calls', async () => {
    const res = await post('/api/witness/snapshot', { scenario: 'normal' });
    expect(res.status).toBe(200);
    const body = json<{
      boundary: string;
      commitment: string;
      gateResult: { decision: string };
      provenance: { channel3ProductId: string };
      oracleResult: { matched: boolean };
      anchor: { authority: string };
    }>(res);
    expect(body.boundary).toBe('WIT');
    expect(body.commitment).toMatch(/^VP1:[0-9a-f]{64}$/);
    expect(body.gateResult.decision).toBe('ASK_HUMAN_DELTA');
    expect(body.provenance.channel3ProductId).toBe('APEX-27-4K-IPS');
    expect(body.oracleResult.matched).toBe(true);
    expect(body.anchor.authority).toBe('LOCAL_TEST');
    const blocked = await post('/api/witness/snapshot', { scenario: 'adversarial_hidden_dom' });
    expect(json<{ gateResult: { decision: string } }>(blocked).gateResult.decision).toBe('BLOCK');
  });

  it('checks out all three scenarios with honest outcomes', async () => {
    const captured = await post('/api/merchant/checkout', { scenario: 'normal' });
    expect(captured.status).toBe(200);
    const ok = json<{
      outcome: string;
      orderId: string;
      authorizationId: string;
      captureId: string;
      finalTotalUsd: number;
    }>(captured);
    expect(ok.outcome).toBe('CAPTURED');
    expect(ok.orderId).toMatch(/^ORD-VP-/);
    expect(ok.finalTotalUsd).toBe(297);
    const voided = await post('/api/merchant/checkout', { scenario: 'surcharge_void' });
    expect(json<{ outcome: string; finalTotalUsd: number }>(voided)).toMatchObject({
      outcome: 'AUTO_VOIDED',
      finalTotalUsd: 340.5,
    });
    const blocked = await post('/api/merchant/checkout', { scenario: 'adversarial_hidden_dom' });
    expect(json<{ outcome: string; orderId?: string }>(blocked).outcome).toBe('BLOCKED_PRE_CHECKOUT');
    expect(json<{ orderId?: string }>(blocked).orderId).toBeUndefined();
  });

  it('lists Case B first with live HATEOAS records and forensics', async () => {
    const res = await get('/api/merchant/disputes');
    expect(res.status).toBe(200);
    const body = json<{
      customId: string;
      disputes: Array<{
        case: string;
        record: { disputeId: string; allowedActions: string[] };
        forensics: { verdict: string; anchorTrusted: boolean };
      }>;
    }>(res);
    expect(body.customId).toMatch(/^VP1:/);
    expect(body.disputes.map((d) => d.case)).toEqual(['buyer_forgery', 'merchant_drift']);
    expect(body.disputes[0]?.record.disputeId).toBe('PP-D-CASE-B-FORGERY');
    expect(body.disputes[0]?.record.allowedActions).toContain('require-evidence');
    expect(body.disputes[0]?.forensics.verdict).toBe('BUYER_FORGERY_DETECTED');
    expect(body.disputes[1]?.forensics.verdict).toBe('MERCHANT_DRIFT_CONFIRMED');
    expect(body.disputes[0]?.forensics.anchorTrusted).toBe(true);
  });

  it('resolves a case through the full HATEOAS chain', async () => {
    const res = await post('/api/merchant/disputes/resolve', { case: 'buyer_forgery' });
    expect(res.status).toBe(200);
    const body = json<{
      verdict: string;
      finalState: { status: string; outcome: string };
      steps: string[];
    }>(res);
    expect(body.verdict).toBe('BUYER_FORGERY_DETECTED');
    expect(body.finalState.status).toBe('RESOLVED');
    expect(body.finalState.outcome).toBe('SELLER_FAVOR');
    expect(body.steps.length).toBeGreaterThan(2);
  });

  it('applies granular dispute actions with shared-engine persistence', async () => {
    const required = await post('/api/merchant/disputes/action', {
      disputeId: 'PP-D-CASE-B-FORGERY',
      action: 'require-evidence',
      requireAction: 'SELLER_EVIDENCE',
    });
    expect(required.status).toBe(200);
    // Second request observes the first (shared engine): provide is now advertised.
    const provided = await post('/api/merchant/disputes/action', {
      disputeId: 'PP-D-CASE-B-FORGERY',
      action: 'provide-evidence',
      evidenceType: 'OTHER',
      notes: 'desk note',
    });
    expect(provided.status).toBe(200);
    expect(json<{ record: { evidenceCount: number } }>(provided).record.evidenceCount).toBe(1);
    const early = await post('/api/merchant/disputes/action', {
      disputeId: 'PP-D-CASE-A-DRIFT',
      action: 'adjudicate',
      outcome: 'BUYER_FAVOR',
    });
    expect(early.status).toBe(409);
    expect(json<{ error: string }>(early).error).toContain('adjudicate');
    expect(
      (
        await post('/api/merchant/disputes/action', {
          disputeId: 'PP-D-CASE-A-DRIFT',
          action: 'mint-money',
        })
      ).status,
    ).toBe(400);
  });

  it('verifies captured bundles and refuses blocked scenarios', async () => {
    const res = await post('/api/verify', { scenario: 'normal' });
    expect(res.status).toBe(200);
    const body = json<{
      customId: string;
      receiptCore: { receiptVersion: string };
      bundle: { allValid: boolean; customIdMatch: boolean };
    }>(res);
    expect(body.customId).toMatch(/^VP1:/);
    expect(body.receiptCore.receiptVersion).toBe('VP1');
    expect(body.bundle.allValid).toBe(true);
    expect(body.bundle.customIdMatch).toBe(true);
    expect((await post('/api/verify', { scenario: 'adversarial_hidden_dom' })).status).toBe(400);
  });

  it('serves the 72-run benchmark report with Wilson intervals', async () => {
    const res = await get('/api/benchmark');
    expect(res.status).toBe(200);
    const body = json<{
      scenarioCount: number;
      runCount: number;
      gateConfusion: Record<string, Record<string, number>>;
      overallPassRate: { rate: number; ci95Lower: number; ci95Upper: number };
    }>(res);
    expect(body.scenarioCount).toBe(24);
    expect(body.runCount).toBe(72);
    expect(body.gateConfusion['PROCEED']?.['PROCEED']).toBeGreaterThan(0);
    expect(body.overallPassRate.rate).toBe(1);
    expect(body.overallPassRate.ci95Lower).toBeGreaterThan(0.9);
  });

  it('resets demo state and enforces body caps and JSON shape', async () => {
    await post('/api/merchant/disputes/action', {
      disputeId: 'PP-D-CASE-B-FORGERY',
      action: 'require-evidence',
      requireAction: 'SELLER_EVIDENCE',
    });
    const reset = await post('/api/demo/reset', {});
    expect(reset.status).toBe(200);
    expect(json<{ ok: boolean }>(reset).ok).toBe(true);
    const disputes = await get('/api/merchant/disputes');
    expect(
      json<{ disputes: Array<{ record: { disputeState: string } }> }>(
        disputes,
      ).disputes[0]?.record.disputeState,
    ).toBe('OPEN_INQUIRIES');
    expect((await post('/api/verify', {}, 'x'.repeat(1_000_001))).status).toBe(413);
    expect((await post('/api/verify', {}, '{bad json')).status).toBe(400);
    expect((await post('/api/verify', {}, '[1,2]')).status).toBe(400);
  });

  it('404s unknown routes and 405s wrong methods', async () => {
    expect((await get('/nope')).status).toBe(404);
    expect((await get('/api/verify')).status).toBe(405);
    expect((await post('/health', {})).status).toBe(405);
    expect((await post('/store/normal', {})).status).toBe(405);
  });

  it('auditor JCS byte-matches server canonicalization (browser parity)', () => {
    // Guards the Verify-It-Yourself drawer: the inlined browser canonicalizer
    // must emit byte-identical JCS, or client-side VP1 recomputation drifts.
    // vm compilation also fails loudly on inline-script syntax errors.
    const html = renderIndexPage();
    const match = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/.exec(html);
    expect(match?.[1]).toContain('function jcs(');
    const elementStub = (): Record<string, unknown> => ({
      addEventListener: () => undefined,
      setAttribute: () => undefined,
      getAttribute: () => null,
      classList: { add: () => undefined, remove: () => undefined, contains: () => false },
      style: {},
      appendChild: () => undefined,
      querySelectorAll: () => [],
      textContent: '',
      value: '',
      hidden: false,
      open: false,
    });
    const sandbox: Record<string, unknown> = {
      document: {
        getElementById: () => elementStub(),
        querySelectorAll: () => [],
        addEventListener: () => undefined,
        createElement: () => elementStub(),
        body: elementStub(),
      },
      window: { addEventListener: () => undefined, open: () => null },
      navigator: {},
      fetch: () => Promise.reject(new Error('no net')),
      performance: { now: () => 0 },
      TextEncoder,
      console,
    };
    const ctx = createContext(sandbox);
    runInContext(match?.[1] ?? '', ctx, { filename: 'ui-inline.js' });
    const cases: Array<[string, unknown]> = [
      [
        'receipt-like',
        {
          receiptVersion: 'VP1',
          rung: 'WIT',
          capturedAtUtc: '2026-11-01T00:00:00.000Z',
          observedTerms: {
            basePriceUsd: { status: 'DETERMINATE', value: 279 },
            shippingUsd: { status: 'DETERMINATE', value: 11.5 },
            note: 'Flat $11.50 shipping. "Quoted" \\ backslash',
          },
        },
      ],
      [
        'nasty',
        {
          q: 'a"b\\c\né',
          n: -0,
          z: 0,
          f: 1.5,
          big: 1e21,
          u: undefined,
          fn: () => 1,
          arr: [1, undefined, 'x'],
          nest: { b: 2, a: 1 },
        },
      ],
    ];
    for (const [name, value] of cases) {
      sandbox['CASE'] = value;
      const browser = runInContext('jcs(CASE)', ctx) as string;
      expect([name, browser]).toEqual([name, canonicalizeJson(value)]);
    }
  });

  it('two-step checkout returns AWAITING and registers the approval popup', async () => {
    const res = await post('/api/merchant/checkout', { scenario: 'normal', twoStep: true });
    expect(res.status).toBe(200);
    const step1 = json<AwaitingBody>(res);
    expect(step1.outcome).toBe('AWAITING_BUYER_APPROVAL');
    expect(step1.orderId).toBe('ORD-VP-0001');
    expect(step1.approveUrl).toBe('/sandbox/paypal-checkout?token=ORD-VP-0001');
    expect(step1.finalTotalUsd).toBe(297);
    expect(step1.expectedPostApprovalAction).toBe('CAPTURE');
    expect(step1.headroomRemainingUsd).toBe(23);
    expect(step1.snapshot['commitment']).toMatch(/^VP1:[0-9a-f]{64}$/);
    expect(ROUTES).toContain('/sandbox/paypal-checkout');
    expect(ROUTES).toContain('/api/merchant/checkout/finalize');
    expect(ROUTES).toContain('/api/sandbox/approve-order');
  });

  it('serves the zero-key approval popup with totals and commitment', async () => {
    await post('/api/merchant/checkout', { scenario: 'normal', twoStep: true });
    const res = await get('/sandbox/paypal-checkout?token=ORD-VP-0001');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    for (const needle of [
      'VeriPact Deterministic Sandbox Buyer Approval — Zero-Key Mode',
      'ORD-VP-0001',
      'VeriPact witnessed checkout',
      '$279.00',
      '$11.50',
      '$6.50',
      '$297.00',
      'VP1:',
      'Approve Order Hold as Buyer',
      'VERIPACT_ORDER_APPROVED',
      '/api/sandbox/approve-order',
    ]) {
      expect(res.body).toContain(needle);
    }
    const badToken = await get('/sandbox/paypal-checkout?token=%3Cscript%3E');
    expect(badToken.status).toBe(400);
    expect(badToken.body).toContain('Cannot load order.');
    const missing = await get('/sandbox/paypal-checkout');
    expect(missing.status).toBe(400);
    const unknown = await get('/sandbox/paypal-checkout?token=ORD-VP-9999');
    expect(unknown.status).toBe(404);
    expect(unknown.body).toContain('was not found on');
  });

  it('approval popup renderer escapes hostile tokens and totals', () => {
    const html = renderApprovalPage({
      orderId: '"><script>alert(1)</script>',
      orderStatus: 'CREATED',
      description: 'x',
      itemTotalUsd: 279,
      shippingUsd: 11.5,
      taxUsd: 6.5,
      finalTotalUsd: 297,
      customId: 'VP1:abc',
      transportMode: 'DETERMINISTIC_SANDBOX_REPLAY',
      scenario: 'custom',
      alreadyApproved: false,
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('\\u003cscript>alert(1)\\u003c/script>');
    const done = renderApprovalPage({
      orderId: 'ORD-VP-0001',
      orderStatus: 'APPROVED',
      description: 'x',
      itemTotalUsd: 279,
      shippingUsd: 11.5,
      taxUsd: 6.5,
      finalTotalUsd: 297,
      customId: 'VP1:abc',
      transportMode: 'DETERMINISTIC_SANDBOX_REPLAY',
      scenario: 'custom',
      alreadyApproved: true,
    });
    expect(done).toContain('Already approved.');
    expect(done).not.toContain('<button');
  });

  it('approve-order transitions replay orders idempotently', async () => {
    await post('/api/merchant/checkout', { scenario: 'normal', twoStep: true });
    const first = await post('/api/sandbox/approve-order', { orderId: 'ORD-VP-0001' });
    expect(first.status).toBe(200);
    expect(json(first)).toEqual({ ok: true, orderId: 'ORD-VP-0001', status: 'APPROVED', already: false });
    const popup = await get('/sandbox/paypal-checkout?token=ORD-VP-0001');
    expect(popup.body).toContain('Already approved.');
    const second = await post('/api/sandbox/approve-order', { orderId: 'ORD-VP-0001' });
    expect(second.status).toBe(200);
    expect(json(second)).toMatchObject({ already: true, status: 'APPROVED' });
    const unknown = await post('/api/sandbox/approve-order', { orderId: 'ORD-VP-9999' });
    expect(unknown.status).toBe(404);
    const bad = await post('/api/sandbox/approve-order', { orderId: '<oops>' });
    expect(bad.status).toBe(400);
  });

  it('finalize captures with browser echo and refreshes receipts on disk', async () => {
    const receiptsBefore = snapshotReceipts();
    try {
      const step1 = json<AwaitingBody>(
        await post('/api/merchant/checkout', { scenario: 'normal', twoStep: true }),
      );
      await post('/api/sandbox/approve-order', { orderId: step1.orderId });
      const fin = await post('/api/merchant/checkout/finalize', {
        orderId: step1.orderId,
        scenario: 'normal',
        prior: {
          snapshot: step1.snapshot,
          buyerApprovalSignatureHex: step1.buyerApprovalSignatureHex,
          merchantSignatureHex: step1.merchantSignatureHex,
        },
      });
      expect(fin.status).toBe(200);
      const done = json<{
        outcome: string;
        orderId: string;
        authorizationId: string;
        captureId: string;
        finalTotalUsd: number;
        snapshot: { commitment: string };
        receiptsWarning?: string;
      }>(fin);
      expect(done.outcome).toBe('CAPTURED');
      expect(done.captureId).toMatch(/^CAP-VP-/);
      expect(done.finalTotalUsd).toBe(297);
      expect(done.snapshot.commitment).toBe(step1.snapshot['commitment']);
      expect(done.receiptsWarning).toBeUndefined();
      expect(existsSync(RECEIPTS_PATH)).toBe(true);
      const doc = JSON.parse(readFileSync(RECEIPTS_PATH, 'utf8')) as {
        orders: Array<Record<string, unknown>>;
      };
      const entry = doc.orders.find((o) => o['orderId'] === step1.orderId);
      expect(entry).toMatchObject({
        orderId: step1.orderId,
        scenario: 'normal',
        authorizationId: done.authorizationId,
        captureId: done.captureId,
        customId: done.snapshot.commitment,
        finalTotalUsd: 297,
        transportMode: 'DETERMINISTIC_SANDBOX_REPLAY',
      });
    } finally {
      restoreReceipts(receiptsBefore);
    }
  });

  it('finalize completes from the pending map and voids surcharges', async () => {
    const receiptsBefore = snapshotReceipts();
    try {
      const step1 = json<AwaitingBody>(
        await post('/api/merchant/checkout', { scenario: 'surcharge_void', twoStep: true }),
      );
      expect(step1.expectedPostApprovalAction).toBe('VOID');
      await post('/api/sandbox/approve-order', { orderId: step1.orderId });
      // No browser echo: the server pending map supplies step-1 evidence.
      const fin = await post('/api/merchant/checkout/finalize', {
        orderId: step1.orderId,
        scenario: 'surcharge_void',
      });
      expect(fin.status).toBe(200);
      const done = json<{
        outcome: string;
        finalTotalUsd: number;
        voidReason: string;
        snapshot: { commitment: string };
      }>(fin);
      expect(done.outcome).toBe('AUTO_VOIDED');
      expect(done.finalTotalUsd).toBe(340.5);
      expect(done.voidReason).toContain('320');
      expect(done.snapshot.commitment).toBe(step1.snapshot['commitment']);
      const doc = JSON.parse(readFileSync(RECEIPTS_PATH, 'utf8')) as {
        orders: Array<Record<string, unknown>>;
      };
      expect(doc.orders.find((o) => o['orderId'] === step1.orderId)).toMatchObject({
        voidStatus: 'VOIDED',
        finalTotalUsd: 340.5,
      });
    } finally {
      restoreReceipts(receiptsBefore);
    }
  });

  it('finalize rejects echoed evidence bound to another order', async () => {
    const fresh = json<AwaitingBody>(
      await post('/api/merchant/checkout', { scenario: 'normal', twoStep: true }),
    );
    const other = json<AwaitingBody>(
      await post('/api/merchant/checkout', { scenario: 'surcharge_void', twoStep: true }),
    );
    await post('/api/sandbox/approve-order', { orderId: fresh.orderId });
    const fin = await post('/api/merchant/checkout/finalize', {
      orderId: fresh.orderId,
      scenario: 'normal',
      prior: {
        snapshot: other.snapshot,
        buyerApprovalSignatureHex: other.buyerApprovalSignatureHex,
        merchantSignatureHex: other.merchantSignatureHex,
      },
    });
    expect(fin.status).toBe(500);
    expect(json<{ error: string }>(fin).error).toContain('does not match the order custom_id');
    const badId = await post('/api/merchant/checkout/finalize', { orderId: '<oops>', scenario: 'normal' });
    expect(badId.status).toBe(400);
  });

  it('reports credential readiness with fingerprints and zero secrets', async () => {
    const res = await get('/api/system/status');
    expect(res.status).toBe(200);
    const body = json<SystemStatusPayload>(res);
    expect(body.transportMode).toBe('DETERMINISTIC_SANDBOX_REPLAY');
    expect(body.hasPayPalCredentials).toBe(false);
    expect(body.envFilePath).toBe(ABSENT_ENV);
    expect(body.totalScenarios).toBe(24);
    expect(body.regressionPassRate).toBe('72/72 (100%)');
    // Independently recomputed from the same demo seeds (env is hermetic).
    const keys = new VeriPactClient().keys;
    expect(body.keyFingerprints).toEqual({
      buyer: sha256Hex(keys.buyer.publicKeyHex).slice(0, 16),
      witness: sha256Hex(keys.witness.publicKeyHex).slice(0, 16),
      merchant: sha256Hex(keys.merchant.publicKeyHex).slice(0, 16),
    });
    expect(new Set(Object.values(body.keyFingerprints)).size).toBe(3);
    expect(res.body).not.toMatch(/private|secret/i);
    expect(JSON.stringify(body.keyFingerprints)).not.toMatch(/[0-9a-f]{32,}/);
    expect(ROUTES).toContain('/api/system/status');
  });

  it('finalize survives a cleared in-memory map via the disk mirror', async () => {
    const receiptsBefore = snapshotReceipts();
    try {
      const step1 = json<AwaitingBody>(
        await post('/api/merchant/checkout', { scenario: 'normal', twoStep: true }),
      );
      await post('/api/sandbox/approve-order', { orderId: step1.orderId });
      expect(existsSync(PENDING_PATH)).toBe(true);
      clearPendingApprovalsMemory();
      const fin = await post('/api/merchant/checkout/finalize', {
        orderId: step1.orderId,
        scenario: 'normal',
      });
      expect(fin.status).toBe(200);
      const done = json<{ outcome: string; snapshot: { commitment: string } }>(fin);
      expect(done.outcome).toBe('CAPTURED');
      expect(done.snapshot.commitment).toBe(step1.snapshot['commitment']);
    } finally {
      restoreReceipts(receiptsBefore);
      resetDemoState();
    }
  });

  it('locks postMessage to the same origin on both popup and workbench', async () => {
    await post('/api/merchant/checkout', { scenario: 'normal', twoStep: true });
    const popup = await get('/sandbox/paypal-checkout?token=ORD-VP-0001');
    expect(popup.status).toBe(200);
    expect(popup.body).toContain('window.location.origin');
    expect(popup.body).toContain('targetOrigin');
    expect(popup.body).toContain('},targetOrigin)');
    expect(popup.body).not.toContain("},'*')");
    const app = renderIndexPage();
    expect(app).toContain('e.origin===loc.origin');
  });

  it('ships 5 valid SVG screenshots referenced by the README', () => {
    const names = [
      '01-architecture-and-3-rung-ladder.svg',
      '02-view1-witnessed-checkout-and-auditor.svg',
      '03-view1-surcharge-void-and-dom-block.svg',
      '04-view2-contested-dispute-desk.svg',
      '05-regression-suite-wilson-ci.svg',
    ];
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    for (const name of names) {
      const svg = readFileSync(join(process.cwd(), 'docs', 'screenshots', name), 'utf8');
      expect(svg.startsWith('<svg ')).toBe(true);
      expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
      const opens = (svg.match(/<[a-zA-Z][^>]*[^/]>/g) ?? []).length;
      const closes = (svg.match(/<\/[a-zA-Z][^>]*>/g) ?? []).length;
      expect(opens).toBeGreaterThan(0);
      expect(opens).toBe(closes);
      expect(readme).toContain(`docs/screenshots/${name}`);
    }
    const arch = readFileSync(
      join(process.cwd(), 'docs', 'screenshots', names[0] as string),
      'utf8',
    );
    expect(arch).toContain('RUNG 2');
    const view1 = readFileSync(
      join(process.cwd(), 'docs', 'screenshots', names[1] as string),
      'utf8',
    );
    expect(view1).toContain('JCS-PARITY MATCH');
    const desk = readFileSync(
      join(process.cwd(), 'docs', 'screenshots', names[3] as string),
      'utf8',
    );
    expect(desk).toContain('return_window_days: 60 vs 30');
    const reg = readFileSync(
      join(process.cwd(), 'docs', 'screenshots', names[4] as string),
      'utf8',
    );
    expect(reg).toContain('72/72');
  });
});
