/**
 * @veripact/core — canonical domain types shared by every workspace package.
 *
 * These types are the contract that Prompts #2–#6 build against. Breaking
 * changes require a repo-wide migration in the same run (see agent 01).
 */

import {
  canonicalizeJson,
  computeCommitment,
  deriveEd25519KeyPairFromSeed,
  evaluateContestedDispute,
  generateEd25519KeyPair,
  sha256Hex,
  signCanonicalPayload,
  verifyCanonicalPayload,
  COMMITMENT_LENGTH,
  COMMITMENT_PREFIX,
} from './crypto';

export { repoPath, resolveRepoRoot } from './paths';

export {
  canonicalizeJson,
  computeCommitment,
  deriveEd25519KeyPairFromSeed,
  evaluateContestedDispute,
  generateEd25519KeyPair,
  sha256Hex,
  signCanonicalPayload,
  verifyCanonicalPayload,
  COMMITMENT_LENGTH,
  COMMITMENT_PREFIX,
};
export type {
  ContestedDisputeInput,
  ContestedDisputeResult,
  Ed25519KeyPair,
  SignedReceipt,
} from './crypto';
export {
  computePartitionAvailableUsd,
  evaluatePartitionSpendCheck,
  partitionSigningPayload,
  signPartitionSpec,
  verifyOrderCommitmentReproducible,
  verifyPartitionSpecSignature,
} from './wallet';
export type {
  ConnectorScope,
  PairingSession,
  PairingStatus,
  PartitionSpec,
  PartitionSpendCheckInput,
  PartitionSpendCheckVerdict,
  PaymentProtectionClass,
  SyncPaymentRecord,
  UnsignedPartitionSpec,
  WalletOrderRecord,
  WalletTransportMode,
} from './wallet';

/** Evidence ladder rung: buyer-recorded, independent-witness, merchant-signed. */
export type EvidenceRung = 'SELF' | 'WIT' | 'SIGN';

/** Per-criterion extraction outcome. */
export type SufficiencyStatus = 'DETERMINATE' | 'INDETERMINATE' | 'CONFLICT' | 'ADVERSARIAL_DOM';

/** Checkout gate outcome. */
export type GateDecision = 'PROCEED' | 'ASK_HUMAN_DELTA' | 'BLOCK';

/** Contested-dispute verdict. */
export type DisputeVerdict =
  | 'BUYER_FORGERY_DETECTED'
  | 'MERCHANT_DRIFT_CONFIRMED'
  | 'TERMS_HONORED';

/** Page integrity from the pre-LLM DOM scan. */
export type PageIntegrity = 'CLEAN' | 'ADVERSARIAL_DOM';

/** Buyer spending/terms constraints locked before shopping. */
export interface MandateConstraints {
  requiredCondition: string;
  maxAllInPriceUsd: number;
  minReturnWindowDays: number;
  maxRestockingFeePct: number;
}

/** Signed buyer mandate (Rung 1 input). */
export interface MandateSpec {
  mandateId: string;
  createdAtUtc: string;
  buyerId: string;
  itemQuery: string;
  constraints: MandateConstraints;
  buyerPublicKeyHex: string;
  buyerSignatureHex: string;
}

/** One verbatim quote pinned to a visible DOM block. */
export interface VerifiedQuote {
  status: SufficiencyStatus;
  blockId: string;
  selector: string;
  verbatimQuote: string;
}

/** One extracted criterion: status plus an optional typed value. */
export interface ObservedCriterion<T> {
  status: SufficiencyStatus;
  value?: T;
  blockId?: string;
  verbatimQuote?: string;
  note?: string;
}

/** Everything the extractor determined about the merchant page. */
export interface ObservedTermSheet {
  itemTitle: ObservedCriterion<string>;
  condition: ObservedCriterion<string>;
  basePriceUsd: ObservedCriterion<number>;
  shippingUsd: ObservedCriterion<number>;
  taxUsd: ObservedCriterion<number>;
  returnWindowDays: ObservedCriterion<number>;
  restockingFeePct: ObservedCriterion<number>;
  /** Derived sum (base + shipping + tax) when all three are determinate. */
  allInTotalUsd: ObservedCriterion<number>;
  pageIntegrity: PageIntegrity;
  headroomRemainingUsd: number;
}

/**
 * How and when the witness observed the merchant page. Displayed verbatim
 * in the workbench provenance card — never localhost on the demo path.
 */
export interface WitnessProvenance {
  fetchedUrl: string;
  httpStatus: number;
  /** True only when fetched over verified TLS (honest transport record). */
  tlsVerified: boolean;
  fetchedAtUtc: string;
  witnessPublicKeyHex: string;
  tsaIssuer: string;
  tsaTimeUtc: string;
  channel3ProductId?: string;
}

/** Canonical witnessed receipt bound into PayPal `custom_id`. */
export interface TermReceipt {
  receiptVersion: 'VP1';
  /** Ladder rung this receipt was produced at. */
  rung: EvidenceRung;
  capturedAtUtc: string;
  merchantDomain: string;
  listingUrl: string;
  mandateSha256: string;
  observedTerms: ObservedTermSheet;
  evidence: Partial<
    Record<EvidenceRung, { publicKeyHex: string; signatureHex: string }>
  >;
  witnessProvenance?: WitnessProvenance;
}

/** Post-approval capture/void decision record. */
export interface CaptureAddendum {
  authorizationId: string;
  capturedTotalUsd: number;
  mandateCeilingUsd: number;
  decision: 'CAPTURE' | 'VOID';
  decidedAtUtc: string;
}

/** One contested dispute case for the verifier desk. */
export interface ContestedDisputeCase {
  caseId: string;
  paypalOrderId: string;
  paypalDisputeId: string;
  buyerReceipt: TermReceipt;
  sellerCounterTerms: ObservedTermSheet;
  expectedVerdict?: DisputeVerdict;
}

/** Machine-checked verdict with its evidence bits. */
export interface DisputeVerification {
  verdict: DisputeVerdict;
  orderCustomIdMatch: boolean;
  witnessSignatureValid: boolean;
  detail: string;
}

/** Base referee interface: deterministic deciders implement this. */
export interface Referee<TInput, TOutput> {
  readonly name: string;
  decide(input: TInput): TOutput;
}

/** Commitment constants live in `./crypto` and are re-exported above. */

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * Validate a 64-char lowercase sha256 hex digest and format the 68-char
 * PayPal `custom_id` commitment (`VP1:` + hex). Throws on any other shape.
 */
export function formatCommitmentPrefix(sha256Hex: string): string {
  if (!SHA256_HEX_RE.test(sha256Hex)) {
    throw new Error(
      `invalid sha256 hex digest: expected 64 lowercase hex chars, got ${sha256Hex.length} chars`,
    );
  }
  return `${COMMITMENT_PREFIX}${sha256Hex}`;
}

/** Thrown by every foundation stub whose implementation lands in a later prompt. */
export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`not implemented (foundation stub): ${feature}`);
    this.name = 'NotImplementedError';
  }
}
