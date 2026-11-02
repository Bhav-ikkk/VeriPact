import { createContext, runInContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  canonicalizeJson,
  COMMITMENT_PREFIX,
  verifyCanonicalPayload,
  type MandateSpec,
} from '@veripact/core';
import {
  handleWorkbenchRequest,
  renderIndexPage,
  resetDemoState,
  ROUTES,
  WORKBENCH_VERSION,
  type HealthPayload,
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
] as const;

const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of ENV_VARS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
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
      window: {},
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
});
