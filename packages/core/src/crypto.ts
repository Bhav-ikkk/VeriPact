/**
 * @veripact/core crypto — zero-dependency RFC 8785 JCS + Ed25519.
 *
 * Implemented directly on `node:crypto` (Node >= 20). No third-party
 * packages: ESM-only libraries would crash this CommonJS monorepo with
 * `ERR_REQUIRE_ESM`, and hand-rolled crypto avoids that entire class.
 */
import {
  createPrivateKey,
  createPublicKey,
  createHash,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import type { DisputeVerdict } from './index';

/** PayPal `custom_id` commitment prefix. */
export const COMMITMENT_PREFIX = 'VP1:';

/** Exact length of a `VP1:` + sha256-hex commitment (4 + 64). */
export const COMMITMENT_LENGTH = 68;

/* ------------------------------------------------------------------ */
/* RFC 8785 JSON Canonicalization Scheme (JCS)                        */
/* ------------------------------------------------------------------ */

/**
 * JCS string escaping: `"` and `\` short-escaped, U+0000–U+001F as
 * lowercase `\uXXXX`, everything else verbatim (UTF-8).
 */
function escapeString(value: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0x22) {
      out += '\\"';
    } else if (code === 0x5c) {
      out += '\\\\';
    } else if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      out += value[i];
    }
  }
  return `${out}"`;
}

/** JCS number formatting: ECMAScript `Number` string form, `-0` as `0`. */
function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return 'null';
  }
  if (Object.is(value, -0)) {
    return '0';
  }
  return String(value);
}

