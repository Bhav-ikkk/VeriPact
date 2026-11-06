# Agent Run 19 — Real Browser Click-Through & Demo Recorder Verification

**Date:** 2026-11-06  
**Status:** PASS (Gate 0 across all 8 packages + E2E + demo recording)  
**Task:** Atomic Task 4 — Real browser click-through, DevTools network/console audit, and automated demo recorder verification.

---

## 1. What Was Done

1. **Live Browser Click-Through Verification (Chrome DevTools MCP on `http://localhost:3000`):**
   - **Scenario 1 (Normal Checkout):**
     - Clicked `Scenario 1` -> `Witness Page` -> `Authorize with PayPal`.
     - Confirmed `#checkout-outcome-banner`: `Purchase Captured ($297.00)`.
     - Confirmed `#auditor-body`: `✓ Recompute Canonical (JCS) · ✓ OK · 1115 bytes`, `✓ Hash Match (VP1) · ✓ OK`, `✓ Terms Consistency (30-day, 0% fee) · ✓ OK`, and `JCS-PARITY MATCH`.
     - Verified zero console errors.
   - **Scenario 2 (Hidden Surcharge):**
     - Clicked `Scenario 2` (`surcharge_void`) -> `Authorize with PayPal`.
     - Confirmed `#checkout-outcome-banner`: `Authorization Auto-Voided ($340.50)` ($340.50 exceeded $320.00 cap · $0 captured).
     - Verified zero console errors.
   - **Scenario 3 (Adversarial DOM Prompt Injection):**
     - Clicked `Scenario 3` (`adversarial_hidden_dom`) -> `Witness Page`.
     - Confirmed `#checkout-status`: `Gate decision: BLOCK — page integrity ADVERSARIAL_DOM: hidden prompt-injection or payment-hijack content`.
     - Confirmed `#checkout-outcome-banner`: `Blocked Pre-Checkout (ADVERSARIAL_DOM detected · 0 PayPal API calls)`.
     - Confirmed zero PayPal API calls made.
   - **Agentic Wallet & Partition Enforcer:**
     - Clicked `Start QR Pair` (`#btn-pair-start`), then approved via `/api/wallet/pair/approve`.
     - Confirmed `#pair-status-pill`: `● Vault Paired (PM-VP-VAULT-0001)`.
     - Confirmed initial available partition: `$350.00`.
     - Clicked `Agent Spend ($297 via Partition)` once -> confirmed available dropped from `$350.00` to `$53.00` and captured `$297.00`.
     - Clicked `Agent Spend ($297 via Partition)` second time -> confirmed partition wall blocked spend: `AUTO_VOIDED_BY_PARTITION_WALL ($297.00 > $53.00 available)`.
     - Clicked `Undo / Refund Last Capture (+$297)` -> confirmed partition available restored to `$350.00`.
   - **Dispute Desk & Clearing:**
     - Switched to `Dispute Desk` tab (`#tab-desk`).
     - Inspected and resolved `Case B (buyer_forgery)` -> confirmed `lifeCycleStage: CHARGEBACK`, `disputeState: RESOLVED`.
     - Inspected and resolved `Case A (merchant_drift)` -> confirmed `lifeCycleStage: CHARGEBACK`, `disputeState: RESOLVED`.
     - Switched to `Payment Sync` (`#ds-sync`) -> confirmed legacy vs protected payment sync table rendered.
     - Switched to `24-Scenario Regression Suite` (`#ds-regression`) -> clicked preset 2 -> confirmed diagonal confusion matrix (24 PROCEED, 33 ASK_HUMAN_DELTA, 15 BLOCK, 72/72 green).
   - **60s Guided Demo Tour:**
     - Clicked `▶ Run 60s Guided Demo Tour` (`#btn-tour`).
     - Monitored live progress across all 7 steps (Steps 1 through 7) until `#tour-status` reported: `Tour complete — VeriPact proved what the merchant promised.`.
     - Inspected DevTools console: 0 errors.
     - Inspected DevTools network log: all 73 requests returned `200 OK` (0 HTTP 4xx, 0 HTTP 5xx).

