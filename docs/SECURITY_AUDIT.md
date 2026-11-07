# VeriPact Security Audit (Run 07, pre-submission lock)

Scope: component-scoped source review + adversarial test lock-in, run
2026-11-02 against the Run 06 tree. Method: `security-audit` skill
guidance mode with the `WEB-PROTOCOL-AND-AUTH`, `CLIENT-SIDE`,
`DATA-ISOLATION-AND-LIFECYCLE`, `RESOURCE-EXHAUSTION-AND-AVAILABILITY`,
`AI-AND-LLM`, and `PROTOCOLS-RPC-AND-MESSAGING` companions. This is a
scoped review (16 HTTP routes, 3 HTML templates, MCP server,
paypal-client), not the skill's full 6-phase workflow with independent
verifiers — coverage beyond this scope is `needs_validation`.

## 1. Threat model

- **Adversary:** a remote HTTP caller (judge browser, curious
  evaluator) and a malicious merchant page (hidden DOM, prompt
  injection, payment redirection). No authenticated users exist: the
  demo server holds all three rung keys and all PayPal credentials
  server-side.
- **Assets:** Ed25519 private keys (buyer/witness/merchant),
  `PAYPAL_CLIENT_SECRET`, PayPal bearer tokens, order/dispute integrity.
- **Trust boundaries:** (a) HTTP request → route handlers;
  (b) merchant HTML → witness snapshotter; (c) MCP stdin → tool
  dispatcher; (d) PayPal API responses → parsers.

## 2. Three-key isolation boundary (AGENTS.md Rule 2)

`BUYER_ED25519_PRIVATE_KEY` (Rung 1 SELF), `WITNESS_ED25519_PRIVATE_KEY`
(Rung 2 WIT), and `MERCHANT_ED25519_PRIVATE_KEY` + PayPal credentials
(Rung 3 SIGN) are read per-route via `readRungKey` — buyer routes never
touch witness/merchant keys and vice versa. The bilateral demo routes
(checkout, disputes, verify, finalize) are the documented composition
points. `GET /api/system/status` exposes only 16-hex fingerprints of
**public** keys. Verified: the red-team suite sets all five secrets to
canary values and asserts zero occurrences across 13 route + error-path
responses.

## 3. Thirteen-rule hidden-DOM prompt-injection defense

`term-extractor` partitions visible vs hidden nodes across 13
`HiddenReason` categories (`display-none`, `visibility-hidden`,
`hidden-attribute`, `aria-hidden`, `hidden-class`, `zero-opacity`,
`micro-font`, `offscreen-position`, `low-contrast-text`,
`non-rendered-container`, `script-style-body`, `html-comment`,
`tainted-attribute`) and scans hidden nodes/comments/attributes for
prompt-override phrases (`ignore previous`, `disregard instructions`,
`system prompt`, `developer mode`, `override mandate`, `always
approve`, …) and payment-hijack tokens (`paypal.me/`, `send payment
to`, `merchant_id=`, `custom_id=`, `beneficiary:`). Any hit forces
`pageIntegrity: ADVERSARIAL_DOM` → sufficiency `BLOCK` before the first
PayPal call. Quotes are accepted only as exact substrings of cited
visible blocks (`QUOTE_SUBSTRING_MISMATCH` → `INDETERMINATE`).

## 4. Findings

### Fixed in this run

