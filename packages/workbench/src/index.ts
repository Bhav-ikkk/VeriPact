/**
 * @veripact/workbench — single-process Node HTTP server (agent 04).
 * Route modules keep Rule 2 key boundaries: buyer (SELF), witness (WIT),
 * merchant (SIGN). Full Sequoia UI + AG Studio desk land in later prompts.
 */
import { createServer, type Server } from 'node:http';
import { COMMITMENT_PREFIX } from '@veripact/core';

export const WORKBENCH_VERSION = '0.1.0';

/** Served routes (foundation skeleton). */
export const ROUTES = ['/health', '/api/buyer', '/api/witness', '/api/merchant', '/store'];

export interface HealthPayload {
  status: 'ok';
  version: string;
  routes: string[];
}

/** Minimal request surface (satisfied by http.IncomingMessage and test fakes). */
export interface WorkbenchRequest {
  method?: string;
  url?: string;
}

/** Minimal response surface (satisfied by http.ServerResponse and test fakes). */
export interface WorkbenchResponse {
  writeHead(code: number, headers: Record<string, string>): void;
  end(body: string): void;
}

const INDEX_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>VeriPact Workbench</title></head>
<body><h1>VeriPact Workbench</h1>
<nav><a href="/store">View 1: Buyer Checkout</a> | <a href="/api/witness">View 2: Dispute Desk (API)</a></nav>
</body></html>`;

const STORE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>VeriPact Synthetic Store</title></head>
<body><h1>Synthetic Store (trademark-free fixture in later prompts)</h1></body></html>`;

function sendJson(res: WorkbenchResponse, code: number, payload: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendHtml(res: WorkbenchResponse, code: number, html: string): void {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

/** Route one request. Synchronous; tested with fake req/res (no sockets). */
export function handleWorkbenchRequest(req: WorkbenchRequest, res: WorkbenchResponse): void {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  switch (pathname) {
    case '/health': {
      const payload: HealthPayload = { status: 'ok', version: WORKBENCH_VERSION, routes: ROUTES };
      sendJson(res, 200, payload);
      return;
    }
    case '/api/buyer':
      sendJson(res, 200, { boundary: 'SELF', mandate: null, note: 'buyer route lands in Prompt #2+' });
      return;
    case '/api/witness':
      sendJson(res, 200, { boundary: 'WIT', receipt: null, note: 'witness route lands in Prompt #2+' });
      return;
    case '/api/merchant':
      sendJson(res, 200, {
        boundary: 'SIGN',
        commitmentPrefix: COMMITMENT_PREFIX,
        note: 'merchant route lands in Prompt #2+',
      });
      return;
    case '/':
      sendHtml(res, 200, INDEX_HTML);
      return;
    case '/store':
      sendHtml(res, 200, STORE_HTML);
      return;
    default:
      sendJson(res, 404, { error: 'not found' });
  }
}

/** Build the workbench server wired to `handleWorkbenchRequest`. */
export function createWorkbenchServer(): Server {
  return createServer((req, res) => handleWorkbenchRequest(req, res));
}

/** Listen on a port (used by `render.yaml` start command and local dev). */
export function start(port: number): Server {
  const server = createWorkbenchServer();
  server.listen(port);
  return server;
}

const entrypoint = process.argv[1] ?? '';
if (entrypoint.endsWith('index.js')) {
  start(Number(process.env['PORT'] ?? 3000));
}
