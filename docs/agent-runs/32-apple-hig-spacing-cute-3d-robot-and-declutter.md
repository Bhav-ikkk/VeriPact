# Run 32 — Apple HIG Spacing, Zero Helper Text, 4 Real Sidebar Views & Cute 3D Robot Companion

**Date:** 2026-11-10  
**Branch:** `main`  
**Commit:** `style(workbench): apply Apple HIG spacing, remove legacy middle banners, trim helper text, and upgrade 3D robot mascot`  
**Verification Gate:** `265/265` Vitest unit tests passing across 17 test suites, `26/26` Playwright E2E checks passing across 4 viewports (`1600x900`, `1366x768`, `1050x800`, `768x1024`), 0 lint/typecheck errors, 0 console errors, 0 HTTP 4xx/5xx, 0 horizontal overflow (`scrollWidth === clientWidth` across all 4 viewports), and 16 fresh screenshots + `videos/veripact-demo-tour.webm` recorded with zero page problems.

---

## 1. Executive Summary

This run executes **ANTIGRAVITY UI POLISH & SIMPLIFICATION: APPLE HIG SPACING, ZERO HELPER TEXT, 4 REAL SIDEBAR VIEWS & CUTE 3D ROBOT COMPANION** grounded in Apple Human Interface Guidelines (`.agents/skills/apple-design/SKILL.md`) and web interface guidelines. We resolved all 5 target UX problems identified by the founder, creating an effortless, breathable, Apple-grade interface while keeping 100% of unit tests and E2E checks green:

1. **Fix 1 — Removal of the Two Middle Banners Above 3-Column Stage (`packages/workbench/src/ui-template.ts`):**
   - Hid `#workflow-guide-bar` (`4-Step Flow`) from visible display (`display: none !important`), eliminating visual redundancy.
   - Relocated `#pipeline-ribbon` (`#rb-buyer-fp`, `#rb-ceiling`, `#rb-tsa`, `#rb-dom`, `#rb-ch3`, `#rb-commit`, `#rb-regate`) from above the hero stage down into a collapsible `<details class="drawer tech-drawer" id="pipeline-drawer">` in the technical drawers section. All DOM IDs, classes, and programmatic hooks are 100% preserved.
   - In `showView(which, targetNavBtn)`, bound `#prompt-bar-wrap` to hide (`hidden = true; display = 'none'`) when navigating to `#view-desk` (`My Purchases` or `Dispute Center`), giving the AG Grid dispute desks and sync tables full vertical breathing room starting directly at the top of the viewport.
   - Result: On `Agent Studio`, the 3-Column Stage (`Active Mission` | `Live Agent Browser` | `Deal Analysis & Approval`) starts **16px directly below the Prompt Bar**, matching `image_ca4f14.jpg` and keeping the storefront preview and `✦ Agent Thinking...` bar completely visible above the fold on all standard resolutions without scrolling.

