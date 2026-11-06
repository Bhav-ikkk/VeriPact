import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleMessage, TOOLS, WALLET_TOOLS } from '../src/index';

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

beforeEach(() => {
  for (const key of KEY_VARS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.VERIPACT_ENV_FILE = ABSENT_ENV;
  stateSeq += 1;
  const stateFile = join(process.cwd(), '.vitest-tmp', `wallet-mcp-${process.pid}-${stateSeq}.json`);
  stateFiles.push(stateFile);
  process.env.VERIPACT_WALLET_STATE_FILE = stateFile;
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

async function callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = (await handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  })) as { result?: { content?: Array<{ text?: string }> }; error?: { message: string } };
  if (response.error !== undefined) {
    throw new Error(`tools/call failed: ${response.error.message}`);
  }
  return JSON.parse(response.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('v5 wallet MCP tools', () => {
  it('exposes 7 tools total across the base + wallet catalogs', () => {
    expect(TOOLS.map((t) => t.name)).toHaveLength(4);
    expect(WALLET_TOOLS.map((t) => t.name)).toEqual([
      'veripact_pair_wallet',
      'veripact_sync_payments',
      'veripact_partition_spend',
    ]);
  });

  it('pairs a wallet: start → approve (vault + $350 partition)', async () => {
    const started = await callTool('veripact_pair_wallet', { action: 'start' });
    expect(started['sessionId']).toMatch(/^PAIR-VP-/);
    const approved = (await callTool('veripact_pair_wallet', {
      action: 'approve',
      sessionId: started['sessionId'],
      payerEmail: 'buyer@example.com',
    })) as {
      session: { status: string };
      partition: { availableUsd: number };
      vaultId: string;
    };
    expect(approved.session.status).toBe('APPROVED');
    expect(approved.vaultId).toMatch(/^PM-VP-VAULT-/);
    expect(approved.partition.availableUsd).toBe(350);
    await expect(callTool('veripact_pair_wallet', { action: 'dance' })).rejects.toThrow(
      'action must be start or approve',
    );
  });

  it('syncs payments and spends from the partition', async () => {
    const synced = (await callTool('veripact_sync_payments', {})) as {
      legacyCount: number;
      records: unknown[];
    };
    expect(synced.legacyCount).toBe(3);
    expect(synced.records.length).toBeGreaterThan(3);
    const started = await callTool('veripact_pair_wallet', { action: 'start' });
    await callTool('veripact_pair_wallet', {
      action: 'approve',
      sessionId: started['sessionId'],
      payerEmail: 'buyer@example.com',
    });
    const spent = (await callTool('veripact_partition_spend', { scenario: 'normal' })) as {
      outcome: string;
      partitionAvailableUsd: number;
    };
    expect(spent.outcome).toBe('CAPTURED');
    expect(spent.partitionAvailableUsd).toBe(53);
    await expect(callTool('veripact_partition_spend', { scenario: 'nope' })).rejects.toThrow(
      'scenario must be one of',
    );
  });
});
