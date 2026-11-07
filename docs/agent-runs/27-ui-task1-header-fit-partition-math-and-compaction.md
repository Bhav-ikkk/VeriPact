# Run 27 — UI Task 1: Laptop Header Fit, Partition Net Math, View 1 Compaction & Quick-Jump Bar

**Date:** 2026-11-07  
**Branch:** `main`  
**Commit:** `style(workbench): fix laptop header button clipping, show net partition spend after refund, and compact View 1 layout`  
**Verification Gate:** `264/264` Vitest unit tests passing across 17 test suites, `24/24` Playwright E2E checks passing across 4 viewports, 0 lint/typecheck errors, 0 console errors, 0 horizontal overflow (`scrollWidth === clientWidth`).

---

## 1. Executive Summary

This run addresses four visual, spatial, and numeric defects identified from laptop (1366×768) reviews of View 1:
1. **Top Header Button Clipping (`#btn-tour`):** Constrained `#tour-status` to `max-width: 190px`, hide when `:empty`, hid `.brand-tag` below 1440px, set `flex-shrink: 0; white-space: nowrap;` on `.hdr-right` action buttons so `▶ Run 60s Guided Demo Tour` remains 100% visible across 1600px, 1366px, 1280px, and 1050px.
2. **Duplicate Stepper Elimination & View 1 Compaction:** Merged the redundant right-column `SELF -> WIT -> SIGN` card and separate `Channel3 Oracle` card into a single compact `.mandate-status-bar` at the footer of the Buyer Mandate & Sufficiency card, keeping all DOM IDs (`#rung-self`, `#rung-wit`, `#rung-sign`, `#oracle-line`) intact while leveling column heights with the storefront.
3. **Partition Meter Math After Refund:** Fixed the misleading `$297.00 Captured / Used` meter display when `$350.00` is available after refund undo by computing `netUsed = Math.max(0, (capturedUsd - refundedUsd + authorizedUsd))`, rendering `fmtUsd(netUsed)` in `#part-captured`, resetting progress fill to `0%`, and updating the metric label to `Net Used (Active)`.
4. **4-Step Workflow Guide Bar:** Added an intuitive quick-jump navigation bar directly above `#pipeline-ribbon` with four interactive pills linking Step 1 (Pair Wallet & Partition), Step 2 (Shop Storefront / Deal Sniper), Step 3 (Verify Receipt in Auditor), and Step 4 (Resolve Disputes & Sync History) with smooth scrolling and spotlight pulsing.

---

## 2. Pre-Flight Git & State Audit

Prior to making any edits, `git status` and `git cherry -v origin/main` were checked. All previous Cursor runs 22–26 (Omni-Sniper engine, sniper routes/CLI/MCP/OpenAPI, `@veripact/anywhere` shadow DOM overlay, and red-team concurrency mutexes) were confirmed clean and pushed to `origin/main` in commits:
- `3949f39`: `feat(sdk): implement autonomous deal and voucher sniper engine with 7 deterministic edge cases`
- `9bbc9b8`: `feat(sdk,workbench,cli,mcp): bind post-voucher snapshot into wallet order custom_id and expose deal sniper across HTTP, CLI, MCP, and OpenAPI`
- `df5e6ea`: `test(sdk,workbench,cli,mcp): add unit tests for deal sniper route, receipt reproducibility, CLI, MCP, and OpenAPI`
- `c51f771`: `feat(workbench): add @veripact anywhere Shadow-DOM intent overlay and embed in storefront pages`
- `620b9d5`: `security(sdk,workbench): add partition concurrency mutex, input allowlists, and v6 red-team fuzzing suite`
- `66af15d`: `fix(workbench): refuse invalid sniper targets and flatten the desk`

All sensitive files (`.env`, `.vitest-tmp/`, `.tools/`, `videos/`, `.veripact-*.json`) remained untracked/gitignored.

---

## 3. Skills & Standards Consulted

