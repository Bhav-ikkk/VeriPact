import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildOpenApiSpec,
  handleWorkbenchRequest,
  resetDemoState,
  ROUTES,
  type WorkbenchResponse,
} from '../src/index';

interface CapturedResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

async function call(method: string, pathname: string): Promise<CapturedResponse> {
  const captured: CapturedResponse = { status: 0, headers: {}, body: '' };
  const res: WorkbenchResponse = {
    writeHead(code: number, headers: Record<string, string>): void {
      captured.status = code;
      captured.headers = headers;
    },
    end(responseBody: string): void {
      captured.body = responseBody;
    },
  };
  await handleWorkbenchRequest({ method, url: pathname }, res);
  return captured;
}

const ENV_VARS = [
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
  for (const key of ENV_VARS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.VERIPACT_ENV_FILE = ABSENT_ENV;
  resetDemoState();
});
afterEach(() => {
  for (const key of ENV_VARS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('@veripact/workbench v5 OpenAPI spec', () => {
  it('serves a valid OpenAPI 3.1.0 wallet spec at GET /openapi.json', async () => {
    const res = await call('GET', '/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    const spec = JSON.parse(res.body) as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { securitySchemes: { bearerAuth: { scheme: string } } };
    };
    expect(spec.openapi).toBe('3.1.0');
    for (const path of [
      '/api/wallet/partitions',
      '/api/wallet/spend-check',
      '/api/wallet/sync',
      '/api/witness/snapshot',
      '/api/merchant/checkout',
    ]) {
      expect(Object.keys(spec.paths)).toContain(path);
    }
    expect(spec.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
    expect(JSON.parse(res.body)).toEqual(buildOpenApiSpec());
  });

  it('lists /openapi.json in ROUTES and rejects POST with 405', async () => {
    expect(ROUTES).toContain('/openapi.json');
    const res = await call('POST', '/openapi.json');
    expect(res.status).toBe(405);
  });
});
