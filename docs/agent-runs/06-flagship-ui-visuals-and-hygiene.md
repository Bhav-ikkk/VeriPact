# Run 06 — Repo Hygiene, Run-05 Hardening, Flagship Sequoia UI & Visual README

Parent state: Run 05 complete (144/144 tests, 72/72 regression runs;
commit `8d11d5a` awaiting owner-terminal push). This run closes the three
Run-05 risks (wildcard `postMessage`, in-memory pending map, no readiness
probe), upgrades the workbench to a flagship clearing-terminal UI with a
guided judge tour, and ships committed SVG visuals + a Playwright demo
recorder behind a visual README.

## 1. Skill & sub-agent mapping (what each changed in the code)

- `apple-design` (HIG foundations) → ribbon stepper keeps semantic
  status colors, tabular numerals on every price/hash/CI, glass stays on
  the floating header only, native `<details>` auditor untouched.
- `frontend-design` (studio lens) → the ribbon/diff/tour vocabulary is
  drawn from the product (evidence rungs, disputed term names, beat
  narration), not SaaS-card defaults; one signature moment (the tour).
- `emilkowalski-skill/break-ui` → diff pills use `white-space:nowrap`
  with `min-width:0` flex parents, hashes truncate middle with full
  value in `title`, `tabular-nums` on all compared figures.
- `web-design-guidelines` (fetched fresh 2026-11-02) → tour button is a
  real `<button>`, tour narration is `role="status" aria-live`,
  `prefers-reduced-motion` shortens tour pauses, SVG screenshots get
  markdown `alt` text, no `outline:none` anywhere.
- `bundled:taste` (preflight) → killed my first ribbon draft (left-border
  accent cards); status now lives in the step-number chip + badge text.
- `ag-grid-skills/ag-dev` → View 2 untouched structurally; the tour
  drives the existing destroy/remount dataset switch (`setDataset`),
  never in-place mutation.
- `security-audit` (guidance mode) → origin-scoped `postMessage` both
  ends, `ORDER_TOKEN_RE` unchanged on all intakes, pending disk mirror
  validated shape-first (corrupt → re-witness, never 500), status
  endpoint exposes fingerprints of public keys only.
- `paypal-api-context` → confirmed Part 2 touches no PayPal API shapes
  (server-local persistence + metadata endpoint).

## 2. What was built

### 2.1 Root hygiene (Part 1)

- `git mv Idea.md`, `VERIPACT_V4_JUDGE_AUDIT.md`, `VeriPact Master Plan v4
  (1).pdf` → `docs/architecture/` (history preserved; only historical
  run reports reference the old paths, correctly left alone).
- `.gitignore` += `.veripact-pending.json`, `playwright-report/`,
  `test-results/`, `videos/`.

### 2.2 Run-05 hardening (Part 2)

- `approval-template.ts` — `postMessage` targets
  `window.location.origin` (falls back to `'*'` only for opaque
  `file://`-style origins); `ui-template.ts` listener verifies
  `e.origin` when an origin exists.
- `routes.ts` — disk-backed `pendingApprovals` mirror at gitignored
  `.veripact-pending.json` (write on stash, load-on-miss with
  `isPriorApprovalData` + scenario validation, delete on finalize,
  removed on reset); new `clearPendingApprovalsMemory()` test hook.
- `GET /api/system/status` — `{ transportMode, hasPayPalCredentials,
  envFilePath, keyFingerprints{buyer,witness,merchant} (16-hex of public
  keys), totalScenarios (live `loadScenarios()` count = 24),
  regressionPassRate ("72/72 (100%)" from the committed report) }`.

### 2.3 Flagship UI (Part 3)

- Pipeline ribbon (`#pipeline-ribbon`): 3-rung stepper with live badges
  — buyer key fp + $320 ceiling; TSA issuer, DOM scan status, Channel3
  product; `VP1:` prefix + re-gate outcome ($297.00 CAPTURED /
  $340.50 AUTO-VOIDED / BLOCKED). Lit by `ribbonFillWitness` /
  `ribbonFillCheckout` on every witness/checkout/finalize path.
- Guided tour (`#btn-tour`): 5 beats over ~60s (normal → auditor
  `JCS-PARITY MATCH`; surcharge auto-void; injection block; desk Case B
  resolve; Case A resolve + Wilson chart), stoppable mid-run, pausable
  in live mode at AWAITING, reduced-motion aware, `#tour-status`
  narration doubles as the Playwright completion marker.
