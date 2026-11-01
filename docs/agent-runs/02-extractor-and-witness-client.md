# Run 02 — Production `@veripact/term-extractor` & `@veripact/witness-client`

Parent state: Run 01b complete (50/50 green, `.agents/` active, `@veripact/core`
JCS + Ed25519 + 3-way referee locked). This run replaces the Prompt #1 stubs in
`term-extractor` and `witness-client` with production implementations and wires
the witness snapshot pipeline end to end.

## 1. What was built

### 1.1 `@veripact/term-extractor` (new modules)

- `packages/term-extractor/src/dom-scanner.ts`
  - `scanMerchantHtml(html): DomScanResult` — pure-TypeScript, zero-dependency
    HTML parser/scanner (no browser, no jsdom). Handles unclosed tags and
    entity decoding; seals `<script>/<style>/<template>/<noscript>` contents
    and HTML comments out of the visible stream.
  - Partitions hidden vs. visible nodes across 9 `HiddenReason` values:
    `display-none`, `visibility-hidden`, `hidden-attribute`, `aria-hidden`,
    `hidden-class`, `zero-opacity`, `micro-font`, `offscreen-position`,
    `low-contrast-text`.
  - Adversarial detection over hidden nodes, comments, and attributes only
    (visible editorial text never escalates): `PROMPT_OVERRIDE_PATTERNS`
    (`ignore previous`, `disregard instructions`, `system prompt`, …) and
    `PAYMENT_HIJACK_PATTERNS` (`paypal.me/`, `send payment to`,
    `beneficiary:`, …). Any match sets `adversarialDomDetected: true` with
    exact `HiddenDomFinding[]` (tag/path, hidden reason, matched pattern,
    snippet).
  - Emits ordered `visibleBlocks: VisibleTextBlock[]` (`B001`, `B002`, …)
    with whitespace-normalized text.
  - Keeps the run-01 `DomScanner` class / `IDomScanner` facade and the
    `looksHidden` / `containsAdversarialPhrase` / `isExactSubstring` helpers
    so the existing API surface keeps working.
- `packages/term-extractor/src/quote-verifier.ts`
  - `extractObservedTerms(scan, options?): Promise<ObservedTermSheet>` —
    deterministic rule/pattern candidate extractor
    (`extractRuleCandidates`) plus an optional pluggable
    `llmCandidateProvider` (LLM candidates take precedence *after* passing
    the same verification).
  - `verifyQuoteInBlocks(blockId, verbatimQuote, visibleBlocks)` — the
    anti-hallucination invariant: `blockId` must exist AND the trimmed quote
    must be an exact character-for-character substring of that block's text.
    Failures mark the attribute `INDETERMINATE` with
    `rejectionReason: "QUOTE_SUBSTRING_MISMATCH"`.
  - Value parsers operate exclusively on verified substrings:
    `parsePriceUsd`, `parseShippingUsd` (`Free Shipping` → 0),
    `parseTaxUsd`, `parseReturnDays` (`Final Sale` → 0),
    `parseRestockingPct`, `parseCondition` (`NEW | REFURBISHED | USED`).
- `packages/term-extractor/src/sufficiency-gate.ts`
  - `evaluateSufficiencyGate(mandate, observed)` — Red `BLOCK`
    (`ADVERSARIAL_DOM`, condition/price/returns/restocking conflicts,
    missing core fields), Yellow `ASK_HUMAN_DELTA` (core determinate +
    compliant, `shipping_usd`/`tax_usd` indeterminate, with
    `headroomUsd = max_all_in − base` and a `deltaPrompt` naming the
    indeterminate fields), Green `PROCEED` (all determinate, compliant,
    `allInTotalUsd ≤ cap`).
  - `evaluatePostApprovalReGate(mandate, receipt, resolvedTotals)` —
    post-`onShippingAddressChange` re-gate returning `CAPTURE`/`VOID` with
    `headroomRemainingUsd`; rejects arithmetically inconsistent totals
    (`item+ship+tax ≠ final`) as `VOID`.