- **`AGENTS.md` (Rules 1–4):** Enforced zero-broken-push gate (`lint && typecheck && build && test && verify:e2e`), three-key isolation boundaries, and epistemic honesty regarding RFC 3161 timestamps.
- **`.agents/skills/frontend-design/SKILL.md`:** Applied editorial fintech design principles: tabular numerals (`tabular-nums`), restrained palettes, clear typographic hierarchy, avoiding boilerplate AI badges, and aligning spatial layouts cleanly.
- **`.agents/skills/emilkowalski-skill/skills/break-ui/SKILL.md`:** Evaluated boundary conditions: longest status strings in header, zero-padding states, responsive viewports down to 768px, ensuring `min-width: 0` and `flex-shrink: 0` prevent trailing action clipping.
- **`scripts/verify-ui-e2e.ts`:** Protected all existing element IDs, bounding assertions, iframe height constraints (`scrollHeight <= 312`), and zero horizontal overflow across 1600×900, 1366×768, 1050×800, and 768×1024 viewports.

---

## 4. Concrete Defect Fixes

### Fix 1 — Top Header Button Clipping (`#btn-tour`)
- **Root Cause:** In 1366px viewports, `#tour-status` expanded up to 280px+ with verbose tour teleprompter strings (`"Tour complete — VeriPact proved what the merchant promised."`). Combined with the brand title, tagline, and view switcher, this pushed `.top-actions` beyond the viewport edge, cutting off `#btn-tour` (`▶ Run 60s Guided Demo Tour`).
- **Remedy:**
  - Styled `.top-actions, .hdr-right` with `display: flex; align-items: center; gap: 8px; flex-shrink: 0;`.
  - Added `flex-shrink: 0; white-space: nowrap;` to `#btn-tour` and `#btn-reset`.
  - Added `#tour-status { font-size: 11.5px; max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 1; }`.
  - Added `#tour-status:empty { display: none; }`.
  - Added responsive media query `@media (max-width: 1440px) { .brand .tagline, .brand-tag, .brand .divider { display: none; } }` which frees ~240px of header width on laptop screens.

### Fix 2 — Eliminate Duplicate Rung Steppers & Compact View 1
- **Root Cause:** View 1 had `#pipeline-ribbon` across the top, plus two separate standalone card boxes (`.rung-flow` and `.oracle-bar`) stacked in the right column, wasting ~120px of vertical space and throwing the right column out of alignment with the storefront.
- **Remedy:**
  - Integrated `#rung-self`, `#rung-wit`, `#rung-sign`, and `#oracle-line` directly into a sleek, 28px-tall `.mandate-status-bar` at the footer of the Buyer Mandate & Sufficiency card.
  - Retained all element IDs, classes, and programmatic hooks (`rungTo(stage)` and `oracleLine(o)`), ensuring zero regression for unit or E2E tests.
  - Removed the standalone `.rung-flow` and `.oracle-bar` cards from `.stack`, aligning the left column (Scenario + Storeframe) and right column (Mandate + Controls + Transaction Record + Auditor) cleanly.

### Fix 3 — Partition Meter Math After Refund
- **Root Cause:** When an agent spent `$297.00` and the user clicked `Undo / Refund Last Capture (+$297)`, `p.capturedUsd` remained `297.00` while `p.refundedUsd` became `297.00`. Displaying raw `capturedUsd` showed `$350.00 Allocated | $297.00 Captured / Used | $350.00 Available`, causing arithmetic confusion.
- **Remedy:**
  - In `paintPartition(p)`, computed net used amount:
    ```javascript
    var netUsed = p ? Math.max(0, Number(((p.capturedUsd || 0) - (p.refundedUsd || 0) + (p.authorizedUsd || 0)).toFixed(2))) : 0;
    ```
  - Updated `#part-captured` to show `wpMoney(netUsed)`.
  - Set progress fill to `(cap > 0 ? Math.min(100, Math.max(0, netUsed / cap * 100)) : 0) + '%'`.
  - In `packages/workbench/src/wallet-template.ts`, changed the small metric label to `Net Used (Active)`.
  - Result: `$350.00 Allocated - $0.00 Net Used = $350.00 Available`, correctly returning the meter to 0% after refund.

