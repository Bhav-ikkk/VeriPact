/**
 * @veripact/sdk live web coupon & wild-URL hunter plugin.
 *
 * Inspects a live merchant URL (JSON-LD Product schema, OpenGraph price /
 * title tags, visible terms, hidden DOM) or a plain product query, runs it
 * through `createWitnessSnapshot` (13-rule DOM scan + quote extraction +
 * sufficiency gate + Channel3 oracle + Ed25519 signature + RFC 3161
 * anchor), evaluates the deterministic coupon registry (plus optional
 * Gemini live suggestions when double-gated), and returns a signed `VP1:`
 * verification report.
 *
 * Honesty (Rule 3): the timestamp proves the page hash existed at time T
 * plus independent witness observation — never content truth. Catalog
 * mode synthesizes HTML from catalog-known facts ONLY (title, price,
 * condition); return terms stay INDETERMINATE there because no merchant
 * page was observed, so catalog hunts can never ALLOW on terms.
 *
 * SSRF guard: only https (plus http for the local workbench test origin)
 * is fetched; loopback / private / link-local IP literals, userinfo URLs,
 * cloud metadata hosts, and non-http schemes are refused with
 * `WebHuntInputError`. Redirects are followed manually (max 3 hops) with
 * the guard re-applied per hop. Known limitation: DNS hostnames are not
 * resolved-and-rechecked, so DNS rebinding is out of scope.
 */
import { randomBytes } from 'node:crypto';
import {
  repoPath,
  signCanonicalPayload,
  type MandateSpec,
  type ObservedCriterion,
} from '@veripact/core';
import {
  createWitnessSnapshot,
  loadChannel3CacheFromDisk,
  type Channel3CatalogCache,
} from '@veripact/witness-client';
import { buildDemoMandate, DEMO_CHANNEL3_CACHE } from './scenarios';
import { parseShoppingIntent, SKU_VOUCHER_MAP } from './intent-planner';

/** One promo code evaluated against the witnessed terms. */
export interface DiscoveredWebCoupon {
  code: string;
  description: string;
  discountUsd: number;
  source: string;
  verifiedTermsIntact: boolean;
  rejectionReason?: string;
}

/** Signed verification report for one wild-URL / product hunt. */
export interface LiveWebHuntResult {
  huntId: string;
  inputQueryOrUrl: string;
  mode: 'LIVE_URL_FETCH' | 'CATALOG_AND_COUPON_SEARCH';
  targetUrl: string;
  extractedTitle: string;
  extractedBasePriceUsd: number;
  shippingPlusTaxUsd: number;
  bestAllInUsd: number;
  targetMaxAllInUsd: number;
  observedCondition: 'NEW' | 'REFURBISHED' | 'UNKNOWN';
  observedReturnDays: number;
  observedRestockingFeePct: number;
  domIntegrity: 'CLEAN' | 'ADVERSARIAL_DOM';
  discoveredCoupons: DiscoveredWebCoupon[];
  appliedCoupon: DiscoveredWebCoupon | null;
  gateDecision: 'ALLOW' | 'ASK_HUMAN_DELTA' | 'BLOCK';
  commitment: string;
  tlsVerified: boolean;
  completedAtUtc: string;
}

/** Hunter input: wild URL or plain product query, optional target cap. */
export interface WebHuntInput {
  queryOrUrl: string;
  targetMaxAllInUsd?: number;
}

/** Host surface the hunter needs (`VeriPactClient` satisfies this). */
export interface WebHuntHost {
  keys: {
    buyer: { publicKeyHex: string; privateKeyHex: string };
    witness: { publicKeyHex: string; privateKeyHex: string };
  };
}

/** Bad input / SSRF refusal — the route maps this to HTTP 400. */
export class WebHuntInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebHuntInputError';
  }
}

/** Wild-URL fetch failure — the route maps this to HTTP 502. */
export class WebHuntFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebHuntFetchError';
  }
}

/** Max `queryOrUrl` length (mirrors the listing-URL caps elsewhere). */
export const WEB_HUNT_MAX_QUERY_CHARS = 512;

/** Max wild-URL response body accepted (512 KB). */
export const WEB_HUNT_MAX_RESPONSE_BYTES = 512 * 1024;

/** Wild-URL fetch timeout per attempt (ms). */
export const WEB_HUNT_FETCH_TIMEOUT_MS = 4000;

