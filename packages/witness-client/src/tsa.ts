/**
 * @veripact/witness-client tsa — RFC 3161 timestamp anchoring.
 *
 * Honesty contract (AGENTS.md Rule 3): a timestamp proves a hash existed
 * at time T plus witness observation. It NEVER proves content truth.
 * Local/test anchors are labeled `LOCAL_*` — never presented as TSA truth.
 */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { randomBytes } from 'node:crypto';
import {
  canonicalizeJson,
  generateEd25519KeyPair,
  sha256Hex,
  signCanonicalPayload,
  verifyCanonicalPayload,
} from '@veripact/core';

/** FreeTSA RFC 3161 responder (published test certs, reproducible). */
export const FREETSA_TSR_URL = 'https://freetsa.org/tsr';
/** DigiCert code-signing TSA (free, no auth). */
export const DIGICERT_TSR_URL = 'http://timestamp.digicert.com';

export type TsaMode = 'local' | 'freetsa' | 'digicert';

export type TsaAuthority = 'LOCAL_TEST' | 'LOCAL_RFC3161_FALLBACK' | 'FREETSA' | 'DIGICERT_TSA';

/** Timestamp anchor over a receipt/commitment digest. */
export interface TimestampAnchor {
  authority: TsaAuthority;
  digestHex: string;
  timestampMs: number;
  timestampSource: 'tstinfo' | 'receipt-clock' | 'local-clock';
  serialHex: string;
  requestDerBase64: string;
  tokenBase64: string;
  signatureHex?: string;
  signerPublicKeyHex?: string;
}

export interface AnchorOptions {
  mode?: TsaMode;
  /** Fall back to a labeled local anchor when live calls fail (default true). */
  fallbackToLocal?: boolean;
  timeoutMs?: number;
  nonceHex?: string;
  /** Fixed clock (deterministic tests + replays). */
  timestampMs?: number;
  localSigner?: { publicKeyHex: string; privateKeyHex: string };
}

export interface TimestampVerification {
  valid: boolean;
  reason: string;
}

const HEX64_RE = /^[0-9a-f]{64}$/;

/* ------------------------------------------------------------------ */
/* Pure-Buffer DER TimeStampReq (RFC 3161 Section 2.4.1)              */
/* ------------------------------------------------------------------ */

/** DER TLV for OID 2.16.840.1.101.3.4.2.1 (SHA-256). */
const SHA256_OID_DER = Buffer.from([
  0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01,
]);

function derLengthBytes(n: number): Buffer {
  if (n < 128) {
    return Buffer.from([n]);
  }
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLengthBytes(content.length), content]);
}

function derIntegerFromBytes(bytes: Buffer): Buffer {
  const padded =
    bytes.length > 0 && (bytes[0] ?? 0) >= 0x80
      ? Buffer.concat([Buffer.from([0x00]), bytes])
      : bytes;
  return derTlv(0x02, padded);
}

/**
 * Build a DER `TimeStampReq`: version 1, SHA-256 message imprint of the
 * 32-byte digest, nonce, `certReq = TRUE`. No external ASN.1 packages.
 */
export function buildRfc3161RequestDer(sha256HexDigest: string, nonceHex?: string): Buffer {
  if (!HEX64_RE.test(sha256HexDigest)) {
    throw new Error('tsa: digest must be 64 lowercase hex chars');
  }
  const nonce = nonceHex ?? randomBytes(8).toString('hex');
  if (!/^[0-9a-f]+$/.test(nonce) || nonce.length % 2 !== 0 || nonce.length === 0) {
    throw new Error('tsa: nonce must be non-empty even-length hex');
  }
  const algorithmId = derTlv(
    0x30,
    Buffer.concat([SHA256_OID_DER, derTlv(0x05, Buffer.alloc(0))]),
  );
  const messageImprint = derTlv(
    0x30,
    Buffer.concat([algorithmId, derTlv(0x04, Buffer.from(sha256HexDigest, 'hex'))]),
  );
  return derTlv(
    0x30,
    Buffer.concat([
      derTlv(0x02, Buffer.from([0x01])),
      messageImprint,
      derIntegerFromBytes(Buffer.from(nonce, 'hex')),
      derTlv(0x01, Buffer.from([0xff])),
    ]),
  );
}

/* ------------------------------------------------------------------ */
/* Live TSA transport + minimal TimeStampResp parsing                 */
/* ------------------------------------------------------------------ */

