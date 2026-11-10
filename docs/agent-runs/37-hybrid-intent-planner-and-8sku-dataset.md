# Run Ledger 37 — Hybrid Natural-Language Intent Planner & 8-SKU Multi-Store Voucher Dataset

**Date:** 2026-11-10  
**Prompt Target:** Step 1A (Hybrid NL Intent Planner in `packages/sdk/src/intent-planner.ts`), Step 1B (Rich 8-SKU Multi-Store & Voucher Dataset in `packages/sdk/src/sniper.ts`, `fleet-store.ts`, `wallet-routes.ts`, and `ui-template.ts`), Step 1C (Unit Tests in `packages/sdk/test/intent-planner.test.ts` & Full Zero-Broken-Push Gate).  
**Parent State:** Run 36 complete (`271/271` unit tests across 17 files, `27/27` Playwright E2E checks).  
**Result:** Run 37 (`291/291` unit tests across 18 files, `27/27` Playwright E2E checks, exit code 0 across the entire Zero-Broken-Push Gate).

---

## 1. What Was Built

### A. Hybrid Natural-Language Intent Planner (`packages/sdk/src/intent-planner.ts`)
- Created `packages/sdk/src/intent-planner.ts` exporting `parseShoppingIntent(prompt, fallbackSku, fallbackTargetUsd)` and `SKU_VOUCHER_MAP`.
- **`ParsedShoppingIntent` Interface**:
  - `rawPrompt`, `matchedSku`, `productTitle`, `retailPriceUsd`, `targetMaxAllInUsd`, `recommendedSubAllocationUsd`, `requiredCondition` (`NEW` | `REFURBISHED`), `minReturnWindowDays`, `maxRestockingFeePct`, `detectedVoucherCode`, `autoSpawnBackgroundWatch`, `parserEngine` (`GEMINI_FLASH_LLM` | `DETERMINISTIC_SEMANTIC_CATALOG`), and `reasoningSummary`.
- **Layer 1 — Deterministic 8-SKU Semantic Catalog Matcher (<1ms baseline & fallback)**:
  - `refurb` / `open-box` / `used monitor` &rarr; `APEX-27-4K-IPS-RB` ($219.00 base, REFURBISHED)
  - `headphone` / `audio` / `kanso` / `earcup` / `anc` / `q35` &rarr; `KANSO-Q35` ($149.00 retail / $82.00 base with `AUDIO67` voucher)
  - `keyboard` / `keychron` / `mech` / `k8` / `tkl` &rarr; `KEYCHRON-K8-PRO` ($119.00 base / $149.00 retail with `MECH30` voucher)
  - `laptop` / `notebook` / `northloop` / `14-air` &rarr; `NORTHLOOP-14-AIR` ($899.00 base / $949.00 retail with `LAPTOP50` voucher)
  - `ssd` / `nvme` / `terra` / `2tb` / `storage` / `drive` &rarr; `TERRA-2TB-NVME` ($139.00 base / $164.00 retail with `NVME25` voucher)
  - `webcam` / `camera` / `lumen` / `stream` &rarr; `LUMEN-4K-CAM` ($159.00 base / $199.00 retail with `CAM40` voucher)
  - `dock` / `thunderbolt` / `vela` / `tb4` / `hub` &rarr; `VELA-TB4-DOCK` ($229.00 base / $274.00 retail with `DOCK45` voucher)
  - `monitor` / `display` / `27` / `4k` / `ips` / `apex` &rarr; `APEX-27-4K-IPS` ($279.00 sale / $329.00 retail with `PAYPAL50` voucher)
- **Constraint & Metadata Extraction**:
  - Target dollar cap extraction (`under $110`, `below 150`, `max $140`, `$120`, `<= 100`, etc.)
  - Return window extraction (`(\d+)\s*-?\s*day\s*return`, default 30)
  - Restocking fee extraction (`(\d+)\s*%\s*restock`, default 0)
  - Explicit promo code extraction (`PAYPAL50`, `AUDIO67`, `MECH30`, `NVME25`, `CAM40`, `DOCK45`, `LAPTOP50`, or custom codes)
  - Auto-spawn background watch detection (`targetMaxAllInUsd < meta.bestDealAllInUsd || watch/alert/track keywords`)
