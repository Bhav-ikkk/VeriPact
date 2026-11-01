import { describe, expect, it } from 'vitest';
import {
  COMMITMENT_LENGTH,
  COMMITMENT_PREFIX,
  formatCommitmentPrefix,
  type MandateSpec,
} from '../src/index';

const VALID_HEX = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

describe('@veripact/core', () => {
  it('formats a 68-char VP1 commitment from valid sha256 hex', () => {
    const commitment = formatCommitmentPrefix(VALID_HEX);
    expect(commitment).toBe(`${COMMITMENT_PREFIX}${VALID_HEX}`);
    expect(commitment).toHaveLength(COMMITMENT_LENGTH);
  });

  it('rejects short, long, non-hex, and uppercase digests', () => {
    expect(() => formatCommitmentPrefix('abc')).toThrow(/invalid sha256/);
    expect(() => formatCommitmentPrefix(`${VALID_HEX}00`)).toThrow(/invalid sha256/);
    expect(() => formatCommitmentPrefix(`z${VALID_HEX.slice(1)}`)).toThrow(/invalid sha256/);
    expect(() => formatCommitmentPrefix(VALID_HEX.toUpperCase())).toThrow(/invalid sha256/);
  });

  it('accepts a well-formed MandateSpec', () => {
    const mandate: MandateSpec = {
      mandateId: 'mnd_test_001',
      createdAtUtc: '2026-11-01T06:30:00.000Z',
      buyerId: 'buyer_sandbox_01',
      itemQuery: '27-inch 4K IPS Monitor',
      constraints: {
        requiredCondition: 'NEW',
        maxAllInPriceUsd: 320,
        minReturnWindowDays: 30,
        maxRestockingFeePct: 0,
      },
      buyerPublicKeyHex: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
      buyerSignatureHex: '92a4c8',
    };
    expect(mandate.constraints.maxAllInPriceUsd).toBe(320);
  });
});
