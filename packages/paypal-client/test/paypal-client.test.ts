import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatCommitmentPrefix } from '@veripact/core';
import {
  AuthorizationStateConflictError,
  buildAmountPatch,
  buildAuthorizeOrderBody,
  buildCaptureInvoiceId,
  createSandboxReplayEngine,
  defaultEnvFilePath,
  DisputeActionNotPermittedByHateoasError,
  isSandboxBaseUrl,
  orderLinksFor,
  PAYPAL_SANDBOX_BASE_URL,
  PayPalClient,
  PayPalHttpError,
  readDotEnvFile,
  resolvePaypalCredentials,
  resolveProxyForUrl,
  toHateoasActionMap,
  type HttpRequest,
  type HttpResponse,
} from '../src/index';

const HEX = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
const COMMITMENT = `VP1:${HEX}`;

// Hermetic env: no ambient PAYPAL_* / VERIPACT_ENV_FILE may flip tests into live mode.
const HERMETIC_VARS = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'VERIPACT_ENV_FILE'] as const;
const savedEnv = new Map<string, string | undefined>();
const ABSENT_ENV = join(process.cwd(), '.vitest-tmp', 'absent-credentials.env');

beforeEach(() => {
  for (const v of HERMETIC_VARS) savedEnv.set(v, process.env[v]);
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;
  process.env.VERIPACT_ENV_FILE = ABSENT_ENV;
  vi.restoreAllMocks();
});

afterEach(() => {
  for (const v of HERMETIC_VARS) {
    const prev = savedEnv.get(v);
    if (prev === undefined) delete process.env[v];
    else process.env[v] = prev;
  }
  savedEnv.clear();
});

function replayClient() {
  const replay = createSandboxReplayEngine();
  const client = new PayPalClient({ replay });
  return { client, replay };
}

