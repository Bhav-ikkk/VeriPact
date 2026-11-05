# Run 11 — End-to-end production system, real AG Grid, demo video & live PayPal proof

Parent: `02c803c` (run 10). This run connects View 1 → View 2 into a stateful
clearing pipeline, serves real AG Grid locally, rebuilds the demo recorder,
and — with the founder's sandbox credentials now on disk — proves the VP1
commitment lands on a REAL PayPal order.

## 1. What was built

**Part 1 — JS audit + real local AG Grid.**
- Audited every handler in `ui-template.ts` / `approval-template.ts` /
  `storefront-template.ts`: zero implicit `event` references (the only matches
  were CSS `pointer-events` and a properly-parameterized `function(e)`).
  The reported `event is not defined` does not reproduce on the current UI;
  locked in by a strict `node:vm` test that compiles the client script under
  `"use strict"`, statically bans standalone `event` tokens, and invokes all
  11 handlers (`selectScenario`, `runWitnessFlow`, `runCheckoutFlow`,
  `setView`, `setDataset`, `runTour`, `stopTour`, `resetDemo`,
  `openByokModal`, `fileDisputeFromOrder`, `updateMandate`) against a stub DOM
  with zero synchronous `ReferenceError`/`TypeError`.
- Installed `ag-grid-community@31.3.4` (MIT, UMD build) as a workbench
  dependency and served it same-origin: `GET /vendor/ag-grid-community.min.js`
  (1.9 MB), `/vendor/ag-grid.min.css`, `/vendor/ag-theme-quartz.min.css`.
  Missing package → honest 200 stub + native fallback (never 404/500).
- `mountAg()` upgraded: sortable/filterable/resizable columns, pinned Case
  column, single-row selection, `sizeColumnsToFit`, registered hash-chip cell
  renderer (no AG warnings), CSV export button. Label now reports
  `AG Grid 31 (local vendor)`. Zero CDN references remain in the page.

**Part 2 — View 1 → View 2 production pipeline.**
- `POST /api/buyer/mandate/update`: validates the 4 constraints, re-signs with
  the buyer key (SELF), stores a session override, re-gates against the live
  storefront. UI: Edit Mandate panel + Sign & Lock; header ceiling updates.
  Lowering $320 → $290 flips the $297 checkout to AUTO-VOID (E2E-proven).
- `POST /api/merchant/disputes/create-from-order`: files `PP-D-LIVE-DRIFT-n`
  / `PP-D-LIVE-FORGERY-n` in the shared replay engine (`fileDispute()` added),
  anchored to the exact captured `custom_id`. UI buttons auto-switch to the
  Dispute Desk, select the new row, and scroll the 3-column forensics into
  view. Live resolve walks the same HATEOAS chain as canned cases.
- `POST /api/witness/custom-html`: scans pasted HTML (200 KB cap, truncated
  transport) under the session mandate with Channel3 cross-check. UI lab tab
  with 4 presets (Apex flagship, Northloop 14 $899, opacity trap,
  prompt-injection trap).
- `POST /api/system/credentials`: upserts the pair into `.env` (other keys
  preserved, `\r\n\0` rejected, placeholders rejected), clears the latch,
  verifies OAuth immediately (8 s default, configurable). Unreachable/invalid
  → honest 200 + replay fallback latch. `{replay:true}` forces in-memory
  replay without touching `.env`. Responses never carry secrets (red-team
  extended to cover the new routes).
- `GET /api/ledger`: append-only session clearing ledger (witness, order,
  capture, void, file, resolve, mandate, credential events), signed by the
  witness key; modal viewer + Download Signed Ledger (.json).
- SDK: `CheckoutFlowInput.mandate` / `CompleteCheckoutInput.mandate` overrides
  honored (fixture default keeps all existing callers identical).

**Part 3 — recorder.** Rewrote `scripts/playwright-record-demo.ts` on the E2E
harness (portable-browser discovery, route fulfillment, hermetic pin):
5 beats at 1600×900 with pacing holds → 7 PNGs in `docs/screenshots/live-*`
+ `videos/veripact-demo-tour.webm` (5.5 MB, gitignored), zero page problems.

**Part 4 — E2E.** Steps 16–18 added (mandate edit, drift+forgery filing with
live resolve, ledger + custom-HTML APIs); dispute-row clicks made AG-aware
(`[row-id]` with native fallback); AG engine asserted in-browser.

## 2. Live PayPal setup (founder sandbox credentials)

`.env` now holds a real sandbox pair (82-char ID / 80-char secret, non
placeholder). Verified end to end from this machine:
- `fetchAccessToken` via the proxy-aware transport: OK in 537 ms.
- Checkout created REAL order `56A58181H7229193E`, status CREATED, with the
  real approve URL `https://www.sandbox.paypal.com/checkoutnow?token=…`.
- Read-back: `custom_id` is exactly the flow's `VP1:d04b190d…` commitment,
  and the PATCH totals landed (279.00 + 11.50 + 6.50 = 297.00).
- Three CREATED orders were minted by these probes; all expire untouched
  (authorize needs interactive buyer approval). Nothing was captured/voided.