function postTimestampQuery(
  url: string,
  body: Buffer,
  timeoutMs: number,
): Promise<{ statusCode: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const sender = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = sender(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers: {
          'content-type': 'application/timestamp-query',
          'content-length': String(body.length),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error(`tsa: request to ${url} timed out`));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function readDerLength(buf: Buffer, offset: number): { length: number; headerBytes: number } {
  const first = buf[offset] ?? 0;
  if (first < 128) {
    return { length: first, headerBytes: 1 };
  }
  const count = first & 0x7f;
  if (count === 0 || count > 4) {
    throw new Error('tsa: unsupported DER length');
  }
  let length = 0;
  for (let k = 0; k < count; k += 1) {
    length = length * 256 + (buf[offset + 1 + k] ?? 0);
  }
  return { length, headerBytes: 1 + count };
}

function readDerTlv(buf: Buffer, offset: number): { tag: number; content: Buffer; next: number } {
  if (offset + 1 >= buf.length) {
    throw new Error('tsa: truncated DER');
  }
  const tag = buf[offset] ?? 0;
  const { length, headerBytes } = readDerLength(buf, offset + 1);
  const start = offset + 1 + headerBytes;
  if (start + length > buf.length) {
    throw new Error('tsa: truncated DER content');
  }
  return { tag, content: buf.subarray(start, start + length), next: start + length };
}

/** Parse TimeStampResp status: 0 granted, 1 grantedWithMods. */
function parseTimestampRespStatus(resp: Buffer): number {
  const outer = readDerTlv(resp, 0);
  if (outer.tag !== 0x30) {
    throw new Error('tsa: TimeStampResp is not a SEQUENCE');
  }
  const statusInfo = readDerTlv(outer.content, 0);
  if (statusInfo.tag !== 0x30) {
    throw new Error('tsa: PKIStatusInfo is not a SEQUENCE');
  }
  const status = readDerTlv(statusInfo.content, 0);
  if (status.tag !== 0x02 || status.content.length < 1) {
    throw new Error('tsa: missing status INTEGER');
  }
  return status.content[0] ?? -1;
}

function parseUtcTime(text: string): number | undefined {
  const match = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text);
  if (!match?.[1]) {
    return undefined;
  }
  const year = Number(match[1]) < 50 ? 2000 + Number(match[1]) : 1900 + Number(match[1]);
  const ms = Date.UTC(
    year,
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  return Number.isFinite(ms) ? ms : undefined;
}

function parseGeneralizedTime(text: string): number | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text);
  if (!match?.[1]) {
    return undefined;
  }
  const ms = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  return Number.isFinite(ms) ? ms : undefined;
}

