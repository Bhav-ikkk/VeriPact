import { describe, expect, it } from 'vitest';
import { formatCommitmentPrefix } from '@veripact/core';
import {
  isValidSha256Hex,
  NotImplementedError,
  WitnessClient,
  type IChannel3Oracle,
  type IHttpSnapshotter,
  type ITimestampAuthority,
} from '../src/index';

const HEX = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

const fakeTsa: ITimestampAuthority = {
  name: 'replay-tsa',
  timestamp: async () => ({ issuer: 'REPLAY', timeUtc: '2026-11-01T00:00:00.000Z', tokenBase64: 'UkVQTEFZ' }),
};

const fakeOracle: IChannel3Oracle = {
  name: 'replay-oracle',
  lookup: async () => null,
};

const fakeSnapshotter: IHttpSnapshotter = {
  name: 'replay-snapshotter',
  fetch: async (url) => ({ url, httpStatus: 200, bytes: 0, bodyText: '' }),
};

describe('@veripact/witness-client', () => {
  it('resolves @veripact/core across the workspace boundary', () => {
    expect(formatCommitmentPrefix(HEX)).toBe(`VP1:${HEX}`);
  });

  it('validates sha256 hex digests', () => {
    expect(isValidSha256Hex(HEX)).toBe(true);
    expect(isValidSha256Hex('xyz')).toBe(false);
  });

  it('constructs a client but witness() throws NotImplementedError', async () => {
    const client = new WitnessClient({
      tsa: fakeTsa,
      oracle: fakeOracle,
      snapshotter: fakeSnapshotter,
      witnessPublicKeyHex: '8a1c',
    });
    expect(client.witnessPublicKeyHex).toBe('8a1c');
    await expect(client.witness('https://example.test/item', HEX)).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });
});
