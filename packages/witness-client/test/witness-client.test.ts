import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeCommitment,
  deriveEd25519KeyPairFromSeed,
  evaluateContestedDispute,
  formatCommitmentPrefix,
  signCanonicalPayload,
  verifyCanonicalPayload,
  type MandateSpec,
} from '@veripact/core';
import {
  anchorDigestRfc3161,
  assertWitnessUrl,
  buildRfc3161RequestDer,
  CHANNEL3_MATCH_THRESHOLD,
  createWitnessSnapshot,
  isValidSha256Hex,
  loadChannel3CacheFromDisk,
  matchCatalogProduct,
  NodeHttpSnapshotter,
  verifyTimestampAnchor,
  verifyWithChannel3Oracle,
  WitnessClient,
  type AnchorOptions,
  type Channel3CatalogCache,
} from '../src/index';

const HEX = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
const WITNESS = deriveEd25519KeyPairFromSeed('22'.repeat(32));
const BUYER = deriveEd25519KeyPairFromSeed('11'.repeat(32));

const MANDATE: MandateSpec = {
  mandateId: 'mnd_test_003',
  createdAtUtc: '2026-11-01T06:30:00.000Z',
  buyerId: 'buyer_sandbox_01',
  itemQuery: '27-inch 4K IPS Monitor',
  constraints: {
    requiredCondition: 'NEW',
    maxAllInPriceUsd: 320,
    minReturnWindowDays: 30,
    maxRestockingFeePct: 0,
  },
  buyerPublicKeyHex: BUYER.publicKeyHex,
  buyerSignatureHex: '92a4c8',
};

const STORE_HTML = `<!doctype html>
<html><head><title>Apex ProView 27 4K IPS Monitor</title></head><body>
<h1>Apex ProView 27 4K IPS Monitor</h1>
<p>Brand New in Box. Sale Price: $279.00.</p>
<p>Free 30-day returns. No restocking fee.</p>
<p>Flat $11.50 shipping. Estimated tax $6.50.</p>
</body></html>`;

const CACHE_PATH = join(process.cwd(), 'benchmark', 'responses', 'channel3_catalog_cache.json');

function loadCache(): Channel3CatalogCache {
  return loadChannel3CacheFromDisk(CACHE_PATH);
}

function flipFirstBase64Char(s: string): string {
  return `${s[0] === 'A' ? 'B' : 'A'}${s.slice(1)}`;
}

