/**
 * @veripact/paypal-client OAuth + shared HTTP transport.
 *
 * `PayPalApi` is the single seam every module (orders, authorizations,
 * disputes, webhooks) programs against: `PayPalClient` implements it once,
 * routing to `LIVE_PAYPAL_SANDBOX` over `nodeHttpTransport` or to the
 * deterministic replay engine. Security-audit skill (guidance mode,
 * WEB-PROTOCOL-AND-AUTH): the client secret crosses exactly one boundary —
 * the OAuth token call — and error paths below never echo headers or
 * request bodies, so `PAYPAL_CLIENT_SECRET` cannot leak into thrown errors.
 */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as tlsConnect } from 'node:tls';
import type { ClientRequest, IncomingMessage } from 'node:http';

/** Honest transport label carried on every paypal-client response (Rule 3). */
export type TransportMode = 'LIVE_PAYPAL_SANDBOX' | 'DETERMINISTIC_SANDBOX_REPLAY';

/** Minimal HTTP request shape for PayPal REST calls. */
export interface HttpRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Path + optional query, e.g. `/v2/checkout/orders/ORD-1`. */
  path: string;
  headers?: Record<string, string>;
  bodyText?: string;
  timeoutMs?: number;
}

/** Minimal HTTP response shape. */
export interface HttpResponse {
  status: number;
  bodyText: string;
}

/**
 * Injectable HTTP transport. Tests inject fakes to exercise live-mode code
 * paths (auth headers, idempotency keys, HATEOAS parsing) with zero sockets.
 */
export type HttpTransport = (baseUrl: string, req: HttpRequest) => Promise<HttpResponse>;

/**
 * The seam modules program against. `request` sends one JSON call and
 * returns the parsed body; it throws `PayPalHttpError` on transport
 * failures or non-2xx statuses.
 */
/** Per-request options: caller-supplied idempotency key. */
export interface RequestOpts {
  requestId?: string;
}

export interface PayPalApi {
  readonly transportMode: TransportMode;
  request<T>(
    method: HttpRequest['method'],
    path: string,
    body?: unknown,
    opts?: RequestOpts,
  ): Promise<PayPalEnvelope<T>>;
}

/** Parsed response envelope. */
export interface PayPalEnvelope<T> {
  status: number;
  data: T;
}

/**
 * Sanitized HTTP failure: method + path + status + truncated server body.
 * Never carries request headers (Authorization) or request bodies, so the
 * OAuth secret and bearer tokens cannot surface via `error.message`.
 */
export class PayPalHttpError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;

  constructor(method: string, path: string, status: number, serverBody: string) {
    const snippet = serverBody.length > 500 ? `${serverBody.slice(0, 500)}…` : serverBody;
    super(`paypal ${method} ${path} failed: HTTP ${status} ${snippet}`);
    this.name = 'PayPalHttpError';
    this.status = status;
    this.method = method;
    this.path = path;
  }
}

/** Parse a transport response as JSON, throwing `PayPalHttpError` on failure. */
export function parseJsonResponse<T>(
  method: string,
  path: string,
  res: HttpResponse,
): PayPalEnvelope<T> {
  if (res.status < 200 || res.status >= 300) {
    throw new PayPalHttpError(method, path, res.status, res.bodyText);
  }
  if (res.bodyText.trim().length === 0) {
    return { status: res.status, data: undefined as T };
  }
  try {
    return { status: res.status, data: JSON.parse(res.bodyText) as T };
  } catch {
    throw new PayPalHttpError(method, path, res.status, 'non-JSON response body');
  }
}

/* ------------------------------------------------------------------ */
/* Proxy-aware node:http(s) transport                                   */
/* ------------------------------------------------------------------ */

/**
 * Resolve the proxy URL for a target, honoring `HTTPS_PROXY`/`https_proxy`
 * (https targets), `HTTP_PROXY`/`http_proxy` (http targets), and
 * `NO_PROXY`/`no_proxy` (comma-separated hosts, `*` bypasses all).
 * Pure and side-effect free so tests can pin the routing table.
 */
export function resolveProxyForUrl(targetUrl: string): string | undefined {
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return undefined;
  }
  const noProxy = (process.env['NO_PROXY'] ?? process.env['no_proxy'] ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const host = target.hostname.toLowerCase();
  for (const entry of noProxy) {
    if (entry === '*' || host === entry || host.endsWith(`.${entry}`)) {
      return undefined;
    }
  }
  const raw =
    target.protocol === 'https:'
      ? (process.env['HTTPS_PROXY'] ?? process.env['https_proxy'])
      : (process.env['HTTP_PROXY'] ?? process.env['http_proxy']);
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  try {
    const proxy = new URL(raw);
    if (proxy.protocol !== 'http:' && proxy.protocol !== 'https:') {
      return undefined;
    }
    return proxy.toString();
  } catch {
    return undefined;
  }
}

