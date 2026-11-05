/**
 * Red-team security suite for @veripact/workbench (run 07 audit lock-in).
 * Adversarial inputs against the real route layer: script breakout, oversize
 * bodies, prototype pollution, path traversal, and secret leakage. All
 * assertions run through `handleWorkbenchRequest` with no sockets.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  handleWorkbenchRequest,
  MAX_BODY_BYTES,
  renderIndexPage,
  resetDemoState,
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

const ABSENT_ENV = join(process.cwd(), '.vitest-tmp', 'absent-credentials.env');

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

describe('@veripact/workbench red team', () => {
  it('neutralizes script payloads in mandate fields as inert JSON data', async () => {
    const payload = '<script>alert("REDTEAM-XSS-MANDATE")</script>';
    const res = await post('/api/buyer/mandate', {
      itemQuery: payload,
      constraints: { maxAllInPriceUsd: 100 },
    });
    expect(res.status).toBe(200);
    // JSON API: the payload round-trips as data under a JSON content type
    // (never HTML), with nosniff + DENY framing on every response.
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    const body = JSON.parse(res.body) as {
      mandate: { itemQuery: string; buyerSignatureHex: string; buyerPublicKeyHex: string };
    };
    expect(body.mandate.itemQuery).toBe(payload);
    expect(body.mandate.buyerSignatureHex).toMatch(/^[0-9a-f]{128}$/);
  });

  it('rejects script-bearing query tokens without reflecting them', async () => {
    const res = await get('/sandbox/paypal-checkout?token=%3Cscript%3Ealert(%27REDTEAM-XSS-TOKEN%27)%3C/script%3E');
    expect(res.status).toBe(400);
    expect(res.body).toContain('Cannot load order.');
    expect(res.body).not.toContain('REDTEAM-XSS-TOKEN');
    const badStore = await get('/store/<script>alert(1)</script>');
    expect(badStore.status).toBe(400);
  });

  it('carries dispute notes as data and enforces the 2000-char cap', async () => {
    const payload = 'Forensic note <script>alert("REDTEAM-XSS-NOTE")</script>';
    // HATEOAS chain: require-evidence must be advertised before provide-evidence.
    const req = await post('/api/merchant/disputes/action', {
      disputeId: 'PP-D-CASE-B-FORGERY',
      action: 'require-evidence',
      requireAction: 'BUYER_EVIDENCE',
    });
    expect(req.status).toBe(200);
    const ok = await post('/api/merchant/disputes/action', {
      disputeId: 'PP-D-CASE-B-FORGERY',
      action: 'provide-evidence',
      evidenceType: 'OTHER',
      notes: payload,
    });
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('application/json');
    // Data minimization: notes are stored server-side; the record echoes
    // only a count, so the payload is never reflected to any reader.
    const record = JSON.parse(ok.body) as { record: { evidenceCount: number } };
    expect(record.record.evidenceCount).toBe(1);
    expect(ok.body).not.toContain('REDTEAM-XSS-NOTE');
    // Cap probe on the second seeded dispute (fresh HATEOAS chain).
    const desk = JSON.parse((await get('/api/merchant/disputes')).body) as {
      disputes: Array<{ record: { disputeId: string } }>;
    };
    const otherId = desk.disputes[1]?.record.disputeId ?? '';
    const req2 = await post('/api/merchant/disputes/action', {
      disputeId: otherId,
      action: 'require-evidence',
      requireAction: 'SELLER_EVIDENCE',
    });
    expect(req2.status).toBe(200);
    const tooLong = await post('/api/merchant/disputes/action', {
      disputeId: otherId,
      action: 'provide-evidence',
      evidenceType: 'OTHER',
      notes: 'x'.repeat(2001),
    });
    expect(tooLong.status).toBe(500);
    expect(tooLong.body).toContain('2000');
  });

  it('rejects path-traversal disputeIds at the route boundary', async () => {
    for (const hostile of [
      '../v1/customer/disputes/x',
      '..%2F..%2Fetc',
      'PP-D-1/require-evidence',
      'PP-D-1?x=1',
      'PP-D-1\n',
      '',
    ]) {
      const res = await post('/api/merchant/disputes/action', {
        disputeId: hostile,
        action: 'escalate',
      });
      expect(res.status).toBe(400);
      expect(res.body).toContain('disputeId');
    }
    // Legit ids still route (unknown-but-wellformed → downstream 404/500, not 400).
    const legit = await post('/api/merchant/disputes/action', {
      disputeId: 'PP-D-CASE-B-FORGERY',
      action: 'bogus-action',
    });
    expect(legit.status).toBe(400);
    expect(legit.body).toContain('unknown dispute action');
  });

  it('enforces the 1MB body cap with 413 and keeps serving', async () => {
    expect(MAX_BODY_BYTES).toBe(1_000_000);
    const huge = `{"scenario":"normal","pad":"${'x'.repeat(1_100_000)}"}`;
    const blocked = await post('/api/merchant/checkout', undefined, huge);
    expect(blocked.status).toBe(413);
    expect(blocked.body).toContain('too large');
    const streamRes = await post('/api/merchant/disputes/action', undefined, huge);
    expect(streamRes.status).toBe(413);
    // Server is unharmed: the next request succeeds.
    const healthy = await get('/health');
    expect(healthy.status).toBe(200);
    expect(JSON.parse(healthy.body) as { ok: boolean }).toEqual(
      expect.objectContaining({ ok: true }),
    );
  });

  it('accepts a body at exactly the cap and rejects cap+1 byte', async () => {
    const prefix = '{"scenario":"normal","pad":"';
    const suffix = '"}';
    const under = await post(
      '/api/merchant/checkout',
      undefined,
      `${prefix}${'x'.repeat(MAX_BODY_BYTES - prefix.length - suffix.length)}${suffix}`,
    );
    expect(under.status).toBe(200);
    const over = await post(
      '/api/merchant/checkout',
      undefined,
      `${prefix}${'x'.repeat(MAX_BODY_BYTES - prefix.length - suffix.length + 1)}${suffix}`,
    );
    expect(over.status).toBe(413);
  });

  it('handles prototype pollution and malformed JSON without polluting', async () => {
    const polluted = await post(
      '/api/merchant/checkout',
      undefined,
      '{"scenario":"normal","__proto__":{"polluted":true}}',
    );
    // Unknown fields are ignored; the known field still routes.
    expect(polluted.status).toBe(200);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
    const mand = await post('/api/buyer/mandate', undefined, '{"__proto__":{"polluted":true}}');
    expect(mand.status).toBe(200);
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
    for (const bad of ['{"scenario":"norm', '[1,2,3]', '"str"', 'not json{{']) {
      const res = await post('/api/merchant/checkout', undefined, bad);
      expect(res.status).toBe(400);
    }
    const emptyArray = await post('/api/buyer/mandate', undefined, '[]');
    expect(emptyArray.status).toBe(400);
  });

  it('leaks zero secret material across routes and error paths', async () => {
    const canaries = {
      BUYER_ED25519_PRIVATE_KEY: 'b1'.repeat(32),
      WITNESS_ED25519_PRIVATE_KEY: 'c2'.repeat(32),
      MERCHANT_ED25519_PRIVATE_KEY: 'd3'.repeat(32),
      PAYPAL_CLIENT_ID: 'REDTEAM-PAYPAL-ID',
      PAYPAL_CLIENT_SECRET: 'REDTEAM-PAYPAL-SECRET',
    };
    for (const [k, v] of Object.entries(canaries)) {
      process.env[k] = v;
    }
    const bodies: string[] = [];
    try {
      // Replay-safe routes + every error shape (no live PayPal calls here).
      bodies.push((await get('/health')).body);
      bodies.push((await get('/api/system/status')).body);
      bodies.push((await get('/')).body);
      bodies.push((await get('/store/normal')).body);
      bodies.push((await post('/api/witness/snapshot', { scenario: 'normal' })).body);
      bodies.push((await post('/api/buyer/mandate', { mandate: { nope: true } })).body);
      bodies.push((await post('/api/merchant/checkout', { scenario: 'nope' })).body);
      bodies.push((await post('/api/merchant/checkout', undefined, '{"truncated')).body);
      bodies.push((await post('/api/merchant/checkout/finalize', { orderId: '<oops>' })).body);
      bodies.push((await get('/sandbox/paypal-checkout?token=%3Cscript%3E')).body);
      bodies.push((await post('/api/merchant/disputes/action', { disputeId: 'x', action: 'y' })).body);
      bodies.push((await get('/no-such-route')).body);
      bodies.push((await get('/api/benchmark')).body);
      bodies.push(
        (
          await post('/api/buyer/mandate/update', {
            maxAllInPriceUsd: 290,
            requiredCondition: 'NEW',
            minReturnWindowDays: 30,
            maxRestockingFeePct: 0,
          })
        ).body,
      );
      bodies.push((await post('/api/witness/custom-html', { html: '<h1>t</h1>' })).body);
      bodies.push((await post('/api/system/credentials', { replay: true })).body);
      bodies.push((await get('/api/ledger')).body);
    } finally {
      for (const k of Object.keys(canaries)) {
        delete process.env[k];
      }
    }
    for (const canary of Object.values(canaries)) {
      for (const body of bodies) {
        expect(body).not.toContain(canary);
      }
    }
    // And the status endpoint still only exposes short public fingerprints.
    const status = JSON.parse(bodies[1] as string) as {
      hasPayPalCredentials: boolean;
      keyFingerprints: Record<string, string>;
    };
    expect(status.hasPayPalCredentials).toBe(true);
    for (const fp of Object.values(status.keyFingerprints)) {
      expect(fp).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('serves the dispute UI with client-side escaping and no secret sinks', () => {
    const html = renderIndexPage();
    expect(html).toContain('function esc(');
    expect(html).not.toContain('PRIVATE_KEY');
    expect(html).not.toContain('PAYPAL_CLIENT_SECRET');
  });

  it('frames same-origin storefront previews while denying everything else', async () => {
    const store = await get('/store/normal');
    expect(store.status).toBe(200);
    expect(store.headers['x-frame-options']).toBe('SAMEORIGIN');
    const app = await get('/');
    expect(app.headers['x-frame-options']).toBe('DENY');
    await post('/api/merchant/checkout', { scenario: 'normal', twoStep: true });
    const popup = await get('/sandbox/paypal-checkout?token=ORD-VP-0001');
    expect(popup.headers['x-frame-options']).toBe('DENY');
  });

  it('keeps fallback grid cells on one line with clipped hashes', () => {
    const html = renderIndexPage();
    expect(html).toContain('white-space:nowrap');
    expect(html).toContain('.fallback-table .hash-chip{max-width:260px}');
    expect(html).toContain('#ag-live-disputes-grid,#ag-regression-benchmark-grid{overflow-x:auto');
  });

  it('wraps inspector diff pills inside narrow columns', () => {
    const html = renderIndexPage();
    expect(html).toMatch(/\.diff-pill\{[^}]*white-space:normal[^}]*overflow-wrap:anywhere/);
    expect(html).toMatch(/\.wit-pill\{[^}]*white-space:normal[^}]*overflow-wrap:anywhere/);
  });

  it('guards finalize against double-submit and resets on settle', () => {
    const html = renderIndexPage();
    expect(html).toContain('var finalizing=false;');
    expect(html).toMatch(/function finalizeApproved\(orderId\)\{if\(finalizing\)return;finalizing=true;/);
    expect(html).toMatch(/\.finally\(function\(\)\{finalizing=false;/);
  });
});