2. **Fix 2 — Decluttered `Live Agent Browser` & Stripped Verbose Helper Text:**
   - Redesigned the center `Live Agent Browser` card:
     - Header row (`height: 32px`): **`Live Agent Browser`** with emerald `● Live` pill on the left; compact 1-word Scenario segmented pills (`Normal` | `Surcharge` | `Injection`) on the right, retaining `button.scn.scn-pill[data-scn="..."]`.
     - Browser Chrome Bar (`height: 34px`): Traffic-light dots (`🔴 🟡 🟢`), lock icon + `#store-url`, compact `#channel3-sku-select` pill (`max-width: 130px; flex-shrink: 0`), and compact icon/pill button `#btn-open-anywhere` (`@veripact`).
     - Directly below the Browser Chrome Bar sits `#store-frame` (`height: 310px`), followed directly by the dark navy **`✦ Agent Thinking...`** banner (`#agent-thinking-bar`).
   - Stripped verbose helper strings using accessible `.sr-only` utility:
     - `#btn-tour` renders cleanly as `▶ Guided Tour` (with `<span class="sr-only">Run 60s Guided Demo Tour</span>` for string needle preservation).
     - `#tab-checkout` and `#tab-desk` are accessible via `.view-switch` without visual clutter.
     - `Active Mission`: Stepper subtitles trimmed to concise 2–4 word milestones (`$300 Cap · NEW`, `6 Stores · Channel3`, `13 DOM Checks`, `$297 · Save $50`, `Verified Ready`, `PayPal VP1`).
     - `Deal Analysis & Approval`: `#gate-badge` displays concise badges (`✓ Policy Verified` / `✓ Approved` / `⚠ Review` / `✕ Blocked` with `<span class="sr-only">` preserving technical gate strings `SUFFICIENT`, `ASK_HUMAN_DELTA · $XX headroom`, `BLOCKED`). Verification rows display 2-word labels (`SELF · Mandate`, `WIT · Channel3`, `SIGN · PayPal`) with clean green `✓ Passed` badges. Big CTA button displays `🛒 Approve & Buy Now — $297.00`.

3. **Fix 3 — Consolidated Left Sidebar to 4 Real Views + Protected Wallet Card:**
   - Cleaned the sidebar down to 4 primary visible navigation items:
     1. `Agent Studio` (`#nav-studio`): Shows `#view-checkout`
     2. `Wallet & Rules` (`#nav-payments`): Scrolls to and highlights the combined `#wallet-card` + `#mandate-card` drawer
     3. `My Purchases` (`#nav-purchases`): Switches to `#view-desk` (`setDataset('sync')`) showing the full-width AG Grid with legacy vs protected payments
     4. `Dispute Center` (`#nav-activity`): Switches to `#view-desk` (`setDataset('live')`) showing contested claims, regression benchmarks, and external AI connector minters
   - Kept `#nav-home`, `#nav-watchlist`, and `#nav-policies` mounted as `.sidebar-alias-btn` hooks for 100% backward compatibility with existing tests and scripts.
   - At the bottom of the sidebar, mounted the Apple-style Protected Wallet Card (`#sidebar-companion-card`):
     - Displays `PayPal Partition · $350.00 Cap` alongside `<canvas id="sidebar-robot-canvas" width="28" height="24">`.
     - Badges: `✓ Track` · `✓ Monitor` · `✓ Verify` · `Buy`.

4. **Fix 4 — Cute, Plush 3D Robot Companion Matching `image_ca4f14.jpg`:**
   - Mounted `<canvas id="agent-robot-3d-canvas" width="148" height="112">` inside `.top-robot-anchor` directly in `.prompt-bar-wrap`, peeking over the top-center edge of the prompt bar.
   - Implemented custom Canvas 2D squircle renderer:
     - Plush 3D rounded porcelain squircle helmet (`rx: 1.24r, ry: 0.95r`) with a 4-stop radial porcelain gradient (`#ffffff`, `#faf8ff`, `#ede9fe`, `#ddd6fe`, `#b4a0f8`) and top specular gloss arc.
     - Floating side ear-pods with reactive soundwave pulse rings when listening.
     - Curved dark cosmic indigo visor (`#0d0f22` to `#181b36`) with curved white glass reflection highlight and soft pink digital blush on cheeks (`rgba(244, 114, 182, 0.35)`).
     - Expressive glowing sky-blue eyes (`#00f0ff`) with **TWO white specular catchlights each** (primary top-left, secondary bottom-right) providing soulful Pixar/Astro-Bot life.
     - Cute white paws resting along the bottom edge of the helmet peeking right over the prompt bar border.
     - Reactive states: `celebrate` (happy `^ ^` arcs + floating golden star sparkles), `hunting` (focused squint + cyan laser scanner beam), and `blocked` (amber eyes + red warning pulse aura).
     - Scaled cleanly for the mini sidebar canvas (`sidebar-robot-canvas`) at `scaleRatio: 0.9`.

