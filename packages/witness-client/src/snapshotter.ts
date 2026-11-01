/**
 * @veripact/witness-client snapshotter — independent Rung-2 (WIT) snapshots.
 *
 * Fetch (pluggable or built-in HTTPS) → pre-LLM scan → substring-verified
 * extraction → Channel3 cross-check → sufficiency gate → canonical WIT
 * receipt → VP1 commitment → Ed25519 signature → RFC 3161 anchor.
 */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import {
  canonicalizeJson,
  computeCommitment,
  sha256Hex,
  signCanonicalPayload,
  type MandateSpec,
  type TermReceipt,
  type WitnessProvenance,
} from '@veripact/core';
import {
  evaluateSufficiencyGate,
  extractObservedTerms,
  scanMerchantHtml,
  type ExtractorOptions,
  type SufficiencyGateResult,
} from '@veripact/term-extractor';
import {
  anchorDigestRfc3161,
  type AnchorOptions,
  type TimestampAnchor,
  type TsaMode,
} from './tsa';
import {
  verifyWithChannel3Oracle,
  type Channel3CatalogCache,
  type Channel3OracleMode,
  type Channel3VerificationResult,
} from './channel3-oracle';
import type { IHttpSnapshotter, SnapshotResult } from './index';

/** Merchant fetch result (pluggable fetcher contract). */
export interface HtmlFetchResult {
  status: number;
  html: string;
  tlsVerified: boolean;
}

/** Pluggable merchant HTML fetcher (in-memory HTML in tests). */
export type HtmlFetcher = (url: string) => Promise<HtmlFetchResult>;

/** Bound fetched pages at 5 MiB (unbounded merchant HTML is a DoS vector). */
export const MAX_HTML_BYTES = 5 * 1024 * 1024;

/** Production HTTPS snapshotter implementing the run-01 fetch contract. */
export class NodeHttpSnapshotter implements IHttpSnapshotter {
  readonly name = 'node-http-snapshotter';
  private readonly timeoutMs: number;

  constructor(timeoutMs = 15000) {
    this.timeoutMs = timeoutMs;
  }

  fetch(url: string): Promise<SnapshotResult> {
    return new Promise((resolve, reject) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        reject(new Error(`snapshotter: invalid URL: ${url}`));
        return;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        reject(new Error(`snapshotter: refusing non-http(s) URL: ${parsed.protocol}`));
        return;
      }
      const sender = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = sender(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || undefined,
          path: `${parsed.pathname}${parsed.search}`,
          method: 'GET',
          headers: { 'user-agent': 'VeriPact-Witness/0.1', accept: 'text/html' },
          timeout: this.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          res.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > MAX_HTML_BYTES) {
              req.destroy(new Error('snapshotter: page exceeds 5 MiB cap'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () =>
            resolve({
              url,
              httpStatus: res.statusCode ?? 0,
              bytes,
              bodyText: Buffer.concat(chunks).toString('utf8'),
            }),
          );
          res.on('error', reject);
        },
      );
      req.on('timeout', () => {
        req.destroy(new Error('snapshotter: fetch timed out'));
      });
      req.on('error', reject);
      req.end();
    });
  }
}

const defaultSnapshotter = new NodeHttpSnapshotter();

