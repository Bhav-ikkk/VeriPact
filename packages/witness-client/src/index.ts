/**
 * @veripact/witness-client — Rung 2 (WIT) interfaces and stubs.
 *
 * Honesty contract (AGENTS.md Rule 3): a timestamp proves that a hash
 * existed at time T plus independent witness observation. It never
 * proves content truth.
 */
import type { TermReceipt, WitnessProvenance } from '@veripact/core';
import { NotImplementedError } from '@veripact/core';

export { NotImplementedError };

/** RFC 3161 timestamp request over a canonical-receipt digest. */
export interface TimestampRequest {
  sha256Hex: string;
}

/** RFC 3161 timestamp response (token is raw DER, base64). */
export interface TimestampResponse {
  issuer: string;
  timeUtc: string;
  tokenBase64: string;
}

/** Pluggable timestamp authority (DigiCert live, freeTSA/OpenSSL for tests). */
export interface ITimestampAuthority {
  readonly name: string;
  timestamp(req: TimestampRequest): Promise<TimestampResponse>;
}

/** Minimal Channel3 catalog product used as the oracle cross-check. */
export interface Channel3Product {
  productId: string;
  brand?: string;
  condition?: string;
  referencePriceUsd?: number;
}

/** Pluggable Channel3 catalog oracle. */
export interface IChannel3Oracle {
  readonly name: string;
  lookup(query: string): Promise<Channel3Product | null>;
}

/** Out-of-band page fetch result. */
export interface SnapshotResult {
  url: string;
  httpStatus: number;
  bytes: number;
  bodyText: string;
}

/** Pluggable HTTPS snapshotter (must fetch the DEPLOYED url, never localhost). */
export interface IHttpSnapshotter {
  readonly name: string;
  fetch(url: string): Promise<SnapshotResult>;
}

/** Witnessed receipt plus its provenance card data. */
export interface WitnessedReceipt {
  receipt: TermReceipt;
  provenance: WitnessProvenance;
}

/** Rung 2 witness service contract (Prompt #2 implements `witness`). */
export interface IWitnessService {
  readonly name: string;
  witness(listingUrl: string, mandateSha256: string): Promise<WitnessedReceipt>;
}

export interface WitnessClientDeps {
  tsa: ITimestampAuthority;
  oracle: IChannel3Oracle;
  snapshotter: IHttpSnapshotter;
  witnessPublicKeyHex: string;
}

/** Foundation stub: constructor is real, `witness` throws until Prompt #2. */
export class WitnessClient implements IWitnessService {
  readonly name = 'witness-client';
  private readonly deps: WitnessClientDeps;

  constructor(deps: WitnessClientDeps) {
    this.deps = deps;
  }

  get witnessPublicKeyHex(): string {
    return this.deps.witnessPublicKeyHex;
  }

  witness(_listingUrl: string, _mandateSha256: string): Promise<WitnessedReceipt> {
    return Promise.reject(new NotImplementedError('WitnessClient.witness'));
  }
}

/** True for 64-char lowercase sha256 hex digests. */
export function isValidSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}
