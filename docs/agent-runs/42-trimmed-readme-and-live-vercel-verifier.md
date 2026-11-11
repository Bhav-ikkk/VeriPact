# Run Ledger 42 -- Trimmed README and Live Vercel Verifier

**Date:** 2026-11-11
**Prompt Target:** Step 1 (README to strictly 3 visible images + silent SVG test contract), Step 2 (`scripts/verify-live-url.ts` + `verify:live` click-tester), Step 3 (gates + ledger + atomic commit).
**Parent State:** Run 41 complete (`349/349` unit tests, `28/28` E2E).
**Result:** Run 42 complete. Gate green: `lint` 0, `typecheck` 0, `build` 0, `349/349` unit tests across 19 files, E2E `PASS` across 28 steps. Committed locally; push attempted (sandbox has no GitHub auth — same established blocker, user pushes manually).

---

## 1. What Was Built

### A. Step 1 -- README trimmed to 3 product images

- `README.md` now visibly renders exactly 3 screenshots (verified by search): `live-00-agent-studio.png` (2-card workspace), `live-05b-deal-sniper.png` (coupon/trap audit), `live-13-drift-inspected.png` (dispute referee) — each with the brief's exact caption.
- Removed the other 2 PNG embeds and all 6 visible SVG embeds; condensed How It Works to the single flagship 3-rung Mermaid diagram (partition/watcher + web-hunt folded into tight prose).
- The 5 test-contracted SVG paths (plus 06) moved into an invisible HTML comment at the very bottom: 0 SVG images render, `ships 5 valid SVG screenshots referenced by the README` stays green.
- Kept tight: 3-sentence opening, Mermaid diagram, 8-package table, exact verification table (349/349, 28/28, 60/60, 72/72), Quickstart, `Where It Breaks`, plus the grounded receipts/research/honesty sections (condensed, not deleted).

### B. Step 2 -- `scripts/verify-live-url.ts` (`npm run verify:live`)

- New self-contained live-deployment click-tester: target from `argv[2]` → `VERIPACT_LIVE_URL` → `http://localhost:3000`; portable-Chromium fallback + require-after-env pattern copied from the E2E harness.
- 7-step audit mirroring the proven E2E selectors/waits: (1) `/health` + `/openapi.json` 200 with `openapi: 3.1.0`; (2) `/` loads with zero console/page/HTTP errors + equal-height rows (±2px) + 36px buttons; (3) full onboarding wizard → `Bhavik` pill; (4) typed sniper query → `CAPTURED $297.00` + `PAYPAL50` ($53 left), then a budget-restoring refund; (5) Details opens with 6-store audit + `VP1:`; (6) Poll + Test $100 Drop → `GOAL CAPTURED` + `VP1:` + `$100.00 Allocated · $0.00 Left`; (7) Orders sync shell + both dispute cases inspected + `#btn-resolve` → `RESOLVED`. Prints `LIVE DEPLOYMENT AUDIT: PASS/FAIL`, exit 0/1.
- `package.json`: `"verify:live": "tsc -p scripts/tsconfig.json && node scripts/dist/verify-live-url.js"` (exact spec string).
- Validation boundary (honest): the script compiles under `tsc -p scripts/tsconfig.json`, passes eslint, launches Chromium via the portable fallback, and fails cleanly (`LIVE DEPLOYMENT AUDIT: FAIL`, exit 1) against a dead port. A full PASS run is impossible in this sandbox (no `listen()`, no deployed URL yet) — the founder runs `npm run verify:live <vercel-url>` post-deploy.

## 2. Skills / Tools Consulted

- No marketplace skill applied: README surgery plus a Playwright script mirroring the repo's own proven E2E patterns. The E2E harness (`verify-ui-e2e.ts`) served as the implementation oracle for selectors, waits, and assertion thresholds.

## 3. Architectural Decisions and Self-Corrections

1. **One flagship Mermaid diagram.** The brief's keep-list names "the Mermaid architecture diagram" (singular); kept the 3-rung pipeline and compressed the other two systems into dense prose rather than deleting their content.
2. **Receipts/research/honesty preserved.** The keep-list does not order their deletion and they carry verified-fact value (live order IDs, arXiv bounds, Rule-3 honesty spine); condensed, not cut.
3. **Browser-fallback path bug caught by dry-run.** My first copy climbed one `..` too few (`scripts/.tools` vs repo-root `.tools`), so the fallback silently never engaged; fixed to the `ROOT`-based form and re-verified the launch.
4. **Launch moved inside try/catch.** A dead browser/install now yields `LIVE DEPLOYMENT AUDIT: FAIL` with the reason instead of an uncaught stack.
5. **Sniper-then-refund ordering.** The live audit spends the $350 partition at step 4; an E2E-proven refund restores it before the watcher capture at step 6, keeping every step on a deterministic budget.

## 4. Verification Output

Gate (repo root, portable toolchain, in order):

```
npm run lint       -> exit 0 (eslint, clean)
npm run typecheck  -> exit 0 (tsc --noEmit, clean)
npm run build      -> exit 0 (tsc -b, clean)
npm test           -> Test Files 19 passed (19) / Tests 349 passed (349)
```

`npm run verify:e2e` -> `E2E RESULT: PASS -- zero 4xx/5xx, zero console/page errors, zero overflow` (exit 0, 28 steps).
`verify:live` dry-run vs dead port -> clean `LIVE DEPLOYMENT AUDIT: FAIL` (connection refused), exit 1 — correct behavior without a deployment.

Commit: `docs(readme,scripts): trim README to 3 flagship screenshots and add verify:live Playwright click-tester` (scoped add of `README.md`, `package.json`, `scripts/verify-live-url.ts`, this ledger). Push: sandbox has no GitHub auth (user pushes manually).