describe('@veripact/paypal-client', () => {
  it('resolves @veripact/core across the workspace boundary', () => {
    expect(formatCommitmentPrefix(HEX)).toBe(COMMITMENT);
  });

  it('builds a single-unit AUTHORIZE order body with VP1 custom_id', () => {
    const body = buildAuthorizeOrderBody({
      receiptSha256Hex: HEX,
      description: 'Apex 27-inch 4K Monitor',
      itemTotal: '279.00',
    });
    expect(body.intent).toBe('AUTHORIZE');
    expect(body.purchase_units).toHaveLength(1);
    expect(body.purchase_units[0]?.custom_id).toBe(COMMITMENT);
    expect(body.purchase_units[0]?.reference_id).toBe('default');
  });

  it('builds an amount-replace patch totaling item + shipping + tax', () => {
    const [op] = buildAmountPatch('279.00', '11.50', '6.50');
    expect(op?.op).toBe('replace');
    expect(op?.path).toContain("@reference_id=='default'");
    expect((op?.value as { value: string }).value).toBe('297.00');
  });

  it('indexes HATEOAS links by rel', () => {
    const map = toHateoasActionMap([
      { rel: 'self', href: 'https://x/self', method: 'GET' },
      { rel: 'escalate', href: 'https://x/escalate', method: 'POST' },
    ]);
    expect(map['escalate']?.method).toBe('POST');
    expect(map['accept-claim']).toBeUndefined();
  });

  it('accepts the sandbox host and rejects anything else', () => {
    expect(isSandboxBaseUrl(PAYPAL_SANDBOX_BASE_URL)).toBe(true);
    expect(isSandboxBaseUrl('https://api-m.paypal.com')).toBe(false);
    const client = new PayPalClient({ clientId: 'id', clientSecret: 'secret' });
    expect(client.hasCredentials()).toBe(true);
    expect(client.transportMode).toBe('LIVE_PAYPAL_SANDBOX');
    expect(() => new PayPalClient({ clientId: 'i', clientSecret: 's', baseUrl: 'https://evil.test' })).toThrow(
      /non-sandbox/,
    );
    expect(() => new PayPalClient({ mode: 'live' })).toThrow(/requires PAYPAL_CLIENT_ID/);
    expect(new PayPalClient({}).transportMode).toBe('DETERMINISTIC_SANDBOX_REPLAY');
  });

  it('creates an order in replay with the VP1 custom_id round-trip', async () => {
    const { client } = replayClient();
    const order = await client.createAuthorizeOrder({
      commitment: COMMITMENT,
      description: 'witnessed checkout',
      itemTotalUsd: 279,
    });
    expect(order.transportMode).toBe('DETERMINISTIC_SANDBOX_REPLAY');
    expect(order.orderId).toMatch(/^ORD-VP-\d{4}$/);
    expect(order.status).toBe('CREATED');
    expect(order.customId).toBe(COMMITMENT);
    const readback = await client.getOrder(order.orderId);
    expect(readback.customId).toBe(COMMITMENT);
    expect(readback.amountBreakdown.totalUsd).toBe(279);
  });

  it('rejects malformed commitments before any transport call', async () => {
    const { client, replay } = replayClient();
    await expect(
      client.createAuthorizeOrder({ commitment: 'VP1:zzz', description: 'd', itemTotalUsd: 1 }),
    ).rejects.toThrow(/VP1:<64 hex>/);
    expect(replay.stats().orders).toBe(0);
  });

  it('patches shipping/tax, approves, and authorizes in order', async () => {
    const { client } = replayClient();
    const order = await client.createAuthorizeOrder({
      commitment: COMMITMENT,
      description: 'd',
      itemTotalUsd: 279,
    });
    const patched = await client.patchOrderShippingAndTax(order.orderId, {
      itemTotalUsd: 279,
      shippingUsd: 11.5,
      taxUsd: 6.5,
    });
    expect(patched.finalTotalUsd).toBe(297);
    // Authorize requires payer approval first.
    await expect(client.authorizeOrder(order.orderId)).rejects.toThrow(/APPROVED/);
    client.simulatePayerApproval(order.orderId);
    const authorized = await client.authorizeOrder(order.orderId);
    expect(authorized.status).toBe('COMPLETED');
    expect(authorized.authorizationId).toMatch(/^AUTH-VP-\d{4}$/);
    expect(authorized.amountBreakdown.totalUsd).toBe(297);
  });

  it('captures exactly once with VPA invoice_id and final_capture', async () => {
    const { client } = replayClient();
    const order = await client.createAuthorizeOrder({
      commitment: COMMITMENT,
      description: 'd',
      itemTotalUsd: 279,
    });
    client.simulatePayerApproval(order.orderId);
    const authorized = await client.authorizeOrder(order.orderId);
    const authId = authorized.authorizationId ?? '';
    const capture = await client.captureAuthorizationExact({
      authorizationId: authId,
      addendumSha256: HEX,
      amountUsd: 297,
      noteToPayer: 'VeriPact Verified Capture',
    });
    expect(capture.captureId).toMatch(/^CAP-VP-\d{4}$/);
    expect(capture.invoiceId).toBe(`VPA-${HEX.slice(0, 28)}`);
    expect(capture.invoiceId.length).toBeLessThanOrEqual(127);
    expect(capture.finalCapture).toBe(true);
    expect(capture.amountUsd).toBe(297);
    expect(buildCaptureInvoiceId(HEX)).toBe(capture.invoiceId);
    // Second capture violates the one-way lock at the client layer.
    await expect(
      client.captureAuthorizationExact({ authorizationId: authId, addendumSha256: HEX }),
    ).rejects.toBeInstanceOf(AuthorizationStateConflictError);
    // ...and void-after-capture is refused too.
    await expect(client.voidAuthorization({ authorizationId: authId })).rejects.toBeInstanceOf(
      AuthorizationStateConflictError,
    );
  });

  it('voids uncaptured authorizations and refuses capture-after-void', async () => {
    const { client, replay } = replayClient();
    const order = await client.createAuthorizeOrder({
      commitment: COMMITMENT,
      description: 'd',
      itemTotalUsd: 279,
    });
    client.simulatePayerApproval(order.orderId);
    const authorized = await client.authorizeOrder(order.orderId);
    const authId = authorized.authorizationId ?? '';
    const voided = await client.voidAuthorization({ authorizationId: authId });
    expect(voided.status).toBe('VOIDED');
    expect(replay.getAuthorization(authId).status).toBe('VOIDED');
    await expect(
      client.captureAuthorizationExact({ authorizationId: authId, addendumSha256: HEX }),
    ).rejects.toBeInstanceOf(AuthorizationStateConflictError);
  });

  it('dedupes mutating calls on PayPal-Request-Id', async () => {
    const { client } = replayClient();
    const input = { commitment: COMMITMENT, description: 'd', itemTotalUsd: 279, requestId: 'idem-1' };
    const first = await client.createAuthorizeOrder(input);
    const second = await client.createAuthorizeOrder(input);
    expect(second.orderId).toBe(first.orderId);
  });

  it('seeds two contested disputes with HATEOAS-gated actions', async () => {
    const { client } = replayClient();
    const disputes = await client.listDisputes();
    expect(disputes.map((d) => d.disputeId).sort()).toEqual([
      'PP-D-CASE-A-DRIFT',
      'PP-D-CASE-B-FORGERY',
    ]);
    const forgery = await client.getDispute('PP-D-CASE-B-FORGERY');
    expect(forgery.lifeCycleStage).toBe('INQUIRY');
    expect(forgery.allowedActions).toContain('require-evidence');
    expect(forgery.allowedActions).toContain('escalate');
    expect(forgery.allowedActions).not.toContain('provide-evidence');
  });

  it('refuses actions the dispute does not advertise', async () => {
    const { client } = replayClient();
    await expect(
      client.provideDisputeEvidence({
        disputeId: 'PP-D-CASE-B-FORGERY',
        evidenceType: 'OTHER',
        notes: 'too early',
      }),
    ).rejects.toBeInstanceOf(DisputeActionNotPermittedByHateoasError);
    await expect(client.adjudicateDisputeSandbox('PP-D-CASE-B-FORGERY', 'SELLER_FAVOR')).rejects
      .toBeInstanceOf(DisputeActionNotPermittedByHateoasError);
  });

  it('drives Case B require → provide → escalate → require → provide → adjudicate', async () => {
    const { client } = replayClient();
    const id = 'PP-D-CASE-B-FORGERY';
    await client.requireDisputeEvidence(id, 'SELLER_EVIDENCE');
    const afterProvide = await client.provideDisputeEvidence({
      disputeId: id,
      evidenceType: 'OTHER',
      notes: 'forensic mismatch report',
    });
    expect(afterProvide.evidenceCount).toBe(1);
    const charged = await client.escalateDisputeToClaim(id);
    expect(charged.lifeCycleStage).toBe('CHARGEBACK');
    await client.requireDisputeEvidence(id, 'SELLER_EVIDENCE');
    await client.provideDisputeEvidence({ disputeId: id, evidenceType: 'OTHER', notes: 'exhibit 2' });
    const resolved = await client.adjudicateDisputeSandbox(id, 'SELLER_FAVOR');
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.outcome).toBe('SELLER_FAVOR');
    expect(resolved.allowedActions).toEqual(['self']);
  });

  it('resolves Case A via escalate → accept-claim', async () => {
    const { client } = replayClient();
    const id = 'PP-D-CASE-A-DRIFT';
    await client.escalateDisputeToClaim(id);
    const resolved = await client.acceptDisputeClaim(id);
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.outcome).toBe('BUYER_FAVOR');
  });

  it('enforces evidence limits pre-transport', async () => {
    const { client } = replayClient();
    const id = 'PP-D-CASE-B-FORGERY';
    await client.requireDisputeEvidence(id, 'SELLER_EVIDENCE');
    await expect(
      client.provideDisputeEvidence({ disputeId: id, evidenceType: 'OTHER', notes: 'x'.repeat(2001) }),
    ).rejects.toThrow(/2000/);
    await expect(
      client.provideDisputeEvidence({ disputeId: id, evidenceType: 'lowercase!', notes: 'n' }),
    ).rejects.toThrow(/evidence_type/);
  });

  it('verifies webhooks with all 7 fields and rejects partial input', async () => {
    const { client } = replayClient();
    const input = {
      authAlgo: 'SHA256withRSA',
      certUrl: 'https://api.sandbox.paypal.com/certs/1',
      transmissionId: 't-1',
      transmissionSig: 'sig',
      transmissionTime: '2026-11-01T00:00:00Z',
      webhookId: 'WH-1',
      webhookEvent: { id: 'EVT-1' },
    };
    const result = await client.verifyWebhookSignature(input);
    expect(result).toMatchObject({ verified: true, status: 'SUCCESS' });
    await expect(
      client.verifyWebhookSignature({ ...input, transmissionSig: '' }),
    ).rejects.toThrow(/transmissionSig/);
  });

  it('live mode sends Bearer + PayPal-Request-Id and caches the token', async () => {
    const seen: Array<{ path: string; headers: Record<string, string> }> = [];
    let tokenFetches = 0;
    const transport = (baseUrl: string, req: HttpRequest): Promise<HttpResponse> => {
      seen.push({ path: req.path, headers: req.headers ?? {} });
      if (req.path === '/v1/oauth2/token') {
        tokenFetches += 1;
        const auth = req.headers?.['Authorization'] ?? '';
        expect(auth).toBe(`Basic ${Buffer.from('id:sh', 'utf8').toString('base64')}`);
        return Promise.resolve({
          status: 200,
          bodyText: JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
        });
      }
      return Promise.resolve({
        status: 201,
        bodyText: JSON.stringify({
          id: 'ORD-LIVE-1',
          status: 'CREATED',
          create_time: '2026-11-01T00:00:00Z',
          purchase_units: [
            {
              custom_id: COMMITMENT,
              amount: {
                currency_code: 'USD',
                value: '279.00',
                breakdown: {
                  item_total: { currency_code: 'USD', value: '279.00' },
                  shipping: { currency_code: 'USD', value: '0.00' },
                  tax_total: { currency_code: 'USD', value: '0.00' },
                },
              },
            },
          ],
        }),
      });
    };
    const client = new PayPalClient({
      clientId: 'id',
      clientSecret: 'sh',
      mode: 'live',
      httpTransport: transport,
    });
    await client.createAuthorizeOrder({ commitment: COMMITMENT, description: 'd', itemTotalUsd: 279 });
    await client.createAuthorizeOrder({ commitment: COMMITMENT, description: 'd', itemTotalUsd: 279 });
    expect(tokenFetches).toBe(1);
    const orderCalls = seen.filter((s) => s.path === '/v2/checkout/orders');
    expect(orderCalls).toHaveLength(2);
    for (const call of orderCalls) {
      expect(call.headers['Authorization']).toBe('Bearer tok');
      expect(call.headers['PayPal-Request-Id']).toBeDefined();
    }
    expect(orderCalls[0]?.headers['PayPal-Request-Id']).not.toBe(
      orderCalls[1]?.headers['PayPal-Request-Id'],
    );
  });

  it('never leaks the client secret into errors or JSON', async () => {
    const transport = (_baseUrl: string, req: HttpRequest): Promise<HttpResponse> => {
      if (req.path === '/v1/oauth2/token') {
        return Promise.resolve({
          status: 200,
          bodyText: JSON.stringify({ access_token: 'tok', expires_in: 1 }),
        });
      }
      return Promise.resolve({ status: 422, bodyText: JSON.stringify({ message: 'bad' }) });
    };
    const client = new PayPalClient({
      clientId: 'id',
      clientSecret: 'SECRET-XYZ-UNIQUE',
      mode: 'live',
      httpTransport: transport,
    });
    const failure = await client
      .createAuthorizeOrder({ commitment: COMMITMENT, description: 'd', itemTotalUsd: 279 })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(failure).toBeInstanceOf(PayPalHttpError);
    expect((failure as Error).message).not.toContain('SECRET-XYZ-UNIQUE');
    expect(JSON.stringify(client)).not.toContain('SECRET-XYZ-UNIQUE');
    expect(JSON.parse(JSON.stringify(client))).toEqual({
      baseUrl: PAYPAL_SANDBOX_BASE_URL,
      transportMode: 'LIVE_PAYPAL_SANDBOX',
      hasCredentials: true,
    });
  });

  it('routes proxies per env with NO_PROXY bypass', () => {
    const saved = { ...process.env };
    try {
      process.env['HTTPS_PROXY'] = 'http://proxy.test:8080';
      process.env['NO_PROXY'] = '';
      expect(resolveProxyForUrl('https://api-m.sandbox.paypal.com/x')).toBe('http://proxy.test:8080/');
      process.env['NO_PROXY'] = 'api-m.sandbox.paypal.com';
      expect(resolveProxyForUrl('https://api-m.sandbox.paypal.com/x')).toBeUndefined();
      process.env['NO_PROXY'] = '*';
      expect(resolveProxyForUrl('https://x.test/')).toBeUndefined();
      delete process.env['HTTPS_PROXY'];
      delete process.env['https_proxy'];
      process.env['NO_PROXY'] = '';
      expect(resolveProxyForUrl('https://x.test/')).toBeUndefined();
      expect(resolveProxyForUrl('::bad::')).toBeUndefined();
    } finally {
      process.env = saved;
    }
  });

  it('orderLinksFor emits a replay approve link while CREATED, self-only afterwards', () => {
    const created = orderLinksFor({ id: 'ORD-VP-0001', status: 'CREATED' });
    const approve = created.find((l) => l.rel === 'approve');
    expect(created.find((l) => l.rel === 'self')).toBeDefined();
    expect(approve).toEqual({
      href: '/sandbox/paypal-checkout?token=ORD-VP-0001',
      rel: 'approve',
      method: 'GET',
    });
    expect(
      orderLinksFor({ id: 'ORD-VP-0001', status: 'APPROVED' }).some((l) => l.rel === 'approve'),
    ).toBe(false);
    expect(orderLinksFor({ id: 'ORD-VP-0001', status: 'COMPLETED' })).toHaveLength(1);
  });

  it('parses approveUrl on replay orders and clears it after approval', async () => {
    const { client } = replayClient();
    const created = await client.createAuthorizeOrder({
      commitment: COMMITMENT,
      description: 'Approval popup test order',
      itemTotalUsd: 279,
    });
    expect(created.status).toBe('CREATED');
    expect(created.approveUrl).toBe(`/sandbox/paypal-checkout?token=${created.orderId}`);
    client.simulatePayerApproval(created.orderId);
    const approved = await client.getOrder(created.orderId);
    expect(approved.status).toBe('APPROVED');
    expect(approved.approveUrl).toBeUndefined();
  });

  it('parses live-shaped approve and payer-action links', async () => {
    const { parseOrderRecord } = await import('../src/orders');
    const fromApprove = parseOrderRecord('LIVE_PAYPAL_SANDBOX', {
      id: 'LIVE-1',
      status: 'CREATED',
      links: [{ href: 'https://www.sandbox.paypal.com/checkoutnow?token=LIVE-1', rel: 'approve', method: 'GET' }],
    });
    expect(fromApprove.approveUrl).toBe('https://www.sandbox.paypal.com/checkoutnow?token=LIVE-1');
    expect(fromApprove.transportMode).toBe('LIVE_PAYPAL_SANDBOX');
    const fromPayerAction = parseOrderRecord('LIVE_PAYPAL_SANDBOX', {
      id: 'LIVE-2',
      status: 'CREATED',
      links: [{ href: 'https://www.sandbox.paypal.com/checkoutnow?token=LIVE-2', rel: 'payer-action', method: 'GET' }],
    });
    expect(fromPayerAction.approveUrl).toBe('https://www.sandbox.paypal.com/checkoutnow?token=LIVE-2');
  });

  it('readDotEnvFile parses quoted/export syntax and ignores comments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vp-env-'));
    try {
      const file = join(dir, '.env');
      writeFileSync(
        file,
        '# VeriPact demo creds\nexport PAYPAL_CLIENT_ID="abc123"\nPAYPAL_CLIENT_SECRET=secret-xyz  \nEMPTY=\nNOT_A_PAIR\n',
      );
      expect(readDotEnvFile(file)).toEqual({
        PAYPAL_CLIENT_ID: 'abc123',
        PAYPAL_CLIENT_SECRET: 'secret-xyz',
        EMPTY: '',
      });
      expect(readDotEnvFile(join(dir, 'missing.env'))).toEqual({});
      // Hermetic hook set defaultEnvFilePath to the absent override...
      expect(defaultEnvFilePath()).toBe(ABSENT_ENV);
      // ...and without the override it falls back to <cwd>/.env.
      delete process.env.VERIPACT_ENV_FILE;
      expect(defaultEnvFilePath()).toBe(join(process.cwd(), '.env'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolvePaypalCredentials prefers explicit, then env, then disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vp-env-'));
    try {
      const file = join(dir, '.env');
      writeFileSync(file, 'PAYPAL_CLIENT_ID=disk-id\nPAYPAL_CLIENT_SECRET=disk-secret\n');
      expect(resolvePaypalCredentials({ clientId: 'x', clientSecret: 'y' }, file)).toEqual({
        clientId: 'x',
        clientSecret: 'y',
      });
      process.env.PAYPAL_CLIENT_ID = 'env-id';
      process.env.PAYPAL_CLIENT_SECRET = 'env-secret';
      expect(resolvePaypalCredentials({}, file)).toEqual({
        clientId: 'env-id',
        clientSecret: 'env-secret',
      });
      delete process.env.PAYPAL_CLIENT_ID;
      delete process.env.PAYPAL_CLIENT_SECRET;
      expect(resolvePaypalCredentials({}, file)).toEqual({
        clientId: 'disk-id',
        clientSecret: 'disk-secret',
      });
      expect(resolvePaypalCredentials({}, join(dir, 'missing.env'))).toEqual({
        clientId: '',
        clientSecret: '',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects non-finite or negative order totals', async () => {
    const { client } = replayClient();
    for (const total of [NaN, Infinity, -Infinity, -5, '279' as unknown as number]) {
      await expect(
        client.createAuthorizeOrder({ commitment: COMMITMENT, description: 't', itemTotalUsd: total }),
      ).rejects.toThrow('itemTotalUsd must be a finite USD amount');
    }
    const zero = await client.createAuthorizeOrder({
      commitment: COMMITMENT,
      description: 'free item',
      itemTotalUsd: 0,
    });
    expect(zero.status).toBe('CREATED');
    expect(zero.amountBreakdown.itemTotalUsd).toBe(0);
  });

  it('hot-reloads credentials dropped into disk mid-session', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vp-env-'));
    try {
      const file = join(dir, '.env');
      writeFileSync(file, '# empty for now\n');
      process.env.VERIPACT_ENV_FILE = file;
      const cold = new PayPalClient({});
      expect(cold.transportMode).toBe('DETERMINISTIC_SANDBOX_REPLAY');
      writeFileSync(file, 'PAYPAL_CLIENT_ID=hot-id\nPAYPAL_CLIENT_SECRET=hot-secret\n');
      const hot = new PayPalClient({});
      expect(hot.transportMode).toBe('LIVE_PAYPAL_SANDBOX');
      expect(hot.hasCredentials()).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
