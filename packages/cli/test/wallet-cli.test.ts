import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../src/index';

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

async function runText(argv: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = await run(argv);
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

beforeEach(() => {
  for (const key of KEY_VARS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.VERIPACT_ENV_FILE = ABSENT_ENV;
  stateSeq += 1;
  const stateFile = join(process.cwd(), '.vitest-tmp', `wallet-cli-${process.pid}-${stateSeq}.json`);
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

describe('@veripact/cli v5 wallet commands', () => {
  it('lists the wallet commands in --help', async () => {
    const { exitCode, stdout } = await runText(['--help']);
    expect(exitCode).toBe(0);
    for (const cmd of ['wallet-pair', 'wallet-sync', 'partition-create', 'partition-list']) {
      expect(stdout).toContain(cmd);
    }
  });

  it('starts then approves a pairing ceremony', async () => {
    const started = await runText(['wallet-pair', '--json']);
    expect(started.exitCode).toBe(0);
    const wrapped = JSON.parse(started.stdout) as {
      result: { sessionId: string; pairingCode: string };
    };
    const session = wrapped.result;
    expect(session.sessionId).toMatch(/^PAIR-VP-/);
    expect(session.pairingCode).toMatch(/^\d{6}$/);
    const approved = await runText([
      'wallet-pair',
      '--approve',
      '--session-id',
      session.sessionId,
      '--email',
      'buyer@example.com',
    ]);
    expect(approved.exitCode).toBe(0);
    expect(approved.stdout).toContain('APPROVED');
    expect(approved.stdout).toContain('PM-VP-VAULT-');
    expect(approved.stdout).toContain('$350.00 available');
  });

  it('syncs legacy vs protected payments', async () => {
    const synced = await runText(['wallet-sync', '--json']);
    expect(synced.exitCode).toBe(0);
    const wrapped = JSON.parse(synced.stdout) as {
      result: { legacyCount: number; protectedCount: number };
    };
    expect(wrapped.result.legacyCount).toBe(3);
    expect(wrapped.result.protectedCount).toBeGreaterThanOrEqual(0);
    const human = await runText(['wallet-sync']);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain(', 3 legacy');
  });

  it('creates and lists buyer-signed partitions', async () => {
    const created = await runText([
      'partition-create',
      '--label',
      'Demo',
      '--total',
      '500',
      '--max-order',
      '400',
      '--ask-above',
      '350',
    ]);
    expect(created.exitCode).toBe(0);
    expect(created.stdout).toContain('PART-VP-0001');
    expect(created.stdout).toContain('$500.00');
    const listed = await runText(['partition-list', '--json']);
    expect(listed.exitCode).toBe(0);
    const wrapped = JSON.parse(listed.stdout) as {
      result: {
        partitions: Array<{ label: string; availableUsd: number; buyerSignatureHex: string }>;
      };
    };
    expect(wrapped.result.partitions).toHaveLength(1);
    expect(wrapped.result.partitions[0]?.label).toBe('Demo');
    expect(wrapped.result.partitions[0]?.availableUsd).toBe(500);
    expect(wrapped.result.partitions[0]?.buyerSignatureHex).toMatch(/^[0-9a-f]{128}$/);
    const bad = await runText(['partition-create', '--total', 'abc']);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toContain('--total');
  });

  it('runs wallet-sniper --sku KANSO-Q35 --target 200 --json', async () => {
    const result = await runText([
      'wallet-sniper',
      '--sku',
      'KANSO-Q35',
      '--target',
      '200',
      '--json',
    ]);
    expect(result.exitCode).toBe(0);
    const wrapped = JSON.parse(result.stdout) as {
      ok: boolean;
      command: string;
      result: { outcome: string; winningCandidate: { allInTotalUsd: number; commitment: string } };
    };
    expect(wrapped.ok).toBe(true);
    expect(wrapped.command).toBe('wallet-sniper');
    expect(wrapped.result.outcome).toBe('DEAL_CAPTURED');
    expect(wrapped.result.winningCandidate.allInTotalUsd).toBe(167);
    expect(wrapped.result.winningCandidate.commitment).toMatch(/^VP1:/);
  });
});