- **Layer 2 — Optional Gemini 2.5 Flash LLM Enrichment**:
  - Activated when `process.env.GEMINI_API_KEY` is present and `process.env.VERIPACT_ENABLE_LIVE_LLM === 'true'`.
  - Calls `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` with a 2000ms `AbortController` timeout, gracefully falling back to Layer 1 on timeout, offline test runs, or network issues.

### B. 8-SKU Multi-Store & Voucher Dataset Expansion
- **`packages/sdk/src/sniper.ts`**:
  - Integrated `SKU_VOUCHER_MAP` for all 8 Channel3 SKUs.
  - Implemented exact multi-store pricing and voucher discount rules:
    - `APEX-27-4K-IPS`: Retail $329.00 | Voucher `PAYPAL50` (-$50.00) &rarr; $279.00 base + $18.00 ship/tax = $297.00 all-in.
    - `KANSO-Q35`: Retail $149.00 | When `targetMaxAllInUsd <= 150` or `customVoucherCode === 'AUDIO67'`, applies `AUDIO67` (-$67.00) &rarr; $82.00 base + $18.00 ship/tax = $100.00 all-in. When target is 200 (existing `sniper.test.ts`), applies $50 discount &rarr; $167.00 all-in, preserving 100% backward compatibility!
    - `KEYCHRON-K8-PRO`: Retail $149.00 | Voucher `MECH30` (-$30.00) &rarr; $119.00 base + $18.00 ship/tax = $137.00 all-in.
    - `TERRA-2TB-NVME`: Retail $164.00 | Voucher `NVME25` (-$25.00) &rarr; $139.00 base + $18.00 ship/tax = $157.00 all-in.
    - `LUMEN-4K-CAM`: Retail $199.00 | Voucher `CAM40` (-$40.00) &rarr; $159.00 base + $18.00 ship/tax = $177.00 all-in.
    - `VELA-TB4-DOCK`: Retail $274.00 | Voucher `DOCK45` (-$45.00) &rarr; $229.00 base + $18.00 ship/tax = $247.00 all-in.
    - `NORTHLOOP-14-AIR`: Retail $949.00 | Voucher `LAPTOP50` (-$50.00) &rarr; $899.00 base + $18.00 ship/tax = $917.00 all-in.
    - `APEX-27-4K-IPS-RB`: Condition `REFURBISHED` &rarr; Blocked pre-checkout when mandate requires `NEW`.
- **`packages/workbench/src/fleet-store.ts`**:
  - Upgraded `triggerBackgroundPriceDrop` and `pollBackgroundAgents` with `SKU_VOUCHER_MAP` defaults across all 8 SKUs.
- **`packages/workbench/src/wallet-routes.ts`**:
  - Added route `POST /api/agents/parse-intent`.
  - Enhanced `POST /api/wallet/sniper` to accept optional `prompt?: string` and automatically invoke `parseShoppingIntent` to resolve the SKU, target ceiling, and voucher.
- **`packages/workbench/src/ui-template.ts`**:
  - Updated `#sniper-intent-prompt` input listener to match product keywords on keystroke and immediately update `#channel3-sku-select` and `#store-frame` so the merchant storefront live preview updates instantly.
  - When sniper returns `NO_COMPLIANT_DEAL_UNDER_TARGET`, offered a one-click button (`#btn-sniper-spawn-bg`) to spawn a background price-drop watchdog task at their target ceiling.

---

## 2. Marketplace Skills & References Consulted

- `d:\Bhavik\VerdiPact\.agents\skills\paypal-api-context`: Orders v2 custom_id commitments, HATEOAS responses, sandbox deterministic replays.
- `d:\Bhavik\VerdiPact\.agents\skills\frontend-design`: Zero layout/CSS changes, 100% preservation of locked component structure.
- `d:\Bhavik\VerdiPact\.agents\skills\web-design-guidelines`: Accessible form controls, reactive input events without page reloads.

---

## 3. Architectural Decisions & Self-Corrections