- This closes the run-10 risks "live approveUrl shape unverified" and "no
  live sandbox receipts", and retires the "PayPal unreachable" assumption:
  the earlier Python OAuth timeout was urllib/proxy-specific; the Node
  transport tunnels cleanly. Founder manual path is open: UI → checkout →
  approve at sandbox.paypal.com → Finalize → live CAPTURED.

## 3. Tools & skills consulted

- `.agents/skills/paypal-api-context/SKILL.md` — Orders v2 / Disputes HATEOAS
  shapes for the filing + resolve chains (PayPal exposes no file-dispute
  API, hence replay-only filing with an honest 400 in live mode).
- `.agents/skills/ag-grid-skills` (presence confirmed; UMD `createGrid`
  contract used) + installed `ag-grid-community@31.3.4` package itself.
- `.agents/skills/security-audit/SKILL.md` — red-team extension, credential
  scrubbing, `.env` injection guards, 200-with-fallback instead of 500s.
- `.agents/subagents/02-extractor-and-paypal.md` (engine/HATEOAS ownership)
  and `04-sequoia-ag-workbench.md` (workbench ownership) for placement.
- Portable Node `22.13.1` + repo-local npm cache (`.npm-cache/`, gitignored);
  `TEMP` redirected to `.vitest-tmp` for vitest/Playwright (sandbox EPERM).

## 4. Architectural decisions & self-corrections

1. **E2E/regression/recorder pinned hermetic.** With live creds on disk, all
   three determinism harnesses now wipe key env vars and point
   `VERIPACT_ENV_FILE` at an absent path (same as vitest). Without the pin,
   `npm run regression` flipped live and overwrote the committed report with
   a 15/72 failure file — caught, restored, and `run-regression.ts` now pins
   itself. Live coverage comes from unit tests + the founder's manual pass.
2. **Latch regex widened for timeouts.** `isLiveAuthFailure` now matches
   `timed out`, `ECONNRESET`, `EPIPE`, `EACCES`, `proxy`, `CONNECT`, etc.:
   previously a stalled live attempt 500'd instead of latching to replay.
3. **Canned disputes baseline stays on the fixture mandate** so View 2 keeps
   working while the founder stress-tests a tighter session mandate; live
   disputes carry their own per-case order/provenance/meta.
4. **Live resolve mirrors the canned HATEOAS walk** (accept-claim for drift,
   require→provide→escalate→adjudicate for forgery) instead of a fixed
   chain — the first fixed chain 409'd on `adjudicate` pre-escalation.
5. **`#mandate-editor[hidden]{display:none}`**: the editor's `display:grid`
   overrode the `hidden` attribute (spotted in the recorded PNG; VM + E2E
   green but visually wrong). Auditor open made idempotent in both scripts.
6. **Stale-`dist` trap**: the first E2E re-run executed pre-fix `dist/`
   output because the script was invoked without its `tsc -b` prefix;
   always run gates via the package scripts (or rebuild first).
7. **Red-team contract kept**: creds-modal placeholders renamed to neutral
   labels rather than weakening the `not.toContain('PAYPAL_CLIENT_SECRET')`
   assertion.

## 5. Verification output (verbatim)

`npm run lint` → exit 0 (no output).
`npm run typecheck` → exit 0 (no output).
`npm run build` (`tsc -b .`) → exit 0.
`npm test` → `Test Files 9 passed (9)` / `Tests 187 passed (187)`.
`npm run regression` → gate 72/72, post-auth 57/57, referee 21/21,
overall 72/72 (95% CI [0.949, 1.000]), exit 0.
`npm run verify:e2e` → 18/18 steps PASS (auto-populate, favicon, reset,
scenario 1 + JCS-PARITY MATCH, void, block, iframes, two-step popup,
desk + both canned resolves with AG-assert, regression + 72/72 chart,
mandate edit $290-void/$320-capture, drift + forgery filing with live
resolve, ledger + custom-HTML, tour, 1366/1050/768 sweeps), zero 4xx/5xx,
zero console/page errors, zero overflow at 1600/1366/1050/768:
`E2E RESULT: PASS — zero 4xx/5xx, zero console/page errors, zero overflow`.
`npm run demo:record` → exit 0, 7 PNGs + `videos/veripact-demo-tour.webm`
(5,511,584 bytes), `demo: DONE — 7 PNGs + .webm, zero page problems`.

## 6. Risks & follow-ups

- Push is still owner-terminal (`git push origin main` now carries runs
  06–11). Three live CREATED orders sit on the founder's sandbox account
  (harmless, auto-expire) — void/ignore at will.
- Live interactive approval + capture + live dispute actions remain
  founder-manual (headed browser, sandbox buyer login).
- `seed-live-sandbox` will now attempt LIVE orders when run (by design) —
  run it only when live receipts are wanted.
- Every `npm test` refreshes `benchmark/results/regression_benchmark_report.json`
  (timestamp bump, by the test's design) — committed here as the green
  72/72 artifact of this run.
- Tour still ~70 s vs the 60 s label; `postMessage('*')` fallback for
  opaque origins unchanged; no rate-limit/CSP (demo scope).