function serialize(value: unknown): string | undefined {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'string':
      return escapeString(value);
    case 'number':
      return serializeNumber(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'bigint':
      throw new TypeError('JCS: bigint values are not serializable');
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
    case 'object':
      break;
    default:
      return undefined;
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      parts.push(serialize(item) ?? 'null');
    }
    return `[${parts.join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const serialized = serialize(record[key]);
    if (serialized !== undefined) {
      parts.push(`${escapeString(key)}:${serialized}`);
    }
  }
  return `{${parts.join(',')}}`;
}

/**
 * Deterministic RFC 8785 canonicalization: lexicographic (UTF-16 code unit)
 * key order, recursive objects, `undefined` members dropped (`null` inside
 * arrays), ECMAScript number formatting. Throws on non-data top levels.
 */
export function canonicalizeJson(value: unknown): string {
  const serialized = serialize(value);
  if (serialized === undefined) {
    throw new TypeError('JCS: top-level value must be JSON-serializable data');
  }
  return serialized;
}

/* ------------------------------------------------------------------ */
/* SHA-256 + VP1 commitments                                          */
/* ------------------------------------------------------------------ */

/** SHA-256 digest as 64-char lowercase hex. */
export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Canonicalize a term-receipt payload via JCS, hash it, and format the
 * 68-char PayPal `custom_id` commitment (`VP1:` + hex).
 */
export function computeCommitment(termReceiptPayload: unknown): string {
  return `${COMMITMENT_PREFIX}${sha256Hex(canonicalizeJson(termReceiptPayload))}`;
}

/* ------------------------------------------------------------------ */
/* Ed25519 (raw 32-byte hex key material)                             */
/* ------------------------------------------------------------------ */

/** Ed25519 keypair with raw hex material + a 16-char public-key fingerprint. */
export interface Ed25519KeyPair {
  /** Raw 32-byte public key, 64 lowercase hex chars. */
  publicKeyHex: string;
  /** Raw 32-byte private seed, 64 lowercase hex chars. */
  privateKeyHex: string;
  /** First 16 hex chars of `sha256(raw public key bytes)`. */
  keyFingerprint: string;
}

function base64UrlToHex(b64u: string): string {
  return Buffer.from(b64u, 'base64url').toString('hex');
}

function hexToBase64Url(hex: string): string {
  return Buffer.from(hex, 'hex').toString('base64url');
}

const HEX_64_RE = /^[0-9a-f]{64}$/;
const HEX_128_RE = /^[0-9a-f]{128}$/;

function fingerprint(publicKeyHex: string): string {
  return sha256Hex(Buffer.from(publicKeyHex, 'hex')).slice(0, 16);
}

/**
 * Rebuild an Ed25519 private KeyObject from a raw 32-byte seed.
 *
 * Self-correction (run 01b): Node 22 rejects d-only OKP JWK import
 * (`ERR_INVALID_ARG_TYPE: key.x must be string`), so the seed is wrapped
 * in the fixed 16-byte PKCS#8 DER prefix instead — the standard,
 * zero-dependency construction (JWK is still used for public keys
 * and for keypair export).
 */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function privateKeyFromSeed(seedHex: string): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seedHex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  });
}

/** Generate a fresh random Ed25519 keypair (raw 32-byte hex material). */
export function generateEd25519KeyPair(): Ed25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x;
  const d = privateKey.export({ format: 'jwk' }).d;
  if (typeof x !== 'string' || typeof d !== 'string') {
    throw new Error('ed25519: JWK export missing key material');
  }
  const publicKeyHex = base64UrlToHex(x);
  const privateKeyHex = base64UrlToHex(d);
  return { publicKeyHex, privateKeyHex, keyFingerprint: fingerprint(publicKeyHex) };
}

/**
 * Derive a keypair from a fixed 32-byte seed (TEST FIXTURES ONLY — never
 * use fixed seeds for live keys). Enables deterministic signed artifacts.
 */
export function deriveEd25519KeyPairFromSeed(seedHex: string): Ed25519KeyPair {
  if (!HEX_64_RE.test(seedHex)) {
    throw new Error('ed25519: seed must be 64 lowercase hex chars');
  }
  const privateKey = privateKeyFromSeed(seedHex);
  const x = createPublicKey(privateKey).export({ format: 'jwk' }).x;
  if (typeof x !== 'string') {
    throw new Error('ed25519: public key derivation failed');
  }
  const publicKeyHex = base64UrlToHex(x);
  return { publicKeyHex, privateKeyHex: seedHex, keyFingerprint: fingerprint(publicKeyHex) };
}

/**
 * Sign a payload's JCS canonical bytes with a raw 32-byte Ed25519 seed.
 * Returns the 128-char hex signature. Throws on malformed key material.
 */
export function signCanonicalPayload(payload: unknown, privateKeyHex: string): string {
  if (!HEX_64_RE.test(privateKeyHex)) {
    throw new Error('ed25519: private key must be 64 lowercase hex chars');
  }
  const key = privateKeyFromSeed(privateKeyHex);
  const data = Buffer.from(canonicalizeJson(payload), 'utf8');
  return cryptoSign(null, data, key).toString('hex');
}

/**
 * Verify an Ed25519 signature over a payload's JCS canonical bytes.
 * Returns `false` (never throws) on malformed hex or tampered payloads.
 */
export function verifyCanonicalPayload(
  payload: unknown,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  try {
    if (!HEX_128_RE.test(signatureHex) || !HEX_64_RE.test(publicKeyHex)) {
      return false;
    }
    const key = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: hexToBase64Url(publicKeyHex) },
      format: 'jwk',
    });
    const data = Buffer.from(canonicalizeJson(payload), 'utf8');
    return cryptoVerify(null, data, key, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Contested-dispute referee (pure, deterministic)                    */
/* ------------------------------------------------------------------ */

/**
 * Signed receipt as supplied to the referee. Signatures are carried for
 * provenance; the verdict compares PAYLOAD HASHES against the PayPal order
 * `custom_id`, because a buyer self-signature cannot detect content forgery
 * (signer == claimant) and seller drift claims are unsigned page states.
 * CALLER CONTRACT: `paypalOrderCustomId` must come from the PayPal Orders
 * API and `witnessReceipt` from the witness store — never from the claimant.
 */
export interface SignedReceipt {
  payload: unknown;
  signatureHex: string;
  publicKeyHex: string;
}

/** Referee input: one PayPal anchor plus three party receipts. */
export interface ContestedDisputeInput {
  paypalOrderCustomId: string;
  witnessReceipt: SignedReceipt;
  buyerClaimReceipt: SignedReceipt;
  sellerCounterClaimReceipt: SignedReceipt;
}

/** Referee output: verdict plus every evidence bit behind it. */
export interface ContestedDisputeResult {
  verdict: DisputeVerdict;
  witnessSignatureValid: boolean;
  witnessHashMatch: boolean;
  buyerSignatureValid: boolean;
  buyerHashMatch: boolean;
  sellerHashMatch: boolean;
  /** True only when the witness anchor (sig + hash) fully verifies. */
  anchorTrusted: boolean;
  reason: string;
}

/**
 * Deterministic 3-way referee:
 * - buyer sig invalid OR buyer hash != order `custom_id` → BUYER_FORGERY_DETECTED
 * - buyer matches but seller hash != `custom_id` → MERCHANT_DRIFT_CONFIRMED
 * - all three hashes match → TERMS_HONORED
 * The witness signature + hash feed `anchorTrusted` and the reason string.
 */
export function evaluateContestedDispute(input: ContestedDisputeInput): ContestedDisputeResult {
  const expected = input.paypalOrderCustomId;
  const witnessSignatureValid = verifyCanonicalPayload(
    input.witnessReceipt.payload,
    input.witnessReceipt.signatureHex,
    input.witnessReceipt.publicKeyHex,
  );
  const witnessHashMatch = computeCommitment(input.witnessReceipt.payload) === expected;
  const buyerSignatureValid = verifyCanonicalPayload(
    input.buyerClaimReceipt.payload,
    input.buyerClaimReceipt.signatureHex,
    input.buyerClaimReceipt.publicKeyHex,
  );
  const buyerHashMatch = computeCommitment(input.buyerClaimReceipt.payload) === expected;
  const sellerHashMatch = computeCommitment(input.sellerCounterClaimReceipt.payload) === expected;
  const anchorTrusted = witnessSignatureValid && witnessHashMatch;

  let verdict: DisputeVerdict;
  let reason: string;
  if (!buyerSignatureValid || !buyerHashMatch) {
    verdict = 'BUYER_FORGERY_DETECTED';
    reason =
      !buyerSignatureValid && !buyerHashMatch
        ? 'buyer receipt signature invalid and hash does not match PayPal order custom_id'
        : !buyerSignatureValid
          ? 'buyer receipt signature invalid'
          : 'buyer receipt hash does not match PayPal order custom_id';
  } else if (!sellerHashMatch) {
    verdict = 'MERCHANT_DRIFT_CONFIRMED';
    reason = 'seller counter-claim diverges from PayPal-anchored witness terms';
  } else {
    verdict = 'TERMS_HONORED';
    reason = 'buyer, seller, and witness receipts all match the PayPal order custom_id';
  }
  if (!anchorTrusted) {
    reason += ' (witness anchor NOT verified — caller must re-source inputs)';
  }
  return {
    verdict,
    witnessSignatureValid,
    witnessHashMatch,
    buyerSignatureValid,
    buyerHashMatch,
    sellerHashMatch,
    anchorTrusted,
    reason,
  };
}