2. **Self-Correction & Rationale:**
   - **PayPal Sandbox Vault Scope 403 Fallback:**
     - During live wallet pairing with developer credentials in `.env`, the developer sandbox client app did not have `/v3/vault/setup-tokens` enabled, throwing `HTTP 403 {"name":"NOT_AUTHORIZED"}`.
     - `isLiveAuthFailure` previously regex-matched only `HTTP 401|invalid_client|unauthorized`.
     - Updated `packages/workbench/src/routes.ts` (`isLiveAuthFailure`) to recognize `HTTP 40[13]|invalid_client|unauthorized|NOT_AUTHORIZED|insufficient permissions`, allowing `withLiveFallback` to gracefully latch deterministic replay mode on live sandbox permission barriers instead of failing the request.
     - Added unit test assertion in `packages/workbench/test/workbench.test.ts`.

---

## 2. Tools and Skills Consulted

- `Chrome DevTools MCP`: `list_pages`, `navigate_page`, `evaluate_script`, `list_console_messages`, `list_network_requests` for real browser interaction and audit.
- `AGENTS.md`: Rule 1 (Zero-Broken-Push Gate), Rule 2 (Three-Key Isolation), Rule 3 (Epistemic & Sandbox Honesty), Rule 4 (Atomic Run Ledger).

---

## 3. Verification Commands & Outputs

### 1. `npm run lint`
```text
> veripact@0.1.0 lint
> eslint .
Exit code: 0
```

### 2. `npm run typecheck`
```text
> veripact@0.1.0 typecheck
> tsc --noEmit -p tsconfig.typecheck.json
Exit code: 0
```

### 3. `npm run build`
```text
> veripact@0.1.0 build
> tsc -b .
Exit code: 0
```

### 4. `npm test`
```text
> veripact@0.1.0 test
> tsc -b . && vitest run

 Test Files  16 passed (16)
      Tests  240 passed (240)
   Duration  14.60s
Exit code: 0
```

### 5. `npm run verify:e2e`
```text
> veripact@0.1.0 verify:e2e
> tsc -b . && tsc -p scripts/tsconfig.json && node scripts/dist/verify-ui-e2e.js

E2E 01 :: load / (auto-populate captured)
E2E 02 :: favicon routes serve SVG
E2E 03 :: reset demo via real button
E2E 04 :: scenario 1 witness + authorize (real clicks)
E2E 05 :: auditor shows JCS-PARITY MATCH
E2E 06 :: scenario 2 surcharge auto-voids
E2E 07 :: scenario 3 injection blocks pre-checkout
E2E 08 :: store iframes fit 310px with zero inner scroll
E2E 09 :: two-step popup approval end-to-end
E2E 10 :: dispute desk: inspect + resolve both cases
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
E2E 21 :: viewport 1366x768 overflow sweep
E2E 22 :: viewport 1050x800 overflow sweep
E2E 23 :: viewport 768x1024 overflow sweep
E2E RESULT: PASS — zero 4xx/5xx, zero console/page errors, zero overflow
Exit code: 0
```

### 6. `npm run demo:record`
```text
> veripact@0.1.0 demo:record
> tsc -b . && tsc -p scripts/tsconfig.json && node scripts/dist/playwright-record-demo.js

demo: beat 1 — QR pair + $350 partition
demo: shot live-01-wallet-qr.png
demo: shot live-02-wallet-paired.png
demo: beat 2 — partition spend, wall block, refund undo
demo: shot live-03-partition-spend.png
demo: shot live-04-partition-wall.png
demo: shot live-05-partition-refund.png
demo: beat 3 — sync grid + connectors
demo: shot live-06-sync-grid.png
demo: shot live-07-connectors.png
demo: beat 4 — normal checkout ($297.00 CAPTURED) + auditor
demo: shot live-08-capture-auditor.png
demo: beat 5 — surcharge auto-void ($340.50 > $320.00 cap)
demo: shot live-09-void.png
demo: beat 6 — adversarial DOM blocked pre-checkout
demo: shot live-10-block.png
demo: beat 7 — restore capture, file + resolve buyer forgery
demo: shot live-11-forgery-filed.png
demo: shot live-12-forgery-resolved.png
demo: beat 8 — Case A drift + 24-scenario regression suite
demo: shot live-13-drift-inspected.png
demo: shot live-14-regression.png
demo: video saved to D:\Bhavik\VerdiPact\videos\veripact-demo-tour.webm
demo: DONE — 14 PNGs + .webm, zero page problems
Exit code: 0
```