async function defaultFetcher(url: string): Promise<HtmlFetchResult> {
  const res = await defaultSnapshotter.fetch(url);
  return {
    status: res.httpStatus,
    html: res.bodyText,
    tlsVerified: url.toLowerCase().startsWith('https:'),
  };
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/**
 * Validate a witness URL. With `requirePublicHttps`, only public `https:`
 * URLs pass (no loopback, no plain http, no exotic schemes).
 */
export function assertWitnessUrl(
  listingUrl: string,
  requirePublicHttps: boolean,
): { hostname: string } {
  let parsed: URL;
  try {
    parsed = new URL(listingUrl);
  } catch {
    throw new Error(`witness: invalid listing URL: ${listingUrl}`);
  }
  const hostname = parsed.hostname.toLowerCase();
  const loopback = LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.localhost');
  if (requirePublicHttps) {
    if (parsed.protocol !== 'https:') {
      throw new Error(`witness: requirePublicHttps demands https, got ${parsed.protocol} (${listingUrl})`);
    }
    if (loopback) {
      throw new Error(`witness: requirePublicHttps rejects loopback host (${listingUrl})`);
    }
  }
  return { hostname: parsed.hostname };
}

export interface WitnessKeys {
  publicKeyHex: string;
  privateKeyHex: string;
}

export interface WitnessSnapshotInput {
  listingUrl: string;
  mandate: MandateSpec;
  witnessKeys: WitnessKeys;
  htmlFetcher?: HtmlFetcher;
  requirePublicHttps?: boolean;
  tsaMode?: TsaMode;
  tsaOptions?: Omit<AnchorOptions, 'mode'>;
  channel3Mode?: Channel3OracleMode;
  channel3Cache?: Channel3CatalogCache;
  channel3CachePath?: string;
  extractorOptions?: ExtractorOptions;
}

/** Canonical receipt core: exactly what the commitment and signature cover. */
export type WitnessReceiptCore = Omit<TermReceipt, 'evidence' | 'witnessProvenance'>;

export interface WitnessSnapshotOutput {
  termReceipt: TermReceipt;
  receiptCore: WitnessReceiptCore;
  commitment: string;
  witnessSignatureHex: string;
  witnessPublicKeyHex: string;
  provenance: WitnessProvenance;
  gateResult: SufficiencyGateResult;
  oracleResult: Channel3VerificationResult;
  anchor: TimestampAnchor;
}

/**
 * Take an independent witness snapshot: fetch → scan → extract → oracle →
 * gate → sign → anchor. The commitment and signature cover `receiptCore`
 * (terms + mandate binding), never the attached evidence/provenance.
 */
export async function createWitnessSnapshot(
  input: WitnessSnapshotInput,
): Promise<WitnessSnapshotOutput> {
  const { hostname } = assertWitnessUrl(input.listingUrl, input.requirePublicHttps ?? false);
  const fetcher = input.htmlFetcher ?? defaultFetcher;
  const fetched = await fetcher(input.listingUrl);
  if (fetched.status < 200 || fetched.status >= 300) {
    throw new Error(`witness: merchant fetch returned HTTP ${fetched.status} (${input.listingUrl})`);
  }

  const scan = scanMerchantHtml(fetched.html);
  const observed = await extractObservedTerms(scan, input.extractorOptions ?? {});
  const oracleResult = await verifyWithChannel3Oracle(
    {
      brandModel: observed.itemTitle.status === 'DETERMINATE' ? observed.itemTitle.value : undefined,
      condition: observed.condition.status === 'DETERMINATE' ? observed.condition.value : undefined,
      basePriceUsd:
        observed.basePriceUsd.status === 'DETERMINATE' ? observed.basePriceUsd.value : undefined,
    },
    {
      mode: input.channel3Mode ?? 'auto',
      cache: input.channel3Cache,
      cachePath: input.channel3CachePath,
    },
  );
  const gateResult = evaluateSufficiencyGate(input.mandate, observed);

  const fetchedAtUtc = new Date().toISOString();
  const receiptCore: WitnessReceiptCore = {
    receiptVersion: 'VP1',
    rung: 'WIT',
    capturedAtUtc: fetchedAtUtc,
    merchantDomain: hostname,
    listingUrl: input.listingUrl,
    mandateSha256: sha256Hex(canonicalizeJson(input.mandate)),
    observedTerms: observed,
  };
  const commitment = computeCommitment(receiptCore);
  const witnessSignatureHex = signCanonicalPayload(receiptCore, input.witnessKeys.privateKeyHex);
  const anchor = await anchorDigestRfc3161(commitment.slice(COMMITMENT_PREFIX_LENGTH), {
    ...(input.tsaOptions ?? {}),
    mode: input.tsaMode ?? 'local',
  });

  const provenance: WitnessProvenance = {
    fetchedUrl: input.listingUrl,
    httpStatus: fetched.status,
    tlsVerified: fetched.tlsVerified,
    fetchedAtUtc,
    witnessPublicKeyHex: input.witnessKeys.publicKeyHex,
    tsaIssuer: anchor.authority,
    tsaTimeUtc: new Date(anchor.timestampMs).toISOString(),
    ...(oracleResult.matched ? { channel3ProductId: oracleResult.productId } : {}),
  };
  const termReceipt: TermReceipt = {
    ...receiptCore,
    evidence: {
      WIT: { publicKeyHex: input.witnessKeys.publicKeyHex, signatureHex: witnessSignatureHex },
    },
    witnessProvenance: provenance,
  };
  return {
    termReceipt,
    receiptCore,
    commitment,
    witnessSignatureHex,
    witnessPublicKeyHex: input.witnessKeys.publicKeyHex,
    provenance,
    gateResult,
    oracleResult,
    anchor,
  };
}

const COMMITMENT_PREFIX_LENGTH = 4;