/** Max manual redirect hops for a wild URL (guard re-applied per hop). */
export const WEB_HUNT_MAX_REDIRECTS = 3;

/**
 * Demo shipping+tax estimate used only when the page states neither
 * (the same $18 the workbench adds to catalog prices: 279 + 18 = 297).
 */
export const WEB_HUNT_DEFAULT_SHIP_TAX_USD = 18.0;

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

function determinateNumber(criterion: ObservedCriterion<number>): number | undefined {
  return criterion.status === 'DETERMINATE' && criterion.value !== undefined
    ? criterion.value
    : undefined;
}

function determinateString(criterion: ObservedCriterion<string>): string | undefined {
  return criterion.status === 'DETERMINATE' && criterion.value !== undefined
    ? criterion.value
    : undefined;
}

function mapCondition(value: string | undefined): 'NEW' | 'REFURBISHED' | 'UNKNOWN' {
  if (value === 'NEW' || value === 'REFURBISHED') {
    return value;
  }
  return 'UNKNOWN';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_m, digits: string) => String.fromCharCode(Number(digits)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/* ------------------------------------------------------------------ */
/* SSRF & protocol guard                                                */
/* ------------------------------------------------------------------ */

function workbenchPort(): string {
  const port = process.env['PORT'];
  return port !== undefined && port !== '' ? port : '3000';
}

/** True only for the local workbench test origin (host + port both match). */
function isLocalTestOrigin(parsed: URL): boolean {
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const localHost = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  return localHost && parsed.port === workbenchPort();
}

function ipv4Octets(host: string): [number, number, number, number] | null {
  if (/^\d+$/.test(host)) {
    // Single-number form (WHATWG usually normalizes this; defense in depth).
    const n = Number(host);
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) {
      return null;
    }
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  }
  const parts = host.split('.');
  if (parts.length !== 4) {
    return null;
  }
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const n = Number(part);
    if (n > 255) {
      return null;
    }
    octets.push(n);
  }
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

