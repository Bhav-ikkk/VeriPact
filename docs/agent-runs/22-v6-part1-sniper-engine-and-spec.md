# Agent Run 22 — VeriPact v6 Part 1: Omni-Sniper spec and SDK engine

**Date:** 2026-11-07  
**Status:** PASS (lint, typecheck, build, and `npm test`: 17 files, 250 tests)  
**Task:** Architecture spec plus the autonomous deal/voucher sniper (EC-1 through EC-7).

## What was built

1. `docs/architecture/VERIPACT_V6_OMNI_SNIPER_AND_UI_PLAN.md` — product thesis, the seven edge cases, and the 3-part backend plus 4-workspace UI plan. Part 1 only implements the spec and the SDK engine.
2. `packages/sdk/src/sniper.ts` — `runAutonomousDealSniper`. Six HTML fixtures are scanned with the real `scanMerchantHtml`, `extractObservedTerms`, `evaluateSufficiencyGate`, and `createWitnessSnapshot` (Channel3 cache from `benchmark/responses/channel3_catalog_cache.json`, labeled replay). The effective mandate cap is `min(mandate cap, targetMaxAllInUsd)` and is re-signed with the buyer key.
3. `VeriPactClient.runDealSniper` and re-exports from `@veripact/sdk`.
4. `packages/sdk/test/sniper.test.ts` — hermetic replay coverage for the default `$297` capture, the partition-wall re-run at `$53`, a `$250` target with no buy, `KANSO-Q35` at `$167`, refurbished `APEX-27-4K-IPS-RB` with `$0` spent, and invalid targets.

`packages/term-extractor` and `packages/witness-client` were not modified.

## Skills and subagents consulted

- `AGENTS.md` Rules 1–4 (gate, three-rung keys, epistemic honesty, this ledger).
- `.agents/subagents/01-core-crypto-referee.md` — witness snapshot and commitment stay on the WIT rung; the timestamp is existence-at-T only.
- `.agents/subagents/02-extractor-and-paypal.md` — extractor and PayPal client are called, not reimplemented. Freight void uses Orders v2 authorize, PATCH shipping/tax, and void. No mocked PayPal call was added to a live path.
- `.agents/subagents/03-sdk-cli-mcp.md` — domain sequencing lives in the SDK facade. CLI and MCP are Part 2 and were not changed.
- `.agents/skills/paypal-api-context/SKILL.md` — `custom_id` carries the `VP1:` commitment (max length 255; the commitment is 68 characters).
- `skills/veripact-witness/SKILL.md` — read for the external-agent contract. The skill file itself is updated when the CLI/MCP tool lands in Part 2, not in this run.

## Decisions

- Trap verdicts are whatever the real gate returns. The fixtures are written so that, at a `$300` target on `APEX-27-4K-IPS`, those gates produce EC-5, EC-3, EC-1, EC-2, and EC-4 in that order. A lower target can reclassify the freight page as over-cap before any PayPal call, because the base price already exceeds the cap. That is the gate, not a special case.
- EC-4 never captures. After the callback total is patched, `evaluatePostApprovalReGate` decides, and the authorization is voided. `$0` is captured.
- EC-6 / EC-7 call `executePartitionedAgentPayment({ scenarioId: 'normal', requestedOverrideUsd })` only after the sixth page's own witness passed. The order `custom_id` is that payment's `VP1:` commitment. For non-Apex SKUs the override amount is the catalog all-in; the pre-capture gate still witnessed that SKU's page. Binding the candidate receipt itself into `custom_id` needs a wallet API that accepts HTML, which is left for a later part and is called out in the architecture spec.
- A missing partition is created at the existing defaults (`$350` / `$320` per order / ask-human above `$300`) so a hunt has a balance to enforce. A second run reloads the same ledger file.
- `customVoucherCode` other than `PAYPAL50` applies a `$0` discount. Only `PAYPAL50` is the verified `$50` rebate.

## Verification

Commands from the repo root, portable Node on `PATH`, npm cache and userconfig pointed at the repo toolchain, `TEMP`/`TMP` at `.vitest-tmp`.