- Inspector diff pills (`ContestedClaimInspectorWidget`): crimson
  `return_window_days: 60 vs 30` (B) / `30 vs 14` + `restocking_fee_pct:
  0% vs 25%` (A) in buyer + seller columns, emerald `witnessed:` pill
  in the provenance column.
- Witness/checkout/desk flows refactored into awaitable
  `runWitnessFlow` / `runCheckoutFlow` / `refreshDesk` (click behavior
  identical; enables the tour).

### 2.4 Visuals + recorder + README (Part 4)

- `scripts/generate-visual-assets.ts` (`npm run assets:generate`) —
  drives `handleWorkbenchRequest` (no sockets) and writes 5 SVG
  screenshots to `docs/screenshots/` from real checkout/dispute/
  benchmark/status data: architecture ladder, View 1 + auditor, edge
  cases, View 2 desk, Wilson CI chart.
- `scripts/playwright-record-demo.ts` (`npm run demo:record`) — boots
  the server on :4123, records Chromium 1920x1080 video + 7 PNGs while
  the in-page tour runs, saves `videos/veripact-demo-tour.webm`
  (host-only; needs `npx playwright install chromium` once).
- `playwright@1.64.1` added as a real devDependency (typed API; audit
  unchanged at 12 moderate, 0 critical).
- `README.md` — "Visual Tour (60 Seconds)" with all 5 embeds above the
  fold, quickstart +7 entries, and a "Zero-Key Instant Evaluation vs
  Live PayPal Sandbox Mode" judge guide.

## 3. Design decisions & self-corrections

- Prompt said "9 hidden-node checks" — the scanner defines **13**
  `HiddenReason` categories, so the ribbon/SVGs render the grounded
  number ("DOM scan CLEAN · 13 checks") per epistemic honesty.
- Prompt's pending path allowed two options — chose root
  `.veripact-pending.json` (works in prod + tests; `.vitest-tmp` is
  test scratch and may not exist on Render).
- `totalScenarios` first read `SCENARIO_NAMES` (= 3 demo flows); the
  failing test caught it — now reads `loadScenarios().length` (= 24
  benchmark scenarios).
- `storefront-template.ts` needed no changes (all Part 3 items are
  workbench chrome); left untouched deliberately.
- Recorder drives the in-page tour rather than re-scripting clicks:
  one autopilot implementation, Playwright observes + records.

## 4. Verification (Rule-1 gate, verbatim tail)

- `npm run lint` → exit 0. `npm run typecheck` → exit 0.
  `npm run build` → exit 0. `npm test` → 8 files, **148/148 passed**
  (+4 workbench: status metadata/secrets, disk-mirror finalize,
  origin lock, SVG validity + README refs).
- `npm run assets:generate` → 5 SVGs written (4.1–7.9KB), tag-balanced,
  content markers verified (`CAPTURED $297.00`, `JCS-PARITY MATCH`,
  `60 vs 30`, `72/72`); `tsc -p scripts` + `eslint scripts/` clean.
- `demo:record` compiles but cannot run here (sandbox blocks `listen()`
  and no Chromium is installed) — host-only by design, documented.
- Regression-report timestamp churn reverted; receipts file untouched;
  no `.veripact-pending.json` stray (gitignored regardless).

## 5. Files changed

Moved: `Idea.md`, `VERIPACT_V4_JUDGE_AUDIT.md`, `VeriPact Master Plan v4
(1).pdf` → `docs/architecture/`. New: `scripts/generate-visual-assets.ts`,
`scripts/playwright-record-demo.ts`, `docs/screenshots/*.svg` (5),
`docs/agent-runs/06-flagship-ui-visuals-and-hygiene.md`. Modified:
`.gitignore`, `README.md`, `package.json` (+2 scripts, +playwright),
`package-lock.json`, `workbench/src/{approval-template,index,routes,
ui-template}.ts`, `workbench/test/workbench.test.ts`.

## 6. Risks & follow-ups

- Run-05 commit `8d11d5a` + this run both await the owner-terminal push
  (sandbox has no GitHub credentials).
- `demo:record` needs a host run to confirm the sub-140s video.
- Tour timing (~70s with API latency) is approximate against the "60s"
  label; acceptable for a demo affordance.
- Live `checkoutnow` shape still unverified against real sandbox orders.
