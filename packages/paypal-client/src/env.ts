/**
 * @veripact/paypal-client hot-reloadable credential resolution.
 *
 * Zero-dependency `.env` reader so a long-lived server can pick up
 * `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` dropped into `.env` after
 * boot: every `PayPalClient` construction re-resolves (explicit options →
 * process env → `.env` file), so the next checkout transparently flips
 * from `DETERMINISTIC_SANDBOX_REPLAY` to `LIVE_PAYPAL_SANDBOX` with no
 * restart and no code change. Secrets are returned only to the client
 * constructor — never logged, never serialized, never sent to HTTP.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Explicit credential overrides (client options win over everything). */
export interface ExplicitPayPalCredentials {
  clientId?: string;
  clientSecret?: string;
}

/** Resolved credentials (possibly empty → replay mode). */
export interface ResolvedPayPalCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Parse a `.env`-style file into a string map. Tolerates comments, blank
 * lines, `export ` prefixes, and single/double quotes. Missing file →
 * empty map (never throws for absence).
 */
export function readDotEnvFile(envPath?: string): Record<string, string> {
  const path = envPath ?? join(process.cwd(), '.env');
  if (!existsSync(path)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match === null || match[1] === undefined) {
      continue;
    }
    let value = match[2] ?? '';
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

/** Default `.env` path (overridable for tests via `VERIPACT_ENV_FILE`). */
export function defaultEnvFilePath(): string {
  const override = process.env['VERIPACT_ENV_FILE'];
  if (override !== undefined && override !== '') {
    return override;
  }
  return join(process.cwd(), '.env');
}

/**
 * Resolve PayPal credentials: explicit options → process environment →
 * `.env` file on disk (re-read on every call, enabling hot-swap).
 * Empty strings count as absent at every layer.
 */
export function resolvePaypalCredentials(
  explicit: ExplicitPayPalCredentials = {},
  envFilePath?: string,
): ResolvedPayPalCredentials {
  const fromEnv = (key: string): string => {
    const value = process.env[key];
    return value !== undefined && value !== '' ? value : '';
  };
  let clientId = explicit.clientId !== undefined && explicit.clientId !== ''
    ? explicit.clientId
    : fromEnv('PAYPAL_CLIENT_ID');
  let clientSecret = explicit.clientSecret !== undefined && explicit.clientSecret !== ''
    ? explicit.clientSecret
    : fromEnv('PAYPAL_CLIENT_SECRET');
  if (clientId === '' || clientSecret === '') {
    const disk = readDotEnvFile(envFilePath ?? defaultEnvFilePath());
    if (clientId === '' && disk['PAYPAL_CLIENT_ID'] !== undefined && disk['PAYPAL_CLIENT_ID'] !== '') {
      clientId = disk['PAYPAL_CLIENT_ID'];
    }
    if (
      clientSecret === '' &&
      disk['PAYPAL_CLIENT_SECRET'] !== undefined &&
      disk['PAYPAL_CLIENT_SECRET'] !== ''
    ) {
      clientSecret = disk['PAYPAL_CLIENT_SECRET'];
    }
  }
  return { clientId, clientSecret };
}
