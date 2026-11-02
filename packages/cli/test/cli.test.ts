import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SDK_VERSION } from '@veripact/sdk';
import { CLI_NAME, CLI_VERSION, run } from '../src/index';

const KEY_VARS = [
  'BUYER_ED25519_PRIVATE_KEY',
  'WITNESS_ED25519_PRIVATE_KEY',
  'MERCHANT_ED25519_PRIVATE_KEY',
] as const;

const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of KEY_VARS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
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

describe('@veripact/cli', () => {
  it('resolves @veripact/sdk across the workspace boundary', () => {
    expect(CLI_VERSION).toBe(SDK_VERSION);
    expect(CLI_NAME).toBe('veripact');
  });

  it('prints help with no args or --help', async () => {
    for (const argv of [[], ['--help']]) {
      const result = await run(argv);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage:');
      expect(result.stdout).toContain('audit-dispute');
    }
  });

  it('prints the version', async () => {
    const result = await run(['--version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('veripact');
  });

  it('rejects unknown commands, flags, and missing values', async () => {
    expect((await run(['frobnicate'])).exitCode).toBe(1);
    expect((await run(['witness'])).stderr).toContain('--scenario');
    expect((await run(['witness', '--scenario'])).stderr).toContain('requires a value');
    expect((await run(['checkout', '--bogus'])).stderr).toContain('unknown flag');
    expect((await run(['checkout', '--scenario', 'nope'])).stderr).toContain('unknown scenario');
    expect((await run(['audit-dispute'])).stderr).toContain('--case');
  });

  it('witnesses the normal scenario in human output', async () => {
    const result = await run(['witness', '--scenario', 'normal']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ASK_HUMAN_DELTA');
    expect(result.stdout).toContain('VP1:');
    expect(result.stdout).toContain('Apex ProView 27 4K IPS Monitor');
    expect(result.stdout).toContain('demoKeys=true');
  });

  it('witnesses the adversarial scenario as BLOCK', async () => {
    const result = await run(['witness', '--scenario', 'adversarial_hidden_dom']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('BLOCK');
  });

  it('checks out the normal scenario as JSON with CAPTURED', async () => {
    const result = await run(['checkout', '--scenario', 'normal', '--json']);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      command: string;
      result: { outcome: string; captureId: string; finalTotalUsd: number };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('checkout');
    expect(parsed.result.outcome).toBe('CAPTURED');
    expect(parsed.result.captureId).toMatch(/^CAP-VP-/);
    expect(parsed.result.finalTotalUsd).toBe(297);
  });

  it('auto-voids the surcharge scenario', async () => {
    const result = await run(['checkout', '--scenario', 'surcharge_void']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('AUTO_VOIDED');
  });

  it('audits buyer forgery to RESOLVED', async () => {
    const result = await run(['audit-dispute', '--case', 'buyer_forgery']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('BUYER_FORGERY_DETECTED');
    expect(result.stdout).toContain('RESOLVED');
  });

  it('verifies the normal bundle as VALID and refuses blocked ones', async () => {
    const good = await run(['verify', '--scenario', 'normal']);
    expect(good.exitCode).toBe(0);
    expect(good.stdout).toContain('VALID');
    expect(good.stdout).toContain('custom_id match=true');
    const blocked = await run(['verify', '--scenario', 'adversarial_hidden_dom']);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stderr).toContain('BLOCKED_PRE_CHECKOUT');
  });
});
