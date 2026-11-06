# Agent Run 20 — End-to-End Channel3 Multi-SKU Checkout & Partition Settlement

**Date:** 2026-11-06  
**Status:** PASS (Gate 0 across all 8 packages + 242 tests + E2E + Live Browser Verified)  
**Task:** Atomic Task 6 — Wire Channel3 `sku` selection end-to-end into PayPal Checkout (`POST /api/merchant/checkout`) and Agentic Wallet Partition Spend (`POST /api/wallet/spend-check`).

---

## 1. What Was Done

1. **Backend Route Support for Optional `sku` in `handleMerchantCheckout` (`packages/workbench/src/routes.ts`):**
   - Read optional `sku` from request body (`const sku = typeof body.sku === 'string' && body.sku.trim() ? body.sku.trim() : undefined;`).
   - If `sku` is omitted or `sku === 'APEX-27-4K-IPS'`, executed the existing `client.runWitnessedCheckoutFlow(...)` path preserving 100% byte-identical behavior for default tests and flows.
   - If a non-default `sku` is supplied:
     - Looked up catalog product via `findCatalogProduct(sku)` from `benchmark/responses/channel3_catalog_cache.json`.
     - Rendered dynamic storefront HTML for `(scenario, sku)` via `renderStorefront(scenario, sku)`.
     - Created independent witness snapshot via `createWitnessSnapshot` with disk cache containing all 8 catalog products.
     - Evaluated Sufficiency Gate against effective mandate. If `gateResult.decision === 'BLOCK'` (e.g. `APEX-27-4K-IPS-RB` refurbished when mandate requires `NEW`, or `NORTHLOOP-14-AIR` at `$899.00 > $320.00` cap), returned `{ outcome: 'BLOCKED_PRE_CHECKOUT', snapshot, gateResult }` with 0 PayPal API calls!
     - If gate passed, computed dynamic totals (`basePriceUsd = product.priceUsd ?? 279`, `shippingUsd = 11.50`, `taxUsd = 6.50`) and executed PayPal order authorization, callback patch, re-gate, and exact capture.

2. **Backend Route Support for Optional `sku` in `POST /api/wallet/spend-check` (`packages/workbench/src/wallet-routes.ts`):**
   - Read optional `sku` from request body.
   - When non-default `sku` is passed, resolved all-in total (`(product.priceUsd ?? 279) + 11.50 + 6.50`) as `requestedOverrideUsd` into `wallet.executePartitionedAgentPayment({ scenarioId, requestedOverrideUsd })`.
   - Updated `packages/sdk/src/wallet.ts` so `itemTotalUsd` in `createAuthorizeOrder` and `patchOrderShippingAndTax` accurately respects `input.requestedOverrideUsd` when supplied, properly deducting the SKU's exact all-in price from the partition.

3. **Frontend UI Wiring in `packages/workbench/src/ui-template.ts`:**
   - In `runCheckoutFlow()`: passed `sku: state.sku || 'APEX-27-4K-IPS'` to `POST /api/merchant/checkout`.
   - In `partSpend()`: passed `sku: state.sku || 'APEX-27-4K-IPS'` to `POST /api/wallet/spend-check`.
   - Added reactive `updateSpendBtnLabel()` function updating `#btn-part-spend`'s label dynamically whenever `#channel3-sku-select` changes (e.g., `Agent Spend ($167 via Partition)` for `KANSO-Q35`, `Agent Spend ($237 via Partition)` for `APEX-27-4K-IPS-RB`, and `Agent Spend ($297 via Partition)` for default `APEX-27-4K-IPS`).
   - Ensured `state.sku` and select value reset to `'APEX-27-4K-IPS'` on `resetDemo()` and `runTour()`.

4. **Unit Tests Added (`packages/workbench/test/workbench.test.ts`):**
   - Test 1: `blocks refurbished Channel3 SKU pre-checkout with 0 PayPal orders created` (tested `sku: 'APEX-27-4K-IPS-RB'` &rarr; `BLOCKED_PRE_CHECKOUT`).
   - Test 2: `captures compliant non-default NEW Channel3 SKU under cap at exact price` (tested `sku: 'KANSO-Q35'` &rarr; `CAPTURED` at `$167.00`).

5. **Live Browser Verification (Chrome DevTools MCP on `:3000`):**
   - Selected `APEX-27-4K-IPS-RB` (refurbished) &rarr; verified `#btn-part-spend` updated to `$237` &rarr; clicked `Authorize with PayPal` &rarr; verified `Blocked Pre-Checkout (0 PayPal API calls)`.
   - Selected `KANSO-Q35` ($149 NEW) &rarr; verified `#btn-part-spend` updated to `$167` &rarr; clicked `Authorize with PayPal` &rarr; verified `Purchase Captured ($167.00)` on order `ORD-VP-0004` / capture `CAP-VP-0004`.
   - Tested partition spend on `KANSO-Q35` &rarr; verified partition available dropped from `$350.00` to `$183.00` (`CAPTURED $167.00`).
   - Clicked `Reset Demo` &rarr; verified clean reset to `APEX-27-4K-IPS` and `Agent Spend ($297 via Partition)`.
   - DevTools console inspection: 0 errors.

---

## 2. Verification Commands & Outputs

| Gate / Command | Result | Details |
|---|---|---|
| `npm run lint` | **Code 0 (PASS)** | Clean across all 8 packages |
| `npm run typecheck` | **Code 0 (PASS)** | Strict TypeScript compilation verified |
| `npm run build` | **Code 0 (PASS)** | All packages built successfully |
| `npm test` | **Code 0 (PASS)** | **16 test files passed (16/16), 242 tests passed (242/242)** |
| `npm run verify:e2e` | **Code 0 (PASS)** | All 23 E2E test steps passed (zero 4xx/5xx, zero console errors, zero overflow) |
| Live DevTools Audit | **PASS** | Refurbished SKU blocked pre-checkout; compliant SKU captured at exact $167.00 price; 0 console errors |
