import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyOrderCommitmentReproducible } from '@veripact/core';
import { createSandboxReplayEngine } from '@veripact/paypal-client';
import { VeriPactClient, type SniperCandidateVerdict } from '../src/index';

const KEY_VARS = [
  'BUYER_ED25519_PRIVATE_KEY',
  'WITNESS_ED25519_PRIVATE_KEY',
  'MERCHANT_ED25519_PRIVATE_KEY',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'VERIPACT_ENV_FILE',
  'VERIPACT_WALLET_STATE_FILE',
] as const;

const ABSENT_ENV = join(process.cwd(), '.vitest-tmp', 'absent-credentials.env');
const savedEnv: Record<string, string | undefined> = {};
let stateSeq = 0;
const stateFiles: string[] = [];

function freshStateFile(): string {
  stateSeq += 1;
  const path = join(process.cwd(), '.vitest-tmp', `sniper-${process.pid}-${stateSeq}.json`);
  stateFiles.push(path);
  return path;
}

function testClient() {
  const replay = createSandboxReplayEngine();
  const client = new VeriPactClient({
    paypal: { replay, mode: 'replay', envFilePath: ABSENT_ENV },
  });
  return { client, replay, stateFilePath: freshStateFile() };
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

describe('@veripact/sdk deal sniper', () => {
  it('captures the verified PAYPAL50 deal at $297 and rejects the five traps', async () => {
    const { client, replay, stateFilePath } = testClient();
    const report = await client.runDealSniper({ targetMaxAllInUsd: 300, stateFilePath });
    const verdicts = report.evaluations.map((e) => e.verdict);
    const expected: SniperCandidateVerdict[] = [
      'REJECTED_ADVERSARIAL_DOM',
      'REJECTED_CONDITION_CONFLICT',
      'REJECTED_VOUCHER_VOIDS_RETURNS',
      'REJECTED_OVER_TARGET_CAP',
      'REJECTED_CALLBACK_SURCHARGE_VOIDED',
      'VERIFIED_VOUCHER_CAPTURED',
    ];
    expect(verdicts).toEqual(expected);
    expect(report.outcome).toBe('DEAL_CAPTURED');
    expect(report.sku).toBe('APEX-27-4K-IPS');
    expect(report.retailBaselineUsd).toBe(329);
    expect(report.candidatesEvaluated).toBe(6);
    expect(report.trapsRejectedCount).toBe(5);
    expect(report.totalSavedUsd).toBe(50);
    expect(report.winningCandidate).toMatchObject({
      candidateId: 'EC-7',
      merchantName: 'Apex Display Co.',
      voucherCode: 'PAYPAL50',
      voucherDiscountUsd: 50,
      netBasePriceUsd: 279,
      allInTotalUsd: 297,
      observedCondition: 'NEW',
      observedReturnDays: 30,
      observedRestockingFeePct: 0,
      pageIntegrity: 'CLEAN',
      paypalApiCalls: 4,
    });
    expect(report.winningCandidate?.commitment).toMatch(/^VP1:[0-9a-f]{64}$/);
    expect(report.winningCandidate?.orderId).toBeTruthy();
    expect(report.winningCandidate?.captureId).toMatch(/^CAP-VP-/);
    expect(report.partitionAfter).toMatchObject({
      totalAllocatedUsd: 350,
      availableUsd: 53,
      capturedUsd: 297,
    });
    for (const row of report.evaluations.slice(0, 4)) {
      expect(row.paypalApiCalls).toBe(0);
      expect(row.orderId).toBeUndefined();
    }
    const freight = report.evaluations[4];
    expect(freight?.allInTotalUsd).toBe(340.5);
    expect(freight?.paypalApiCalls).toBe(4);
    expect(freight?.captureId).toBeUndefined();
    expect(freight?.commitment).toMatch(/^VP1:/);
    expect(replay.stats()).toMatchObject({ orders: 2, authorizations: 2, captures: 1 });
  });

  it('voids the second hunt on the partition wall and leaves $53 available', async () => {
    const { client, stateFilePath } = testClient();
    const first = await client.runDealSniper({ targetMaxAllInUsd: 300, stateFilePath });
    expect(first.partitionAfter?.availableUsd).toBe(53);
    const second = await client.runDealSniper({ targetMaxAllInUsd: 300, stateFilePath });
    expect(second.outcome).toBe('BLOCKED_BY_PARTITION_WALL');
    expect(second.totalSavedUsd).toBe(0);
    expect(second.winningCandidate).toMatchObject({
      verdict: 'AUTO_VOIDED_BY_PARTITION_WALL',
    });
    expect(second.winningCandidate?.captureId).toBeUndefined();
    expect(second.partitionAfter).toMatchObject({
      availableUsd: 53,
      capturedUsd: 297,
    });
  });

  it('returns no compliant deal when the target is below every all-in price', async () => {
    const { client, replay, stateFilePath } = testClient();
    const report = await client.runDealSniper({
      targetMaxAllInUsd: 250,
      stateFilePath,
    });
    expect(report.outcome).toBe('NO_COMPLIANT_DEAL_UNDER_TARGET');
    expect(report.winningCandidate).toBeNull();
    expect(report.totalSavedUsd).toBe(0);
    expect(report.partitionAfter).toMatchObject({
      availableUsd: 350,
      capturedUsd: 0,
    });
    expect(replay.stats()).toMatchObject({ orders: 0, authorizations: 0, captures: 0 });
  });

  it('captures KANSO-Q35 at $167 and leaves $183 in the partition', async () => {
    const { client, stateFilePath } = testClient();
    const report = await client.runDealSniper({
      sku: 'KANSO-Q35',
      targetMaxAllInUsd: 200,
      stateFilePath,
    });
    expect(report.outcome).toBe('DEAL_CAPTURED');
    expect(report.productTitle).toBe('Kanso Q35 Wireless Headphones');
    expect(report.winningCandidate).toMatchObject({
      verdict: 'VERIFIED_VOUCHER_CAPTURED',
      voucherCode: 'PAYPAL50',
      netBasePriceUsd: 149,
      allInTotalUsd: 167,
      observedCondition: 'NEW',
    });
    expect(report.totalSavedUsd).toBe(50);
    expect(report.partitionAfter).toMatchObject({
      availableUsd: 183,
      capturedUsd: 167,
    });
  });

  it('rejects the refurbished SKU with nothing spent', async () => {
    const { client, replay, stateFilePath } = testClient();
    const report = await client.runDealSniper({
      sku: 'APEX-27-4K-IPS-RB',
      targetMaxAllInUsd: 300,
      stateFilePath,
    });
    expect(report.outcome).toBe('NO_COMPLIANT_DEAL_UNDER_TARGET');
    expect(report.winningCandidate).toBeNull();
    expect(report.totalSavedUsd).toBe(0);
    expect(report.evaluations.map((e) => e.verdict)).toContain('REJECTED_CONDITION_CONFLICT');
    expect(report.partitionAfter).toMatchObject({
      availableUsd: 350,
      capturedUsd: 0,
    });
    expect(replay.stats()).toMatchObject({ orders: 0, authorizations: 0, captures: 0 });
  });

  it('binds the post-voucher snapshot into custom_id for Apex and Kanso', async () => {
    for (const spec of [
      { sku: 'APEX-27-4K-IPS', targetMaxAllInUsd: 300, allIn: 297 },
      { sku: 'KANSO-Q35', targetMaxAllInUsd: 200, allIn: 167 },
    ]) {
      const { client, stateFilePath } = testClient();
      const report = await client.runDealSniper({
        sku: spec.sku,
        targetMaxAllInUsd: spec.targetMaxAllInUsd,
        stateFilePath,
      });
      expect(report.outcome).toBe('DEAL_CAPTURED');
      expect(report.winningCandidate?.allInTotalUsd).toBe(spec.allIn);
      const order = client.wallet(stateFilePath).listOrders().at(-1);
      expect(order).toBeDefined();
      expect(order?.commitment).toBe(report.winningCandidate?.commitment);
      expect(verifyOrderCommitmentReproducible(order!)).toBe(true);
      const paypalOrder = await client.paypal.getOrder(order!.orderId);
      expect(paypalOrder.customId).toBe(report.winningCandidate?.commitment);
      expect(paypalOrder.customId).toBe(order?.commitment);
    }
  });

  it('throws a validation error for NaN, non-positive, and infinite targets', async () => {
    const { client, stateFilePath } = testClient();
    await expect(client.runDealSniper({ targetMaxAllInUsd: Number.NaN, stateFilePath })).rejects.toThrow(
      /targetMaxAllInUsd/,
    );
    await expect(client.runDealSniper({ targetMaxAllInUsd: -10, stateFilePath })).rejects.toThrow(
      /targetMaxAllInUsd/,
    );
    await expect(client.runDealSniper({ targetMaxAllInUsd: 0, stateFilePath })).rejects.toThrow(
      /targetMaxAllInUsd/,
    );
    await expect(client.runDealSniper({ targetMaxAllInUsd: Number.POSITIVE_INFINITY, stateFilePath })).rejects.toThrow(
      /targetMaxAllInUsd/,
    );
  });
});
