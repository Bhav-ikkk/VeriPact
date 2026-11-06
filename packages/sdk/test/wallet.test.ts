import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeCommitment,
  verifyOrderCommitmentReproducible,
  verifyPartitionSpecSignature,
} from '@veripact/core';
import { createSandboxReplayEngine, PayPalClient } from '@veripact/paypal-client';
import {
  resetWalletState,
  resolveKeys,
  VeriPactClient,
  VeriPactWallet,
} from '../src/index';

const KEY_VARS = [
  'BUYER_ED25519_PRIVATE_KEY',
  'WITNESS_ED25519_PRIVATE_KEY',
  'MERCHANT_ED25519_PRIVATE_KEY',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'VERIPACT_ENV_FILE',
] as const;
const ABSENT_ENV = join(process.cwd(), '.vitest-tmp', 'absent-credentials.env');

const savedEnv: Record<string, string | undefined> = {};
let stateSeq = 0;
const stateFiles: string[] = [];

function freshStateFile(): string {
  stateSeq += 1;
  const path = join(process.cwd(), '.vitest-tmp', `wallet-sdk-${process.pid}-${stateSeq}.json`);
  stateFiles.push(path);
  return path;
}

function testWallet() {
  const replay = createSandboxReplayEngine();
  const paypal = new PayPalClient({ replay });
  const keys = resolveKeys({});
  const wallet = new VeriPactWallet({ paypal, keys, stateFilePath: freshStateFile() });
  return { wallet, paypal, replay, keys };
}

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
  for (const file of stateFiles.splice(0)) {
    rmSync(file, { force: true });
  }
});