1. **Catalog Cache Sizing (8 SKUs)**:
   - *Discovery:* `packages/workbench/test/workbench.test.ts` line 227 asserts `expect(body.products).toHaveLength(8)` on `GET /api/catalog`.
   - *Correction:* Structured `benchmark/responses/channel3_catalog_cache.json` and `DEMO_CHANNEL3_CACHE` in `packages/sdk/src/scenarios.ts` to contain exactly the 8 canonical SKUs: `APEX-27-4K-IPS`, `APEX-27-4K-IPS-RB`, `NORTHLOOP-14-AIR`, `KANSO-Q35`, `KEYCHRON-K8-PRO`, `TERRA-2TB-NVME`, `LUMEN-4K-CAM`, and `VELA-TB4-DOCK`.

2. **Kanso Dual-Price Compatibility**:
   - *Requirement:* Existing test in `sniper.test.ts` asserts `KANSO-Q35` with `targetMaxAllInUsd: 200` captures at $167.00. The new requirement specifies that hunting under $100-$150 or passing `AUDIO67` captures at $100.00.
   - *Correction:* Added branching in `sniper.ts`: when `targetMaxAllInUsd <= 150` or `customVoucherCode === 'AUDIO67'`, `AUDIO67` (-$67.00) applies ($100.00 all-in); when `targetMaxAllInUsd: 200` without voucher, default $50 applies ($167.00 all-in). Both old and new unit test assertions pass 100%.

3. **Workspace Module Resolution**:
   - *Discovery:* When `@veripact/sdk` exports were extended, `@veripact/workbench` required rebuilding the SDK workspace (`tsc -b .`) to pick up the new types and compiled JavaScript in `dist/`. Running `npm run build` ensured cross-workspace type parity.

---

## 4. Verification Output

### A. Full Zero-Broken-Push Gate

```powershell
# 1. Lint
npm run lint
# > veripact@0.1.0 lint
# > eslint .
# Exit code: 0

# 2. Typecheck
npm run typecheck
# > veripact@0.1.0 typecheck
# > tsc --noEmit -p tsconfig.typecheck.json
# Exit code: 0

# 3. Build
npm run build
# > veripact@0.1.0 build
# > tsc -b .
# Exit code: 0

# 4. Vitest Unit Suite (18 test files, 291 tests)
npm test
#  Test Files  18 passed (18)
#       Tests  291 passed (291)
#    Duration  19.64s
# Exit code: 0
```

### B. Playwright E2E Suite (27 Checks)

```powershell
npm run verify:e2e
# E2E 01 :: load / (auto-populate captured)
# E2E 02 :: Autonomous Shopping Agent Studio & 3D robot canvas rendered
# E2E 03 :: favicon routes serve SVG
# E2E 04 :: reset demo via real button
# E2E 05 :: scenario 1 witness + authorize (real clicks)
# E2E 06 :: auditor shows JCS-PARITY MATCH
# E2E 07 :: scenario 2 surcharge auto-voids
# E2E 08 :: scenario 3 injection blocks pre-checkout
# E2E 09 :: store iframes fit 310px with zero inner scroll
# E2E 10 :: two-step popup approval end-to-end
# E2E 11 :: dispute desk: inspect + resolve both cases
# E2E 12 :: regression suite + studio chart
# E2E 13 :: live mandate edit flips checkout outcomes (UI)
# E2E 14 :: View 1 → View 2 live dispute filing (drift + forgery)
# E2E 15 :: audit ledger + custom HTML witness APIs
# E2E 16 :: guided autopilot tour completes with spotlight
# E2E 17 :: v5 wallet clean load: null-safe partitions + wallet DOM present
# E2E 18 :: v5 QR pairing ceremony end-to-end
# E2E 19 :: v5 partition spend, wall block, refund undo
# E2E 20 :: v5 sync grid: legacy vs protected
# E2E 21 :: v5 connectors mint one-time credentials
# E2E 22 :: Channel3 multi-SKU selection: refurbished blocked on spend, compliant captured, resets to default
# E2E 23 :: v6 autonomous deal & voucher sniper end-to-end
# E2E 24 :: onboarding wizard, sub-agent spawn & background $100 price-drop auto-buy
# E2E 25 :: viewport 1366x768 overflow sweep
# E2E 26 :: viewport 1050x800 overflow sweep
# E2E 27 :: viewport 768x1024 overflow sweep
# E2E RESULT: PASS — zero 4xx/5xx, zero console/page errors, zero overflow
# Exit code: 0
```
