# VeriPact — Devpost Submission Kit (ready to paste)

Target: `paypalaihackathon.devpost.com`. Solo build + AI agents.
Repository: `https://github.com/Bhav-ikkk/VeriPact`.

## 1. Project title & tagline

**Title:** VeriPact — Proving What the Merchant Promised

**Tagline (125 chars):** Independent witness infrastructure for agentic commerce — VeriPact proves what the merchant actually promised, inside PayPal.

## 2. Sandbox receipts & verification strip

Live sandbox receipts (committed, `docs/sandbox-receipts.json`,
`LIVE_PAYPAL_SANDBOX`, generated 2026-11-06T05:52:02.665Z by
`npm run seed:sandbox` against `api-m.sandbox.paypal.com`):

| Scenario | Order ID | custom_id | Total | Status |
|---|---|---|---|---|
| normal | `1D1495603B138083R` | `VP1:e1c9eabe3c821dd3a72d47e7bcd6eba731024dc5ed42a3a2f7a0b03873134627` | $297.00 | CREATED (read-back match=true) |
| surcharge_void | `1DM45086A58528407` | `VP1:e0ea946fd40916eb1db67a7d9b2778d291c9d6f4e541fb0e976887fe10c10c56` | $340.50 | CREATED (read-back) |

Live dispute listing at seed time: none on the account (`"disputes": []`).
Zero-key judges get the same flows against the labeled
`DETERMINISTIC_SANDBOX_REPLAY` engine (`ORD-VP-…` orders,
`PP-D-CASE-B-FORGERY` / `PP-D-CASE-A-DRIFT` fixtures).

## 3. Full Devpost story

### Inspiration