function isBlockedIpLiteral(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = ipv4Octets(h);
  if (v4 !== null) {
    const [a, b] = v4;
    if (a === 127 || a === 10 || a === 0) {
      return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
    if (a === 192 && b === 168) {
      return true;
    }
    if (a === 169 && b === 254) {
      return true;
    }
    if (a === 100 && b >= 64 && b <= 127) {
      return true;
    }
    if (a === 192 && b === 0 && v4[2] === 0) {
      return true;
    }
    if (a === 198 && (b === 18 || b === 19)) {
      return true;
    }
    if (a >= 224) {
      return true;
    }
    return false;
  }
  if (h.includes(':')) {
    if (h === '::1' || h === '::') {
      return true;
    }
    if (h.startsWith('fe80:') || h.startsWith('fe80::')) {
      return true;
    }
    const first = h.split(':')[0] ?? '';
    if (/^f[cd][0-9a-f]{2}$/.test(first)) {
      return true;
    }
    if (h.startsWith('::ffff:')) {
      // IPv4-mapped: judge the embedded v4 address.
      const tail = h.slice('::ffff:'.length);
      const embedded = tail.includes('.') ? tail : null;
      if (embedded !== null) {
        return isBlockedIpLiteral(embedded);
      }
      return true;
    }
    return false;
  }
  return false;
}

function guardParsedUrl(parsed: URL): void {
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new WebHuntInputError(
      `web-hunt: unsupported URL scheme "${parsed.protocol.slice(0, -1)}" (only https, plus http for the local test origin)`,
    );
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new WebHuntInputError('web-hunt: credentials embedded in the URL are not allowed');
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (
    host === 'metadata.google.internal' ||
    host === 'metadata.goog' ||
    host.endsWith('.metadata.google.internal')
  ) {
    throw new WebHuntInputError('web-hunt: refused SSRF target (cloud metadata host)');
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    if (!isLocalTestOrigin(parsed)) {
      throw new WebHuntInputError(
        'web-hunt: refused SSRF target (loopback is allowed only for the local workbench test origin)',
      );
    }
    return;
  }
  if (isBlockedIpLiteral(host) && !isLocalTestOrigin(parsed)) {
    throw new WebHuntInputError(`web-hunt: refused SSRF target (${host})`);
  }
  if (parsed.protocol === 'http:' && !isLocalTestOrigin(parsed)) {
    throw new WebHuntInputError('web-hunt: plain http is allowed only for the local test origin');
  }
}

interface ClassifiedTarget {
  mode: 'LIVE_URL_FETCH' | 'CATALOG_AND_COUPON_SEARCH';
  url: string;
}

function classifyTarget(queryOrUrl: string): ClassifiedTarget {
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(queryOrUrl);
  if (scheme === null) {
    // No scheme: plain product query, never fetched.
    return { mode: 'CATALOG_AND_COUPON_SEARCH', url: '' };
  }
  let parsed: URL;
  try {
    parsed = new URL(queryOrUrl);
  } catch {
    throw new WebHuntInputError('web-hunt: malformed URL');
  }
  guardParsedUrl(parsed);
  return { mode: 'LIVE_URL_FETCH', url: parsed.toString() };
}

/* ------------------------------------------------------------------ */
/* Wild-URL fetch (manual redirects, size cap, timeout)                 */
/* ------------------------------------------------------------------ */

interface FetchedPage {
  html: string;
  status: number;
  tlsVerified: boolean;
}

async function fetchHuntHtml(url: string): Promise<FetchedPage> {
  if (typeof fetch !== 'function') {
    throw new WebHuntFetchError('web-hunt: fetch is unavailable in this runtime');
  }
  let current = url;
  for (let hop = 0; hop <= WEB_HUNT_MAX_REDIRECTS; hop += 1) {
    let res: Response;
    try {
      res = await fetch(current, {
        signal: AbortSignal.timeout(WEB_HUNT_FETCH_TIMEOUT_MS),
        redirect: 'manual',
        headers: {
          'user-agent': 'VeriPact-WebHunt/1.0 (+https://github.com/Bhav-ikkk/VeriPact)',
          accept: 'text/html,application/xhtml+xml',
        },
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'TimeoutError') {
        throw new WebHuntFetchError(
          `web-hunt: wild URL fetch timed out after ${WEB_HUNT_FETCH_TIMEOUT_MS}ms`,
        );
      }
      throw new WebHuntFetchError(
        `web-hunt: wild URL fetch failed (${e instanceof Error ? e.message : String(e)})`,
      );
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location === null || location === '') {
        throw new WebHuntFetchError(`web-hunt: redirect without location (HTTP ${res.status})`);
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new WebHuntFetchError('web-hunt: redirect to a malformed URL');
      }
      guardParsedUrl(next);
      current = next.toString();
      continue;
    }
    if (!res.ok) {
      throw new WebHuntFetchError(`web-hunt: wild URL fetch failed (HTTP ${res.status})`);
    }
    const declared = res.headers.get('content-length');
    if (declared !== null && Number(declared) > WEB_HUNT_MAX_RESPONSE_BYTES) {
      throw new WebHuntFetchError('web-hunt: wild URL response exceeds the 512 KB cap');
    }
    const html = Buffer.from(await res.arrayBuffer()).toString('utf8');
    if (Buffer.byteLength(html, 'utf8') > WEB_HUNT_MAX_RESPONSE_BYTES) {
      throw new WebHuntFetchError('web-hunt: wild URL response exceeds the 512 KB cap');
    }
    return {
      html,
      status: res.status,
      tlsVerified: new URL(current).protocol === 'https:',
    };
  }
  throw new WebHuntFetchError('web-hunt: too many redirects for the wild URL');
}

/* ------------------------------------------------------------------ */
/* Page meta extraction (JSON-LD Product, OpenGraph, title, price)      */
/* ------------------------------------------------------------------ */

interface PageMeta {
  title?: string;
  priceUsd?: number;
}

function parseMoney(raw: unknown): number | undefined {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? round2(raw) : undefined;
  }
  if (typeof raw !== 'string') {
    return undefined;
  }
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return undefined;
  }
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? round2(n) : undefined;
}

function metaContent(html: string, key: string): string | undefined {
  const patterns = [
    new RegExp(
      `<meta[^>]*property=["']${key}["'][^>]*content=["']([^"']*)["'][^>]*>`,
      'i',
    ),
    new RegExp(
      `<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${key}["'][^>]*>`,
      'i',
    ),
  ];
  for (const re of patterns) {
    const match = re.exec(html);
    if (match?.[1] !== undefined && match[1] !== '') {
      return decodeEntities(match[1]);
    }
  }
  return undefined;
}