| Command | Exit |
|---|---|
| `npm run lint` | 0 (eslint, no findings) |
| `npm run typecheck` | 0 |
| `npm run build` | 0 |
| `npm test` | 0 — 17 files, 250 tests |

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

 ✓ packages/sdk/test/sdk.test.ts (27 tests) 2469ms
   ✓ @veripact/sdk regression suite > passes every scenario in a single pass with a diagonal confusion matrix  481ms
   ✓ @veripact/sdk regression suite > runs 3 passes and writes the committed 72-run report  1331ms
 ✓ packages/workbench/test/wallet-routes.test.ts (17 tests) 902ms
stderr | packages/workbench/test/workbench.test.ts > @veripact/workbench > honors per-request executionMode ('replay' vs 'live' vs invalid)
veripact: POST /api/merchant/checkout failed: paypal POST /v1/oauth2/token failed: HTTP 401 {"error":"invalid_client","error_description":"Client Authentication failed"}
PayPalHttpError: paypal POST /v1/oauth2/token failed: HTTP 401 {"error":"invalid_client","error_description":"Client Authentication failed"}
    at parseJsonResponse (D:\Bhavik\VerdiPact\packages\paypal-client\src\oauth.ts:95:11)
    at fetchAccessToken (D:\Bhavik\VerdiPact\packages\paypal-client\src\oauth.ts:310:20)
    at processTicksAndRejections (node:internal/process/task_queues:105:5)

 ✓ packages/workbench/test/workbench.test.ts (46 tests) 3556ms
   ✓ @veripact/workbench > serves real AG Grid vendor assets same-origin (never 404)  575ms
   ✓ @veripact/workbench > honors per-request executionMode ('replay' vs 'live' vs invalid)  1487ms
stderr | packages/workbench/test/security.test.ts > @veripact/workbench red team > carries dispute notes as data and enforces the 2000-char cap
veripact: POST /api/merchant/disputes/action failed: paypal: evidence notes must be <= 2000 chars
Error: paypal: evidence notes must be <= 2000 chars
    at provideDisputeEvidence (D:\Bhavik\VerdiPact\packages\paypal-client\src\disputes.ts:174:11)
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at handleDisputeAction (D:\Bhavik\VerdiPact\packages\workbench\src\routes.ts:2054:15)

 ✓ packages/term-extractor/test/term-extractor.test.ts (23 tests) 6254ms
   ✓ @veripact/term-extractor > survives 100k nested elements without hanging (nesting cap)  6196ms
 ✓ packages/workbench/test/security.test.ts (13 tests) 362ms
 ✓ packages/mcp-server/test/wallet-mcp.test.ts (3 tests) 143ms
 ✓ packages/witness-client/test/witness-client.test.ts (15 tests) 1471ms
   ✓ @veripact/witness-client > live timestamp mode always yields a verifiable anchor  1344ms
 ✓ packages/sdk/test/wallet.test.ts (8 tests) 499ms
 ✓ packages/mcp-server/test/mcp-server.test.ts (9 tests) 183ms
 ✓ packages/cli/test/cli.test.ts (10 tests) 188ms
 ✓ packages/paypal-client/test/paypal-client.test.ts (30 tests) 166ms
 ✓ packages/cli/test/wallet-cli.test.ts (4 tests) 113ms
 ✓ packages/sdk/test/sniper.test.ts (6 tests) 481ms
 ✓ packages/core/test/core.test.ts (20 tests) 107ms
 ✓ packages/core/test/wallet.test.ts (10 tests) 57ms
 ✓ packages/paypal-client/test/wallet-paypal.test.ts (7 tests) 31ms
 ✓ packages/workbench/test/openapi.test.ts (2 tests) 14ms

 Test Files  17 passed (17)
      Tests  250 passed (250)
   Start at  11:43:54
   Duration  12.46s (transform 2.43s, setup 0ms, collect 7.53s, tests 17.00s, environment 7ms, prepare 5.37s)
```

The stderr lines above are existing tests asserting malformed-key warnings, a rejected finalize, a deliberate live-mode 401, and the 2000-character dispute-note cap. They are not new failures.
