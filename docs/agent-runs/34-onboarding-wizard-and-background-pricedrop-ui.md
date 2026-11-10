# Run 34 — Apple-Style 3-Step Onboarding Wizard, Sub-Allocation Splitter & Background Price-Drop Watcher UI

**Execution Date:** 2026-11-10  
**Phase:** Part 2 of 2 — Antigravity Onboarding & Fleet (UI & E2E Step 27)  
**Parent State:** Commit `028b918` (Run 33 complete: Neon DB Serverless Postgres HTTP SQL adapter, Clerk session & OAuth detection, multi-agent sub-allocations, and `/api/agents/webhook/price-drop` live backend).

---

## 1. What Was Built

### A. Sleek Apple-Grade 3-Step Onboarding Wizard (`#onboarding-modal`)
1. **Initial Unblocked Page Load:**
   - In strict compliance with guardrails, `#onboarding-modal` has the HTML `hidden` attribute by default so it never blocks page load or intercepts clicks during existing E2E steps (`E2E 01`–`E2E 23`).
   - Triggered either from the top-right header pill `#btn-open-onboarding` (`👤 Connect Clerk & PayPal`) or from `Wallet & Rules` via `#btn-wallet-open-onboarding` (`Setup Onboarding & Sub-Agents`).
2. **Step 1 — Identity (Clerk + Google OAuth):**
   - Branded Google OAuth button `#btn-clerk-google` with live `CLERK_PUBLISHABLE_KEY` detection and deterministic sandbox session fallback.
   - User inputs `#onb-email` (default `bhavik@veripact.ai`) and `#onb-name` (default `Bhavik`).
   - Live status badge showing `Clerk Session + Neon DB Sync Ready`.
   - Forward button `#btn-onb-next-1` advances to Step 2.
3. **Step 2 — Link PayPal Vault & Master Budget:**
   - 1-Click PayPal OAuth / QR Pair button `#btn-onb-paypal-connect` pairing the user's PayPal authority.
   - Master Agentic Budget Partition input and slider (`#onb-master-cap` and `#onb-master-slider`, default `$350.00`).
   - Collapsed `<details>` drawer providing custom sandbox API key inputs for technical judges.
   - Back button `#btn-onb-back-2` and Next button `#btn-onb-next-2` advance to Step 3.
4. **Step 3 — Multi-Agent Sub-Allocation Splitter:**
   - Visual breakdown progress bar showing sub-allocation slices against the master budget:
     - `Monitor Sniper (APEX-27-4K-IPS)`: `$220.00` sub-allocation | target $\le \$300.00$.
     - `Audio Deal Bot (KANSO-Q35)`: `$100.00` sub-allocation | target $\le \$100.00$ ($149 retail).
     - `Unallocated Safety Reserve`: `$30.00` buffer cushion.
   - Mathematical enforcement status `#onb-alloc-status` validating that total sub-allocations remain within the master partition.
   - Primary finish button `#btn-onb-finish` (`✓ Complete Onboarding & Arm Background Agents`):
     - Dispatches `POST /api/onboarding/complete`.
     - Updates header pill `#onb-pill-label` to `🟢 Bhavik · PayPal Vault ($350)`.
     - Closes modal, refreshes live sub-agents, and triggers 3D Robot mascot into `'celebrate'` mode.

### B. Autonomous Background Sub-Agents Panel (`#fleet-panel`)
1. Mounted inside `Agent Studio` (`#view-checkout`) right below `${walletCardHtml()}` with zero horizontal overflow across all viewports.
2. Header with badge showing `Neon DB + Channel3 Webhook Active` and button `+ New Sub-Agent` (`#btn-toggle-spawn-agent`), which toggles quick inline form `#form-spawn-agent` (`#spawn-agent-name`, `#spawn-agent-sku`, `#spawn-agent-target`, `#spawn-agent-suballoc`, `#btn-spawn-agent`).
3. Dynamic list `#fleet-agents-list` rendering active sub-agents with live status badges (`🟣 ARMED · WATCHING 24/7` -> `🟢 GOAL CAPTURED`), sub-allocation balances (`$100.00 Allocated · $100.00 Left`), and target triggers.
4. Action button `#btn-sim-pricedrop` on KANSO card (`⚡ Simulate $100 Price-Drop Webhook`):
   - Wakes 3D Robot mascot into `'hunting'` mode.
   - Streams live thoughts in `#agent-thinking-bar`:
     `"⚡ Background Webhook Received: KANSO-Q35 dropped to $100.00 all-in (AUDIO67) -> 3-Rung WIT Verified -> Auto-Captured $100.00 from Agent Sub-Allocation!"`
   - Calls `POST /api/agents/webhook/price-drop` with `{ sku: 'KANSO-Q35', newBasePriceUsd: 82, voucherCode: 'AUDIO67' }`.
   - On response: wakes robot into `'celebrate'`, flips Kanso sub-agent status to `🟢 GOAL CAPTURED ($100.00 · VP1:...)`, drops remaining sub-allocation to `$0.00 Left`, and updates the master partition available balance in real time in both the topbar pill and wallet enforcer card.