function jsonLdCandidates(html: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const block of blocks) {
    const raw = block[1] ?? '';
    if (raw.length === 0 || raw.length > 200_000) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'object' && item !== null) {
            out.push(item as Record<string, unknown>);
          }
        }
      } else if (typeof parsed === 'object' && parsed !== null) {
        const obj = parsed as Record<string, unknown>;
        const graph = obj['@graph'];
        if (Array.isArray(graph)) {
          for (const item of graph) {
            if (typeof item === 'object' && item !== null) {
              out.push(item as Record<string, unknown>);
            }
          }
        } else {
          out.push(obj);
        }
      }
    } catch {
      // Malformed JSON-LD is ignored; OpenGraph/title fallbacks still apply.
    }
  }
  return out;
}

function extractPageMeta(html: string): PageMeta {
  const meta: PageMeta = {};
  for (const item of jsonLdCandidates(html)) {
    const rawType = item['@type'];
    const types = (Array.isArray(rawType) ? rawType : [rawType])
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.toLowerCase());
    if (!types.includes('product')) {
      continue;
    }
    const name = item['name'];
    if (meta.title === undefined && typeof name === 'string' && name.trim() !== '') {
      meta.title = name.trim().slice(0, 200);
    }
    const offers = item['offers'];
    const offer = Array.isArray(offers) ? offers[0] : offers;
    if (typeof offer === 'object' && offer !== null) {
      const record = offer as Record<string, unknown>;
      const currency = record['priceCurrency'];
      if (currency === undefined || currency === 'USD') {
        const price = parseMoney(record['price']);
        if (price !== undefined && meta.priceUsd === undefined) {
          meta.priceUsd = price;
        }
      }
    }
    if (meta.title !== undefined && meta.priceUsd !== undefined) {
      break;
    }
  }
  if (meta.title === undefined) {
    const ogTitle = metaContent(html, 'og:title');
    if (ogTitle !== undefined) {
      meta.title = ogTitle.slice(0, 200);
    } else {
      const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
      const title = titleMatch?.[1]?.trim();
      if (title !== undefined && title !== '') {
        meta.title = decodeEntities(title).slice(0, 200);
      }
    }
  }
  if (meta.priceUsd === undefined) {
    const ogPrice = metaContent(html, 'product:price:amount');
    const price = ogPrice !== undefined ? parseMoney(ogPrice) : undefined;
    if (price !== undefined) {
      meta.priceUsd = price;
    }
  }
  return meta;
}

/* ------------------------------------------------------------------ */
/* Coupon registry + discovery plugin                                   */
/* ------------------------------------------------------------------ */

interface RegistryCoupon {
  code: string;
  description: string;
  discountUsd: number;
  source: string;
  voidsReturns: boolean;
  minOrderUsd?: number;
}

/**
 * Multi-source coupon registry. Trap codes stay listed with
 * `verifiedTermsIntact: false` so judges can see the rejection reason
 * instead of a silent omission.
 */
const COUPON_REGISTRY: RegistryCoupon[] = [
  { code: 'PAYPAL50', description: '$50 off sitewide', discountUsd: 50, source: 'veripact-coupon-registry', voidsReturns: false },
  { code: 'AUDIO67', description: '$67 off audio', discountUsd: 67, source: 'veripact-coupon-registry', voidsReturns: false },
  { code: 'MECH30', description: '$30 off keyboards', discountUsd: 30, source: 'veripact-coupon-registry', voidsReturns: false },
  { code: 'NVME25', description: '$25 off storage', discountUsd: 25, source: 'veripact-coupon-registry', voidsReturns: false },
  { code: 'CAM40', description: '$40 off cameras', discountUsd: 40, source: 'veripact-coupon-registry', voidsReturns: false },
  { code: 'DOCK45', description: '$45 off accessories', discountUsd: 45, source: 'veripact-coupon-registry', voidsReturns: false },
  { code: 'WELCOME15', description: '$15 off first order', discountUsd: 15, source: 'veripact-coupon-registry', voidsReturns: false },
  { code: 'CLEARANCE70', description: '$70 off clearance (voids returns)', discountUsd: 70, source: 'veripact-coupon-registry', voidsReturns: true },
  { code: 'VIP60', description: '$60 off $500+ orders', discountUsd: 60, source: 'veripact-coupon-registry', voidsReturns: false, minOrderUsd: 500 },
];

