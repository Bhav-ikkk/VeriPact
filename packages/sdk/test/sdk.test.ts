import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatCommitmentPrefix,
  verifyCanonicalPayload,
  type MandateSpec,
} from '@veripact/core';
import {
  createSandboxReplayEngine,
  PayPalClient,
  type HttpRequest,
  type HttpResponse,
} from '@veripact/paypal-client';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildDemoMandate,
  buildForensicNotes,
  buildScenarioMandate,
  DISPUTE_CASE_NAMES,
  getScenario,
  loadScenarios,
  resolveKeys,
  resolveKeysLenient,
  runRegressionSuite,
  SCENARIO_NAMES,
  SDK_VERSION,
  VeriPactClient,
  verifyTransactionBundle,
  wilsonConfidenceInterval95,
  writeRegressionReport,
} from '../src/index';

const HEX = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

const KEY_VARS = [
  'BUYER_ED25519_PRIVATE_KEY',
  'WITNESS_ED25519_PRIVATE_KEY',
  'MERCHANT_ED25519_PRIVATE_KEY',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'VERIPACT_ENV_FILE',
] as const;

// Pin a zero-key environment so demo-mode assertions are hermetic. The env
// file pointer aims at an absent path so stray repo .env files stay unread.
const ABSENT_ENV = join(process.cwd(), '.vitest-tmp', 'absent-credentials.env');
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of KEY_VARS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.VERIPACT_ENV_FILE = ABSENT_ENV;
});
afterEach(() => {
  for (const key of KEY_VARS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('@veripact/sdk', () => {
  it('resolves core and paypal-client across workspace boundaries', () => {
    expect(formatCommitmentPrefix(HEX)).toBe(`VP1:${HEX}`);
    expect(new PayPalClient({ clientId: 'i', clientSecret: 's' }).hasCredentials()).toBe(true);
  });

  it('exposes version, gate, and commitment formatting', () => {
    const client = new VeriPactClient();
    expect(client.version).toBe(SDK_VERSION);
    expect(client.witness).toBeNull();
    expect(client.formatCommitment(HEX)).toBe(`VP1:${HEX}`);
    expect(() => client.formatCommitment('nope')).toThrow(/invalid sha256/);
    expect(client.gate.decide([{ status: 'DETERMINATE' }])).toBe('PROCEED');
  });

  it('defaults to replay PayPal with labeled demo keys', () => {
    const client = new VeriPactClient();
    expect(client.paypal.transportMode).toBe('DETERMINISTIC_SANDBOX_REPLAY');
    expect(client.keys.demoKeys).toBe(true);
    expect(client.keys.buyer.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('falls back per-rung on partial or malformed keys (lenient)', () => {
    const demo = resolveKeys();
    expect(demo.demoKeys).toBe(true);
    process.env.BUYER_ED25519_PRIVATE_KEY = 'aa'.repeat(32);
    process.env.WITNESS_ED25519_PRIVATE_KEY = 'not-hex';
    const keys = resolveKeysLenient();
    expect(keys.demoKeys).toBe(false);
    expect(keys.buyer.publicKeyHex).toBe(
      resolveKeys({
        buyerPrivateKeyHex: 'aa'.repeat(32),
        witnessPrivateKeyHex: 'bb'.repeat(32),
        merchantPrivateKeyHex: 'cc'.repeat(32),
      }).buyer.publicKeyHex,
    );
    expect(keys.witness.publicKeyHex).toBe(demo.witness.publicKeyHex);
    expect(keys.merchant.publicKeyHex).toBe(demo.merchant.publicKeyHex);
    const client = new VeriPactClient({ lenientKeys: true });
    expect(client.keys.witness.publicKeyHex).toBe(demo.witness.publicKeyHex);
  });

  it('resolves explicit keys, refuses partial or malformed keys', () => {
    const keys = resolveKeys({
      buyerPrivateKeyHex: 'aa'.repeat(32),
      witnessPrivateKeyHex: 'bb'.repeat(32),
      merchantPrivateKeyHex: 'cc'.repeat(32),
    });
    expect(keys.demoKeys).toBe(false);
    expect(keys.buyer.privateKeyHex).toBe('aa'.repeat(32));
    expect(() => resolveKeys({ buyerPrivateKeyHex: 'aa'.repeat(32) })).toThrow(/partial/);
    expect(() =>
      resolveKeys({
        buyerPrivateKeyHex: 'zzz',
        witnessPrivateKeyHex: 'bb'.repeat(32),
        merchantPrivateKeyHex: 'cc'.repeat(32),
      }),
    ).toThrow(/64 lowercase hex/);
  });

  it('serves three signed scenarios with callback totals', () => {
    expect(SCENARIO_NAMES).toEqual(['normal', 'surcharge_void', 'adversarial_hidden_dom']);
    expect(DISPUTE_CASE_NAMES).toEqual(['buyer_forgery', 'merchant_drift']);
    const normal = getScenario('normal');
    expect(normal.mandate.constraints.maxAllInPriceUsd).toBe(320);
    expect(normal.callbackTotals).toEqual({ shippingUsd: 11.5, taxUsd: 6.5 });
    const unsigned: MandateSpec = { ...normal.mandate, buyerSignatureHex: '' };
    expect(
      verifyCanonicalPayload(
        unsigned,
        normal.mandate.buyerSignatureHex,
        normal.mandate.buyerPublicKeyHex,
      ),
    ).toBe(true);
    expect(getScenario('surcharge_void').callbackTotals.shippingUsd).toBe(55);
    expect(getScenario('adversarial_hidden_dom').html).toContain('paypal.me/attacker-sink');
    expect(() => getScenario('nope')).toThrow(/unknown scenario/);
    expect(buildDemoMandate('custom query').itemQuery).toBe('custom query');
  });

  it('witnesses the normal scenario with zero PayPal calls', async () => {
    const client = new VeriPactClient();
    const result = await client.witnessScenario('normal');
    expect(result.demoKeys).toBe(true);
    expect(result.snapshot.commitment).toMatch(/^VP1:[0-9a-f]{64}$/);
    expect(result.snapshot.gateResult.decision).toBe('ASK_HUMAN_DELTA');
    expect(result.snapshot.oracleResult).toMatchObject({
      matched: true,
      productId: 'APEX-27-4K-IPS',
      source: 'CHANNEL3_CACHE_REPLAY',
    });
    expect(result.snapshot.provenance.tlsVerified).toBe(false);
  });

  it('captures the normal checkout end to end with a signed addendum', async () => {
    const replay = createSandboxReplayEngine();
    const client = new VeriPactClient({ paypal: { replay } });
    const result = await client.runWitnessedCheckoutFlow({ scenario: 'normal' });
    expect(result.outcome).toBe('CAPTURED');
    expect(result.orderId).toMatch(/^ORD-VP-/);
    expect(result.authorizationId).toMatch(/^AUTH-VP-/);
    expect(result.captureId).toMatch(/^CAP-VP-/);
    expect(result.finalTotalUsd).toBe(297);
    expect(result.transportMode).toBe('DETERMINISTIC_SANDBOX_REPLAY');
    expect(replay.stats()).toEqual({ orders: 1, authorizations: 1, captures: 1 });
    expect(result.addendum).toMatchObject({
      capturedTotalUsd: 297,
      mandateCeilingUsd: 320,
      decision: 'CAPTURE',
    });
    expect(
      verifyCanonicalPayload(
        result.addendum,
        result.addendumSignatureHex ?? '',
        client.keys.merchant.publicKeyHex,
      ),
    ).toBe(true);
    expect(
      verifyCanonicalPayload(
        result.snapshot.receiptCore,
        result.merchantSignatureHex ?? '',
        client.keys.merchant.publicKeyHex,
      ),
    ).toBe(true);
  });

  it('auto-voids the surcharge scenario past the mandate cap', async () => {
    const replay = createSandboxReplayEngine();
    const client = new VeriPactClient({ paypal: { replay } });
    const result = await client.runWitnessedCheckoutFlow({ scenario: 'surcharge_void' });
    expect(result.outcome).toBe('AUTO_VOIDED');
    expect(result.finalTotalUsd).toBe(340.5);
    expect(result.voidReason ?? '').toContain('320');
    expect(replay.stats()).toEqual({ orders: 1, authorizations: 1, captures: 0 });
    expect(replay.getAuthorization(result.authorizationId ?? '').status).toBe('VOIDED');
  });

  it('honors a session mandate override on scenario checkouts', async () => {
    const replay = createSandboxReplayEngine();
    const client = new VeriPactClient({ paypal: { replay } });
    const tight = {
      ...buildDemoMandate(),
      constraints: {
        requiredCondition: 'NEW',
        maxAllInPriceUsd: 290,
        minReturnWindowDays: 30,
        maxRestockingFeePct: 0,
      },
    };
    const result = await client.runWitnessedCheckoutFlow({ scenario: 'normal', mandate: tight });
    expect(result.outcome).toBe('AUTO_VOIDED');
    expect(result.finalTotalUsd).toBe(297);
  });

  it('re-gates step-2 finalize under the override mandate', async () => {
    const replay = createSandboxReplayEngine();
    const client = new VeriPactClient({ paypal: { replay } });
    const step1 = await client.runWitnessedCheckoutFlow({ scenario: 'normal', twoStepApproval: true });
    expect(step1.outcome).toBe('AWAITING_BUYER_APPROVAL');
    const tight = {
      ...buildDemoMandate(),
      constraints: {
        requiredCondition: 'NEW',
        maxAllInPriceUsd: 290,
        minReturnWindowDays: 30,
        maxRestockingFeePct: 0,
      },
    };
    const done = await client.completeApprovedCheckout({
      orderId: step1.orderId ?? '',
      scenario: 'normal',
      mandate: tight,
    });
    expect(done.outcome).toBe('AUTO_VOIDED');
    expect(done.finalTotalUsd).toBe(297);
  });

  it('blocks the adversarial scenario before any PayPal call', async () => {
    const replay = createSandboxReplayEngine();
    const client = new VeriPactClient({ paypal: { replay } });
    const result = await client.runWitnessedCheckoutFlow({ scenario: 'adversarial_hidden_dom' });
    expect(result.outcome).toBe('BLOCKED_PRE_CHECKOUT');
    expect(result.orderId).toBeUndefined();
    expect(result.snapshot.gateResult.decision).toBe('BLOCK');
    expect(replay.stats()).toEqual({ orders: 0, authorizations: 0, captures: 0 });
  });

  it('audits buyer forgery to a seller-favor resolution', async () => {
    const client = new VeriPactClient();
    const result = await client.auditAndResolveDispute({ case: 'buyer_forgery' });
    expect(result.verdict).toBe('BUYER_FORGERY_DETECTED');
    expect(result.anchorTrusted).toBe(true);
    expect(result.disputeId).toBe('PP-D-CASE-B-FORGERY');
    expect(result.finalState).toMatchObject({
      status: 'RESOLVED',
      lifeCycleStage: 'CHARGEBACK',
      outcome: 'SELLER_FAVOR',
    });
    expect(result.finalState.evidenceCount).toBeGreaterThanOrEqual(2);
    expect(result.steps.join('\n')).toContain('adjudicate: SELLER_FAVOR');
  });

  it('audits merchant drift to a buyer-favor accept-claim', async () => {
    const client = new VeriPactClient();
    const result = await client.auditAndResolveDispute({ case: 'merchant_drift' });
    expect(result.verdict).toBe('MERCHANT_DRIFT_CONFIRMED');
    expect(result.disputeId).toBe('PP-D-CASE-A-DRIFT');
    expect(result.finalState).toMatchObject({ status: 'RESOLVED', outcome: 'BUYER_FAVOR' });
    expect(result.steps.join('\n')).toContain('accept-claim');
  });

  it('verifies captured bundles and detects tampering', async () => {
    const client = new VeriPactClient();
    const checkout = await client.runWitnessedCheckoutFlow({ scenario: 'normal' });
    const bundle = await client.verifyCheckoutBundle(checkout);
    expect(bundle.allValid).toBe(true);
    expect(bundle.anchorChecked).toBe(true);
    expect(bundle.anchorValid).toBe(true);
    const tamperedCustomId = verifyTransactionBundle({
      receiptCore: checkout.snapshot.receiptCore,
      buyerPublicKeyHex: client.keys.buyer.publicKeyHex,
      buyerSignatureHex: checkout.buyerApprovalSignatureHex ?? '',
      witnessPublicKeyHex: checkout.snapshot.witnessPublicKeyHex,
      witnessSignatureHex: checkout.snapshot.witnessSignatureHex,
      merchantPublicKeyHex: client.keys.merchant.publicKeyHex,
      merchantSignatureHex: checkout.merchantSignatureHex ?? '',
      paypalOrderCustomId: `VP1:${'0'.repeat(64)}`,
    });
    expect(tamperedCustomId.customIdMatch).toBe(false);
    expect(tamperedCustomId.allValid).toBe(false);
    const blocked = await client.runWitnessedCheckoutFlow({ scenario: 'adversarial_hidden_dom' });
    await expect(client.verifyCheckoutBundle(blocked)).rejects.toThrow(/only CAPTURED/);
  });

  it('builds bounded forensic notes without key material', () => {
    const notes = buildForensicNotes({
      caseName: 'buyer_forgery',
      orderId: 'ORD-VP-0001',
      commitment: `VP1:${HEX}`,
      verdict: 'BUYER_FORGERY_DETECTED',
      refereeReason: 'hash mismatch',
    });
    expect(notes.length).toBeLessThanOrEqual(2000);
    expect(notes).toContain('BUYER_FORGERY_DETECTED');
    expect(notes).toContain('ORD-VP-0001');
  });
});

describe('@veripact/sdk regression suite', () => {
  it('computes exact 95% Wilson intervals', () => {
    const perfect = wilsonConfidenceInterval95(72, 72);
    expect(perfect.rate).toBe(1);
    expect(perfect.lower).toBeCloseTo(0.949, 2);
    expect(perfect.upper).toBe(1);
    const half = wilsonConfidenceInterval95(36, 72);
    expect(half.rate).toBe(0.5);
    expect(half.lower).toBeLessThan(0.5);
    expect(half.upper).toBeGreaterThan(0.5);
    expect(wilsonConfidenceInterval95(0, 0)).toEqual({ rate: 0, lower: 0, upper: 0 });
  });

  it('loads 24 unique scenarios across three balanced groups', () => {
    const scenarios = loadScenarios();
    expect(scenarios).toHaveLength(24);
    expect(new Set(scenarios.map((s) => s.scenarioId)).size).toBe(24);
    const groups = scenarios.map((s) => s.group).sort();
    expect(groups.filter((g) => g === 'benign')).toHaveLength(8);
    expect(groups.filter((g) => g === 'drift')).toHaveLength(8);
    expect(groups.filter((g) => g === 'adversarial')).toHaveLength(8);
    const mandate = buildScenarioMandate(scenarios[0]);
    expect(
      verifyCanonicalPayload(
        { ...mandate, buyerSignatureHex: '' },
        mandate.buyerSignatureHex,
        mandate.buyerPublicKeyHex,
      ),
    ).toBe(true);
  });

  it('passes every scenario in a single pass with a diagonal confusion matrix', async () => {
    const report = await runRegressionSuite({ passes: 1 });
    expect(report.failures).toEqual([]);
    expect(report.runCount).toBe(24);
    expect(report.gateConfusion['PROCEED']).toEqual({
      PROCEED: 8,
      ASK_HUMAN_DELTA: 0,
      BLOCK: 0,
    });
    expect(report.gateConfusion['ASK_HUMAN_DELTA']).toEqual({
      PROCEED: 0,
      ASK_HUMAN_DELTA: 11,
      BLOCK: 0,
    });
    expect(report.gateConfusion['BLOCK']).toEqual({ PROCEED: 0, ASK_HUMAN_DELTA: 0, BLOCK: 5 });
    expect(report.gateAccuracy).toMatchObject({ successes: 24, total: 24 });
    expect(report.postAuthAccuracy).toMatchObject({ successes: 19, total: 19 });
    expect(report.refereeAccuracy).toMatchObject({ successes: 7, total: 7 });
    expect(report.overallPassRate.rate).toBe(1);
  });

  it(
    'runs 3 passes and writes the committed 72-run report',
    { timeout: 120000 },
    async () => {
      const report = await runRegressionSuite({ passes: 3 });
      expect(report.failures).toEqual([]);
      expect(report.runCount).toBe(72);
      expect(report.overallPassRate).toMatchObject({ successes: 72, total: 72, rate: 1 });
      const path = writeRegressionReport(report);
      expect(path.endsWith('regression_benchmark_report.json')).toBe(true);
      expect(existsSync(path)).toBe(true);
    },
  );

  it('two-step replay returns AWAITING with a popup approveUrl and no authorize', async () => {
    const replay = createSandboxReplayEngine();
    const client = new VeriPactClient({ paypal: { replay } });
    const step1 = await client.runWitnessedCheckoutFlow({ scenario: 'normal', twoStepApproval: true });
    expect(step1.outcome).toBe('AWAITING_BUYER_APPROVAL');
    expect(step1.orderId).toMatch(/^ORD-VP-/);
    expect(step1.approveUrl).toBe(`/sandbox/paypal-checkout?token=${step1.orderId}`);
    expect(step1.transportMode).toBe('DETERMINISTIC_SANDBOX_REPLAY');
    expect(step1.finalTotalUsd).toBe(297);
    expect(step1.expectedPostApprovalAction).toBe('CAPTURE');
    expect(step1.headroomRemainingUsd).toBe(23);
    expect(step1.snapshot.commitment).toMatch(/^VP1:[0-9a-f]{64}$/);
    // Step 1 stops before approve/authorize: order still CREATED, zero auths.
    expect((await client.paypal.getOrder(step1.orderId ?? '')).status).toBe('CREATED');
    expect(replay.stats()).toEqual({ orders: 1, authorizations: 0, captures: 0 });
  });

  it('two-step replay previews VOID for the surcharge scenario', async () => {
    const replay = createSandboxReplayEngine();
    const client = new VeriPactClient({ paypal: { replay } });
    const step1 = await client.runWitnessedCheckoutFlow({
      scenario: 'surcharge_void',
      twoStepApproval: true,
    });
    expect(step1.outcome).toBe('AWAITING_BUYER_APPROVAL');
    expect(step1.finalTotalUsd).toBe(340.5);
    expect(step1.expectedPostApprovalAction).toBe('VOID');
    expect(step1.headroomRemainingUsd).toBeLessThan(0);
  });

  it('completeApprovedCheckout captures with echoed step-1 evidence', async () => {
    const replay = createSandboxReplayEngine();
    const client = new VeriPactClient({ paypal: { replay } });
    const step1 = await client.runWitnessedCheckoutFlow({ scenario: 'normal', twoStepApproval: true });
    const done = await client.completeApprovedCheckout({
      orderId: step1.orderId ?? '',
      scenario: 'normal',
      prior: {
        snapshot: step1.snapshot,
        buyerApprovalSignatureHex: step1.buyerApprovalSignatureHex ?? '',
        merchantSignatureHex: step1.merchantSignatureHex ?? '',
      },
    });
    expect(done.outcome).toBe('CAPTURED');
    expect(done.captureId).toMatch(/^CAP-VP-/);
    expect(done.finalTotalUsd).toBe(297);
    expect(done.snapshot.commitment).toBe(step1.snapshot.commitment);
    expect(replay.stats()).toEqual({ orders: 1, authorizations: 1, captures: 1 });
    const bundle = await client.verifyCheckoutBundle(done);
    expect(bundle.allValid).toBe(true);
    expect(bundle.anchorChecked).toBe(true);
  });

  it('completeApprovedCheckout auto-voids the surcharge scenario', async () => {
    const replay = createSandboxReplayEngine();
    const client = new VeriPactClient({ paypal: { replay } });
    const step1 = await client.runWitnessedCheckoutFlow({
      scenario: 'surcharge_void',
      twoStepApproval: true,
    });
    const done = await client.completeApprovedCheckout({
      orderId: step1.orderId ?? '',
      scenarioId: 'surcharge_void',
      prior: {
        snapshot: step1.snapshot,
        buyerApprovalSignatureHex: step1.buyerApprovalSignatureHex ?? '',
        merchantSignatureHex: step1.merchantSignatureHex ?? '',
      },
    });
    expect(done.outcome).toBe('AUTO_VOIDED');
    expect(done.finalTotalUsd).toBe(340.5);
    expect(done.voidReason ?? '').toContain('320');
    expect(replay.getAuthorization(done.authorizationId ?? '').status).toBe('VOIDED');
  });

  it('completeApprovedCheckout re-witnesses when no prior evidence is echoed', async () => {
    const replay = createSandboxReplayEngine();
    const client = new VeriPactClient({ paypal: { replay } });
    const step1 = await client.runWitnessedCheckoutFlow({ scenario: 'normal', twoStepApproval: true });
    const done = await client.completeApprovedCheckout({ orderId: step1.orderId ?? '', scenario: 'normal' });
    expect(done.outcome).toBe('CAPTURED');
    expect(done.finalTotalUsd).toBe(297);
  });

  it('completeApprovedCheckout rejects prior evidence bound to another order', async () => {
    const replay = createSandboxReplayEngine();
    const client = new VeriPactClient({ paypal: { replay } });
    const step1 = await client.runWitnessedCheckoutFlow({ scenario: 'normal', twoStepApproval: true });
    const other = await client.witnessScenario('surcharge_void');
    await expect(
      client.completeApprovedCheckout({
        orderId: step1.orderId ?? '',
        scenario: 'normal',
        prior: {
          snapshot: other.snapshot,
          buyerApprovalSignatureHex: '00'.repeat(64),
          merchantSignatureHex: '00'.repeat(64),
        },
      }),
    ).rejects.toThrow(/does not match the order custom_id/);
  });

  it('simulated live CREATED auto-awaits and completes via checkoutnow script', async () => {
    let customId = '';
    let approved = false;
    const transport = (_baseUrl: string, req: HttpRequest): Promise<HttpResponse> => {
      if (req.path === '/v1/oauth2/token') {
        return Promise.resolve({
          status: 200,
          bodyText: JSON.stringify({ access_token: 'fake-token', expires_in: 300 }),
        });
      }
      if (req.method === 'POST' && req.path === '/v2/checkout/orders') {
        const body = JSON.parse(req.bodyText ?? '{}') as {
          purchase_units?: Array<{ custom_id?: string }>;
        };
        customId = body.purchase_units?.[0]?.custom_id ?? '';
        return Promise.resolve({
          status: 201,
          bodyText: JSON.stringify({
            id: 'LIVE-ORD-1',
            status: 'CREATED',
            links: [
              { rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=LIVE-ORD-1', method: 'GET' },
            ],
            purchase_units: [{ custom_id: customId }],
          }),
        });
      }
      if (req.method === 'PATCH' && req.path === '/v2/checkout/orders/LIVE-ORD-1') {
        return Promise.resolve({ status: 204, bodyText: '' });
      }
      if (req.method === 'GET' && req.path === '/v2/checkout/orders/LIVE-ORD-1') {
        const status = approved ? 'APPROVED' : 'CREATED';
        return Promise.resolve({
          status: 200,
          bodyText: JSON.stringify({
            id: 'LIVE-ORD-1',
            status,
            links:
              status === 'CREATED'
                ? [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=LIVE-ORD-1', method: 'GET' }]
                : [],
            purchase_units: [
              {
                custom_id: customId,
                amount: {
                  currency_code: 'USD',
                  value: '297.00',
                  breakdown: {
                    item_total: { currency_code: 'USD', value: '279.00' },
                    shipping: { currency_code: 'USD', value: '11.50' },
                    tax_total: { currency_code: 'USD', value: '6.50' },
                  },
                },
                payments: approved
                  ? { authorizations: [{ id: 'AUTH-LIVE-1', status: 'CREATED' }] }
                  : undefined,
              },
            ],
          }),
        });
      }
      if (req.method === 'POST' && req.path === '/v2/checkout/orders/LIVE-ORD-1/authorize') {
        return Promise.resolve({
          status: 201,
          bodyText: JSON.stringify({
            id: 'LIVE-ORD-1',
            status: 'COMPLETED',
            purchase_units: [{ payments: { authorizations: [{ id: 'AUTH-LIVE-1', status: 'CREATED' }] } }],
          }),
        });
      }
      if (req.method === 'POST' && req.path === '/v2/payments/authorizations/AUTH-LIVE-1/capture') {
        return Promise.resolve({
          status: 201,
          bodyText: JSON.stringify({ id: 'CAP-LIVE-1', status: 'COMPLETED' }),
        });
      }
      return Promise.resolve({ status: 404, bodyText: JSON.stringify({ message: 'unexpected' }) });
    };
    const client = new VeriPactClient({
      paypal: { clientId: 'id', clientSecret: 'sh', mode: 'live', httpTransport: transport },
    });
    expect(client.paypal.transportMode).toBe('LIVE_PAYPAL_SANDBOX');
    // No explicit flag: live CREATED auto-awaits without simulating approval.
    const step1 = await client.runWitnessedCheckoutFlow({ scenario: 'normal' });
    expect(step1.outcome).toBe('AWAITING_BUYER_APPROVAL');
    expect(step1.orderId).toBe('LIVE-ORD-1');
    expect(step1.approveUrl).toBe('https://www.sandbox.paypal.com/checkoutnow?token=LIVE-ORD-1');
    expect(step1.expectedPostApprovalAction).toBe('CAPTURE');
    expect(customId).toMatch(/^VP1:[0-9a-f]{64}$/);
    // Buyer approves out-of-band on the checkoutnow page, then step 2 runs.
    approved = true;
    const done = await client.completeApprovedCheckout({
      orderId: 'LIVE-ORD-1',
      scenario: 'normal',
      prior: {
        snapshot: step1.snapshot,
        buyerApprovalSignatureHex: step1.buyerApprovalSignatureHex ?? '',
        merchantSignatureHex: step1.merchantSignatureHex ?? '',
      },
    });
    expect(done.outcome).toBe('CAPTURED');
    expect(done.captureId).toBe('CAP-LIVE-1');
    expect(done.finalTotalUsd).toBe(297);
  });
});
