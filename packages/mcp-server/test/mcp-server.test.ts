import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { formatCommitmentPrefix } from '@veripact/core';
import { SDK_VERSION, VeriPactClient } from '@veripact/sdk';
import {
  containsKeyMaterial,
  handleMessage,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  TOOLS,
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

function toolText(res: unknown): string {
  const result = (res as { result: { content: Array<{ text: string }> } }).result;
  return result.content[0]?.text ?? '';
}

describe('@veripact/mcp-server', () => {
  it('resolves core and sdk across workspace boundaries', () => {
    expect(formatCommitmentPrefix(HEX)).toBe(`VP1:${HEX}`);
    expect(MCP_SERVER_VERSION).toBe(SDK_VERSION);
    expect(MCP_SERVER_NAME).toBe('veripact-mcp');
  });

  it('answers initialize and ping', async () => {
    const init = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect((init.result as { serverInfo: { name: string } }).serverInfo.name).toBe('veripact-mcp');
    expect((await handleMessage({ jsonrpc: '2.0', id: 2, method: 'ping' })).result).toEqual({});
  });

  it('lists the four production tools', async () => {
    const res = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const names = ((res.result as { tools: typeof TOOLS }).tools ?? []).map((t) => t.name);
    expect(names).toEqual([
      'veripact_witness_offer',
      'veripact_execute_guarded_checkout',
      'veripact_verify_order_receipt',
      'veripact_adjudicate_contested_dispute',
    ]);
  });

  it('witnesses an offer through tools/call', async () => {
    const res = await handleMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'veripact_witness_offer', arguments: { scenario: 'normal' } },
    });
    const payload = JSON.parse(toolText(res)) as {
      snapshot: { commitment: string; gateResult: { decision: string } };
    };
    expect(payload.snapshot.commitment).toMatch(/^VP1:[0-9a-f]{64}$/);
    expect(payload.snapshot.gateResult.decision).toBe('ASK_HUMAN_DELTA');
  });

  it('executes a guarded checkout through tools/call', async () => {
    const res = await handleMessage({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'veripact_execute_guarded_checkout', arguments: { scenario: 'normal' } },
    });
    const payload = JSON.parse(toolText(res)) as { outcome: string; captureId: string };
    expect(payload.outcome).toBe('CAPTURED');
    expect(payload.captureId).toMatch(/^CAP-VP-/);
  });

  it('verifies a scenario bundle and an explicit bundle', async () => {
    const scenarioRes = await handleMessage({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'veripact_verify_order_receipt', arguments: { scenario: 'normal' } },
    });
    expect(
      (JSON.parse(toolText(scenarioRes)) as { allValid: boolean }).allValid,
    ).toBe(true);
    // Explicit bundle path: mint via the SDK, verify via the tool.
    const client = new VeriPactClient();
    const checkout = await client.runWitnessedCheckoutFlow({ scenario: 'normal' });
    const order = await client.paypal.getOrder(checkout.orderId ?? '');
    const explicitRes = await handleMessage({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'veripact_verify_order_receipt',
        arguments: {
          bundle: {
            receiptCore: checkout.snapshot.receiptCore,
            buyerPublicKeyHex: client.keys.buyer.publicKeyHex,
            buyerSignatureHex: checkout.buyerApprovalSignatureHex,
            witnessPublicKeyHex: checkout.snapshot.witnessPublicKeyHex,
            witnessSignatureHex: checkout.snapshot.witnessSignatureHex,
            merchantPublicKeyHex: client.keys.merchant.publicKeyHex,
            merchantSignatureHex: checkout.merchantSignatureHex,
            paypalOrderCustomId: order.customId,
          },
        },
      },
    });
    expect((JSON.parse(toolText(explicitRes)) as { allValid: boolean }).allValid).toBe(true);
  });

  it('adjudicates a contested dispute through tools/call', async () => {
    const res = await handleMessage({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'veripact_adjudicate_contested_dispute',
        arguments: { case: 'merchant_drift' },
      },
    });
    const payload = JSON.parse(toolText(res)) as {
      verdict: string;
      finalState: { status: string; outcome: string };
    };
    expect(payload.verdict).toBe('MERCHANT_DRIFT_CONFIRMED');
    expect(payload.finalState.status).toBe('RESOLVED');
    expect(payload.finalState.outcome).toBe('BUYER_FAVOR');
  });

  it('rejects key material over stdin', () => {
    expect(containsKeyMaterial({ scenario: 'normal' })).toBe(false);
    expect(containsKeyMaterial({ privateKey: 'abc' })).toBe(true);
    expect(containsKeyMaterial({ bundle: { clientSecret: 'x' } })).toBe(true);
    expect(containsKeyMaterial(null)).toBe(false);
    // Break-it hardening: api/token spellings trip the guard too…
    for (const name of ['apiKey', 'api_key', 'APIKEY', 'accessToken', 'auth_token', 'refreshToken']) {
      expect(containsKeyMaterial({ scenario: 'normal', [name]: 'x' })).toBe(true);
    }
    // …while public hex material (safe to carry by design) still passes.
    expect(
      containsKeyMaterial({
        orderId: 'ORD-VP-0001',
        customId: `VP1:${HEX}`,
        publicKeyHex: HEX,
        signatureHex: 'ab'.repeat(64),
      }),
    ).toBe(false);
  });

  it('errors on key material, bad input, unknown tools and methods', async () => {
    const keyed = await handleMessage({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'veripact_witness_offer', arguments: { scenario: 'normal', privateKey: 'x' } },
    });
    expect(keyed.error?.code).toBe(-32602);
    const badScenario = await handleMessage({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'veripact_witness_offer', arguments: { scenario: 'nope' } },
    });
    expect(badScenario.error?.code).toBe(-32602);
    const unknownTool = await handleMessage({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'mint_money', arguments: {} },
    });
    expect(unknownTool.error?.code).toBe(-32601);
    expect((await handleMessage({ jsonrpc: '2.0', id: 12, method: 'nope' })).error?.code).toBe(-32601);
  });
});
