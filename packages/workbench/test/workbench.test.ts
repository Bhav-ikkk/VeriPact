import { describe, expect, it } from 'vitest';
import { COMMITMENT_PREFIX } from '@veripact/core';
import {
  handleWorkbenchRequest,
  ROUTES,
  WORKBENCH_VERSION,
  type HealthPayload,
  type WorkbenchResponse,
} from '../src/index';

interface CapturedResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function get(pathname: string, method = 'GET'): CapturedResponse {
  const captured: CapturedResponse = { status: 0, headers: {}, body: '' };
  const res: WorkbenchResponse = {
    writeHead(code: number, headers: Record<string, string>): void {
      captured.status = code;
      captured.headers = headers;
    },
    end(body: string): void {
      captured.body = body;
    },
  };
  handleWorkbenchRequest({ method, url: pathname }, res);
  return captured;
}

describe('@veripact/workbench', () => {
  it('resolves @veripact/core across the workspace boundary', () => {
    expect(COMMITMENT_PREFIX).toBe('VP1:');
  });

  it('serves /health with version and routes', () => {
    const res = get('/health');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as HealthPayload;
    expect(body.status).toBe('ok');
    expect(body.version).toBe(WORKBENCH_VERSION);
    expect(body.routes).toEqual(ROUTES);
  });

  it('serves the three key-boundary APIs', () => {
    const cases: Array<[string, string]> = [
      ['/api/buyer', 'SELF'],
      ['/api/witness', 'WIT'],
      ['/api/merchant', 'SIGN'],
    ];
    for (const [route, boundary] of cases) {
      const res = get(route);
      expect(res.status).toBe(200);
      expect((JSON.parse(res.body) as { boundary: string }).boundary).toBe(boundary);
    }
  });

  it('serves HTML views, rejects non-GET, and 404s unknown routes', () => {
    const index = get('/');
    expect(index.status).toBe(200);
    expect(index.headers['content-type']).toContain('text/html');
    expect(get('/store').status).toBe(200);
    expect(get('/health', 'POST').status).toBe(405);
    expect(get('/nope').status).toBe(404);
  });
});