describe('@veripact/witness-client', () => {
  it('resolves @veripact/core across the workspace boundary', () => {
    expect(formatCommitmentPrefix(HEX)).toBe(`VP1:${HEX}`);
  });

  it('validates sha256 hex digests', () => {
    expect(isValidSha256Hex(HEX)).toBe(true);
    expect(isValidSha256Hex('xyz')).toBe(false);
  });

  it('builds a deterministic DER TimeStampReq embedding OID and digest', () => {
    const der = buildRfc3161RequestDer(HEX, '0102030405060708');
    expect(der[0]).toBe(0x30);
    const oid = Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
    expect(der.indexOf(oid)).toBeGreaterThan(-1);
    expect(der.indexOf(Buffer.from(HEX, 'hex'))).toBeGreaterThan(-1);
    expect([...der.subarray(der.length - 3)]).toEqual([0x01, 0x01, 0xff]);
    expect(buildRfc3161RequestDer(HEX, '0102030405060708').equals(der)).toBe(true);
    expect(() => buildRfc3161RequestDer('xyz')).toThrow(/64 lowercase hex/);
    expect(() => buildRfc3161RequestDer(HEX, 'zz')).toThrow(/nonce/);
  });

  it('anchors locally with byte-deterministic tokens', async () => {
    const options: AnchorOptions = {
      mode: 'local',
      nonceHex: 'aa'.repeat(8),
      timestampMs: 1798761600000,
      localSigner: { publicKeyHex: WITNESS.publicKeyHex, privateKeyHex: WITNESS.privateKeyHex },
    };
    const first = await anchorDigestRfc3161(HEX, options);
    const second = await anchorDigestRfc3161(HEX, options);
    expect(first.authority).toBe('LOCAL_TEST');
    expect(first.tokenBase64).toBe(second.tokenBase64);
    expect(first.serialHex).toBe(second.serialHex);
    expect(verifyTimestampAnchor(first, HEX)).toEqual({ valid: true, reason: 'timestamp anchor valid' });
  });

  it('rejects mutated digests, tampered tokens, and skew violations', async () => {
    const anchor = await anchorDigestRfc3161(HEX, {
      mode: 'local',
      nonceHex: 'bb'.repeat(8),
      timestampMs: 1798761600000,
      localSigner: { publicKeyHex: WITNESS.publicKeyHex, privateKeyHex: WITNESS.privateKeyHex },
    });
    const mutated = `${HEX.slice(0, -1)}${HEX.endsWith('0') ? '1' : '0'}`;
    expect(verifyTimestampAnchor(anchor, mutated).valid).toBe(false);
    expect(verifyTimestampAnchor(anchor, 'xyz').valid).toBe(false);
    const tampered = { ...anchor, tokenBase64: flipFirstBase64Char(anchor.tokenBase64) };
    expect(verifyTimestampAnchor(tampered, HEX).valid).toBe(false);
    const within = new Date(1798761600000 - 1000).toISOString();
    expect(verifyTimestampAnchor(anchor, HEX, { orderCreateTimeIso: within }).valid).toBe(true);
    const beyond = new Date(1798761600000 - 6 * 60 * 1000 - 1000).toISOString();
    const skewed = verifyTimestampAnchor(anchor, HEX, { orderCreateTimeIso: beyond });
    expect(skewed.valid).toBe(false);
    expect(skewed.reason).toContain('skew window');
  });

  it('live timestamp mode always yields a verifiable anchor', async () => {
    const anchor = await anchorDigestRfc3161(HEX, { mode: 'freetsa', timeoutMs: 1500 });
    expect(['FREETSA', 'LOCAL_RFC3161_FALLBACK']).toContain(anchor.authority);
    expect(verifyTimestampAnchor(anchor, HEX).valid).toBe(true);
  });

  it('Channel3 cache matches the flagship SKU and flags condition fraud', async () => {
    const cache = loadCache();
    expect(cache.replay).toBe(true);
    expect(cache.products).toHaveLength(8);
    const hit = await verifyWithChannel3Oracle(
      { brandModel: 'Apex ProView 27 4K IPS Monitor', condition: 'NEW', basePriceUsd: 279 },
      { mode: 'cache', cache },
    );
    expect(hit).toMatchObject({
      matched: true,
      productId: 'APEX-27-4K-IPS',
      catalogPriceUsd: 279,
      conditionMatch: true,
      priceDeltaUsd: 0,
      source: 'CHANNEL3_CACHE_REPLAY',
    });
    const fraud = await verifyWithChannel3Oracle(
      {
        brandModel: 'Apex ProView 27 4K IPS Monitor - Certified Refurbished',
        condition: 'NEW',
        basePriceUsd: 279,
      },
      { mode: 'cache', cache },
    );
    expect(fraud.matched).toBe(true);
    expect(fraud.productId).toBe('APEX-27-4K-IPS-RB');
    expect(fraud.conditionMatch).toBe(false);
    expect(fraud.priceDeltaUsd).toBe(60);
  });

  it('Channel3 live mode honors injected transport with honest fallback', async () => {
    const live = await verifyWithChannel3Oracle(
      { brandModel: 'Apex ProView 27 4K IPS Monitor', condition: 'NEW', basePriceUsd: 279 },
      {
        mode: 'live',
        fetchJson: () =>
          Promise.resolve({
            status: 200,
            json: {
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify([
                      {
                        productId: 'APEX-27-4K-IPS',
                        title: 'Apex ProView 27 4K IPS Monitor',
                        condition: 'NEW',
                        priceUsd: 279,
                      },
                    ]),
                  },
                ],
              },
            },
          }),
      },
    );
    expect(live.source).toBe('CHANNEL3_MCP_LIVE');
    expect(live.matched).toBe(true);
    const fellBack = await verifyWithChannel3Oracle(
      { brandModel: 'Apex ProView 27 4K IPS Monitor' },
      {
        mode: 'auto',
        cache: loadCache(),
        fetchJson: () => Promise.reject(new Error('sandbox offline')),
      },
    );
    expect(fellBack.source).toBe('CHANNEL3_CACHE_REPLAY');
    expect(fellBack.matched).toBe(true);
    await expect(
      verifyWithChannel3Oracle(
        { brandModel: 'Apex ProView 27 4K IPS Monitor' },
        {
          mode: 'live',
          fetchJson: () => Promise.reject(new Error('transport down')),
        },
      ),
    ).rejects.toThrow('transport down');
  });

  it('catalog matching is exact-boosted, thresholded, and total', () => {
    expect(CHANNEL3_MATCH_THRESHOLD).toBe(0.5);
    const cache = loadCache();
    expect(matchCatalogProduct('Apex ProView 27 4K IPS Monitor', cache.products)?.productId).toBe(
      'APEX-27-4K-IPS',
    );
    expect(matchCatalogProduct('apex proview 27 4k ips monitor', cache.products)?.productId).toBe(
      'APEX-27-4K-IPS',
    );
    expect(matchCatalogProduct('zzzqqq nonexistent widget', cache.products)).toBeUndefined();
    expect(matchCatalogProduct('', cache.products)).toBeUndefined();
  });

  it('NodeHttpSnapshotter rejects bad URLs without sockets', async () => {
    const snapshotter = new NodeHttpSnapshotter(2000);
    expect(snapshotter.name).toBe('node-http-snapshotter');
    await expect(snapshotter.fetch('not a url')).rejects.toThrow(/invalid URL/);
    await expect(snapshotter.fetch('ftp://example.test/x')).rejects.toThrow(/non-http/);
    await expect(snapshotter.fetch('https://nonexistent.invalid/')).rejects.toThrow();
  });

  it('assertWitnessUrl enforces public HTTPS only when required', () => {
    expect(() => assertWitnessUrl('http://localhost:4003/store/1', true)).toThrow(/https|loopback/);
    expect(() => assertWitnessUrl('http://example.test/item', true)).toThrow(/https/);
    expect(assertWitnessUrl('https://veripact-demo.onrender.com/store/1', true)).toEqual({
      hostname: 'veripact-demo.onrender.com',
    });
    expect(assertWitnessUrl('http://localhost:4003/store/1', false)).toEqual({
      hostname: 'localhost',
    });
    expect(() => assertWitnessUrl('::bad::', false)).toThrow(/invalid listing URL/);
  });

  it('createWitnessSnapshot produces a signed WIT receipt end to end', async () => {
    const output = await createWitnessSnapshot({
      listingUrl: 'https://veripact-demo.onrender.com/store/1',
      mandate: MANDATE,
      witnessKeys: { publicKeyHex: WITNESS.publicKeyHex, privateKeyHex: WITNESS.privateKeyHex },
      htmlFetcher: () => Promise.resolve({ status: 200, html: STORE_HTML, tlsVerified: true }),
      requirePublicHttps: true,
      tsaMode: 'local',
      channel3Mode: 'cache',
      channel3Cache: loadCache(),
    });
    expect(output.commitment).toMatch(/^VP1:[0-9a-f]{64}$/);
    expect(output.commitment).toHaveLength(68);
    expect(output.commitment).toBe(computeCommitment(output.receiptCore));
    expect(output.termReceipt.rung).toBe('WIT');
    expect(output.termReceipt.receiptVersion).toBe('VP1');
    expect(
      verifyCanonicalPayload(output.receiptCore, output.witnessSignatureHex, output.witnessPublicKeyHex),
    ).toBe(true);
    expect(output.provenance).toMatchObject({
      fetchedUrl: 'https://veripact-demo.onrender.com/store/1',
      httpStatus: 200,
      tlsVerified: true,
      tsaIssuer: 'LOCAL_TEST',
      channel3ProductId: 'APEX-27-4K-IPS',
    });
    expect(output.gateResult.decision).toBe('PROCEED');
    expect(output.oracleResult.matched).toBe(true);
    expect(verifyTimestampAnchor(output.anchor, output.commitment.slice(4)).valid).toBe(true);
  });

  it('snapshot receipts pass the core referee for Case B and Case A', async () => {
    const output = await createWitnessSnapshot({
      listingUrl: 'https://veripact-demo.onrender.com/store/1',
      mandate: MANDATE,
      witnessKeys: { publicKeyHex: WITNESS.publicKeyHex, privateKeyHex: WITNESS.privateKeyHex },
      htmlFetcher: () => Promise.resolve({ status: 200, html: STORE_HTML, tlsVerified: true }),
      tsaMode: 'local',
      channel3Mode: 'cache',
      channel3Cache: loadCache(),
    });
    const witnessReceipt = {
      payload: output.receiptCore,
      signatureHex: output.witnessSignatureHex,
      publicKeyHex: output.witnessPublicKeyHex,
    };
    const forgedPayload = {
      ...output.receiptCore,
      observedTerms: {
        ...output.receiptCore.observedTerms,
        basePriceUsd: { status: 'DETERMINATE', value: 199 },
      },
    };
    const caseB = evaluateContestedDispute({
      paypalOrderCustomId: output.commitment,
      witnessReceipt,
      buyerClaimReceipt: {
        payload: forgedPayload,
        signatureHex: signCanonicalPayload(forgedPayload, BUYER.privateKeyHex),
        publicKeyHex: BUYER.publicKeyHex,
      },
      sellerCounterClaimReceipt: witnessReceipt,
    });
    expect(caseB.verdict).toBe('BUYER_FORGERY_DETECTED');
    const driftedPayload = {
      ...output.receiptCore,
      observedTerms: {
        ...output.receiptCore.observedTerms,
        returnWindowDays: { status: 'DETERMINATE', value: 14 },
      },
    };
    const caseA = evaluateContestedDispute({
      paypalOrderCustomId: output.commitment,
      witnessReceipt,
      buyerClaimReceipt: {
        payload: output.receiptCore,
        signatureHex: signCanonicalPayload(output.receiptCore, BUYER.privateKeyHex),
        publicKeyHex: BUYER.publicKeyHex,
      },
      sellerCounterClaimReceipt: {
        payload: driftedPayload,
        signatureHex: output.witnessSignatureHex,
        publicKeyHex: output.witnessPublicKeyHex,
      },
    });
    expect(caseA.verdict).toBe('MERCHANT_DRIFT_CONFIRMED');
  });

  it('WitnessClient witnesses through the configured facade', async () => {
    const client = new WitnessClient({
      witnessPublicKeyHex: WITNESS.publicKeyHex,
      witnessPrivateKeyHex: WITNESS.privateKeyHex,
      htmlFetcher: () => Promise.resolve({ status: 200, html: STORE_HTML, tlsVerified: false }),
      channel3Mode: 'cache',
      channel3Cache: loadCache(),
    });
    expect(client.witnessPublicKeyHex).toBe(WITNESS.publicKeyHex);
    const { receipt, provenance } = await client.witness('https://example.test/item', MANDATE);
    expect(receipt.rung).toBe('WIT');
    expect(provenance.fetchedUrl).toBe('https://example.test/item');
    expect(provenance.tlsVerified).toBe(false);
  });

  it('snapshot rejects error pages and enforced-localhost URLs', async () => {
    const base = {
      mandate: MANDATE,
      witnessKeys: { publicKeyHex: WITNESS.publicKeyHex, privateKeyHex: WITNESS.privateKeyHex },
      tsaMode: 'local' as const,
      channel3Mode: 'cache' as const,
      channel3Cache: loadCache(),
    };
    await expect(
      createWitnessSnapshot({
        ...base,
        listingUrl: 'https://example.test/item',
        htmlFetcher: () => Promise.resolve({ status: 404, html: 'nope', tlsVerified: true }),
      }),
    ).rejects.toThrow(/HTTP 404/);
    await expect(
      createWitnessSnapshot({
        ...base,
        listingUrl: 'http://localhost:4003/store/1',
        requirePublicHttps: true,
        htmlFetcher: () => Promise.resolve({ status: 200, html: STORE_HTML, tlsVerified: false }),
      }),
    ).rejects.toThrow(/https|loopback/);
  });
});