describe('@veripact/sdk v5 wallet', () => {
  it('pairs over QR, vaults the payer, and mints the $350 partition', async () => {
    const { wallet } = testWallet();
    const session = wallet.startPairingCeremony();
    expect(session.sessionId).toMatch(/^PAIR-VP-/);
    expect(session.qrPairUrl).toBe(`/pair/${session.sessionId}`);
    expect(session.pairingCode).toMatch(/^\d{6}$/);
    expect(session.status).toBe('PENDING_SCAN');
    const approved = await wallet.approvePairingCeremony({
      sessionId: session.sessionId,
      payerEmail: 'buyer@example.com',
    });
    expect(approved.session.status).toBe('APPROVED');
    expect(approved.vaultId).toMatch(/^PM-VP-VAULT-/);
    expect(approved.partition).toMatchObject({
      totalAllocatedUsd: 350,
      maxPerOrderUsd: 320,
      askHumanAboveUsd: 300,
      availableUsd: 350,
      status: 'ACTIVE',
    });
    expect(verifyPartitionSpecSignature(approved.partition)).toBe(true);
    await expect(
      wallet.approvePairingCeremony({ sessionId: session.sessionId, payerEmail: 'x@y.zz' }),
    ).rejects.toThrow('need PENDING_SCAN');
  });

  it('captures $297 (→$53), then wall-voids the second $297 (captured flat)', async () => {
    const { wallet, replay } = testWallet();
    const session = wallet.startPairingCeremony();
    await wallet.approvePairingCeremony({ sessionId: session.sessionId, payerEmail: 'a@b.cc' });
    const first = await wallet.executePartitionedAgentPayment({ scenarioId: 'normal' });
    expect(first.outcome).toBe('CAPTURED');
    expect(first.finalTotalUsd).toBe(297);
    expect(first.captureId).toMatch(/^CAP-VP-/);
    expect(first.verdict.decision).toBe('ALLOW_AUTONOMOUS');
    expect(first.partitionAvailableUsd).toBe(53);
    const second = await wallet.executePartitionedAgentPayment({ scenarioId: 'normal' });
    expect(second.outcome).toBe('AUTO_VOIDED_BY_PARTITION_WALL');
    expect(second.verdict.decision).toBe('BLOCK_PARTITION_EXCEEDED');
    expect(second.captureId).toBeUndefined();
    const status = wallet.getPartitionStatus();
    expect(status.capturedUsd).toBe(297);
    expect(status.availableUsd).toBe(53);
    expect(replay.stats()).toMatchObject({ orders: 2, authorizations: 2, captures: 1 });
  });

  it('restores $53 → $350 via Refund Undo', async () => {
    const { wallet } = testWallet();
    const session = wallet.startPairingCeremony();
    await wallet.approvePairingCeremony({ sessionId: session.sessionId, payerEmail: 'a@b.cc' });
    const paid = await wallet.executePartitionedAgentPayment({ scenarioId: 'normal' });
    expect(paid.partitionAvailableUsd).toBe(53);
    const refunded = await wallet.refundPartitionPayment({ captureId: paid.captureId ?? '' });
    expect(refunded.refundId).toMatch(/^RFD-VP-/);
    expect(refunded.amountUsd).toBe(297);
    expect(refunded.partitionAvailableUsd).toBe(350);
    expect(wallet.getPartitionStatus().refundedUsd).toBe(297);
    await expect(wallet.refundPartitionPayment({ captureId: 'CAP-VP-9999' })).rejects.toThrow(
      'unknown wallet capture',
    );
  });

  it('blocks adversarial checkouts pre-PayPal with zero engine calls', async () => {
    const { wallet, replay } = testWallet();
    const session = wallet.startPairingCeremony();
    await wallet.approvePairingCeremony({ sessionId: session.sessionId, payerEmail: 'a@b.cc' });
    const blocked = await wallet.executePartitionedAgentPayment({
      scenarioId: 'adversarial_hidden_dom',
    });
    expect(blocked.outcome).toBe('BLOCKED_PRE_CHECKOUT');
    expect(blocked.orderId).toBeUndefined();
    expect(replay.stats()).toEqual({ orders: 0, authorizations: 0, captures: 0 });
    expect(wallet.getPartitionStatus().availableUsd).toBe(350);
  });

  it('holds above-threshold spends for a human and scopes agent tokens', async () => {
    const { wallet } = testWallet();
    const session = wallet.startPairingCeremony();
    await wallet.approvePairingCeremony({ sessionId: session.sessionId, payerEmail: 'a@b.cc' });
    const held = await wallet.executePartitionedAgentPayment({
      scenarioId: 'normal',
      requestedOverrideUsd: 310,
    });
    expect(held.outcome).toBe('ASK_HUMAN_OVER_THRESHOLD');
    expect(held.orderId).toBeUndefined();
    const { scope, bearerToken } = wallet.mintConnectorToken({ platform: 'CHATGPT_ACTION' });
    expect(scope.tokenId).toMatch(/^CONN-VP-/);
    expect(scope.maskedToken).toMatch(/^vp_…[0-9a-f]{4}$/);
    expect(scope.openapiUrl).toBe('/openapi.json');
    expect(bearerToken).toMatch(/^vp_[0-9a-f]{48}$/);
    const scoped = await wallet.executePartitionedAgentPayment({
      scenarioId: 'normal',
      agentToken: bearerToken,
    });
    expect(scoped.outcome).toBe('CAPTURED');
    await expect(
      wallet.executePartitionedAgentPayment({ scenarioId: 'normal', agentToken: 'vp_deadbeef' }),
    ).rejects.toThrow('unknown agent token');
  });

  it('syncs legacy vs protected rows incl. live seeded receipts', async () => {
    const { wallet } = testWallet();
    const session = wallet.startPairingCeremony();
    await wallet.approvePairingCeremony({ sessionId: session.sessionId, payerEmail: 'a@b.cc' });
    await wallet.executePartitionedAgentPayment({ scenarioId: 'normal' });
    const synced = wallet.syncWalletTransactions();
    expect(synced.legacyCount).toBe(3);
    // Live seeded receipts (when the committed file exists) + 1 session order.
    expect(synced.protectedCount).toBeGreaterThanOrEqual(1);
    const liveRow = synced.records.find((r) => r.orderId === '1D1495603B138083R');
    if (liveRow !== undefined) {
      expect(liveRow.protectionClass).toBe('VERIPACT_PROTECTED');
      expect(liveRow.commitment).toMatch(/^VP1:[0-9a-f]{64}$/);
    }
    const sessionRow = synced.records.find((r) => r.orderId.startsWith('ORD-VP-'));
    expect(sessionRow?.protectionClass).toBe('VERIPACT_PROTECTED');
    expect(sessionRow?.returnWindowDays).toBe(30);
  });

  it('persists receiptCore so VP1 recomputes bit-identically (GAP-10)', async () => {
    const stateFile = freshStateFile();
    const replay = createSandboxReplayEngine();
    const wallet = new VeriPactWallet({
      paypal: new PayPalClient({ replay }),
      keys: resolveKeys({}),
      stateFilePath: stateFile,
    });
    const session = wallet.startPairingCeremony();
    await wallet.approvePairingCeremony({ sessionId: session.sessionId, payerEmail: 'a@b.cc' });
    await wallet.executePartitionedAgentPayment({ scenarioId: 'normal' });
    expect(existsSync(stateFile)).toBe(true);
    const doc = JSON.parse(readFileSync(stateFile, 'utf8')) as {
      orders: Array<{ orderId: string; receiptCore: unknown; commitment: string }>;
    };
    expect(doc.orders).toHaveLength(1);
    const [stored] = doc.orders;
    // Recompute from the persisted bytes — no re-witness, no TSA involved.
    expect(computeCommitment(stored?.receiptCore)).toBe(stored?.commitment);
    expect(
      verifyOrderCommitmentReproducible({
        orderId: stored?.orderId ?? '',
        scenarioId: 'normal',
        receiptCore: stored?.receiptCore,
        commitment: stored?.commitment ?? '',
        amountUsd: 297,
        status: 'CAPTURED',
        createdAtUtc: '',
        transportMode: 'DETERMINISTIC_SANDBOX_REPLAY',
      }),
    ).toBe(true);
    // A fresh instance over the same file sees the same wallet (GAP-15).
    const reopened = new VeriPactWallet({
      paypal: new PayPalClient({ replay }),
      keys: resolveKeys({}),
      stateFilePath: stateFile,
    });
    expect(reopened.getPartitionStatus().availableUsd).toBe(53);
    resetWalletState(stateFile);
    expect(existsSync(stateFile)).toBe(false);
  });

  it('delegates a wallet from VeriPactClient sharing transport + keys', () => {
    const client = new VeriPactClient({ paypal: { mode: 'replay' } });
    const wallet = client.wallet(freshStateFile());
    expect(wallet.paypal).toBe(client.paypal);
    expect(wallet.keys).toBe(client.keys);
    expect(client.wallet()).toBe(client.wallet());
  });
});