- `packages/term-extractor/src/index.ts` — re-exports the new modules;
  keeps `SufficiencyGate` facade for backward compatibility.

### 1.2 `@veripact/witness-client` (new modules)

- `packages/witness-client/src/tsa.ts`
  - `buildRfc3161RequestDer(sha256Hex, nonceHex?)` — pure-`Buffer` ASN.1 DER
    `TimeStampReq` (RFC 3161 §2.4.1): SHA-256 OID
    `2.16.840.1.101.3.4.2.1`, 32-byte digest, `certReq = TRUE`.
  - `anchorDigestRfc3161(digest, options)` — modes `local` (default,
    byte-deterministic Ed25519-signed receipt for offline tests/regression),
    `freetsa` (`https://freetsa.org/tsr`), `digicert`
    (`http://timestamp.digicert.com`); network failure falls back
    honestly to `authority: 'LOCAL_RFC3161_FALLBACK'` (configurable).
  - `verifyTimestampAnchor(anchor, expectedSha256Hex, { orderCreateTimeIso? })`
    — digest match (digest bytes in live DER `TSTInfo`, signature check for
    local tokens) plus the ±5-minute clock-skew rule
    (`tokenMs ≤ orderMs + 5min`).
- `packages/witness-client/src/channel3-oracle.ts`
  - `verifyWithChannel3Oracle(input, options)` — modes `live` (Channel3
    Streamable HTTP MCP `https://mcp.trychannel3.com/`, JSON-RPC
    `tools/call → search_products`, injectable `fetchJson` transport),
    `cache`, `auto` (live-first, honest fallback to cache replay).
  - `matchCatalogProduct(title, products)` — normalized token match with
    exact-title boost and `CHANNEL3_MATCH_THRESHOLD = 0.5`.
  - `loadChannel3CacheFromDisk(cachePath)` for the deterministic cache.
- `packages/witness-client/src/snapshotter.ts`
  - `createWitnessSnapshot(input)` — fetch HTML (pluggable `htmlFetcher`
    or built-in `NodeHttpSnapshotter`, 5 MiB cap via `MAX_HTML_BYTES`),
    `assertWitnessUrl` (rejects `localhost`/non-HTTPS when
    `requirePublicHttps: true`), scan → extract → Channel3 cross-check →
    sufficiency gate → canonical `TermReceipt` (`rung: 'WIT'`),
    `commitment = computeCommitment(receiptCore)` (`VP1:` + 64-hex),
    Ed25519 witness signature, RFC 3161 anchor. Returns
    `{ termReceipt, receiptCore, commitment, witnessSignatureHex,
    witnessPublicKeyHex, provenance, gateResult, oracleResult, anchor }`.
- `packages/witness-client/src/index.ts` — re-exports; keeps the
  `WitnessClient` facade (now a real `witness(url, mandate)` implementation),
  `IHttpSnapshotter`, and `isValidSha256Hex`.
- `packages/witness-client/package.json` / `tsconfig.json` — added the
  `@veripact/term-extractor` dependency and project reference (witness now
  depends on both core and term-extractor).

### 1.3 Shared types and fixtures

- `packages/core/src/index.ts` — extended `ObservedTermSheet`
  (`PageIntegrity`, `shipping_usd`/`tax_usd`/`all_in_total_usd`),
  `WitnessProvenance` (`tlsVerified`), `TermReceipt` (`rung`), plus the
  `SufficiencyGateResult`/`PostApproval*` and Channel3 result shapes the
  witness pipeline consumes.
- `benchmark/responses/channel3_catalog_cache.json` — new deterministic
  8-product trademark-safe catalog cache, including flagship
  `APEX-27-4K-IPS` ("Apex ProView 27 4K IPS Monitor", $279.00, NEW) plus
  laptop/headphone entries and refurbished variants.

### 1.4 Tests

- `packages/term-extractor/test/term-extractor.test.ts` — rewritten, 19
  tests: run-01 facade/help
...[truncated 6151 chars]