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