function readStreamText(stream: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

function sendRequest(
  req: ClientRequest,
  bodyText: string | undefined,
  timeoutMs: number,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      req.destroy(new Error(`paypal request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    req.on('response', (res: IncomingMessage) => {
      readStreamText(res).then(
        (bodyText) => {
          clearTimeout(timer);
          resolve({ status: res.statusCode ?? 0, bodyText });
        },
        (e: unknown) => {
          clearTimeout(timer);
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
    req.on('error', (e: Error) => {
      clearTimeout(timer);
      reject(e);
    });
    if (bodyText !== undefined) {
      req.write(bodyText);
    }
    req.end();
  });
}

/**
 * Default transport over `node:http(s)`. HTTPS targets behind an
 * `http(s)://` proxy use CONNECT tunneling; proxy credentials come from the
 * proxy URL only and are never logged. Rejects non-http(s) targets.
 */
export async function nodeHttpTransport(baseUrl: string, req: HttpRequest): Promise<HttpResponse> {
  const target = new URL(req.path, baseUrl);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`paypal: refusing non-http(s) target ${target.protocol}`);
  }
  const timeoutMs = req.timeoutMs ?? 15000;
  const proxyRaw = resolveProxyForUrl(target.toString());
  if (proxyRaw === undefined) {
    const sender = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const clientReq = sender(
      target,
      { method: req.method, headers: req.headers, timeout: timeoutMs },
      // Response is consumed via the 'response' listener in sendRequest.
      () => undefined,
    );
    return sendRequest(clientReq, req.bodyText, timeoutMs);
  }
  const proxy = new URL(proxyRaw);
  if (target.protocol === 'http:') {
    // Plain-HTTP forwarding proxy: absolute URI in the request line.
    const clientReq = httpRequest(
      {
        host: proxy.hostname,
        port: proxy.port !== '' ? Number(proxy.port) : 80,
        method: req.method,
        path: target.toString(),
        headers: req.headers,
        timeout: timeoutMs,
      },
      () => undefined,
    );
    return sendRequest(clientReq, req.bodyText, timeoutMs);
  }
  // HTTPS target: CONNECT tunnel, then TLS over the tunnel socket.
  const connectHeaders: Record<string, string> = { Host: target.host };
  if (proxy.username !== '') {
    connectHeaders['Proxy-Authorization'] = `Basic ${Buffer.from(
      `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
      'utf8',
    ).toString('base64')}`;
  }
  const tunnel: import('node:net').Socket = await new Promise((resolve, reject) => {
    const connectReq = httpRequest({
      host: proxy.hostname,
      port: proxy.port !== '' ? Number(proxy.port) : 80,
      method: 'CONNECT',
      path: `${target.hostname}:${target.port !== '' ? target.port : 443}`,
      headers: connectHeaders,
      timeout: timeoutMs,
    });
    connectReq.on('connect', (_res, socket) => resolve(socket));
    connectReq.on('error', reject);
    connectReq.end();
  });
  const tlsSocket = tlsConnect({
    socket: tunnel,
    servername: target.hostname,
    timeout: timeoutMs,
  });
  await new Promise<void>((resolve, reject) => {
    tlsSocket.on('secureConnect', () => resolve());
    tlsSocket.on('error', reject);
  });
  const clientReq = httpsRequest(
    {
      host: target.hostname,
      port: target.port !== '' ? Number(target.port) : 443,
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers: req.headers,
      timeout: timeoutMs,
      createConnection: () => tlsSocket,
    },
    () => undefined,
  );
  return sendRequest(clientReq, req.bodyText, timeoutMs);
}

/* ------------------------------------------------------------------ */
/* OAuth client-credentials                                             */
/* ------------------------------------------------------------------ */

export interface OAuthTokenInput {
  transport: HttpTransport;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs?: number;
}

export interface OAuthToken {
  accessToken: string;
  expiresInSec: number;
}

/**
 * Fetch a client-credentials access token (`POST /v1/oauth2/token`,
 * HTTP Basic with `id:secret`). The secret is used here and only here;
 * failures surface as `PayPalHttpError` (no headers/bodies echoed).
 */
export async function fetchAccessToken(input: OAuthTokenInput): Promise<OAuthToken> {
  const basic = Buffer.from(`${input.clientId}:${input.clientSecret}`, 'utf8').toString('base64');
  const res = await input.transport(input.baseUrl, {
    method: 'POST',
    path: '/v1/oauth2/token',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    bodyText: 'grant_type=client_credentials',
    timeoutMs: input.timeoutMs,
  });
  const { data } = parseJsonResponse<{ access_token?: unknown; expires_in?: unknown }>(
    'POST',
    '/v1/oauth2/token',
    res,
  );
  if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
    throw new PayPalHttpError('POST', '/v1/oauth2/token', 200, 'missing access_token');
  }
  const expiresInSec = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  return { accessToken: data.access_token, expiresInSec };
}

/** Cached bearer token with a 60s expiry skew. */
export class TokenCache {
  private token: string | undefined;
  private expiresAtMs = 0;

  async get(fetch: () => Promise<OAuthToken>): Promise<string> {
    if (this.token !== undefined && Date.now() < this.expiresAtMs) {
      return this.token;
    }
    const fresh = await fetch();
    this.token = fresh.accessToken;
    this.expiresAtMs = Date.now() + Math.max(0, fresh.expiresInSec - 60) * 1000;
    return this.token;
  }

  clear(): void {
    this.token = undefined;
    this.expiresAtMs = 0;
  }
}