- **H-1 — `disputeId` path traversal (hardening).** `disputeId` was
  interpolated raw into live PayPal URL paths
  (`/v1/customer/disputes/${disputeId}/…`, normalized by `new URL`),
  so `..`/`/` sequences could redirect the request to unintended
  sandbox endpoints. Impact was bounded (sandbox host pinned, GET-first
  + HATEOAS-parse gate, caller's own credential), so this never met the
  bar for a confirmed exploitable finding — but the route layer now
  enforces the same token allowlist as orderId
  (`/^[A-Za-z0-9_-]+$/`, 400 otherwise). Legit `PP-D-*` flows unchanged.

### Verified controls (no change needed)

- **Body caps:** 1MB enforced on both transports (`bodyText` length
  check + streaming abort) → `413`, server keeps serving.
- **JSON gate:** truncated/array/primitive bodies → `400`; handlers
  read named fields only — no deep merge, no prototype-pollution
  gadget (`__proto__` payloads ignored, `Object.prototype` untouched).
- **XSS:** all server HTML interpolations escaped (`esc()` +
  `<`-free popup JSON); hostile `?token=` renders a static error page
  with zero reflection; JSON APIs serve `application/json` with
  `nosniff` + `DENY` framing; dispute notes are stored, never echoed
  (`evidenceCount` only).
- **Messaging:** popup `postMessage` targets `window.location.origin`;
  the workbench listener verifies `event.origin`.
- **PayPal client:** sandbox host pinned (non-sandbox refused);
  secrets used only for the OAuth Basic call; `PayPalHttpError`
  carries status + path, never headers/bodies; evidence notes ≤2000
  and `evidence_type` regex enforced pre-transport; webhook `cert_url`
  is fetched by PayPal, never by us (no SSRF).
- **MCP:** key-material argument keys rejected pre-dispatch; tool,
  scenario, and case names allowlisted; errors are JSON-RPC shaped.
- **CSRF N/A by design:** no cookies, sessions, or ambient
  credentials exist — a cross-site POST gains nothing over a direct
  curl against this open demo server.

### Needs validation / hardening notes (not findings)

- No rate limiting — acceptable for a judged demo; production needs
  edge limits (Render/CDN) before public traffic.
- Client-caused cap violations (e.g. >2000-char notes) surface as
  `500` instead of `400` (error-code hygiene, no security impact).
- No `Content-Security-Policy` header; remote script surface is one
  pinned AG Grid CDN build + preconnect.
- Replay evidence arrays grow per `provide-evidence` call (bounded by
  the 2000-char cap; demo scope only — production needs retention).

## 5. Verified security test results

`packages/workbench/test/security.test.ts` — 8/8 green via the real
route layer: script payloads in mandate fields (inert JSON round-trip),
script query tokens (400, zero reflection), dispute-note handling +
2000-char cap, 6 hostile `disputeId` shapes (400) + legit routing,
>1MB bodies (413, server healthy after), `__proto__` + 5 malformed-JSON
shapes (handled, prototype untouched), 5 canary secrets × 13 responses
(zero leakage, fingerprints stay 16-hex), UI bundle (`esc` present, no
secret names). Full gate: **156/156** tests green.

## 6. Run 08 break-it addendum (2026-11-02, post-lock hardening)

Adversarial re-test with a headless-Chromium probe (10 scripted UI +
backend steps, all green) and a route/template/CLI/MCP fuzzer. Five
real breaks found and fixed; each carries a committed regression
test. Full gate after fixes: **166/166** tests green.

- **DoS via deeply nested merchant HTML (fixed).** 100k nested `<div>`s
  turned the scanner walk quadratic (hang). Fix: `MAX_NESTING_DEPTH =
  256` parser cap with sticky fail-closed inheritance (`cappedHiddenAbove`
  / `cappedSealedAbove`) — deep content loses ancestry detail but never
  detection coverage. Proven no-op on shallow pages: every changed
  branch is gated on depth > 256, and visible-block emission keeps the
  strict concealed filter.
- **Nested injection blind spot (fixed).** Findings text stopped at one
  concealment level, so an injection nested inside a hidden element was
  missed. Fix: `subtreeText(..., includeConcealed)` sees through nested
  concealment for findings only; quote emission is unchanged.
- **Unvalidated order totals (fixed).** `createAuthorizeOrder` accepted
  `NaN` / `Infinity` / negative totals. Fix: finite `>= 0` guard;
  `NaN` / `Infinity` / negatives / strings reject, `0` allowed.
- **MCP key-material regex gap (fixed).** `apiKey` / `accessToken` /
  `auth_token` / `refreshToken` spellings bypassed the stdin guard.
  Fix: pattern widened; public hex material (`orderId`, `VP1:`
  commitments, public keys, signatures) still passes by design.
- **Exact body-cap boundary (locked in).** The 1MB cap previously had
  only an over-cap test. Added: exactly 1,000,000 bytes → 200,
  cap+1 → 413.
- **Framing (no finding).** `/store/*` preview moved from `DENY` to
  `SAMEORIGIN` so the workbench can iframe its own preview; all other
  surfaces keep `DENY`, and the approval popup is never framed.
- **Fuzz false alarms (documented, not fixed).** `VP1:` key-format
  throws, JCS circular-input throws, TSA digest-mismatch rejects,
  replay out-of-order transitions, and MCP unknown-shape errors are
  all designed fail-closed behavior, asserted by the existing suite.

Non-security UI fixes in the same run: fallback-grid wrapping,
diff-pill overflow, finalize double-submit guard. No flow changes.

## 7. Run 10 availability-hardening addendum (2026-11-02)

The founder's browser showed 500s from environment state, not logic
bugs. Verified throw sites: malformed rung keys in `process.env`
(`readRungKey` 500), partial 1-of-3 keys (`resolveKeys` 500),
placeholder or dead PayPal credentials (live-mode 401 → 500), and an
unreadable `.env` path (`EISDIR`/EACCES → 500 on every credential
route). All closed; clean checkouts behaved identically before/after.

- **Per-rung demo fallback (workbench only).** `readRungKey` and the
  new `resolveKeysLenient` warn to stderr and engage the demo seed
  for malformed/missing rungs. The strict `resolveKeys` refusal is
  UNCHANGED for SDK/CLI/MCP embedders (locked tests pin it) — only
  the always-on demo server opts into `lenientKeys: true`.
  `deriveEd25519KeyPairFromSeed` stays strict (pure primitive).
- **Placeholder scrubbing.** `isPlaceholderCredential` (`your_`,
  `replace_`, `<…>`, `xxx`, …) filters the human-edited layers
  (process env, `.env` file) in `resolvePaypalCredentials` and in
  the workbench's explicit pass-through. Explicit options bypass the
  filter (programmer intent; locked tests pin short values). No
  length rule by design — the 401 fallback below catches the rest.
- **Live → replay latch.** A live-auth/transport failure
  (`isLiveAuthFailure`: 401/`invalid_client`/DNS/refused/timeout/
  `fetch failed`) retries the operation once in deterministic replay
  and latches the whole workbench to replay until credentials change
  or demo-reset. The latch stores only a SHA-256 of the pair, never
  the pair; 4xx/referee errors never trigger it.
- **Repo-root paths.** New `resolveRepoRoot()` (walk up to
  `workspaces` root or `benchmark/` markers) anchors `.env`,
  receipts, pending file, and benchmark paths — the server starts
  from any cwd. Unreadable `.env` now reads as absent.
- **Favicon + CDN.** `/favicon.ico` + `/favicon.svg` serve the
  V-emblem SVG (kills the 404); external jsdelivr tags are removed
  (offline-first native grid, zero console errors). The AG Grid
  mount branch stays as a progressive enhancement if
  `window.agGrid` ever exists.

## 8. Run 15 v5 addendum (2026-11-06, wallet surface review)

Full gate at review time: 238/238 unit tests (16 files), 23/23
Playwright E2E, `lint` + `typecheck` + `build` exit 0. v5 wallet
findings (demo-model unless noted):

- **Pairing ceremony is possession-only (demo model).** Session IDs
  are sequential (`PAIR-VP-0001` ...) and the `/pair/:sessionId`
  page approves whoever opens the link inside the 15-minute TTL.
  Safe for the local demo; production needs owner-bound sessions.
- **One-time credentials stay one-time.** The raw connector value
  leaves the server exactly once (mint response); the ledger and
  all later reads carry the masked form only (unit + E2E asserted).
- **Ceremony page is injection-safe.** Session fields are
  HTML-escaped server-side (committed script-escape test); the
  paired notification is a same-origin `postMessage`.
- **No new PayPal or key-boundary risk.** Wallet routes reuse the
  Step-1 vault/refund/reporting modules and the Rule-2 route
  boundaries; no foreign keys cross buyer/witness/merchant code.

## 9. VeriPact v6 Deal Sniper, Concurrency Mutex & @veripact Anywhere Audit

Run 25 (2026-11-07). Full gate: 263/263 unit tests (17 files), 24/24
Playwright E2E, `lint` + `typecheck` + `build` exit 0. Six vectors were
executed through `handleWorkbenchRequest` with dummy keys and an isolated
wallet file. Findings below are the ones that changed source.

- **Concurrent double-spend (fixed).** Five overlapping
  `POST /api/wallet/sniper` calls each constructed a wallet from the same
  state file and could all observe `$350` available before any capture
  was saved. `withWalletFileLock` plus `VeriPactWallet.runExclusive`
  queues mutations on that file and reloads disk state at the start of
  each turn. The sniper hunt and `executePartitionedAgentPayment` share
  the lock (re-entrant on one instance). After the change, one
  `$297.00` capture succeeds and the other four return
  `BLOCKED_BY_PARTITION_WALL`. `availableUsd` is `53` and `capturedUsd`
  is `297`.
- **Wall void left the partition EXHAUSTED (fixed).** A blocked spend
  adds `authorizedUsd` and then `voidedUsd`. The intermediate balance
  hits zero, and the old status rule never returned a partition to
  `ACTIVE` after the void restored funds. The next caller then saw
  `BLOCKED_PARTITION_FROZEN` and the route 500'd.
  `syncPartitionStatus` keeps a buyer `FROZEN` partition frozen and
  otherwise sets `EXHAUSTED` only while available funds are zero.
- **Voucher and prototype keys.** `customVoucherCode` must match
  `/^[A-Za-z0-9_-]{1,32}$/`. `__proto__`, `constructor`, and `prototype`
  are rejected even though they match that alphabet. Quote-break and
  instruction-override strings return 400 and are not copied into the
  response. `parseJsonBody` drops those three keys and rejects objects
  nested past 32 levels with 400.
- **Hidden-DOM injections.** `clip-path: inset(100%)` is classified as
  `offscreen-position` (one of the existing 13 reasons). Zero-width
  joiners are stripped before adversarial phrase matching, so a hidden
  "ignore previous" split by U+200D still matches. Custom HTML with
  `font-size:0`, `opacity:0.001`, `clip-path`, `text-indent:-9999px`,
  `aria-hidden`, and off-screen `left` gates `BLOCK` with no PayPal
  capture. Visible editorial text that merely contains "system prompt"
  stays clean.
- **Cent boundary.** `targetMaxAllInUsd: 296.99` returns
  `NO_COMPLIANT_DEAL_UNDER_TARGET` and spends `$0`. `297` captures.
  `NaN`, `Infinity`, `1e308`, numeric strings, `null`, arrays, and
  objects return 400 from the sniper, partition, and mandate routes.
- **XSS.** Script payloads in `/pair/:sessionId`, sniper SKU and voucher
  fields, partition labels, and connector platforms are rejected by
  allowlists. An unknown store `sku` falls back to the catalog id, so
  the raw `<script>` string is not written into `/store/normal`.
- **Secrets.** Health, status, ledger, partitions, sync, a rejected
  sniper body, OpenAPI, and `/embed/veripact-anywhere.js` do not contain
  private-key canaries, `PAYPAL_CLIENT_SECRET`, or a bearer minted
  earlier in the same test. Connector bearers are `vp_` plus 48 hex
  characters, returned once.
