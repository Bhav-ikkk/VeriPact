import { describe, expect, it } from 'vitest';
import { formatCommitmentPrefix } from '@veripact/core';
import {
  buildAmountPatch,
  buildAuthorizeOrderBody,
  isSandboxBaseUrl,
  NotImplementedError,
  PAYPAL_SANDBOX_BASE_URL,
  PayPalClient,
  toHateoasActionMap,
} from '../src/index';

const HEX = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

describe('@veripact/paypal-client', () => {
  it('resolves @veripact/core across the workspace boundary', () => {
    expect(formatCommitmentPrefix(HEX)).toBe(`VP1:${HEX}`);
  });

  it('builds a single-unit AUTHORIZE order body with VP1 custom_id', () => {
    const body = buildAuthorizeOrderBody({
      receiptSha256Hex: HEX,
      description: 'Apex 27-inch 4K Monitor',
      itemTotal: '279.00',
    });
    expect(body.intent).toBe('AUTHORIZE');
    expect(body.purchase_units).toHaveLength(1);
    expect(body.purchase_units[0]?.custom_id).toBe(`VP1:${HEX}`);
    expect(body.purchase_units[0]?.reference_id).toBe('default');
  });

  it('builds an amount-replace patch totaling item + shipping + tax', () => {
    const [op] = buildAmountPatch('279.00', '11.50', '6.50');
    expect(op?.op).toBe('replace');
    expect(op?.path).toContain("@reference_id=='default'");
    expect((op?.value as { value: string }).value).toBe('297.00');
  });

  it('indexes HATEOAS links by rel', () => {
    const map = toHateoasActionMap([
      { rel: 'self', href: 'https://x/self', method: 'GET' },
      { rel: 'escalate', href: 'https://x/escalate', method: 'POST' },
    ]);
    expect(map['escalate']?.method).toBe('POST');
    expect(map['accept-claim']).toBeUndefined();
  });

  it('accepts the sandbox host and rejects anything else', () => {
    expect(isSandboxBaseUrl(PAYPAL_SANDBOX_BASE_URL)).toBe(true);
    expect(isSandboxBaseUrl('https://api-m.paypal.com')).toBe(false);
    const client = new PayPalClient({ clientId: 'id', clientSecret: 'secret' });
    expect(client.hasCredentials()).toBe(true);
    expect(() => new PayPalClient({ clientId: 'i', clientSecret: 's', baseUrl: 'https://evil.test' })).toThrow(
      /non-sandbox/,
    );
  });

  it('networked methods throw NotImplementedError', async () => {
    const client = new PayPalClient({ clientId: 'id', clientSecret: 'secret' });
    await expect(
      client.createAuthorizeOrder({ receiptSha256Hex: HEX, description: 'd', itemTotal: '1.00' }),
    ).rejects.toBeInstanceOf(NotImplementedError);
    await expect(client.getDispute('PP-D-1')).rejects.toBeInstanceOf(NotImplementedError);
  });
});
