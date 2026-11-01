import { describe, expect, it } from 'vitest';
import { SDK_VERSION } from '@veripact/sdk';
import { CLI_NAME, CLI_VERSION, run } from '../src/index';

describe('@veripact/cli', () => {
  it('resolves @veripact/sdk across the workspace boundary', () => {
    expect(CLI_VERSION).toBe(SDK_VERSION);
    expect(CLI_NAME).toBe('veripact');
  });

  it('prints help with no args or --help', () => {
    for (const argv of [[], ['--help']]) {
      const result = run(argv);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage:');
    }
  });

  it('prints the version', () => {
    const result = run(['--version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('veripact');
  });

  it('rejects unknown commands and unimplemented subcommands', () => {
    expect(run(['frobnicate']).exitCode).toBe(1);
    expect(run(['witness']).exitCode).toBe(1);
    expect(run(['witness']).stderr).toContain('Prompt #2');
  });
});
