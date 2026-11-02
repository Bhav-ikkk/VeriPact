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
import { repoPath } from '@veripact/core';

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
 * lines, `export ` prefixes, and single/double quotes. A missing OR
 * unreadable file (EACCES, EISDIR, …) yields an empty map — a broken
 * credentials file must flip the server to replay, never to a 500.
 */
export function readDotEnvFile(envPath?: string): Record<string, string> {
  const path = envPath ?? join(process.cwd(), '.env');
  if (!existsSync(path)) {
    return {};
  }
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
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
  return repoPath('.env');
}

/**
 * True when a human-edited credential value is obviously a placeholder
 * (`your_…`, `replace_…`, `<…>`, `xxx`) rather than a PayPal secret.
 * Applied ONLY to the process-env and `.env`-file layers — explicit
 * options are programmer intent and pass through untouched.
 *
 * NOTE: no minimum-length rule here by design. Short test values
 * (`x`, `env-id`, `hot-secret`) are pinned by the locked paypal-client
 * suite, and short garbage that reaches live mode is caught one layer
 * up by the workbench's live-401 → replay fallback instead.
 */
export function isPlaceholderCredential(value: string): boolean {
  const v = value.trim().toLowerCase();
  return (
    v.length === 0 ||
    v.includes('your_') ||
    v.includes('replace_') ||
    v.includes('changeme') ||
    v.includes('placeholder') ||
    v.includes('example') ||
    v.includes('xxx') ||
    value.includes('<') ||
    value.includes('>')
  );
}

/**
 * Resolve PayPal credentials: explicit options → process environment →
 * `.env` file on disk (re-read on every call, enabling hot-swap).
 * Empty strings count as absent at every layer; obvious placeholders in
 * the human-edited layers (env vars, `.env` file) are ignored so a
 * half-filled `.env` keeps the server in replay instead of flipping it
 * into a broken live mode. Explicit options bypass the filter.
 */
export function resolvePaypalCredentials(
  explicit: ExplicitPayPalCredentials = {},
  envFilePath?: string,
): ResolvedPayPalCredentials {
  const fromEnv = (key: string): string => {
    const value = process.env[key];
    if (value === undefined || value === '' || isPlaceholderCredential(value)) {
      return '';
    }
    return value;
  };
  const fromDisk = (disk: Record<string, string>, key: string): string => {
    const value = disk[key];
    if (value === undefined || value === '' || isPlaceholderCredential(value)) {
      return '';
    }
    return value;
  };
  let clientId =
    explicit.clientId !== undefined && explicit.clientId !== ''
      ? explicit.clientId
      : fromEnv('PAYPAL_CLIENT_ID');
  let clientSecret =
    explicit.clientSecret !== undefined && explicit.clientSecret !== ''
      ? explicit.clientSecret
      : fromEnv('PAYPAL_CLIENT_SECRET');
  if (clientId === '' || clientSecret === '') {
    const disk = readDotEnvFile(envFilePath ?? defaultEnvFilePath());
    if (clientId === '') {
      clientId = fromDisk(disk, 'PAYPAL_CLIENT_ID');
    }
    if (clientSecret === '') {
      clientSecret = fromDisk(disk, 'PAYPAL_CLIENT_SECRET');
    }
  }
  return { clientId, clientSecret };
}
