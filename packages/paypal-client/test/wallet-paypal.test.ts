import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { WalletOrderRecord } from '@veripact/core';
import {
  createSandboxReplayEngine,
  legacyUnwitnessedFixtures,
  mapReportingStatusCode,
  PayPalClient,
  RefundStateConflictError,
  REPORTING_INDEXING_DELAY_DISCLOSURE,
  ReportingRangeExceededError,
  syncAccountPayments,
  validateSearchWindow,
  type HttpResponse,
} from '../src/index';

// Hermetic env: no ambient PAYPAL_* / VERIPACT_ENV_FILE may flip tests into live mode.
const HERMETIC_VARS = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'VERIPACT_ENV_FILE'] as const;
const savedEnv = new Map<string, string | undefined>();
const ABSENT_ENV = join(process.cwd(), '.vitest-tmp', 'absent-credentials.env');

beforeEach(() => {
  for (const v of HERMETIC_VARS) savedEnv.set(v, process.env[v]);
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;
  process.env.VERIPACT_ENV_FILE = ABSENT_ENV;
});

afterEach(() => {
  for (const v of HERMETIC_VARS) {
    const prev = savedEnv.get(v);
    if (prev === undefined) delete process.env[v];
    else process.env[v] = prev;
  }
  savedEnv.clear();
});

const HEX = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
const COMMITMENT = `VP1:${HEX}`;

function replayClient() {
  const replay = createSandboxReplayEngine();
  const client = new PayPalClient({ replay });
  return { client, replay };
}

async function capturedFixture(client: PayPalClient): Promise<{ captureId: string; amountUsd: number }> {
  const order = await client.createAuthorizeOrder({
    commitment: COMMITMENT,
    description: 'wallet refund fixture',
    itemTotalUsd: 279,
  });
  await client.patchOrderShippingAndTax(order.orderId, {
    itemTotalUsd: 279,
    shippingUsd: 11.5,
    taxUsd: 6.5,
  });
  client.simulatePayerApproval(order.orderId);
  const authorized = await client.authorizeOrder(order.orderId);
  const capture = await client.captureAuthorizationExact({
    authorizationId: authorized.authorizationId ?? '',
    addendumSha256: HEX,
    amountUsd: 297,
  });
  return { captureId: capture.captureId, amountUsd: capture.amountUsd };
}

