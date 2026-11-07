# Agent Run 23 — VeriPact v6 Part 2: receipt binding, sniper route, CLI, MCP, OpenAPI

**Date:** 2026-11-07  
**Status:** PASS (lint, typecheck, build, and `npm test`: 17 files, 256 tests)  
**Task:** Bind the post-voucher witness snapshot into the PayPal order, and expose the deal sniper over HTTP, CLI, MCP, and OpenAPI 3.1.

## What was built

1. `executePartitionedAgentPayment` accepts optional `preWitnessedSnapshot` (`WitnessSnapshotOutput`: commitment, receiptCore, gateResult, term receipt). When it is set, the wallet does not re-witness `getScenario(scenarioId)` HTML. The PayPal `custom_id` and `WalletOrderRecord.receiptCore` are that snapshot. `scenarioId` stays optional and still defaults to `normal` for the shipping/tax callback (`$11.50` + `$6.50`).
2. Candidate 6 in `runAutonomousDealSniper` passes its own post-voucher snapshot into that call. For `APEX-27-4K-IPS` and `KANSO-Q35`, `winningCandidate.commitment`, the order `custom_id`, and `verifyOrderCommitmentReproducible(order)` agree.
3. `POST /api/wallet/sniper` validates SKU (`/^[A-Za-z0-9_-]{1,64}$/` and a Channel3 catalog hit), `targetMaxAllInUsd` (finite, 1 through 10000), and `customVoucherCode` (`/^[A-Za-z0-9_-]{1,32}$/`). It runs the sniper under `effectiveMandate('normal')`, appends ledger kind `wallet_sniper_sweep`, and returns the `DealSniperReport`. Other methods on that path return 405.
4. OpenAPI 3.1 at `GET /openapi.json` adds `POST /api/wallet/sniper`, `GET /api/catalog`, and schemas `DealSniperReport` and `SniperCandidateEvaluation`.
5. CLI `veripact wallet-sniper [--sku] [--target] [--voucher] [--json]`.
6. MCP `veripact_run_deal_sniper` on `WALLET_TOOLS`. `TOOLS` stays length 4, and `tools/list` still returns only those four. `skills/veripact-witness/SKILL.md` documents the command and the tool.

The field is typed `WitnessSnapshotOutput`, not the HTTP `SnapshotResult`. Only the witness output carries `commitment`, `receiptCore`, and `gateResult`. An RFC 3161 timestamp still proves the page hash existed at time T. It does not prove the voucher is true.

## Skills and subagents consulted

- `AGENTS.md` Rules 1–4.
- `.agents/subagents/03-sdk-cli-mcp.md` — CLI and MCP stay thin adapters. The skill file was updated in the same run as the new tool.
- `.agents/subagents/04-sequoia-ag-workbench.md` — the route is server-side. No PayPal secret is added to a browser bundle.
- `.agents/skills/paypal-api-context/SKILL.md` — `custom_id` max length 255; the `VP1:` commitment is 68 characters.
- `skills/veripact-witness/SKILL.md` — updated for `wallet-sniper` and `veripact_run_deal_sniper`.

## Decision

`packages/mcp-server/test/wallet-mcp.test.ts` locked `WALLET_TOOLS` to the previous three names. Adding `veripact_run_deal_sniper` required extending that expected list. `TOOLS` and the `tools/list` assertion in `mcp-server.test.ts` were not changed.

## Verification

| Command | Exit |
|---|---|
| `npm run lint` | 0 |
| `npm run typecheck` | 0 |
| `npm run build` | 0 |
| `npm test` | 0 — 17 files, 256 tests |

`npm test` (vitest section):

