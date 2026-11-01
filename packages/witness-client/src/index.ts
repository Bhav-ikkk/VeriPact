/**
 * @veripact/witness-client — Rung 2 (WIT) independent witness.
 *
 * Modules: `tsa` (RFC 3161 anchoring), `channel3-oracle` (catalog
 * cross-check), `snapshotter` (fetch → scan → extract → gate → sign).
 *
 * Honesty contract (AGENTS.md Rule 3): a timestamp proves that a hash
 * existed at time T plus independent witness observation. It never
 * proves content truth.
 */
import type { MandateSpec, TermReceipt, WitnessProvenance } from '@veripact/core';
import { NotImplementedError } from '@veripact/core';
import { createWitnessSnapshot } from './snapshotter';
import type { TsaMode } from './tsa';
import type { Channel3CatalogCache, Channel3OracleMode } from './channel3-oracle';
import type { HtmlFetcher } from './snapshotter';

export { NotImplementedError };
export * from './tsa';
export * from './channel3-oracle';
export * from './snapshotter';

/** Out-of-band page fetch result. */
export interface SnapshotResult {
  url: string;
  httpStatus: number;
  bytes: number;
  bodyText: string;
}

/** HTTPS snapshotter contract (implemented by `NodeHttpSnapshotter`). */
export interface IHttpSnapshotter {
  readonly name: string;
  fetch(url: string): Promise<SnapshotResult>;
}

/** Witnessed receipt plus its provenance card data. */
export interface WitnessedReceipt {
  receipt: TermReceipt;
  provenance: WitnessProvenance;
}

/** Rung 2 witness service contract. */
export interface IWitnessService {
  readonly name: string;
  witness(listingUrl: string, mandate: MandateSpec): Promise<WitnessedReceipt>;
}

export interface WitnessClientDeps {
  witnessPublicKeyHex: string;
  witnessPrivateKeyHex: string;
  requirePublicHttps?: boolean;
  tsaMode?: TsaMode;
  channel3Mode?: Channel3OracleMode;
  htmlFetcher?: HtmlFetcher;
  channel3Cache?: Channel3CatalogCache;
}

/** Configured witness facade over `createWitnessSnapshot`. */
export class WitnessClient implements IWitnessService {
  readonly name = 'witness-client';
  private readonly deps: WitnessClientDeps;

  constructor(deps: WitnessClientDeps) {
    this.deps = deps;
  }

  get witnessPublicKeyHex(): string {
    return this.deps.witnessPublicKeyHex;
  }

  async witness(listingUrl: string, mandate: MandateSpec): Promise<WitnessedReceipt> {
    const output = await createWitnessSnapshot({
      listingUrl,
      mandate,
      witnessKeys: {
        publicKeyHex: this.deps.witnessPublicKeyHex,
        privateKeyHex: this.deps.witnessPrivateKeyHex,
      },
      htmlFetcher: this.deps.htmlFetcher,
      requirePublicHttps: this.deps.requirePublicHttps,
      tsaMode: this.deps.tsaMode,
      channel3Mode: this.deps.channel3Mode,
      channel3Cache: this.deps.channel3Cache,
    });
    return { receipt: output.termReceipt, provenance: output.provenance };
  }
}

/** True for 64-char lowercase sha256 hex digests. */
export function isValidSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}