describe('@veripact/paypal-client v5 wallet surface', () => {
  it('vaults a payer: setup token → payment token', async () => {
    const { client } = replayClient();
    const setup = await client.createVaultSetupToken({
      payerEmail: 'buyer@example.com',
      returnUrl: 'https://example.com/return',
      cancelUrl: 'https://example.com/cancel',
    });
    expect(setup.setupTokenId).toMatch(/^SETUP-VP-/);
    expect(setup.transportMode).toBe('DETERMINISTIC_SANDBOX_REPLAY');
    const vaulted = await client.approveVaultPaymentToken({
      setupTokenId: setup.setupTokenId,
      payerEmail: 'buyer@example.com',
    });
    expect(vaulted.vaultId).toMatch(/^PM-VP-VAULT-/);
    expect(vaulted.status).toBe('VAULTED');
    await expect(
      client.approveVaultPaymentToken({ setupTokenId: 'SETUP-VP-9999', payerEmail: 'x@y.zz' }),
    ).rejects.toThrow('vault setup token not found');
    await expect(
      client.createVaultSetupToken({ payerEmail: 'not-an-email', returnUrl: 'r', cancelUrl: 'c' }),
    ).rejects.toThrow('payerEmail must be a valid email address');
  });

  it('refunds a capture once, then conflicts (one-way lock, both layers)', async () => {
    const { client, replay } = replayClient();
    const { captureId } = await capturedFixture(client);
    const refund = await client.refundCapturedPayment({
      captureId,
      amountUsd: 297,
      noteToPayer: 'VeriPact Partition Undo',
    });
    expect(refund.refundId).toMatch(/^RFD-VP-/);
    expect(refund.amountUsd).toBe(297);
    expect(refund.status).toBe('COMPLETED');
    // In-session repeat → client lock.
    await expect(client.refundCapturedPayment({ captureId, amountUsd: 297 })).rejects.toThrow(
      RefundStateConflictError,
    );
    // Cross-instance repeat → engine truth (fresh client, same engine).
    const twin = new PayPalClient({ replay });
    expect(twin.transportMode).toBe('DETERMINISTIC_SANDBOX_REPLAY');
    await expect(
      twin.refundCapturedPayment({ captureId, amountUsd: 1, requestId: 'other-key' }),
    ).rejects.toThrow(RefundStateConflictError);
    // Unknown capture → not found (never a phantom refund).
    await expect(client.refundCapturedPayment({ captureId: 'CAP-VP-9999' })).rejects.toThrow(
      'capture not found',
    );
  });

  it('validates the reporting window: RFC3339, 31-day cap, pageSize (GAP-06)', () => {
    const start = '2026-10-01T00:00:00.000Z';
    const end = '2026-10-15T00:00:00.000Z';
    expect(validateSearchWindow({ startDateIso: start, endDateIso: end })).toMatchObject({
      startDateIso: start,
      endDateIso: end,
      pageSize: 100,
    });
    expect(() =>
      validateSearchWindow({ startDateIso: '2026-10-01', endDateIso: end }),
    ).toThrow('must be an RFC 3339 timestamp');
    expect(() =>
      validateSearchWindow({ startDateIso: end, endDateIso: start }),
    ).toThrow('endDateIso must be after startDateIso');
    expect(() =>
      validateSearchWindow({ startDateIso: '2026-09-01T00:00:00.000Z', endDateIso: end }),
    ).toThrow(ReportingRangeExceededError);
    expect(() => validateSearchWindow({ startDateIso: start, endDateIso: end, pageSize: 0 })).toThrow(
      'pageSize must be an integer 1..500',
    );
    expect(() => validateSearchWindow({ startDateIso: start, endDateIso: end, pageSize: 501 })).toThrow(
      'pageSize must be an integer 1..500',
    );
  });

  it('maps D/P/S/V status codes and rejects unknown money statuses', () => {
    expect(mapReportingStatusCode('S')).toBe('CAPTURED');
    expect(mapReportingStatusCode('P')).toBe('CREATED');
    expect(mapReportingStatusCode('V')).toBe('VOIDED');
    expect(mapReportingStatusCode('D')).toBe('DENIED');
    expect(() => mapReportingStatusCode('X')).toThrow('unmapped reporting transaction_status code');
  });

  it('serves replay reporting rows with the 3-hour delay disclosure', async () => {
    const { client } = replayClient();
    await capturedFixture(client);
    const result = await client.searchTransactions({
      startDateIso: new Date(Date.now() - 86400000).toISOString(),
      endDateIso: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(result.transportMode).toBe('DETERMINISTIC_SANDBOX_REPLAY');
    expect(result.reportingScopeStatus).toBe('DETERMINISTIC_REPLAY_FIXTURE');
    expect(result.indexingDelayDisclosure).toBe(REPORTING_INDEXING_DELAY_DISCLOSURE);
    expect(result.indexingDelayDisclosure).toContain('3-hour indexing delay');
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records.map((r) => r.statusCode).sort()).toContain('S');
  });

  it('falls back honestly on live 403 / transport failure (never live data)', async () => {
    const replay = createSandboxReplayEngine();
    const seen: string[] = [];
    const failingTransport = async (_base: string, req: { path: string }): Promise<HttpResponse> => {
      seen.push(req.path);
      if (req.path === '/v1/oauth2/token') {
        return { status: 200, bodyText: '{"access_token":"tok","expires_in":3600}' };
      }
      return { status: 403, bodyText: '{"error":"forbidden","details":"missing scope"}' };
    };
    const client = new PayPalClient({
      mode: 'live',
      clientId: 'live-id-for-stubbed-transport',
      clientSecret: 'live-secret-for-stubbed-transport',
      httpTransport: failingTransport,
      replay,
    });
    expect(client.transportMode).toBe('LIVE_PAYPAL_SANDBOX');
    const result = await client.searchTransactions({
      startDateIso: new Date(Date.now() - 86400000).toISOString(),
      endDateIso: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(seen.some((p) => p.startsWith('/v1/reporting/transactions'))).toBe(true);
    expect(result.reportingScopeStatus).toBe('FALLBACK_TO_REPLAY_AND_SESSION_ORDERS');
    expect(result.transportMode).toBe('DETERMINISTIC_SANDBOX_REPLAY');
    expect(result.indexingDelayDisclosure).toContain('3-hour indexing delay');
  });

  it('tags legacy vs protected sync rows from evidence presence', () => {
    const legacy = legacyUnwitnessedFixtures();
    expect(legacy).toHaveLength(3);
    for (const row of legacy) {
      expect(row.protectionClass).toBe('LEGACY_UNWITNESSED');
      expect(row.commitment).toBeUndefined();
      expect(row.driftRiskNote).toContain('UNPROTECTED');
    }
    expect(legacy[0]?.driftRiskNote).toContain('30 days to 14 days');
    const sessionOrder: WalletOrderRecord = {
      orderId: 'ORD-VP-0001',
      scenarioId: 'normal',
      receiptCore: {
        observedTerms: {
          returnWindowDays: { status: 'DETERMINATE', value: 30 },
          restockingFeePct: { status: 'DETERMINATE', value: 0 },
        },
      },
      commitment: COMMITMENT,
      captureId: 'CAP-VP-0001',
      amountUsd: 297,
      status: 'CAPTURED',
      createdAtUtc: '2026-11-06T00:00:00.000Z',
      transportMode: 'DETERMINISTIC_SANDBOX_REPLAY',
    };
    const synced = syncAccountPayments({
      liveOrderReceipts: [
        {
          orderId: '1D1495603B138083R',
          readBackCustomId: 'VP1:e1c9eabe3c821dd3a72d47e7bcd6eba731024dc5ed42a3a2f7a0b03873134627',
          finalTotalUsd: 297,
          status: 'CREATED',
          scenario: 'normal',
        },
      ],
      sessionOrders: [sessionOrder],
    });
    expect(synced.legacyCount).toBe(3);
    expect(synced.protectedCount).toBe(2);
    const liveRow = synced.records.find((r) => r.orderId === '1D1495603B138083R');
    expect(liveRow?.protectionClass).toBe('VERIPACT_PROTECTED');
    expect(liveRow?.transportMode).toBe('LIVE_PAYPAL_SANDBOX');
    const sessionRow = synced.records.find((r) => r.orderId === 'ORD-VP-0001');
    expect(sessionRow?.protectionClass).toBe('VERIPACT_PROTECTED');
    expect(sessionRow?.returnWindowDays).toBe(30);
    expect(sessionRow?.restockingFeePct).toBe(0);
  });
});
