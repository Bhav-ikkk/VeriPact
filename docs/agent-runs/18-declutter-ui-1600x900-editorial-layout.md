# Run 18 — Atomic Task 3: Declutter `ui-template.ts` to Match Approved 1600x900 Editorial Fintech Layout

Parent: run 17 (Channel3 8-product catalog discovery, 240/240 tests passed, live server verified).
Prompt: Atomic Task 3: Declutter `ui-template.ts` to Match Approved 1600x900 Editorial Fintech Layout.

## 1. Problem and Objective

VeriPact's View 1 had accumulated clutter:
- The Agentic Wallet card (`#wallet-card`) was positioned between Tier C and Tier D, pushing the bottom strip below the fold and breaking the natural visual flow.
- The 3-stage Evidence Pipeline (`#pipeline-ribbon`) had an asymmetrical box styling only on Step 3 (`#rb-3`), causing uneven vertical height across steps.
- Tier D's middle card (`#checkout-result`) was previously marked `hidden` when idle, which caused the 3-column CSS grid to collapse or skip the middle column prior to checkout.
- At 1280x800, media query breakpoints prematurely collapsed horizontal tiers.

The objective was to declutter `ui-template.ts` and `wallet-template.ts` to achieve the approved 1600x900 and 1280x800 editorial fintech layout while keeping all existing DOM IDs, API shapes, and contracts 100% intact so zero tests break.

## 2. What was built

1. **Tier A Header (58px):**
   - Maintained 58px sticky topbar with logo + tagline on left, segmented view toggle in center (`Buyer Checkout` / `Dispute Desk`), and live sandbox mode pill, `Reset Demo`, and `▶ Run 60s Guided Demo Tour` on right.

2. **Tier B Connected 3-Stage Evidence Pipeline (`#pipeline-ribbon`):**
   - Configured `.ribbon` grid: `220px minmax(0, 1fr) 20px minmax(0, 1.05fr) 20px minmax(0, 1.1fr)` with `align-items: stretch`.
   - Styled all three steps (`#rb-1`, `#rb-2`, `#rb-3`) with consistent rounded card containers (`background: var(--bg-muted); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 8px 12px;`).
   - Achieved identical pixel heights, zero text collisions, and aligned metadata chips with connected horizontal lines (`.rb-connector`).

3. **Tier C Split Workspace (2 equal columns, `gap: 16px`):**
   - **Left Card:**
     - `Select Scenario` (3 clean scenario buttons).
     - Clean `.channel3-catalog-bar` embedded above the browser preview.
     - `#store-frame` browser-framed at `height: 310px` with `overflow: hidden` and zero inner scrollbars.
     - Extracted quote badges (`#quote-badges`), custom merchant HTML lab, and mutation controls neatly collapsed inside the native `<details class="drawer tech-drawer">` at the bottom of the card.
   - **Right Card Stack:**
     - `Buyer Mandate & Sufficiency` card featuring the 4-column metric strip (`$320.00` / `NEW` / `≥ 30 days` / `0%`), `#gate-badge`, and 4 observed term sufficiency pills.
     - `SELF -> WIT -> SIGN` mini-bar (`.rung-flow`).
     - `Channel3 Oracle` bar (`.oracle-bar`).
     - Action row (`.controls-row`): checkboxes card (`#reviewed-toggle`, `#twostep-toggle`) and prominent dual action buttons (`#btn-witness` + `#btn-checkout`).

4. **Tier D Bottom 3-Card Strip (`grid-template-columns: 0.9fr 1.1fr 1.1fr; gap: 16px`):**
   - Left: `#checkout-outcome-banner` (`Purchase Captured` / `Authorization Auto-Voided` / `Blocked Pre-Checkout`).
   - Center: `#checkout-result` (`Transaction Record` 5-row key-value list with post-purchase `Simulate Drift` and `Simulate Forgery` buttons). Initialized with an awaiting record and updated via `resetTransactionRecord()` so the 3-column grid stays aligned at all times.
   - Right: `Verify-It-Yourself (Auditor)` (`.auditor-card` with 3-row checklist and `JCS-PARITY MATCH` banner).
   - Set `align-items: stretch` so all three cards match height.

5. **Full-Width Agentic Wallet Bar Below Tier D:**
   - Moved `${walletCardHtml()}` from between Tier C and Tier D to full-width directly below Tier D.
   - Updated `#wallet-card` styling with `padding: 14px 20px` and crisp button alignment across phone QR pairing ceremony and partition balance controls.

6. **Breakpoint Refinement:**
   - Updated the desktop breakpoint from `1280px` to `1100px` so both 1600x900 and 1280x800 display the full, uncollapsed editorial fintech 4-tier layout.
   - Added `overflow: hidden` to storefront body to ensure zero inner scrollbars.

7. **Browser Verification via Chrome DevTools MCP:**
   - Resized page to 1600x900 and 1280x800.
   - Captured viewport and full-page screenshots of View 1 (`Buyer Checkout`) and View 2 (`Dispute Desk`).
   - Visually inspected card borders, typography hierarchy, button alignment, and responsiveness.
   - Verified scenario switching, SKU changing, and demo reset.
   - Checked browser console: **0 errors, 0 warnings**.

## 3. Marketplace Skills & Tools Consulted

- `chrome-devtools-mcp`: `resize_page`, `navigate_page`, `evaluate_script`, `take_screenshot`, `list_console_messages` to visually inspect and test responsive layouts.
- `frontend-design` & `web-design-guidelines`: Editorial fintech principles, tabular numeral formatting, token consistency.
- `vitest`: Monorepo test verification across all 16 test files.

## 4. Verification Output

Full Rule 1 Zero-Broken-Push Gate passed with code 0:
```
> veripact@0.1.0 lint
> eslint .

> veripact@0.1.0 typecheck
> tsc --noEmit -p tsconfig.typecheck.json

> veripact@0.1.0 build
> tsc -b .

> veripact@0.1.0 test
> tsc -b . && vitest run

 Test Files  16 passed (16)
      Tests  240 passed (240)
```

