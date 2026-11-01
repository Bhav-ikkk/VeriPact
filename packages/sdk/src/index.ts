/**
 * @veripact/sdk — high-level `VeriPactClient` facade over the workspace.
 * Thin by design: domain logic lives in the leaf packages (agent 03).
 */
import { formatCommitmentPrefix } from '@veripact/core';
import { PayPalClient, type PayPalClientOptions } from '@veripact/paypal-client';
import { SufficiencyGate } from '@veripact/term-extractor';
import { WitnessClient, type WitnessClientDeps } from '@veripact/witness-client';

export { formatCommitmentPrefix, PayPalClient, SufficiencyGate, WitnessClient };
export type { PayPalClientOptions, WitnessClientDeps };

/** SDK version (mirrors the workspace version). */
export const SDK_VERSION = '0.1.0';

export interface VeriPactClientOptions {
  paypal?: PayPalClientOptions;
  witness?: WitnessClientDeps;
}

/** Stable facade: gate is always available, networked clients are optional. */
export class VeriPactClient {
  readonly version = SDK_VERSION;
  readonly gate = new SufficiencyGate();
  readonly paypal: PayPalClient | null;
  readonly witness: WitnessClient | null;

  constructor(options: VeriPactClientOptions = {}) {
    this.paypal = options.paypal ? new PayPalClient(options.paypal) : null;
    this.witness = options.witness ? new WitnessClient(options.witness) : null;
  }

  /** Format a `VP1:` commitment (throws on malformed digests). */
  formatCommitment(sha256Hex: string): string {
    return formatCommitmentPrefix(sha256Hex);
  }
}