### C. Playwright E2E Audit Expansion (Step 24 / Total 27 Checks)
- Added full automated verification flow into `scripts/verify-ui-e2e.ts`:
  - Verified `#onboarding-modal` has `hidden` attribute on initial load.
  - Clicked `#btn-open-onboarding`, navigated through Steps 1, 2, and 3, and submitted `#btn-onb-finish`.
  - Asserted header pill updated to include `Bhavik`.
  - Asserted `#fleet-panel` visible in View 1.
  - Triggered `#btn-sim-pricedrop`, waited for and verified `GOAL CAPTURED` and cryptographic commitment `VP1:`.
  - Verified `#agent-thinking-bar` streaming log.
  - Cleared state via `#btn-reset` before subsequent viewport sweeps.
- Ran all 4 viewport sweeps (`1600x900`, `1366x768`, `1050x800`, `768x1024`) with strict `scrollWidth === clientWidth` zero-overflow assertions.

---

## 2. Marketplace Skills & Architectural Standards Consulted

- `.agents/skills/apple-design`: Glassmorphic styling, segmented tab controls (`.onb-tabs`), high-contrast accessible status badges, restrained typography, and fluid responsive grid layouts.
- `.agents/skills/frontend-design`: Zero-overflow responsive CSS (`repeat(auto-fit, minmax(280px, 1fr))` collapsing gracefully on tablet/mobile), interactive visual progress breakdown bars, and 3D robot mood coordination.
- `AGENTS.md` Rule 1 (Zero-Broken-Push gate), Rule 2 (Three-Key cryptographic isolation), Rule 3 (Epistemic & sandbox honesty), Rule 4 (Mandatory atomic run ledger).

---

## 3. Architectural Decisions & Self-Corrections

1. **Initial Page Load Guard:**
   - *Problem:* Modal overlays that pop up automatically on load break Playwright tests that click stage elements (`E2E 01`–`E2E 23`).
   - *Solution:* Pinned the `hidden` attribute on `#onboarding-modal` in HTML. Onboarding is accessible on demand via the header pill or wallet card.
2. **Response Field Normalization:**
   - *Problem:* `triggerBackgroundPriceDrop` returns `{ triggeredAgents, fleet }`, while frontend originally looked for `res.state.agents`.
   - *Solution:* Updated client handlers to accept `res.fleet || res.state || res` and pull `agents` seamlessly, enabling instant real-time DOM card updates without requiring a secondary network roundtrip.
3. **Zero Undeclared `event` Tokens:**
   - *Problem:* Browser linting rejects references to implicit window `event`.
   - *Solution:* Every single event listener in `ui-template.ts` explicitly declares parameter `(e)`.

---

## 4. Verification Output

### Zero-Broken-Push Gate (npm run lint && npm run typecheck && npm run build && npm test)
```
> veripact@0.1.0 lint
> eslint .
Exit code: 0

> veripact@0.1.0 typecheck
> tsc --noEmit -p tsconfig.typecheck.json
Exit code: 0

> veripact@0.1.0 build
> tsc -b .
Exit code: 0

> veripact@0.1.0 test
> tsc -b . && vitest run

 Test Files  17 passed (17)
      Tests  269 passed (269)
   Start at  18:15:24
   Duration  25.26s
Exit code: 0
```