function toDiscovered(entry: RegistryCoupon, preCouponTotalUsd: number): DiscoveredWebCoupon {
  if (entry.voidsReturns) {
    return {
      code: entry.code,
      description: entry.description,
      discountUsd: entry.discountUsd,
      source: entry.source,
      verifiedTermsIntact: false,
      rejectionReason: 'Voids the 30-day return policy',
    };
  }
  if (entry.minOrderUsd !== undefined && preCouponTotalUsd < entry.minOrderUsd) {
    return {
      code: entry.code,
      description: entry.description,
      discountUsd: entry.discountUsd,
      source: entry.source,
      verifiedTermsIntact: false,
      rejectionReason: `Requires a $${entry.minOrderUsd} minimum order`,
    };
  }
  return {
    code: entry.code,
    description: entry.description,
    discountUsd: entry.discountUsd,
    source: entry.source,
    verifiedTermsIntact: true,
  };
}

/**
 * Evaluate the coupon registry for a hunt: every candidate is returned
 * with its terms verdict; the SKU-mapped voucher sorts first, then by
 * discount descending (deterministic).
 */
export function discoverCouponsForProduct(options: {
  sku?: string;
  preCouponTotalUsd: number;
}): DiscoveredWebCoupon[] {
  const mapped = options.sku !== undefined ? SKU_VOUCHER_MAP[options.sku]?.voucherCode : undefined;
  const out = COUPON_REGISTRY.map((entry) => toDiscovered(entry, options.preCouponTotalUsd));
  out.sort((a, b) => {
    const aMapped = mapped !== undefined && a.code === mapped ? 1 : 0;
    const bMapped = mapped !== undefined && b.code === mapped ? 1 : 0;
    if (aMapped !== bMapped) {
      return bMapped - aMapped;
    }
    return b.discountUsd - a.discountUsd;
  });
  return out;
}

/** Highest-discount coupon with intact terms (first-max wins ties). */
export function selectAppliedCoupon(coupons: DiscoveredWebCoupon[]): DiscoveredWebCoupon | null {
  let best: DiscoveredWebCoupon | null = null;
  for (const coupon of coupons) {
    if (!coupon.verifiedTermsIntact) {
      continue;
    }
    if (best === null || coupon.discountUsd > best.discountUsd) {
      best = coupon;
    }
  }
  return best;
}

const LLM_COUPON_CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,23}$/;

/**
 * Optional Gemini live coupon suggestions. Double-gated exactly like the
 * intent planner (`GEMINI_API_KEY` + `VERIPACT_ENABLE_LIVE_LLM=true`),
 * silent `[]` on any failure. Suggestions are ALWAYS unverified: they
 * are listed for visibility but can never become `appliedCoupon`.
 */
async function llmSuggestCoupons(productTitle: string): Promise<DiscoveredWebCoupon[]> {
  const key = process.env['GEMINI_API_KEY'];
  if (key === undefined || key === '') {
    return [];
  }
  if (process.env['VERIPACT_ENABLE_LIVE_LLM'] !== 'true') {
    return [];
  }
  if (typeof fetch !== 'function') {
    return [];
  }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(2000),
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text:
                    `List currently-known public promo coupon codes for "${productTitle.slice(0, 120)}" ` +
                    'as JSON: [{"code":"...","description":"...","discountUsd":0}]. ' +
                    'Only real public codes; an empty array when none are known. No markdown.',
                },
              ],
            },
          ],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      },
    );
    if (!res.ok) {
      return [];
    }
    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text === undefined || text === '') {
      return [];
    }
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const out: DiscoveredWebCoupon[] = [];
    for (const item of parsed.slice(0, 8)) {
      if (typeof item !== 'object' || item === null) {
        continue;
      }
      const record = item as Record<string, unknown>;
      const code = record['code'];
      const description = record['description'];
      const discount = record['discountUsd'];
      if (typeof code !== 'string' || !LLM_COUPON_CODE_RE.test(code)) {
        continue;
      }
      if (typeof description !== 'string' || description.length > 140) {
        continue;
      }
      if (typeof discount !== 'number' || !Number.isFinite(discount) || discount < 0 || discount > 1000) {
        continue;
      }
      out.push({
        code,
        description,
        discountUsd: round2(discount),
        source: 'gemini-live-coupon-search',
        verifiedTermsIntact: false,
        rejectionReason: 'Unverified live suggestion — terms not confirmed',
      });
    }
    return out;
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Main hunt                                                            */
/* ------------------------------------------------------------------ */

