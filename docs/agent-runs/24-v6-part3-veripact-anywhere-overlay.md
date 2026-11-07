# Agent Run 24 — VeriPact v6 Part 3: `@veripact` Anywhere overlay

**Date:** 2026-11-07  
**Status:** PASS (lint, typecheck, build, `npm test` 17 files / 257 tests, `npm run verify:e2e` 24 checks)  
**Task:** Serve a shadow-DOM intent catcher at `GET /embed/veripact-anywhere.js` and embed it on every synthetic storefront.

## What was built

1. `packages/workbench/src/anywhere-script.ts` exports `renderAnywhereScript()`. The script is an IIFE. Every listener takes an explicit `function(e)` parameter. A fixed host `#veripact-anywhere-host` (`position:fixed;bottom:8px;right:8px;z-index:2147483647;pointer-events:none`) holds an open shadow root so the pill and command bar do not add document height.
2. Three triggers open `#vp-anywhere-modal`: typing `@veripact` in a host `<input>` or `<textarea>`, `Alt+V` or `Ctrl+Shift+V`, and the 26px pill `#vp-anywhere-pill` (`@veripact · Snipe & Witness (Alt+V)`).
3. `#vp-intent-run` posts `{ sku, targetMaxAllInUsd }` to `POST /api/wallet/sniper`. The SKU comes from `?sku=` or page text, defaulting to `APEX-27-4K-IPS`. A `$NNN` in the intent box is the target (default `$300`). Dynamic strings go through a local `esc()`. Rejected rows render as crimson pills. A `VERIFIED_VOUCHER_CAPTURED` row renders the voucher, `-$50.00`, the all-in total, and the `VP1:` commitment in emerald. The overlay states that a VP1 commitment proves the receipt hash existed at time T and does not prove the page was true.
4. On success the iframe posts `{ type: 'VERIPACT_SNIPER_COMPLETED', report }` to `window.parent` with `window.location.origin`. The workbench message listener paints `partitionAfter` on the partition bar and the winning order, capture, and commitment on the transaction record.
5. `GET /embed/veripact-anywhere.js` returns `application/javascript; charset=utf-8` and `Cache-Control: public, max-age=3600` plus the standard security headers. Other methods on that path return 405. Every `/store/:scenarioId` page loads the script with `defer` immediately before `</body>`.

## Skills consulted

- `.agents/skills/security-audit/skills/security-audit/CLIENT-SIDE.md` — dynamic overlay text is escaped before `innerHTML`. `postMessage` uses the page origin, not `*`. The script does not read storage or secrets.
- `.agents/skills/emilkowalski-skill/skills/break-ui/SKILL.md` — the pill is a fixed 26px control. Long verdicts stay in wrapping rows inside a `max-height` modal so a long `VP1:` commitment cannot stretch the store iframe.
- `scripts/verify-ui-e2e.ts` — store iframe invariant is `scrollHeight <= 312`. Measured height after this change is 310 on all three scenarios at 1600, 1366, 1050, and 768.

## Decision

The parent partition and transaction update lives in `packages/workbench/src/ui-template.ts`, next to the existing `VERIPACT_ORDER_APPROVED` listener. The embed script only posts the message. Without the listener the workbench would not refresh after a hunt started inside `#store-frame`.

## Verification

`npm test` (257 passed):

```
> veripact@0.1.0 test
> tsc -b . && vitest run


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
    at handleCheckoutFinalize (D:\Bhavik\VerdiPact\packages\workbench\src\routes.ts:2280:18)

 ✓ packages/sdk/test/sdk.test.ts (27 tests) 2258ms
   ✓ @veripact/sdk regression suite > passes every scenario in a single pass with a diagonal confusion matrix  414ms
   ✓ @veripact/sdk regression suite > runs 3 passes and writes the committed 72-run report  1258ms
stderr | packages/workbench/test/workbench.test.ts > @veripact/workbench > honors per-request executionMode ('replay' vs 'live' vs invalid)
veripact: POST /api/merchant/checkout failed: paypal POST /v1/oauth2/token failed: HTTP 401 {"error":"invalid_client","error_description":"Client Authentication failed"}
PayPalHttpError: paypal POST /v1/oauth2/token failed: HTTP 401 {"error":"invalid_client","error_description":"Client Authentication failed"}
    at parseJsonResponse (D:\Bhavik\VerdiPact\packages\paypal-client\src\oauth.ts:95:11)
    at fetchAccessToken (D:\Bhavik\VerdiPact\packages\paypal-client\src\oauth.ts:310:20)
    at processTicksAndRejections (node:internal/process/task_queues:105:5)

 ✓ packages/witness-client/test/witness-client.test.ts (15 tests) 1215ms
   ✓ @veripact/witness-client > live timestamp mode always yields a verifiable anchor  1119ms
 ✓ packages/workbench/test/workbench.test.ts (46 tests) 3808ms
   ✓ @veripact/workbench > serves real AG Grid vendor assets same-origin (never 404)  580ms
   ✓ @veripact/workbench > honors per-request executionMode ('replay' vs 'live' vs invalid)  1414ms
 ✓ packages/term-extractor/test/term-extractor.test.ts (23 tests) 5658ms
   ✓ @veripact/term-extractor > survives 100k nested elements without hanging (nesting cap)  5576ms
 ✓ packages/sdk/test/sniper.test.ts (7 tests) 837ms
stderr | packages/workbench/test/security.test.ts > @veripact/workbench red team > carries dispute notes as data and enforces the 2000-char cap
veripact: POST /api/merchant/disputes/action failed: paypal: evidence notes must be <= 2000 chars
Error: paypal: evidence notes must be <= 2000 chars
    at provideDisputeEvidence (D:\Bhavik\VerdiPact\packages\paypal-client\src\disputes.ts:174:11)
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at handleDisputeAction (D:\Bhavik\VerdiPact\packages\workbench\src\routes.ts:2065:15)

 ✓ packages/workbench/test/security.test.ts (13 tests) 554ms
 ✓ packages/workbench/test/wallet-routes.test.ts (20 tests) 2067ms
 ✓ packages/sdk/test/wallet.test.ts (8 tests) 484ms
 ✓ packages/mcp-server/test/wallet-mcp.test.ts (4 tests) 244ms
 ✓ packages/cli/test/cli.test.ts (10 tests) 245ms
 ✓ packages/mcp-server/test/mcp-server.test.ts (9 tests) 217ms
 ✓ packages/cli/test/wallet-cli.test.ts (5 tests) 255ms
 ✓ packages/core/test/core.test.ts (20 tests) 145ms
 ✓ packages/core/test/wallet.test.ts (10 tests) 85ms
 ✓ packages/paypal-client/test/paypal-client.test.ts (30 tests) 122ms
 ✓ packages/paypal-client/test/wallet-paypal.test.ts (7 tests) 45ms
 ✓ packages/workbench/test/openapi.test.ts (3 tests) 29ms

 Test Files  17 passed (17)
      Tests  257 passed (257)
   Start at  12:17:29
   Duration  14.54s (transform 2.67s, setup 0ms, collect 8.46s, tests 18.27s, environment 7ms, prepare 6.53s)
```

