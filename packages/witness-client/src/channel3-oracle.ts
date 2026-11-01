/**
 * @veripact/witness-client channel3-oracle — catalog cross-check oracle.
 *
 * Live mode queries Channel3's Streamable HTTP MCP endpoint; cache/auto
 * modes verify against the deterministic replay catalog. The source label
 * always says which one produced the answer (AGENTS.md Rule 3).
 */
import { request as httpsRequest } from 'node:https';
import { readFileSync } from 'node:fs';

/** Channel3 Streamable HTTP MCP endpoint (no key on the free tier). */
export const CHANNEL3_MCP_URL = 'https://mcp.trychannel3.com/';

/** Minimum title recall (0..1, plus exact-title boost) to accept a match. */
export const CHANNEL3_MATCH_THRESHOLD = 0.5;

/** One catalog product (cache rows and normalized live rows). */
export interface Channel3CatalogProduct {
  productId: string;
  title: string;
  brand?: string;
  condition?: string;
  priceUsd?: number;
  category?: string;
}

/** Deterministic replay catalog (benchmark/responses, labeled REPLAY). */
export interface Channel3CatalogCache {
  replay: boolean;
  recordedAtUtc: string;
  source?: string;
  products: Channel3CatalogProduct[];
}

export interface Channel3OracleInput {
  brandModel?: string;
  condition?: string;
  basePriceUsd?: number;
}

export type Channel3OracleMode = 'live' | 'cache' | 'auto';

export interface Channel3OracleOptions {
  mode?: Channel3OracleMode;
  cache?: Channel3CatalogCache;
  cachePath?: string;
  timeoutMs?: number;
  fetchJson?: (url: string, body: unknown, timeoutMs: number) => Promise<{ status: number; json: unknown }>;
}

export interface Channel3VerificationResult {
  matched: boolean;
  productId: string;
  catalogCondition: string;
  catalogPriceUsd: number;
  conditionMatch: boolean;
  priceDeltaUsd: number;
  source: 'CHANNEL3_MCP_LIVE' | 'CHANNEL3_CACHE_REPLAY';
}

/** Load a replay cache from disk (caller supplies the explicit path). */
export function loadChannel3CacheFromDisk(cachePath: string): Channel3CatalogCache {
  const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as Channel3CatalogCache;
  if (!Array.isArray(parsed.products)) {
    throw new Error('channel3: cache has no products array');
  }
  return parsed;
}

function tokensOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

function normalizeTitle(title: string): string {
  return tokensOf(title).join(' ');
}

function matchScore(listingTokens: string[], catalogTitle: string): number {
  if (listingTokens.length === 0) {
    return 0;
  }
  const catalog = new Set(tokensOf(catalogTitle));
  const hits = listingTokens.filter((t) => catalog.has(t)).length;
  return hits / listingTokens.length;
}

/**
 * Best catalog match for a listing title: token recall plus an exact-title
 * boost, first-on-tie for determinism. Undefined below threshold.
 */