function loadCatalog(): Channel3CatalogCache {
  try {
    return loadChannel3CacheFromDisk(
      repoPath('benchmark', 'responses', 'channel3_catalog_cache.json'),
    );
  } catch {
    return DEMO_CHANNEL3_CACHE;
  }
}

function mandateWithCap(
  mandate: MandateSpec,
  cap: number,
  buyerPrivateKeyHex: string,
  buyerPublicKeyHex: string,
): MandateSpec {
  const next: MandateSpec = {
    ...mandate,
    constraints: { ...mandate.constraints, maxAllInPriceUsd: round2(cap) },
    buyerPublicKeyHex,
    buyerSignatureHex: '',
  };
  next.buyerSignatureHex = signCanonicalPayload(
    { ...next, buyerSignatureHex: '' },
    buyerPrivateKeyHex,
  );
  return next;
}

/**
 * Conservative final decision: the witness gate leads; the couponed total
 * can only escalate ALLOW to ASK (never to ALLOW); integrity or condition
 * conflicts always BLOCK; and unverified return terms can never ALLOW
 * (unknown required terms already BLOCK at the witness gate; the overlay
 * additionally caps any gate ALLOW at ASK as defensive depth).
 */
function finalDecision(
  mapped: 'ALLOW' | 'ASK_HUMAN_DELTA' | 'BLOCK',
  input: {
    adversarial: boolean;
    refurbished: boolean;
    returnDaysKnown: boolean;
    bestAllInUsd: number;
    target: number;
  },
): 'ALLOW' | 'ASK_HUMAN_DELTA' | 'BLOCK' {
  if (input.adversarial || input.refurbished) {
    return 'BLOCK';
  }
  if (mapped === 'BLOCK') {
    return 'BLOCK';
  }
  if (!input.returnDaysKnown || input.bestAllInUsd > input.target) {
    return 'ASK_HUMAN_DELTA';
  }
  return mapped;
}

/**
 * Run one live web + coupon hunt. URL inputs are SSRF-guarded, fetched
 * (4s timeout, 512 KB cap, manual redirects), meta-parsed, and witnessed;
 * plain queries resolve through the deterministic intent planner against
 * the Channel3 cache. Registry coupons are evaluated, optional Gemini
 * suggestions merged (unverified), the best intact coupon applied, and a
 * signed `VP1:` report returned.
 */