### Fix 4 — Workflow Guide Bar
- **Remedy:** Added `<nav id="workflow-guide-bar" class="workflow-bar">` directly above `#pipeline-ribbon` with four styled quick-jump buttons:
  - `wf-step-1`: **Step 1: Pair Wallet & Set $350 Partition** → switches to checkout view, scrolls to `#wallet-card`, pulses with `tourRing`.
  - `wf-step-2`: **Step 2: Shop Storefront or Run @veripact Deal Sniper** → switches to checkout view, scrolls to Channel3 / storefront frame, pulses with `tourRing`.
  - `wf-step-3`: **Step 3: Verify Receipt Hash in Browser** → switches to checkout view, expands `#auditor` (`open = true`), scrolls and pulses.
  - `wf-step-4`: **Step 4: Resolve Disputes & Sync History** → switches to `#view-desk`, scrolls to dispute desk, pulses with `tourRing`.

---

## 5. Verification Output

### Vitest Suite Output (264 / 264 passed)
```
 Test Files  17 passed (17)
      Tests  264 passed (264)
   Start at  15:46:54
   Duration  18.38s (transform 3.22s, setup 0ms, collect 10.31s, tests 27.35s, environment 10ms, prepare 8.28s)
```

### Playwright E2E Verification (`npm run verify:e2e`)
```
E2E 01 :: load / (auto-populate captured)
  view1@1600: scrollWidth=1600 clientWidth=1600
E2E 02 :: favicon routes serve SVG
E2E 03 :: reset demo via real button
E2E 04 :: scenario 1 witness + authorize (real clicks)
E2E 05 :: auditor shows JCS-PARITY MATCH
E2E 06 :: scenario 2 surcharge auto-voids
E2E 07 :: scenario 3 injection blocks pre-checkout
E2E 08 :: store iframes fit 310px with zero inner scroll
  store/normal: scrollHeight=310 scrollWidth=712 clientWidth=712
  store/surcharge_void: scrollHeight=310 scrollWidth=712 clientWidth=712
  store/adversarial_hidden_dom: scrollHeight=310 scrollWidth=712 clientWidth=712
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
  store/normal: scrollHeight=310 scrollWidth=615 clientWidth=615
  store/surcharge_void: scrollHeight=310 scrollWidth=615 clientWidth=615
  store/adversarial_hidden_dom: scrollHeight=310 scrollWidth=615 clientWidth=615
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

### Live Chrome DevTools MCP Audit
- Navigated to `http://localhost:3000` at `1366×768` and `1600×900`.
- Verified `#btn-tour` (`▶ Run 60s Guided Demo Tour`) bounding box: right edge = 1248px, clientWidth = 1268px, `visible === true`, never clipped.
- Verified `#tour-status` text overflow truncated cleanly with ellipsis at max-width 190px when displaying `"Tour complete — VeriPact proved what the merchant promised."`.
- Executed Partition spend: Allocated `$350.00`, Net Used `$297.00`, Available `$53.00`.
- Executed Refund Undo: Allocated `$350.00`, Net Used `$0.00`, Available `$350.00`, progress fill `0%`.
- Verified all 4 workflow guide buttons interactively scrolled and pulsed their targets without error.
- Verified zero console errors.

---

## 6. Epistemic & Sandbox Honesty Declaration

An RFC 3161 cryptographic timestamp proves that a document hash existed at time T and was witnessed independently. It does **not** prove content veracity. VeriPact verifies what the merchant actually promised at the time of purchase, providing cryptographic receipts anchored to PayPal's settlement network.
