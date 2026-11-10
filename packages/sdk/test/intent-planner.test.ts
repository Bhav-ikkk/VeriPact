import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSandboxReplayEngine } from '@veripact/paypal-client';
import {
  parseShoppingIntent,
  VeriPactClient,
} from '../src/index';

const KEY_VARS = [
  'BUYER_ED25519_PRIVATE_KEY',
  'WITNESS_ED25519_PRIVATE_KEY',
  'MERCHANT_ED25519_PRIVATE_KEY',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'VERIPACT_ENV_FILE',
  'VERIPACT_WALLET_STATE_FILE',
  'GEMINI_API_KEY',
  'VERIPACT_ENABLE_LIVE_LLM',
] as const;

const ABSENT_ENV = join(process.cwd(), '.vitest-tmp', 'absent-credentials.env');
const savedEnv: Record<string, string | undefined> = {};
let stateSeq = 0;
const stateFiles: string[] = [];

function freshStateFile(): string {
  stateSeq += 1;
  const path = join(process.cwd(), '.vitest-tmp', `intent-${process.pid}-${stateSeq}.json`);
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

describe('@veripact/sdk hybrid intent planner', () => {
  describe('Natural-language intent parsing across all 8 Channel3 SKUs', () => {
    it('parses wireless headphones intent for KANSO-Q35', async () => {
      const intent = await parseShoppingIntent('Buy wireless headphones under $110');
      expect(intent.matchedSku).toBe('KANSO-Q35');
      expect(intent.productTitle).toBe('Kanso Q35 Wireless Headphones');
      expect(intent.targetMaxAllInUsd).toBe(110);
      expect(intent.requiredCondition).toBe('NEW');
      expect(intent.detectedVoucherCode).toBe('AUDIO67');
      expect(intent.parserEngine).toBe('DETERMINISTIC_SEMANTIC_CATALOG');
    });

    it('parses Keychron mechanical keyboard intent for KEYCHRON-K8-PRO', async () => {
      const intent = await parseShoppingIntent('Get a Keychron mechanical keyboard under $150');
      expect(intent.matchedSku).toBe('KEYCHRON-K8-PRO');
      expect(intent.productTitle).toBe('Keychron K8 Pro Mechanical Keyboard');
      expect(intent.targetMaxAllInUsd).toBe(150);
      expect(intent.requiredCondition).toBe('NEW');
      expect(intent.detectedVoucherCode).toBe('MECH30');
    });

    it('parses NVMe SSD intent for TERRA-2TB-NVME', async () => {
      const intent = await parseShoppingIntent('Find me a fast 2TB NVMe SSD under $140');
      expect(intent.matchedSku).toBe('TERRA-2TB-NVME');
      expect(intent.productTitle).toBe('Terra 2TB NVMe PCIe 4.0 SSD');
      expect(intent.targetMaxAllInUsd).toBe(140);
      expect(intent.detectedVoucherCode).toBe('NVME25');
    });

    it('parses webcam intent for LUMEN-4K-CAM', async () => {
      const intent = await parseShoppingIntent('4K streaming webcam below $180');
      expect(intent.matchedSku).toBe('LUMEN-4K-CAM');
      expect(intent.productTitle).toBe('Lumen 4K Pro Streaming Webcam');
      expect(intent.targetMaxAllInUsd).toBe(180);
      expect(intent.detectedVoucherCode).toBe('CAM40');
    });

    it('parses dock intent for VELA-TB4-DOCK', async () => {
      const intent = await parseShoppingIntent('Thunderbolt 4 docking hub for workstation under $250');
      expect(intent.matchedSku).toBe('VELA-TB4-DOCK');
      expect(intent.productTitle).toBe('Vela Thunderbolt 4 Docking Hub');
      expect(intent.targetMaxAllInUsd).toBe(250);
      expect(intent.detectedVoucherCode).toBe('DOCK45');
    });

    it('parses laptop intent for NORTHLOOP-14-AIR', async () => {
      const intent = await parseShoppingIntent('Northloop Air 14 laptop for $920');
      expect(intent.matchedSku).toBe('NORTHLOOP-14-AIR');
      expect(intent.productTitle).toBe('Northloop Air 14 Laptop');
      expect(intent.targetMaxAllInUsd).toBe(920);
      expect(intent.detectedVoucherCode).toBe('LAPTOP50');
    });

    it('parses monitor intent for APEX-27-4K-IPS', async () => {
      const intent = await parseShoppingIntent('Apex 27 inch 4K IPS monitor cap $300');
      expect(intent.matchedSku).toBe('APEX-27-4K-IPS');
      expect(intent.productTitle).toBe('Apex ProView 27 4K IPS Monitor');
      expect(intent.targetMaxAllInUsd).toBe(300);
      expect(intent.detectedVoucherCode).toBe('PAYPAL50');
    });

    it('parses refurbished monitor intent for APEX-27-4K-IPS-RB', async () => {
      const intent = await parseShoppingIntent('Certified refurbished 27 4K monitor under $240');
      expect(intent.matchedSku).toBe('APEX-27-4K-IPS-RB');
      expect(intent.productTitle).toBe('Apex ProView 27 4K IPS Monitor - Certified Refurbished');
      expect(intent.targetMaxAllInUsd).toBe(240);
      expect(intent.requiredCondition).toBe('REFURBISHED');
    });
  });

  describe('Constraint and metadata extraction', () => {
    it('extracts target ceiling from various phrase patterns', async () => {
      const p1 = await parseShoppingIntent('Keychron keyboard under $135');
      expect(p1.targetMaxAllInUsd).toBe(135);

      const p2 = await parseShoppingIntent('Keychron keyboard below 145');
      expect(p2.targetMaxAllInUsd).toBe(145);

      const p3 = await parseShoppingIntent('Keychron keyboard max $125.50');
      expect(p3.targetMaxAllInUsd).toBe(125.5);

      const p4 = await parseShoppingIntent('Keychron keyboard $130');
      expect(p4.targetMaxAllInUsd).toBe(130);
    });

    it('extracts return window and restocking fee constraints', async () => {
      const intent = await parseShoppingIntent(
        'Buy Kanso headphones under $110 with 45-day return and 10% restock fee',
      );
      expect(intent.minReturnWindowDays).toBe(45);
      expect(intent.maxRestockingFeePct).toBe(10);
    });

    it('extracts explicit voucher codes when present', async () => {
      const intent = await parseShoppingIntent(
        'Buy Apex 4k monitor under $300 with promo code SPECIAL99',
      );
      expect(intent.detectedVoucherCode).toBe('SPECIAL99');
    });

    it('flags autoSpawnBackgroundWatch when target is lower than best deal', async () => {
      // Best deal for APEX-27-4K-IPS is $297.00
      const low = await parseShoppingIntent('Buy a 27" 4K monitor under $220');
      expect(low.autoSpawnBackgroundWatch).toBe(true);

      const achievable = await parseShoppingIntent('Buy a 27" 4K monitor under $300');
      expect(achievable.autoSpawnBackgroundWatch).toBe(false);

      const explicitWatch = await parseShoppingIntent('Watch for 27" 4K monitor deals');
      expect(explicitWatch.autoSpawnBackgroundWatch).toBe(true);
    });

    it('falls back cleanly to default SKU and target when unspecified', async () => {
      const intent = await parseShoppingIntent('best deal online');
      expect(intent.matchedSku).toBe('APEX-27-4K-IPS');
      expect(intent.targetMaxAllInUsd).toBe(300);
      expect(intent.parserEngine).toBe('DETERMINISTIC_SEMANTIC_CATALOG');
    });
  });

  describe('Multi-SKU sniper sweeps', () => {
    it('snipes KEYCHRON-K8-PRO at $137.00 with MECH30 voucher', async () => {
      const { client, stateFilePath } = testClient();
      const report = await client.runDealSniper({
        sku: 'KEYCHRON-K8-PRO',
        targetMaxAllInUsd: 150,
        stateFilePath,
      });

      expect(report.outcome).toBe('DEAL_CAPTURED');
      expect(report.sku).toBe('KEYCHRON-K8-PRO');
      expect(report.productTitle).toBe('Keychron K8 Pro Mechanical Keyboard');
      expect(report.retailBaselineUsd).toBe(149);
      expect(report.totalSavedUsd).toBe(30);
      expect(report.winningCandidate).toMatchObject({
        candidateId: 'EC-7',
        voucherCode: 'MECH30',
        voucherDiscountUsd: 30,
        netBasePriceUsd: 119,
        allInTotalUsd: 137,
        observedCondition: 'NEW',
      });
      expect(report.partitionAfter?.capturedUsd).toBe(137);
      expect(report.partitionAfter?.availableUsd).toBe(213);
    });

    it('snipes TERRA-2TB-NVME at $157.00 with NVME25 voucher', async () => {
      const { client, stateFilePath } = testClient();
      const report = await client.runDealSniper({
        sku: 'TERRA-2TB-NVME',
        targetMaxAllInUsd: 160,
        stateFilePath,
      });

      expect(report.outcome).toBe('DEAL_CAPTURED');
      expect(report.sku).toBe('TERRA-2TB-NVME');
      expect(report.productTitle).toBe('Terra 2TB NVMe PCIe 4.0 SSD');
      expect(report.retailBaselineUsd).toBe(164);
      expect(report.totalSavedUsd).toBe(25);
      expect(report.winningCandidate).toMatchObject({
        candidateId: 'EC-7',
        voucherCode: 'NVME25',
        voucherDiscountUsd: 25,
        netBasePriceUsd: 139,
        allInTotalUsd: 157,
      });
      expect(report.partitionAfter?.capturedUsd).toBe(157);
    });

    it('snipes VELA-TB4-DOCK at $247.00 with DOCK45 voucher', async () => {
      const { client, stateFilePath } = testClient();
      const report = await client.runDealSniper({
        sku: 'VELA-TB4-DOCK',
        targetMaxAllInUsd: 250,
        stateFilePath,
      });

      expect(report.outcome).toBe('DEAL_CAPTURED');
      expect(report.sku).toBe('VELA-TB4-DOCK');
      expect(report.retailBaselineUsd).toBe(274);
      expect(report.totalSavedUsd).toBe(45);
      expect(report.winningCandidate).toMatchObject({
        candidateId: 'EC-7',
        voucherCode: 'DOCK45',
        voucherDiscountUsd: 45,
        netBasePriceUsd: 229,
        allInTotalUsd: 247,
      });
      expect(report.partitionAfter?.capturedUsd).toBe(247);
    });

    it('snipes KANSO-Q35 at $100.00 with AUDIO67 when target is <= $150', async () => {
      const { client, stateFilePath } = testClient();
      const report = await client.runDealSniper({
        sku: 'KANSO-Q35',
        targetMaxAllInUsd: 120,
        stateFilePath,
      });

      expect(report.outcome).toBe('DEAL_CAPTURED');
      expect(report.sku).toBe('KANSO-Q35');
      expect(report.winningCandidate).toMatchObject({
        candidateId: 'EC-7',
        voucherCode: 'AUDIO67',
        voucherDiscountUsd: 67,
        netBasePriceUsd: 82,
        allInTotalUsd: 100,
      });
      expect(report.totalSavedUsd).toBe(67);
      expect(report.partitionAfter?.capturedUsd).toBe(100);
      expect(report.partitionAfter?.availableUsd).toBe(250);
    });
  });
});