export async function runLiveWebAndCouponHunt(
  host: WebHuntHost,
  input: WebHuntInput,
): Promise<LiveWebHuntResult> {
  const raw = input.queryOrUrl;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new WebHuntInputError('web-hunt: queryOrUrl must be a non-empty string');
  }
  const queryOrUrl = raw.trim();
  if (queryOrUrl.length > WEB_HUNT_MAX_QUERY_CHARS) {
    throw new WebHuntInputError(
      `web-hunt: queryOrUrl exceeds the ${WEB_HUNT_MAX_QUERY_CHARS}-char cap`,
    );
  }
  const target = input.targetMaxAllInUsd ?? 300;
  if (typeof target !== 'number' || !Number.isFinite(target) || target < 1 || target > 10000) {
    throw new WebHuntInputError('web-hunt: targetMaxAllInUsd must be between 1 and 10000');
  }

  const classified = classifyTarget(queryOrUrl);
  let html: string;
  let targetUrl: string;
  let tlsVerified: boolean;
  let fetchStatus = 200;
  let sku: string | undefined;
  let catalogBaseUsd: number | undefined;
  let catalogTitle: string | undefined;

  if (classified.mode === 'LIVE_URL_FETCH') {
    targetUrl = classified.url;
    const fetched = await fetchHuntHtml(targetUrl);
    html = fetched.html;
    tlsVerified = fetched.tlsVerified;
    fetchStatus = fetched.status;
  } else {
    const intent = await parseShoppingIntent(queryOrUrl, 'APEX-27-4K-IPS', target);
    const meta = SKU_VOUCHER_MAP[intent.matchedSku] ?? SKU_VOUCHER_MAP['APEX-27-4K-IPS']!;
    sku = meta.sku;
    catalogBaseUsd = meta.basePriceUsd;
    catalogTitle = meta.title;
    targetUrl = `https://store.example.com/product/${meta.sku}`;
    // Catalog-known facts ONLY — return terms stay INDETERMINATE because
    // no merchant page was observed (see module honesty note).
    const conditionPhrase =
      meta.condition === 'REFURBISHED' ? 'Certified Refurbished.' : 'Brand New in Box.';
    html =
      `<h1>${escapeHtml(meta.title)}</h1>` +
      `<p>${conditionPhrase} Sale Price: $${meta.basePriceUsd.toFixed(2)}.</p>`;
    tlsVerified = false;
  }

  const meta = extractPageMeta(html);
  const catalog = loadCatalog();
  const mandate = mandateWithCap(
    buildDemoMandate(meta.title ?? catalogTitle ?? queryOrUrl.slice(0, 80)),
    Math.min(320, target),
    host.keys.buyer.privateKeyHex,
    host.keys.buyer.publicKeyHex,
  );
  const snapshot = await createWitnessSnapshot({
    listingUrl: targetUrl,
    mandate,
    witnessKeys: {
      publicKeyHex: host.keys.witness.publicKeyHex,
      privateKeyHex: host.keys.witness.privateKeyHex,
    },
    htmlFetcher: () => Promise.resolve({ status: fetchStatus, html, tlsVerified }),
    requirePublicHttps: false,
    tsaMode: 'local',
    channel3Mode: 'cache',
    channel3Cache: catalog,
  });

  const observed = snapshot.termReceipt.observedTerms;
  const title =
    meta.title ??
    determinateString(observed.itemTitle) ??
    catalogTitle ??
    queryOrUrl.slice(0, 80);
  const base = meta.priceUsd ?? determinateNumber(observed.basePriceUsd) ?? catalogBaseUsd ?? 0;
  const ship = determinateNumber(observed.shippingUsd);
  const tax = determinateNumber(observed.taxUsd);
  const shipTax =
    ship !== undefined || tax !== undefined
      ? round2((ship ?? 0) + (tax ?? 0))
      : WEB_HUNT_DEFAULT_SHIP_TAX_USD;
  const preCoupon = round2(base + shipTax);

  const discovered = discoverCouponsForProduct({ sku, preCouponTotalUsd: preCoupon });
  const live = await llmSuggestCoupons(title);
  const seen = new Set(discovered.map((coupon) => coupon.code));
  for (const coupon of live) {
    if (!seen.has(coupon.code)) {
      seen.add(coupon.code);
      discovered.push(coupon);
    }
  }
  const applied = selectAppliedCoupon(discovered);
  const bestAllIn = round2(Math.max(0, preCoupon - (applied?.discountUsd ?? 0)));

  const condition = mapCondition(determinateString(observed.condition));
  const gate = snapshot.gateResult.decision;
  const mapped = gate === 'PROCEED' ? 'ALLOW' : gate;
  const decision = finalDecision(mapped, {
    adversarial: observed.pageIntegrity === 'ADVERSARIAL_DOM',
    refurbished: condition === 'REFURBISHED',
    returnDaysKnown: determinateNumber(observed.returnWindowDays) !== undefined,
    bestAllInUsd: bestAllIn,
    target,
  });

  return {
    huntId: `HUNT-VP-${randomBytes(3).toString('hex').toUpperCase()}`,
    inputQueryOrUrl: queryOrUrl,
    mode: classified.mode,
    targetUrl,
    extractedTitle: title,
    extractedBasePriceUsd: base,
    shippingPlusTaxUsd: shipTax,
    bestAllInUsd: bestAllIn,
    targetMaxAllInUsd: target,
    observedCondition: condition,
    observedReturnDays: determinateNumber(observed.returnWindowDays) ?? 0,
    observedRestockingFeePct: determinateNumber(observed.restockingFeePct) ?? 0,
    domIntegrity: observed.pageIntegrity,
    discoveredCoupons: discovered,
    appliedCoupon: applied,
    gateDecision: decision,
    commitment: snapshot.commitment,
    tlsVerified,
    completedAtUtc: new Date().toISOString(),
  };
}