export function matchCatalogProduct(
  title: string,
  products: Channel3CatalogProduct[],
): Channel3CatalogProduct | undefined {
  const listing = tokensOf(title);
  if (listing.length === 0) {
    return undefined;
  }
  const want = normalizeTitle(title);
  let best: Channel3CatalogProduct | undefined;
  let bestScore = 0;
  for (const product of products) {
    const score =
      matchScore(listing, product.title) + (normalizeTitle(product.title) === want ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = product;
    }
  }
  return bestScore >= CHANNEL3_MATCH_THRESHOLD ? best : undefined;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

function toResult(
  input: Channel3OracleInput,
  product: Channel3CatalogProduct,
  source: Channel3VerificationResult['source'],
): Channel3VerificationResult {
  const catalogCondition = (product.condition ?? 'UNKNOWN').toUpperCase();
  const listingCondition = input.condition?.toUpperCase();
  return {
    matched: true,
    productId: product.productId,
    catalogCondition,
    catalogPriceUsd: product.priceUsd ?? 0,
    conditionMatch:
      listingCondition !== undefined && listingCondition !== '' && listingCondition === catalogCondition,
    priceDeltaUsd:
      input.basePriceUsd === undefined || product.priceUsd === undefined
        ? 0
        : round2(input.basePriceUsd - product.priceUsd),
    source,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

/** Tolerantly normalize live MCP payloads into catalog rows. */
function normalizeMcpProducts(json: unknown): Channel3CatalogProduct[] {
  const out: Channel3CatalogProduct[] = [];
  const push = (row: Record<string, unknown>): void => {
    const title = asString(row['title'] ?? row['name']);
    const productId = asString(row['productId'] ?? row['id'] ?? row['sku']);
    if (!title || !productId) {
      return;
    }
    out.push({
      productId,
      title,
      brand: asString(row['brand']),
      condition: asString(row['condition']),
      priceUsd: asNumber(row['priceUsd'] ?? row['price']),
    });
  };
  const root = isRecord(json) ? json : undefined;
  const result = root?.['result'] ?? json;
  if (Array.isArray(result)) {
    for (const row of result) {
      if (isRecord(row)) {
        push(row);
      }
    }
    return out;
  }
  if (!isRecord(result)) {
    return out;
  }
  const content = result['content'];
  if (Array.isArray(content)) {
    for (const item of content) {
      if (!isRecord(item)) {
        continue;
      }
      const text = asString(item['text']);
      if (!text) {
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(text);
        if (Array.isArray(parsed)) {
          for (const row of parsed) {
            if (isRecord(row)) {
              push(row);
            }
          }
        } else if (isRecord(parsed)) {
          push(parsed);
        }
      } catch {
        continue;
      }
    }
    return out;
  }
  const products = result['products'] ?? result['items'];
  if (Array.isArray(products)) {
    for (const row of products) {
      if (isRecord(row)) {
        push(row);
      }
    }
  }
  return out;
}

function defaultFetchJson(
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const text = JSON.stringify(body);
    const parsed = new URL(url);
    const req = httpsRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'content-length': String(Buffer.byteLength(text)),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const contentType = String(res.headers['content-type'] ?? '');
          let payload = raw;
          if (contentType.includes('text/event-stream')) {
            const line = raw
              .split('\n')
              .map((l) => l.trim())
              .find((l) => l.startsWith('data:'));
            if (!line || line.slice(5).trim() === '[DONE]') {
              reject(new Error('channel3: empty SSE response'));
              return;
            }
            payload = line.slice(5).trim();
          }
          try {
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(payload) as unknown });
          } catch {
            reject(new Error('channel3: MCP response is not JSON'));
          }
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('channel3: MCP request timed out'));
    });
    req.on('error', reject);
    req.end(text);
  });
}

async function fetchLiveProducts(
  query: string,
  options: Channel3OracleOptions,
): Promise<Channel3CatalogProduct[]> {
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  const { status, json } = await fetchJson(
    CHANNEL3_MCP_URL,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search_products', arguments: { query } },
    },
    options.timeoutMs ?? 8000,
  );
  if (status < 200 || status >= 300) {
    throw new Error(`channel3: MCP HTTP ${status}`);
  }
  return normalizeMcpProducts(json);
}

/**
 * Cross-check listing terms against the Channel3 catalog. `'live'` queries
 * MCP (network errors throw — no silent fallback); `'cache'` uses the
 * replay catalog; `'auto'` (default) tries live, then the cache.
 */
export async function verifyWithChannel3Oracle(
  input: Channel3OracleInput,
  options: Channel3OracleOptions = {},
): Promise<Channel3VerificationResult> {
  const mode = options.mode ?? 'auto';
  const cacheMiss: Channel3VerificationResult = {
    matched: false,
    productId: '',
    catalogCondition: 'UNKNOWN',
    catalogPriceUsd: 0,
    conditionMatch: false,
    priceDeltaUsd: 0,
    source: 'CHANNEL3_CACHE_REPLAY',
  };
  if (!input.brandModel) {
    return cacheMiss;
  }
  if (mode === 'live' || mode === 'auto') {
    try {
      const products = await fetchLiveProducts(input.brandModel, options);
      const match = matchCatalogProduct(input.brandModel, products);
      if (match) {
        return toResult(input, match, 'CHANNEL3_MCP_LIVE');
      }
      if (mode === 'live') {
        return { ...cacheMiss, source: 'CHANNEL3_MCP_LIVE' };
      }
    } catch (error) {
      if (mode === 'live') {
        throw error;
      }
    }
  }
  const cache =
    options.cache ?? (options.cachePath ? loadChannel3CacheFromDisk(options.cachePath) : undefined);
  if (!cache) {
    if (mode === 'cache') {
      throw new Error('channel3: cache mode needs options.cache or options.cachePath');
    }
    return cacheMiss;
  }
  const match = matchCatalogProduct(input.brandModel, cache.products);
  if (!match) {
    return cacheMiss;
  }
  return toResult(input, match, 'CHANNEL3_CACHE_REPLAY');
}
