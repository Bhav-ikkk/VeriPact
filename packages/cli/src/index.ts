/**
 * @veripact/cli — `veripact` executable entry point.
 * Pure `run()` routing (tested) plus a thin `main()` process wrapper.
 */
import { SDK_VERSION } from '@veripact/sdk';

export const CLI_NAME = 'veripact';
export const CLI_VERSION = SDK_VERSION;

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const HELP = `veripact ${CLI_VERSION} — prove what the merchant promised.

Usage:
  veripact --help                      Show this help
  veripact --version                   Show the version
  veripact witness --url <url>         Witness merchant terms (Prompt #2+)
  veripact verify --receipt <file>     Verify a receipt (Prompt #2+)
  veripact dispute --case <file>       Run a contested case (Prompt #2+)
`;

function ok(stdout: string): CliResult {
  return { exitCode: 0, stdout, stderr: '' };
}

function fail(stderr: string): CliResult {
  return { exitCode: 1, stdout: '', stderr: `${stderr}\nRun \`veripact --help\` for usage.` };
}

/** Route argv (without node/script prefix) to a result. No process side effects. */
export function run(argv: string[]): CliResult {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h') {
    return ok(HELP);
  }
  if (command === '--version' || command === '-v') {
    return ok(`${CLI_NAME} ${CLI_VERSION}\n`);
  }
  if (command === 'witness' || command === 'verify' || command === 'dispute') {
    return fail(`\`veripact ${command}\` lands in Prompt #2 (got: ${rest.join(' ') || 'no args'})`);
  }
  return fail(`unknown command: ${command}`);
}

/** Process wrapper: prints the result and sets the exit code. */
export function main(): void {
  const result = run(process.argv.slice(2));
  if (result.stdout.length > 0) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr.length > 0) {
    process.stderr.write(`${result.stderr}\n`);
  }
  process.exitCode = result.exitCode;
}