/** First UTCTime/GeneralizedTime in the response as epoch ms, if parseable. */
function extractTstInfoTime(resp: Buffer): number | undefined {
  for (let i = 0; i + 1 < resp.length; i += 1) {
    const tag = resp[i] ?? 0;
    if (tag !== 0x17 && tag !== 0x18) {
      continue;
    }
    try {
      const { content } = readDerTlv(resp, i);
      const ms =
        tag === 0x17
          ? parseUtcTime(content.toString('ascii'))
          : parseGeneralizedTime(content.toString('ascii'));
      if (ms !== undefined) {
        return ms;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Multi-mode anchor + verifier                                       */
/* ------------------------------------------------------------------ */

interface LocalTokenPayload {
  v: 'VP-LOCAL-TS1';
  digestHex: string;
  timestampMs: number;
  serialHex: string;
}

function localAnchor(
  digestHex: string,
  requestDer: Buffer,
  options: AnchorOptions,
  authority: 'LOCAL_TEST' | 'LOCAL_RFC3161_FALLBACK',
): TimestampAnchor {
  const timestampMs = options.timestampMs ?? Date.now();
  const serialHex = sha256Hex(`${digestHex}:${timestampMs}`).slice(0, 16);
  const signer = options.localSigner ?? generateEd25519KeyPair();
  const payload: LocalTokenPayload = { v: 'VP-LOCAL-TS1', digestHex, timestampMs, serialHex };
  return {
    authority,
    digestHex,
    timestampMs,
    timestampSource: 'local-clock',
    serialHex,
    requestDerBase64: requestDer.toString('base64'),
    tokenBase64: Buffer.from(canonicalizeJson(payload), 'utf8').toString('base64'),
    signatureHex: signCanonicalPayload(payload, signer.privateKeyHex),
    signerPublicKeyHex: signer.publicKeyHex,
  };
}

/**
 * Anchor a digest: `'local'` (default, offline, deterministic with fixed
 * options) or live `'freetsa'` / `'digicert'` POST with honest labeled
 * fallback. Live success requires HTTP 200, granted status, and the
 * 32-byte digest embedded in the response.
 */
export async function anchorDigestRfc3161(
  digestHex: string,
  options: AnchorOptions = {},
): Promise<TimestampAnchor> {
  if (!HEX64_RE.test(digestHex)) {
    throw new Error('tsa: digest must be 64 lowercase hex chars');
  }
  const mode = options.mode ?? 'local';
  const requestDer = buildRfc3161RequestDer(digestHex, options.nonceHex);
  if (mode === 'local') {
    return localAnchor(digestHex, requestDer, options, 'LOCAL_TEST');
  }
  const url = mode === 'freetsa' ? FREETSA_TSR_URL : DIGICERT_TSR_URL;
  try {
    const { statusCode, body } = await postTimestampQuery(url, requestDer, options.timeoutMs ?? 8000);
    if (statusCode !== 200) {
      throw new Error(`tsa: ${url} returned HTTP ${statusCode}`);
    }
    const status = parseTimestampRespStatus(body);
    if (status !== 0 && status !== 1) {
      throw new Error(`tsa: TimeStampResp status ${status}`);
    }
    if (body.indexOf(Buffer.from(digestHex, 'hex')) === -1) {
      throw new Error('tsa: response does not embed the request digest');
    }
    const tstTime = extractTstInfoTime(body);
    return {
      authority: mode === 'freetsa' ? 'FREETSA' : 'DIGICERT_TSA',
      digestHex,
      timestampMs: tstTime ?? Date.now(),
      timestampSource: tstTime === undefined ? 'receipt-clock' : 'tstinfo',
      serialHex: sha256Hex(requestDer).slice(0, 16),
      requestDerBase64: requestDer.toString('base64'),
      tokenBase64: body.toString('base64'),
    };
  } catch (error) {
    if (options.fallbackToLocal === false) {
      throw error;
    }
    return localAnchor(digestHex, requestDer, options, 'LOCAL_RFC3161_FALLBACK');
  }
}

/**
 * Verify an anchor: digest binding (cryptographic signature for local
 * tokens; status + digest bytes for live `.tsr` responses) plus the
 * ±5-minute clock-skew window against the PayPal order creation time.
 */
export function verifyTimestampAnchor(
  anchor: TimestampAnchor,
  expectedSha256Hex: string,
  options: { orderCreateTimeIso?: string } = {},
): TimestampVerification {
  if (!HEX64_RE.test(expectedSha256Hex)) {
    return { valid: false, reason: 'expected digest malformed' };
  }
  if (anchor.digestHex !== expectedSha256Hex) {
    return { valid: false, reason: 'anchor digest does not match expected digest' };
  }
  if (anchor.authority === 'LOCAL_TEST' || anchor.authority === 'LOCAL_RFC3161_FALLBACK') {
    if (!anchor.signatureHex || !anchor.signerPublicKeyHex) {
      return { valid: false, reason: 'local anchor missing signature' };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(anchor.tokenBase64, 'base64').toString('utf8')) as unknown;
    } catch {
      return { valid: false, reason: 'local token is not valid JSON' };
    }
    const token = payload as { digestHex?: unknown; timestampMs?: unknown };
    if (token.digestHex !== expectedSha256Hex) {
      return { valid: false, reason: 'local token digest mismatch' };
    }
    if (token.timestampMs !== anchor.timestampMs) {
      return { valid: false, reason: 'local token timestamp does not match anchor' };
    }
    if (!verifyCanonicalPayload(payload, anchor.signatureHex, anchor.signerPublicKeyHex)) {
      return { valid: false, reason: 'local token signature invalid' };
    }
  } else {
    let token: Buffer;
    try {
      token = Buffer.from(anchor.tokenBase64, 'base64');
      const status = parseTimestampRespStatus(token);
      if (status !== 0 && status !== 1) {
        return { valid: false, reason: `live token status ${status}` };
      }
    } catch {
      return { valid: false, reason: 'live token is not a valid TimeStampResp' };
    }
    if (token.indexOf(Buffer.from(expectedSha256Hex, 'hex')) === -1) {
      return { valid: false, reason: 'live token does not embed the expected digest' };
    }
  }
  if (options.orderCreateTimeIso !== undefined) {
    const orderMs = Date.parse(options.orderCreateTimeIso);
    if (!Number.isFinite(orderMs)) {
      return { valid: false, reason: 'orderCreateTimeIso unparseable' };
    }
    if (anchor.timestampMs > orderMs + 5 * 60 * 1000) {
      return { valid: false, reason: 'token timestamp beyond +5 minute skew window' };
    }
  }
  return { valid: true, reason: 'timestamp anchor valid' };
}
