import { describe, expect, it } from 'vitest';
import {
  computeCommitment,
  computePartitionAvailableUsd,
  deriveEd25519KeyPairFromSeed,
  evaluatePartitionSpendCheck,
  signPartitionSpec,
  verifyOrderCommitmentReproducible,
  verifyPartitionSpecSignature,
  type PartitionSpec,
  type WalletOrderRecord,
} from '../src/index';

const BUYER_SEED = '11'.repeat(32);

function signedPartition(overrides: Partial<PartitionSpec> = {}): PartitionSpec {
  const buyer = deriveEd25519KeyPairFromSeed(BUYER_SEED);
  const base = {
    partitionId: 'PART-VP-0001',
    label: 'Agentic Partition',
    totalAllocatedUsd: 350,
    maxPerOrderUsd: 320,
    askHumanAboveUsd: 300,
    authorizedUsd: 0,
    capturedUsd: 0,
    voidedUsd: 0,
    refundedUsd: 0,
    availableUsd: 350,
    status: 'ACTIVE' as const,
    createdAtUtc: '2026-11-06T00:00:00.000Z',
    ...overrides,
  };
  return signPartitionSpec(base, {
    publicKeyHex: buyer.publicKeyHex,
    privateKeyHex: buyer.privateKeyHex,
  });
}

describe('@veripact/core v5 wallet math', () => {
  it('computes availability as cap - authorized - captured + voided + refunded', () => {
    expect(
      computePartitionAvailableUsd({
        totalAllocatedUsd: 350,
        authorizedUsd: 0,
        capturedUsd: 297,
        voidedUsd: 0,
        refundedUsd: 0,
      }),
    ).toBe(53);
    // Void + refund legs restore headroom cent-exactly.
    expect(
      computePartitionAvailableUsd({
        totalAllocatedUsd: 350,
        authorizedUsd: 297,
        capturedUsd: 297,
        voidedUsd: 297,
        refundedUsd: 297,
      }),
    ).toBe(350);
  });

  it('clamps availability at zero (never negative headroom)', () => {
    expect(
      computePartitionAvailableUsd({
        totalAllocatedUsd: 350,
        authorizedUsd: 0,
        capturedUsd: 400,
        voidedUsd: 0,
        refundedUsd: 0,
      }),
    ).toBe(0);
  });

  it('allows autonomous spend within budget, caps, and threshold', () => {
    const verdict = evaluatePartitionSpendCheck(signedPartition(), {
      partitionId: 'PART-VP-0001',
      requestedAmountUsd: 297,
      merchantName: 'Apex Display Co.',
      hasWitnessedReceipt: true,
    });
    expect(verdict).toMatchObject({
      allowed: true,
      decision: 'ALLOW_AUTONOMOUS',
      availableBeforeUsd: 350,
      availableAfterUsd: 53,
    });
  });

  it('blocks the second $297 order when only $53 remains', () => {
    const verdict = evaluatePartitionSpendCheck(
      signedPartition({ capturedUsd: 297, availableUsd: 53 }),
      {
        partitionId: 'PART-VP-0001',
        requestedAmountUsd: 297,
        hasWitnessedReceipt: true,
      },
    );
    expect(verdict).toMatchObject({
      allowed: false,
      decision: 'BLOCK_PARTITION_EXCEEDED',
      availableBeforeUsd: 53,
      availableAfterUsd: 53,
    });
    expect(verdict.reason).toContain('$53.00');
  });

  it('blocks unwitnessed merchants before budget checks', () => {
    const verdict = evaluatePartitionSpendCheck(signedPartition(), {
      partitionId: 'PART-VP-0001',
      requestedAmountUsd: 10,
      hasWitnessedReceipt: false,
    });
    expect(verdict.decision).toBe('BLOCK_UNWITNESSED_MERCHANT');
    expect(verdict.allowed).toBe(false);
  });

  it('enforces the per-order cap and frozen status', () => {
    const capped = evaluatePartitionSpendCheck(signedPartition(), {
      partitionId: 'PART-VP-0001',
      requestedAmountUsd: 321,
      hasWitnessedReceipt: true,
    });
    expect(capped.decision).toBe('BLOCK_PER_ORDER_CAP');
    const frozen = evaluatePartitionSpendCheck(signedPartition({ status: 'FROZEN' }), {
      partitionId: 'PART-VP-0001',
      requestedAmountUsd: 10,
      hasWitnessedReceipt: true,
    });
    expect(frozen.decision).toBe('BLOCK_PARTITION_FROZEN');
  });

  it('holds above-threshold spends for human approval', () => {
    const verdict = evaluatePartitionSpendCheck(signedPartition(), {
      partitionId: 'PART-VP-0001',
      requestedAmountUsd: 310,
      hasWitnessedReceipt: true,
    });
    expect(verdict).toMatchObject({
      allowed: false,
      decision: 'ASK_HUMAN_OVER_THRESHOLD',
      availableBeforeUsd: 350,
      availableAfterUsd: 40,
    });
  });

  it('rejects non-positive or non-finite request amounts', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        evaluatePartitionSpendCheck(signedPartition(), {
          partitionId: 'PART-VP-0001',
          requestedAmountUsd: bad,
          hasWitnessedReceipt: true,
        }),
      ).toThrow('requestedAmountUsd must be a finite USD amount > 0');
    }
  });

  it('signs partitions with the buyer key and detects tampering', () => {
    const spec = signedPartition();
    expect(verifyPartitionSpecSignature(spec)).toBe(true);
    expect(verifyPartitionSpecSignature({ ...spec, capturedUsd: 999 })).toBe(false);
    expect(verifyPartitionSpecSignature({ ...spec, totalAllocatedUsd: 9999 })).toBe(false);
  });

  it('reproduces VP1 commitments from persisted receiptCore (GAP-10)', () => {
    const receiptCore = {
      receiptVersion: 'VP1',
      rung: 'WIT',
      capturedAtUtc: '2026-11-06T00:00:00.000Z',
      merchantDomain: 'example.com',
      listingUrl: 'https://example.com/p',
      mandateSha256: 'ab'.repeat(32),
      observedTerms: { basePriceUsd: { status: 'DETERMINATE', value: 279 } },
    };
    const record: WalletOrderRecord = {
      orderId: 'ORD-VP-0001',
      scenarioId: 'normal',
      receiptCore,
      commitment: computeCommitment(receiptCore),
      amountUsd: 297,
      status: 'CAPTURED',
      createdAtUtc: '2026-11-06T00:00:00.000Z',
      transportMode: 'DETERMINISTIC_SANDBOX_REPLAY',
    };
    expect(verifyOrderCommitmentReproducible(record)).toBe(true);
    // A swapped core (e.g. re-witnessed under a new TSA timestamp) no
    // longer matches — the persisted bytes are the source of truth.
    expect(
      verifyOrderCommitmentReproducible({
        ...record,
        receiptCore: { ...receiptCore, capturedAtUtc: '2026-11-07T00:00:00.000Z' },
      }),
    ).toBe(false);
  });
});