### Playwright E2E Audit (`npm run verify:e2e`)
```
E2E 01 :: load / (auto-populate captured)
  view1@1600: scrollWidth=1600 clientWidth=1600
E2E 02 :: Autonomous Shopping Agent Studio & 3D robot canvas rendered
E2E 03 :: favicon routes serve SVG
E2E 04 :: reset demo via real button
E2E 05 :: scenario 1 witness + authorize (real clicks)
E2E 06 :: auditor shows JCS-PARITY MATCH
E2E 07 :: scenario 2 surcharge auto-voids
E2E 08 :: scenario 3 injection blocks pre-checkout
E2E 09 :: store iframes fit 310px with zero inner scroll
  store/normal: scrollHeight=310 scrollWidth=646 clientWidth=646
  store/surcharge_void: scrollHeight=310 scrollWidth=646 clientWidth=646
  store/adversarial_hidden_dom: scrollHeight=310 scrollWidth=646 clientWidth=646
E2E 10 :: two-step popup approval end-to-end
E2E 11 :: dispute desk: inspect + resolve both cases
  view2@1600: scrollWidth=1600 clientWidth=1600
E2E 12 :: regression suite + studio chart
E2E 13 :: live mandate edit flips checkout outcomes (UI)
E2E 14 :: View 1 → View 2 live dispute filing (drift + forgery)
E2E 15 :: audit ledger + custom HTML witness APIs
E2E 16 :: guided autopilot tour completes with spotlight
E2E 17 :: v5 wallet clean load: null-safe partitions + wallet DOM present
E2E 18 :: v5 QR pairing ceremony end-to-end
E2E 19 :: v5 partition spend, wall block, refund undo
E2E 20 :: v5 sync grid: legacy vs protected
E2E 21 :: v5 connectors mint one-time credentials
E2E 22 :: Channel3 multi-SKU selection: refurbished blocked on spend, compliant captured, resets to default
E2E 23 :: v6 autonomous deal & voucher sniper end-to-end
E2E 24 :: onboarding wizard, sub-agent spawn & background $100 price-drop auto-buy
E2E 25 :: viewport 1366x768 overflow sweep
  view1@1366: scrollWidth=1366 clientWidth=1366
  view2@1366: scrollWidth=1366 clientWidth=1366
  store/normal: scrollHeight=310 scrollWidth=476 clientWidth=476
  store/surcharge_void: scrollHeight=310 scrollWidth=476 clientWidth=476
  store/adversarial_hidden_dom: scrollHeight=310 scrollWidth=476 clientWidth=476
E2E 26 :: viewport 1050x800 overflow sweep
  view1@1050: scrollWidth=1050 clientWidth=1050
  view2@1050: scrollWidth=1050 clientWidth=1050
  store/normal: scrollHeight=310 scrollWidth=459 clientWidth=459
  store/surcharge_void: scrollHeight=310 scrollWidth=459 clientWidth=459
  store/adversarial_hidden_dom: scrollHeight=310 scrollWidth=459 clientWidth=459
E2E 27 :: viewport 768x1024 overflow sweep
  view1@768: scrollWidth=768 clientWidth=768
  view2@768: scrollWidth=768 clientWidth=768
  store/normal: scrollHeight=310 scrollWidth=692 clientWidth=692
  store/surcharge_void: scrollHeight=310 scrollWidth=692 clientWidth=692
  store/adversarial_hidden_dom: scrollHeight=310 scrollWidth=692 clientWidth=692
E2E RESULT: PASS — zero 4xx/5xx, zero console/page errors, zero overflow
```

### Demo Video & Screenshot Recording (`npm run demo:record`)
```
demo: beat 1 — Autonomous Shopping Agent Studio + QR pair & partition
demo: shot live-00-agent-studio.png
demo: shot live-01-wallet-qr.png
demo: shot live-02-wallet-paired.png
demo: beat 2 — partition spend, wall block, refund undo
demo: shot live-03-partition-spend.png
demo: shot live-04-partition-wall.png
demo: shot live-05-partition-refund.png
demo: beat 2b — autonomous deal sniper 6-candidate sweep
demo: shot live-05b-deal-sniper.png
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
demo: DONE — 16 PNGs + .webm, zero page problems
```