`npm run verify:e2e`:

```
> veripact@0.1.0 verify:e2e
> tsc -b . && tsc -p scripts/tsconfig.json && node scripts/dist/verify-ui-e2e.js

E2E 01 :: load / (auto-populate captured)
  view1@1600: scrollWidth=1600 clientWidth=1600
E2E 02 :: favicon routes serve SVG
E2E 03 :: reset demo via real button
E2E 04 :: scenario 1 witness + authorize (real clicks)
E2E 05 :: auditor shows JCS-PARITY MATCH
E2E 06 :: scenario 2 surcharge auto-voids
E2E 07 :: scenario 3 injection blocks pre-checkout
E2E 08 :: store iframes fit 310px with zero inner scroll
  store/normal: scrollHeight=310 scrollWidth=708 clientWidth=708
  store/surcharge_void: scrollHeight=310 scrollWidth=708 clientWidth=708
  store/adversarial_hidden_dom: scrollHeight=310 scrollWidth=708 clientWidth=708
E2E 09 :: two-step popup approval end-to-end
E2E 10 :: dispute desk: inspect + resolve both cases
  view2@1600: scrollWidth=1600 clientWidth=1600
E2E 11 :: regression suite + studio chart
E2E 12 :: live mandate edit flips checkout outcomes (UI)
E2E 13 :: View 1 → View 2 live dispute filing (drift + forgery)
E2E 14 :: audit ledger + custom HTML witness APIs
E2E 15 :: guided autopilot tour completes with spotlight
E2E 16 :: v5 wallet clean load: null-safe partitions + wallet DOM present
E2E 17 :: v5 QR pairing ceremony end-to-end
E2E 18 :: v5 partition spend, wall block, refund undo
E2E 19 :: v5 sync grid: legacy vs protected
E2E 20 :: v5 connectors mint one-time credentials
E2E 21 :: Channel3 multi-SKU selection: refurbished blocked on spend, compliant captured, resets to default
E2E 22 :: viewport 1366x768 overflow sweep
  view1@1366: scrollWidth=1366 clientWidth=1366
  view2@1366: scrollWidth=1366 clientWidth=1366
  store/normal: scrollHeight=310 scrollWidth=611 clientWidth=611
  store/surcharge_void: scrollHeight=310 scrollWidth=611 clientWidth=611
  store/adversarial_hidden_dom: scrollHeight=310 scrollWidth=611 clientWidth=611
E2E 23 :: viewport 1050x800 overflow sweep
  view1@1050: scrollWidth=1050 clientWidth=1050
  view2@1050: scrollWidth=1050 clientWidth=1050
  store/normal: scrollHeight=310 scrollWidth=467 clientWidth=467
  store/surcharge_void: scrollHeight=310 scrollWidth=467 clientWidth=467
  store/adversarial_hidden_dom: scrollHeight=310 scrollWidth=467 clientWidth=467
E2E 24 :: viewport 768x1024 overflow sweep
  view1@768: scrollWidth=768 clientWidth=768
  view2@768: scrollWidth=768 clientWidth=768
  store/normal: scrollHeight=310 scrollWidth=712 clientWidth=712
  store/surcharge_void: scrollHeight=310 scrollWidth=712 clientWidth=712
  store/adversarial_hidden_dom: scrollHeight=310 scrollWidth=712 clientWidth=712
E2E RESULT: PASS — zero 4xx/5xx, zero console/page errors, zero overflow
```
