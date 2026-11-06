# Agent Run 21 — Enforce Channel3 SKU Sufficiency Gate on Partition Spend & Mount AG Grid 31 on Payment Sync

**Date:** 2026-11-06  
**Status:** PASS (Gate 0 across all 8 packages + 244 unit tests + 24 E2E checks + Live Browser DevTools Verified)  
**Task:** Atomic Task 7 — Enforce Channel3 SKU Gate on Partition Spend, Mount Real AG Grid 31 on Payment Sync, and Push 2 Atomic Commits.

---

## 1. What Was Done

1. **Enforce Channel3 SKU Witness & Sufficiency Gate in `POST /api/wallet/spend-check` (`packages/workbench/src/wallet-routes.ts` & `routes.ts`):**
   - Refactored `witnessSnapshotForSku(scenario, sku)` into an exported helper in `packages/workbench/src/routes.ts` so dynamic HTML storefront rendering and witness snapshot creation are shared between merchant checkout and wallet partition spend.
   - In `packages/workbench/src/wallet-routes.ts` (`handleSpendCheck`): when `dryRun !== true` and a non-default `sku` is passed (e.g. `APEX-27-4K-IPS-RB` refurbished or `NORTHLOOP-14-AIR` $899), witnesses the offer dynamically and evaluates the sufficiency gate under the effective mandate.
   - If `gateResult.decision === 'BLOCK'`, returns `200 OK` with `{ outcome: 'BLOCKED_PRE_CHECKOUT', reason: gateResult.reasons.join('; '), gateResult, snapshot, partition: wallet.getPartitionStatus(), sku }` — zero PayPal API calls, zero partition balance debit, and logs the blocked event in the clearing ledger.
   - Updated `partSpend()` in `packages/workbench/src/ui-template.ts` so `r.outcome === 'BLOCKED_PRE_CHECKOUT'` cleanly populates `#part-status` and `#checkout-outcome-banner` (`data-state="blocked"`) with the reason while leaving `#part-available` untouched.

2. **Mounted Real AG Grid 31 on Payment Sync (`packages/workbench/src/wallet-template.ts` & `ui-template.ts`):**
   - Added container `<div id="ag-sync-payments-grid" class="ag-theme-quartz" style="height: 360px; width: 100%; margin-bottom: 12px;"></div>` inside `#sync-shell` alongside `#sync-table-wrap`.
   - In `packages/workbench/src/ui-template.ts`, created `mountSyncGrid(records)` using `mountAg()` with 7 columns:
     - `Protection Class` (pinned left)
     - `Transaction / Order ID` (mono)
     - `Merchant & Item`
     - `Amount ($)`
     - `Status`
     - `Commitment (VP1)` (hash chip)
     - `Drift Risk / Terms`
   - Wired proper destroy/remount cleanup in `setDataset()`, `resetWalletUi()`, and enabled CSV export via `exportGridCsv()`.
   - Retained `#sync-body` fallback table and summary status line so guided tour and existing test assertions remain intact.

3. **Step 24 E2E in `scripts/verify-ui-e2e.ts`:**
   - Added E2E step 24: selects `APEX-27-4K-IPS-RB` &rarr; verifies `#gate-badge` shows `✕ BLOCKED` &rarr; clicks `#btn-part-spend` &rarr; asserts `BLOCKED_PRE_CHECKOUT` and `#part-available` stays at `$350.00` &rarr; selects `KANSO-Q35` &rarr; asserts gate passes (`ASK_HUMAN_DELTA`/`SUFFICIENT`) &rarr; clicks `#btn-checkout` &rarr; asserts capture at `$167.00` &rarr; clicks `#btn-reset` &rarr; asserts clean reset to default `APEX-27-4K-IPS`.
   - Updated test metrics across `README.md` and `docs/DEVPOST_SUBMISSION.md` to reflect 244 unit tests (16 files) and 24 E2E checks.

4. **Unit Tests Added (`packages/workbench/test/wallet-routes.test.ts`):**
   - Test 1: `blocks partition spend on refurbished SKU due to condition gate and keeps partition balance untouched` (`APEX-27-4K-IPS-RB` &rarr; `BLOCKED_PRE_CHECKOUT`, available remains `$350.00`).
   - Test 2: `captures compliant SKU (KANSO-Q35) on partition spend with exact amount $167.00` (`KANSO-Q35` &rarr; `CAPTURED`, available becomes `$183.00`).
   - Added `'ag-sync-payments-grid'` to the DOM first-paint verification test.

5. **Live DevTools Audit (Chrome DevTools MCP on `:3000`):**
   - Selected `APEX-27-4K-IPS-RB` &rarr; verified `✕ BLOCKED · condition conflict` badge &rarr; triggered `#btn-part-spend` &rarr; verified `#part-status` showed `BLOCKED_PRE_CHECKOUT — condition conflict: observed REFURBISHED but mandate requires NEW` and `#part-available` remained `$350.00`.
   - Switched to Dispute Desk &rarr; clicked `Payment Sync` &rarr; verified `#ag-sync-payments-grid` rendered AG Grid 31 with `.ag-theme-quartz`, 7 column headers, 10 payment rows, and 0 console errors.

---

## 2. Verification Commands & Outputs

| Gate / Command | Result | Details |
|---|---|---|
| `npm run lint` | **Code 0 (PASS)** | Clean across all 8 packages |
| `npm run typecheck` | **Code 0 (PASS)** | Strict TypeScript compilation verified |
| `npm run build` | **Code 0 (PASS)** | All packages built successfully |
| `npm test` | **Code 0 (PASS)** | **16 test files passed (16/16), 244 tests passed (244/244)** |
| `npm run verify:e2e` | **Code 0 (PASS)** | **24 E2E checks passed (zero 4xx/5xx, zero console errors, zero overflow)** |
| `npm run demo:record` | **Code 0 (PASS)** | 14 live screenshots + full `.webm` video generated |
| Live DevTools Audit | **PASS** | Refurbished spend blocked pre-checkout; partition untouched; AG Grid 31 mounted on payment sync; 0 console errors |
