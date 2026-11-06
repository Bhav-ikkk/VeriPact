# Run 13 — v5 Step 1: backend wallet, sync, refunds, OpenAPI

Parent: run 12 (189/189 tests, 18/18 E2E, hybrid live/replay).
Blueprint authority: `docs/architecture/VERIPACT_V5_AGENTIC_WALLET_PLAN.md` Step 1.
Prompt: v5 atomic Step 1 (backend agent wallet + QR pairing + partition
ledger + historical sync + refunds + `/openapi.json`).

## 1. What was built

**Part 1 — `@veripact/core` wallet domain (`src/wallet.ts`, +re-export).**
Pairing, partition, sync-record, and connector types; cent-safe
`computePartitionAvailableUsd` (`total - authorized - captured + voided +
refunded`, clamped ≥ 0); `evaluatePartitionSpendCheck` 5-gate conjunction
(ACTIVE → witnessed → within partition → within per-order cap → within
ask-human threshold); buyer Ed25519 partition sign/verify; GAP-10
`WalletOrderRecord` (persisted `receiptCore` + `verifyOrderCommitmentReproducible`).

**Part 2 — `@veripact/paypal-client` v5 surface (4 new modules + wiring).**
`vault.ts` (setup token → `PM-VP-VAULT-…` payment token),
`refunds.ts` (capture refund + `RefundStateConflictError` one-way lock),
`reporting.ts` (RFC 3339 + 31-day + pageSize validation with
`ReportingRangeExceededError`, D/P/S/V mapping, 3-hour disclosure,
honest live-403/transport fallback), `payment-sync.ts` (3 legacy
fixtures + live receipts + session orders, protection derived from
evidence presence). Replay engine gained vault/refund/reporting/order-list
methods; client index gained routing + refund lock + 4 methods. Existing
`orders/authorizations/disputes/oauth/webhooks` behavior untouched.

**Part 3 — `@veripact/sdk` `VeriPactWallet` (`src/wallet.ts`).**
QR pairing ceremony (approve vaults + mints default $350/$320/$300
partition), buyer-signed partition upsert, `executePartitionedAgentPayment`
(witness → preview total → spend check → capture / partition-wall
authorize+void / ask-human hold / pre-checkout block; live mode never
auto-approves and pre-empts wall blocks pre-create), Refund Undo,
`syncWalletTransactions`, scoped connector mint (bearer once, sha256
persisted), disk-mirrored store + `resetWalletState`. `VeriPactClient.wallet()`
delegates with shared transport + keys.

**Part 4 — CLI + MCP + OpenAPI.**
CLI: `wallet-pair`, `wallet-sync`, `partition-create`, `partition-list`
(+`--json`); MCP: `WALLET_TOOLS` (3 tools, dispatched via `tools/call`,
7 total with base catalog); `GET /openapi.json` OpenAPI 3.1.0 spec with
`bearerAuth` (wallet paths marked as the frozen Step-2 contract).
`resetDemoState` clears the wallet store; `.gitignore` covers the state file.

**Part 5 — tests + gate.** 6 new test files, 34 new tests; Rule-1 gate
green: lint 0, typecheck 0, build 0, `npm test` **223/223** (15 files).

## 2. Skills / tools consulted

- `bundled:durable-test-collateral` (loaded before first edit; Part 5
  makes reusable tests a deliverable — kept 6 focused new files in the
  repo's normal layout, no new framework).
- `bundled:git` (loaded in run 12; commit explicitly requested again here).
- No subagents: single-session implementation + verification.

## 3. GAPs closed

- **GAP-01** (no v5 spec): this run implements the Step-1 slice of the
  frozen blueprint; delta judgments in §4 of the plan held as written.
- **GAP-02/GAP-03** (uninspected bodies): read `core/{crypto,paths,index}`,
  `paypal-client/{index,orders,authorizations,sandbox-replay}`,
  `sdk/{client,regression,index}`, `cli/index`, `mcp-server/index`,
  `workbench/{routes,server,index}` before writing code.
- **GAP-04** (zero Vault/Reporting/Refund code): all three modules landed
  with replay mirrors; Payouts/Invoicing remain zero-hit (out of Step-1 scope).
- **GAP-05/GAP-06** (reporting sandbox + constraints): 31-day/pageSize/RFC3339
  guards + D/P/S/V mapping coded and tested; live 403/transport falls back
  to labeled replay records; 3-hour disclosure attached to every result.
- **GAP-10** (TSA non-reproducibility): `receiptCore` persisted beside every
  wallet order; test recomputes `VP1:` from stored bytes with no re-witness.
- **GAP-15** (hermetic wallet state): disk-mirrored store (best-effort I/O,
  `VERIPACT_WALLET_STATE_FILE` override for tests), zero sockets, cleared
  on `resetDemoState`; polling-first pairing (no SSE in Step 1).

## 4. Architectural decisions & self-corrections

1. **MCP tools/list conflict (decision).** The existing test pins exactly
   4 listed tools, so `TOOLS` stays 4 and wallet tools ship as a separate
   `WALLET_TOOLS` export dispatched by `tools/call` (7 total, documented
   in SKILL.md). Editing the pinned assertion was never an option.
2. **Ledger double-count fix (self-correction).** First draft incremented
   both `authorizedUsd` and `capturedUsd` on capture, yielding −$244
   (clamped 0) instead of $53. Capture now settles the hold
   (`authorized −= total`, `captured += total`); voids cancel via `voided`,
   refunds via `refunded`. The $297→$53→wall→$350 test locks the semantics.
3. **Live vault shape flagged (honesty).** `email_address` in the setup-token
   body is marked for Step-3 sandbox verification; live vaulting needs a
   buyer approval regardless, and all tests exercise replay.
4. **OpenAPI contract framing (honesty).** Wallet paths are labeled as the
   frozen Step-2 contract in `info.description`; only witness/checkout
   paths exist in Step 1.
5. **Benchmark timestamp churn reverted** (test-run artifact, not a change).
6. **`verify:e2e` deferred to Step 3** per the blueprint's step boundaries;
   workbench deltas are additive (one GET route + best-effort file unlink
   in reset) and covered by unit tests.

## 5. Verification output (Rule-1 gate, repo root, in order)

- `npm run lint` → exit 0 (after fixing 2 unused-var errors + 1 CliResult
  shape error in new code — no existing file touched for either).
- `npm run typecheck` → exit 0.
- `npm run build` → exit 0.
- `npm test` → exit 0, **223/223 passed** (15 files: 9 existing files
  byte-identical with all 189 prior tests green, 6 new v5 files with 34).
- Guardrails verified via git: `witness-client` + `term-extractor`
  byte-identical; 9 existing test files unmodified.

Commit: `feat(core,paypal,sdk,cli,mcp,workbench): implement v5 Step 1
partitioned agent wallet, QR pairing engine, payment sync, refunds, and
OpenAPI 3.1 spec`.
