# Run 09 — Editorial-Fintech UI Redesign (Light 1600×900 Spec)

Scope: full visual + structural rebuild of the workbench UI to the
approved light-mode editorial fintech mockup — `ui-template.ts` (Tiers
A–D + View 2), `storefront-template.ts` (browser-framed product card),
`approval-template.ts` (buyer popup), and the 5 committed SVGs. All
backend contracts, state machines, security guards, and 166/166 test
assertions preserved; zero flow changes.

## 1. Skill & sub-agent mapping

- `bundled:taste` (negative constraints): no glassmorphism, no emoji
  icons, no purple chrome, no hero/feature-grid tropes — the dense
  workspace already complied; the storefront monitor's purple-blue
  wave is explicitly spec-mandated product art, so the spec wins.
- `hallmark` (Run 08): verification lens reused — every claim below
  is backed by a real Chromium screenshot, not code reading.
- No subagents: one template file + two small ones stayed inline.

## 2. What was built

**Design tokens.** `:root` carries the exact spec palette
(`#F8F9FB` canvas, `#FFFFFF` cards, `#182230` actions, mint/amber/
crimson status sets), Inter + JetBrains Mono stacks (system
fallbacks, no webfont fetch — offline-safe), and body-level
`tabular-nums`. The `prefers-color-scheme: dark` block is deleted:
light-only per spec. Glass header, rung legend, and slate theme are
gone.

**Tier A header (58px).** Two-tone V-check logo SVG, VeriPact 800 +
divider + tagline, centered segmented Buyer/Dispute switcher
(`#182230` active), amber replay pill with CSS `::before` dot
(survives the JS `textContent` update), ghost Reset with refresh
icon, dark tour CTA. `#tour-status` lives in the header with
ellipsis + full-text `title` (one additive line in `tourSay`).

**Tier B pipeline.** Six-column card: title block, three
`.ribbon-step` stages (kept class + `#rb-1..3` for the probe),
32px connectors (`#rb-conn-1/2`, green when the stage completes),
and a state-tinted `#rb-3` box (`data-state` captured/voided/
blocked/neutral, set additively in `ribbonFillCheckout`).

**Tier C workspace.** Left: `Select Scenario` + 3-button icon grid
(check / layers / code SVGs, dark active), browser-chrome frame
(dots + lock + `#store-url`, suffix updates per scenario) around
`#store-frame`, quote badges, mutation preview (kept). Right:
mandate card (metric strip + `#gate-badge` + 4 suff cells),
SELF→WIT→SIGN strip, Channel3 oracle bar, controls row
(review-gate checkbox + `twostep-toggle` + Witness/Authorize
buttons), status line, awaiting card.

**Tier D strip.** `#checkout-outcome-banner` (mint Purchase
Captured / crimson Auto-Voided / Blocked, 46px geometric icons),
`#checkout-result` as a 5-row Transaction Record (friendly PayPal
Mode labels), auditor card (3-row checklist + JCS-PARITY banner +
`Inspect hash & JCS` drawer with the full prior detail: 4 sig
rows, raw hex, canonical bytes).

**View 2.** Same tokens: segmented dataset switcher, 560px grid
shells (exact CSS strings kept), fallback table, 3-column
inspector, studio agent (canvas recolored to `#16a34a`/`#b42318`/
`#175cd3`), matrix, evidence sheet, print rules.

**Storefront.** Two-column showcase (thumbnails + wave-display
monitor SVG), SKU/name/price/specs with ✓ bullets and NEW badge,
verbatim fixture copy, per-scenario annotations (surcharge callback
warning, concealed-payload indicator), exact hidden injection node
on scenario 3. Quote badges are computed by the REAL extractor over
the SDK fixture HTML (`renderStorefront` is now async; `handleStore`
awaits it — the only routes.ts change), so `B001·itemTitle` etc.
match the workbench pins exactly.

**Approval popup.** Same tokens, charcoal CTA, tabular breakdown;
script byte-identical (origin-locked postMessage untouched). Also
fixed a latent bug: the commitment `<dd>` carried the page
`.wrap` class (container padding on a table cell).