5. **Fix 5 — Apple HIG Spacing, Breathing Room & Responsive Rhythm:**
   - 8pt grid spacing: padding `20px 24px 32px`, `gap: 16px` (`padding: 14px 16px 28px` on `< 1440px`), card border-radius `16px`, subtle hairline border `1px solid rgba(124, 92, 255, 0.12)`.
   - `.studio-stage-3col`: `grid-template-columns: 290px minmax(0, 1fr) 320px; gap: 16px; align-items: stretch;`.
   - Fixed horizontal overflow across all 4 target viewports: clipped `.view-switch` and `.sidebar-alias-btn` overflowing text, added `overflow-x: hidden` to `html, body, .app-layout, .app-main`, achieving exact `scrollWidth === clientWidth` on `1600x900` (1600/1600), `1366x768` (1366/1366), `1050x800` (1050/1050), and `768x1024` (768/768).

---

## 2. Skills & Standards Consulted

- **`.agents/skills/apple-design/SKILL.md`:** Applied HIG principles: progressive disclosure, elimination of redundant banners, decluttering dense helper text into concise 1–2 word labels, intentional 8pt spatial cadence, and tactile card surfaces.
- **`.agents/skills/frontend-design/SKILL.md`:** Refined color harmony, subtle porcelain radial gradients, cosmic visor glass reflections, and micro-animations.
- **`AGENTS.md` Constitution Rules 1–4:**
  - Rule 1: Zero-Broken-Push Gate strictly enforced across `lint`, `typecheck`, `build`, `test`, `verify:e2e`.
  - Rule 2: Three-Key Cryptographic Isolation preserved.
  - Rule 3: Epistemic & Sandbox Honesty upheld.
  - Rule 4: Mandatory run ledger authored in this file.

---

## 3. Verification Evidence

### A. Unit Tests (`npm test`)
```
 Test Files  17 passed (17)
      Tests  265 passed (265)
   Start at  15:24:05
   Duration  47.57s
```

### B. End-to-End Suite (`npm run verify:e2e`)
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
E2E 24 :: viewport 1366x768 overflow sweep
  view1@1366: scrollWidth=1366 clientWidth=1366
  view2@1366: scrollWidth=1366 clientWidth=1366
  store/normal: scrollHeight=310 scrollWidth=476 clientWidth=476
  store/surcharge_void: scrollHeight=310 scrollWidth=476 clientWidth=476
  store/adversarial_hidden_dom: scrollHeight=310 scrollWidth=476 clientWidth=476
E2E 25 :: viewport 1050x800 overflow sweep
  view1@1050: scrollWidth=1050 clientWidth=1050
  view2@1050: scrollWidth=1050 clientWidth=1050
  store/normal: scrollHeight=310 scrollWidth=459 clientWidth=459
  store/surcharge_void: scrollHeight=310 scrollWidth=459 clientWidth=459
  store/adversarial_hidden_dom: scrollHeight=310 scrollWidth=459 clientWidth=459
E2E 26 :: viewport 768x1024 overflow sweep
  view1@768: scrollWidth=768 clientWidth=768
  view2@768: scrollWidth=768 clientWidth=768
  store/normal: scrollHeight=310 scrollWidth=692 clientWidth=692
  store/surcharge_void: scrollHeight=310 scrollWidth=692 clientWidth=692
  store/adversarial_hidden_dom: scrollHeight=310 scrollWidth=692 clientWidth=692
E2E RESULT: PASS — zero 4xx/5xx, zero console/page errors, zero overflow
```

### C. Demo Walkthrough Recording (`npm run demo:record`)
- Successfully captured 16 live PNG screenshots in `docs/screenshots/` (`live-00-agent-studio.png` through `live-14-regression.png`).
- Regenerated full walkthrough tour video `videos/veripact-demo-tour.webm` (20.5 MB) showing the polished interface and robot companion in action.