```
 RUN  v3.2.7 D:/Bhavik/VerdiPact

stderr | packages/sdk/test/sdk.test.ts > @veripact/sdk > falls back per-rung on partial or malformed keys (lenient)
veripact: ignoring malformed witness private key (expected 64 lowercase hex) — demo seed engaged
veripact: ignoring malformed witness private key (expected 64 lowercase hex) — demo seed engaged

stderr | packages/workbench/test/workbench.test.ts > @veripact/workbench > falls back to demo keys on malformed rung values (never 500)
veripact: ignoring malformed WITNESS_ED25519_PRIVATE_KEY (expected 64 lowercase hex) — demo seed engaged
veripact: ignoring malformed WITNESS_ED25519_PRIVATE_KEY (expected 64 lowercase hex) — demo seed engaged

stderr | packages/workbench/test/workbench.test.ts > @veripact/workbench > falls back to demo keys on malformed rung values (never 500)
veripact: ignoring malformed witness private key (expected 64 lowercase hex) — demo seed engaged

stderr | packages/workbench/test/workbench.test.ts > @veripact/workbench > finalize rejects echoed evidence bound to another order
veripact: POST /api/merchant/checkout/finalize failed: veripact: step-1 receipt does not match the order custom_id
Error: veripact: step-1 receipt does not match the order custom_id
    at VeriPactClient.completeApprovedCheckout (D:\Bhavik\VerdiPact\packages\sdk\src\client.ts:688:13)
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at handleCheckoutFinalize (D:\Bhavik\VerdiPact\packages\workbench\src\routes.ts:2269:18)

 ✓ packages/sdk/test/sdk.test.ts (27 tests) 2510ms
   ✓ @veripact/sdk regression suite > passes every scenario in a single pass with a diagonal confusion matrix  364ms
   ✓ @veripact/sdk regression suite > runs 3 passes and writes the committed 72-run report  1529ms
stderr | packages/workbench/test/workbench.test.ts > @veripact/workbench > honors per-request executionMode ('replay' vs 'live' vs invalid)
veripact: POST /api/merchant/checkout failed: paypal POST /v1/oauth2/token failed: HTTP 401 {"error":"invalid_client","error_description":"Client Authentication failed"}
PayPalHttpError: paypal POST /v1/oauth2/token failed: HTTP 401 {"error":"invalid_client","error_description":"Client Authentication failed"}
    at parseJsonResponse (D:\Bhavik\VerdiPact\packages\paypal-client\src\oauth.ts:95:11)
    at fetchAccessToken (D:\Bhavik\VerdiPact\packages\paypal-client\src\oauth.ts:310:20)
    at processTicksAndRejections (node:internal/process/task_queues:105:5)

 ✓ packages/workbench/test/workbench.test.ts (46 tests) 2469ms
   ✓ @veripact/workbench > honors per-request executionMode ('replay' vs 'live' vs invalid)  654ms
 ✓ packages/workbench/test/wallet-routes.test.ts (19 tests) 1523ms
 ✓ packages/witness-client/test/witness-client.test.ts (15 tests) 1255ms
   ✓ @veripact/witness-client > live timestamp mode always yields a verifiable anchor  1151ms
 ✓ packages/sdk/test/wallet.test.ts (8 tests) 335ms
 ✓ packages/term-extractor/test/term-extractor.test.ts (23 tests) 6764ms
   ✓ @veripact/term-extractor > survives 100k nested elements without hanging (nesting cap)  6691ms
 ✓ packages/sdk/test/sniper.test.ts (7 tests) 661ms
stderr | packages/workbench/test/security.test.ts > @veripact/workbench red team > carries dispute notes as data and enforces the 2000-char cap
veripact: POST /api/merchant/disputes/action failed: paypal: evidence notes must be <= 2000 chars
Error: paypal: evidence notes must be <= 2000 chars
    at provideDisputeEvidence (D:\Bhavik\VerdiPact\packages\paypal-client\src\disputes.ts:174:11)
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at handleDisputeAction (D:\Bhavik\VerdiPact\packages\workbench\src\routes.ts:2054:15)

 ✓ packages/cli/test/wallet-cli.test.ts (5 tests) 212ms
 ✓ packages/mcp-server/test/wallet-mcp.test.ts (4 tests) 334ms
 ✓ packages/workbench/test/security.test.ts (13 tests) 412ms
 ✓ packages/mcp-server/test/mcp-server.test.ts (9 tests) 214ms
 ✓ packages/cli/test/cli.test.ts (10 tests) 298ms
 ✓ packages/paypal-client/test/paypal-client.test.ts (30 tests) 192ms
 ✓ packages/core/test/wallet.test.ts (10 tests) 61ms
 ✓ packages/core/test/core.test.ts (20 tests) 129ms
 ✓ packages/paypal-client/test/wallet-paypal.test.ts (7 tests) 46ms
 ✓ packages/workbench/test/openapi.test.ts (3 tests) 18ms

 Test Files  17 passed (17)
      Tests  256 passed (256)
   Start at  12:02:32
   Duration  12.76s (transform 2.30s, setup 0ms, collect 7.17s, tests 17.43s, environment 7ms, prepare 6.18s)
```

The stderr lines are existing tests (malformed-key warnings, a rejected finalize, a deliberate live-mode 401, and the 2000-character dispute-note cap).
