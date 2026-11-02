import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatCommitmentPrefix,
  verifyCanonicalPayload,
  type MandateSpec,
} from '@veripact/core';
import { createSandboxReplayEngine, PayPalClient } from '@veripact/paypal-client';
import {
  buildDemoMandate,
  buildForensicNotes,
  DISPUTE_CASE_NAMES,
  getScenario,
  resolveKeys,
  SCENARIO_NAMES,
  SDK_VERSION,
  VeriPactClient,
  verifyTransactionBundle,
} from '../src/index';

const HEX = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

const KEY_VARS = [
  'BUYER_ED25519_PRIVATE_KEY',
  'WITNESS_ED25519_PRIVATE_KEY',
  'MERCHANT_ED25519_PRIVATE_KEY',
] as const;

// Pin a zero-key environment so demo-mode assertions are hermetic.
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of KEY_VARS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
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