**Landing pre-population.** `DOMContentLoaded` runs witness →
1-click checkout → auditor open for the normal scenario, so first
paint already shows the rich captured state. VM-test safe (stub
`addEventListener` never fires it).

**SVGs.** Generator palette swapped to the light system (layout DSL
unchanged); all 5 regenerated from live run data with content
needles intact.

## 3. Self-corrections

- Spec's `#chk-two-step` conflicts with the locked `twostep-toggle`
  test needle + 3 JS call sites: kept `twostep-toggle` (contract
  wins over label; noted here).
- Spec's `Finalize Approved Order` casing conflicts with the
  `Finalize approved order` needle: kept the tested string; the
  untested popup button took the spec casing (`Open Buyer Approval
  Popup`).
- Spec's banner-right inspect toggle became a full-width `Inspect
  hash & JCS` drawer below the banner — a dropdown needs the width.
- Screenshot QA caught and fixed: suff-pill overflow (wrap inside
  cells), oracle label wrap (nowrap + no-shrink), gate-badge
  mid-word truncation (word-boundary + ellipsis), canvas bar labels
  overlapping at equal values (labels moved under bars — a
  pre-existing defect), stale auditor MATCH persisting after a
  non-captured checkout (body resets to placeholder), audit-button
  spacing.
- The main-probe `-1` exit on the first post-rebuild run was a
  PowerShell `Select-Object -First` pipe artifact; the rerun
  without truncation exits 0.

## 4. Verification (Rule-1 gate, verbatim tail)

- `npm run lint`: clean, `lint-exit=0`
- `npm run typecheck`: clean, `typecheck-exit=0`
- `npm run build`: clean, `build-exit=0`
- `npm test`: `Test Files 9 passed (9)`, `Tests 166 passed
  (166)`, `test-exit=0` (all pre-existing assertions untouched)
- `npm run assets:generate`: `normal=CAPTURED $297.00
  surcharge=AUTO_VOIDED adversarial=BLOCKED_PRE_CHECKOUT
  regression=72/72 (100%)`, `assets-exit=0`
- `jcs` canonicalizer: SHA-256 of the line matches HEAD exactly
  (plus the vm parity test green)
- Main probe (1600×900): `STEP OK` × 10, `probe-exit=0`, 6 console
  errors all `ERR_NETWORK_ACCESS_DENIED` on the pinned AG Grid CDN
- Tier-D probe: `hScroll:false`, iframe 708/708, captured/voided/
  blocked banners + record + auditor + popup all screenshotted,
  0 page errors
- Screenshots inspected: landing, surcharge, adversarial, desk,
  inspector drift, chart, tour, Tier-D × 3, approval popup — zero
  clipping, zero horizontal scroll, crisp 2-column iframe

## 5. Files changed

`packages/workbench/src/ui-template.ts` (full retheme, contracts
intact), `storefront-template.ts` (async showcase + real badges),
`approval-template.ts` (tokens + `wrap`-class fix),
`routes.ts` (await async storefront — 3 lines), `index.ts` +
`package.json` (Sequoia → editorial-fintech wording),
`scripts/generate-visual-assets.ts` (light palette),
`docs/screenshots/01–05.svg`, `benchmark/results/…json`
(regen timestamp), this report. Not committed: `.vitest-tmp/vp-probe`
(scratch probes + PNGs, gitignored).

## 6. Risks & follow-ups

- Push still owner-terminal: Runs 06–09 (`122c0f2`, `baf45b8`,
  `f70edb9`, this run) await `git push origin main`.
- Still open: live sandbox receipts (SMS cooldown), hosted Render
  URL, demo video, `postMessage` allowlist hardening.
- Auto-populate mints a replay order per page load (replay-only,
  harmless; in live mode it lands on AWAITING without opening a
  popup — no gesture hijack).
- AG Grid CDN remains unreachable in-sandbox; the native fallback
  is what screenshots show. Verify the AG Grid path once online.
