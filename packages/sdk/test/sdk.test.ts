import { describe, expect, it } from 'vitest';
import { formatCommitmentPrefix } from '@veripact/core';
import { PayPalClient } from '@veripact/paypal-client';
import { SDK_VERSION, VeriPactClient } from '../src/index';

const HEX = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

describe('@veripact/sdk', () => {
  it('resolves core and paypal-client across workspace boundaries', () => {
    expect(formatCommitmentPrefix(HEX)).toBe(`VP1:${HEX}`);
    expect(new PayPalClient({ clientId: 'i', clientSecret: 's' }).hasCredentials()).toBe(true);
  });

  it('exposes version, gate, and commitment formatting', () => {
    const client = new VeriPactClient();
    expect(client.version).toBe(SDK_VERSION);
    expect(client.paypal).toBeNull();
    expect(client.witness).toBeNull();
    expect(client.formatCommitment(HEX)).toBe(`VP1:${HEX}`);
    expect(() => client.formatCommitment('nope')).toThrow(/invalid sha256/);
    expect(client.gate.decide([{ status: 'DETERMINATE' }])).toBe('PROCEED');
  });

  it('wires optional PayPal credentials through the constructor', () => {
    const client = new VeriPactClient({ paypal: { clientId: 'i', clientSecret: 's' } });
    expect(client.paypal?.hasCredentials()).toBe(true);
  });
});