Agent shopping breaks at the merchant-promise gap. In a 330-merchant
assessment ([arXiv:2610.17378](https://arxiv.org/abs/2610.17378), *Get
In, Decide, Prove*), the all-in total was determinate at only **18 of
330** merchants, with **137 of 178** decision failures traced to tax —
kept strictly separate from that paper's **555-site access census**
(105 sites, 18.9%, unreadable to agents). The RAILS verification ladder
([arXiv:2606.08790](https://arxiv.org/abs/2606.08790)) demands
human-verified settlement for agent-arranged transactions, and Whisper
attacks ([arXiv:2609.11757](https://arxiv.org/abs/2609.11757)) flip
agent payment choices without touching signed bytes (90% / 56% / 73.3%
across three attack families). Buyer guardrails control what an agent
may spend — but nothing proves what the merchant actually promised, in
a form that survives PayPal representment. VeriPact is that proof
layer, built for PayPal's agentic-commerce (AP2) direction.

### What It Does

VeriPact witnesses a merchant page and binds a `VP1:` commitment of the
observed terms into the PayPal order record:

- **3-rung evidence ladder** — Rung 1 SELF (buyer signs the mandate),
  Rung 2 WIT (independent HTTPS witness: hidden-DOM scan, exact-match
  quotes, Channel3 catalog cross-check, RFC 3161 timestamp), Rung 3
  SIGN (merchant countersigns; commitment lands in
  `purchase_units[0].custom_id`).
- **Guarded PayPal flow** — Orders v2 `AUTHORIZE → PATCH` (shipping/tax
  callback) → post-approval re-gate → `CAPTURE` ($297.00) or
  auto-`VOID` ($340.50 over the $320 cap). Yellow
  `ASK_HUMAN_DELTA` ($41 headroom) when ship/tax are indeterminate;
  red `BLOCK` on adversarial DOM before any PayPal call.
- **Verify It Yourself auditor** — the judge's own browser recomputes
  SHA-256 over canonical JSON and compares it to the live order's
  `custom_id` (`JCS-PARITY MATCH`). Nothing trusts our server.
- **Contested dispute verifier** — a 3-column inspector that catches
  Case B buyer forgery (self-signed "60-day returns" vs the anchored
  30-day hash → `BUYER_FORGERY_DETECTED`) and Case A merchant drift
  ("30-day → 14-day / 25% fee" post-purchase mutation →
  `MERCHANT_DRIFT_CONFIRMED`), then drives the PayPal dispute through
  its real HATEOAS action chain.
- **v5 Agentic Wallet & Witnessed Clearing** — the ladder above,
  promoted into a wallet system: phone QR pairing links a PayPal
  Vault payer and opens a $350.00 partition ($320.00 per-order cap);
  the deterministic spend check auto-voids overruns; sync splits
  legacy unwitnessed history from VP1:-protected payments; ChatGPT
  Actions import `GET /openapi.json` and Claude/Cursor run the 7-tool
  MCP server, with automatic 3-rung witnessing on every agent payment.

### How We Built It

An 8-package TypeScript monorepo (`core`, `term-extractor`,
`witness-client`, `paypal-client`, `sdk`, `cli`, `mcp-server`,
`workbench`) with zero-dependency cryptography: RFC 8785 JSON
canonicalization, PKCS#8 Ed25519, and ASN.1 DER RFC 3161 timestamp
requests, all on Node's built-in `crypto`. The Channel3 MCP oracle
cross-checks condition and price; the PayPal engine speaks Orders v2,
Payments v2, and Disputes v1 through strict HATEOAS gating; the
workbench pairs a macOS Sequoia UI with an AG Grid / Studio dispute
desk, plus a CLI and a stdio MCP server so any shopping agent can
invoke witnessing. Zero paid API keys anywhere.

### Verification & Evaluation

- **238/238 unit + integration tests** across 16 files green
  (`lint`, `typecheck`, `build`, `test` all exit 0), including an
  8-case adversarial red-team suite (XSS, 1MB/413 caps, prototype
  pollution, path traversal, zero secret leakage), plus a **23-step
  Playwright E2E** (pairing, partition wall, refund, sync, mint,
  4-viewport overflow gates) with zero 4xx/5xx and zero console
  errors.
- **JCS-Parity proof:** the in-browser canonicalizer is byte-tested
  against the server implementation, so client-side hash recomputation
  cannot drift.
- **24-scenario, 72-run regression suite** (8 benign / 8 drift / 8
  adversarial, 3 passes, zero network cost): gate 72/72, post-auth
  57/57, referee 21/21, overall 72/72 — each with honest 95% Wilson
  score intervals and a perfectly diagonal confusion matrix.

### Honesty & Epistemic Boundaries

1. Timestamps prove hash existence at time T plus independent witness
   observation — never content truth.
2. Witness isolation is logical in this demo (route groups in one
   process for judge-click latency); production deploys buyer,
   witness, and merchant as disjoint services.
3. Sandbox adjudication is simulated; live disputes resolve through
   PayPal's real flow with VeriPact evidence attached as `OTHER`.
4. The 18/330 figure counts merchants with determinate all-in totals
   — not agent task success, and not the separate 555-site census.
5. The regression suite is controlled, not a field benchmark: 24
   synthetic storefronts with honest Wilson bounds on that suite.
6. The Dispute Desk is a LOCAL SIMULATION (`simulationDesk: true`):
   desk HATEOAS walks are `OTHER` evidence, never PayPal proof.
7. Live receipts are CREATED-only; live capture/void needs
   founder-manual buyer approval plus Finalize per order.
8. The surcharge custom_id match is withheld: TSA real-clock hashes
   are non-reproducible, so judge re-witness stays untested.
9. Transaction Search sync is async reconciliation only
   (`FALLBACK_TO_REPLAY_AND_SESSION_ORDERS` uncredentialed, 3-hour
   SLA, non-unique IDs); real-time balances come from the Clearing
   Ledger, never from a reporting row.

## 4. Built With & sponsor alignment

**Built With:** `typescript`, `node`, `paypal-rest-api`,
`paypal-orders-v2`, `paypal-disputes-v1`, `ed25519`, `rfc3161`,
`rfc8785`, `ag-grid`, `channel3-mcp`, `playwright`, `vitest`, `render`.

- **Best Use of PayPal + AI:** full Orders v2 AUTHORIZE/PATCH/capture
  + Disputes v1 HATEOAS engine with the `VP1:` commitment bound into
  `custom_id`, re-gated post-approval — plus Vault pairing, Refunds
  Undo, and reporting reconciliation behind the partition ledger.
- **Best Use of Agentic Commerce:** witness → gate → guarded checkout
  pipeline plus a stdio MCP server any shopping agent can call —
  now with QR-paired sub-balance partitions, deterministic
  pre-authorization spend checks, and ChatGPT/Claude connectors.
- **Best Demo Delivery:** 60-second guided in-app tour, one-command
  Playwright video recorder, 5 committed SVG visuals, zero-key judging.
- **Best Use of AG Grid:** dispute desk + 72-run regression grids with
  remount-by-design datasets and an offline native fallback.
- **Best Use of Channel3:** MCP catalog oracle cross-checking every
  witnessed listing (condition + baseline price) with cache replay.
