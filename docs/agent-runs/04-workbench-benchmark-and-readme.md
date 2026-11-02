# Run 04 — Workbench (Sequoia + AG Desk), 24-Scenario Benchmark & README

Parent state: Run 03 complete (7 packages green, 109/109). This run builds
the judge-facing surface: the single-process workbench server with the
Apple Sequoia 2-view UI + AG dispute desk, the 24-scenario regression
engine, the live sandbox seeder, and the production README.

## 1. Skill & sub-agent mapping (what each changed in the code)

- `apple-design/SKILL.md` (HIG foundations + review lens) → `ui-template.ts`:
  semantic status pills (emerald DETERMINATE, amber INDETERMINATE/DELTA,
  crimson CONFLICT/BLOCK), tabular numerals on every price/hash/timestamp,
  translucency confined to the floating header (the lens's "functional
  layer" rule), native `<details>` auditor drawer for free keyboard/SR
  support.
- `emilkowalski-skill/skills/break-ui` → hash chips (truncate + title +
  copy-on-click + horizontal-scroll inspector), `min-width:0` on all flex
  children, `escape once at render` (`esc()` on every interpolation),
  Intel-style numeric formatting via `toFixed`.
- `frontend-design` + `web-design-guidelines` (fetched fresh 2026-11-02,
  applied: aria-labels, tabular-nums, truncate handling, reduced-motion,
  focus-visible, semantic headings, labeled inputs) → template a11y pass.
- `taste` (preflight) → negative filter: no landing tropes in a dense
  workspace (no hero, no bento, no purple, system type, motion gated on
  `prefers-reduced-motion`).
- `ag-grid-skills/skills/ag-dev` (+ grid + studio recommendations, both
  read) → 560px containers, `getRowId`, dataset switch by destroy/remount
  (never in-place data mutation), console-error discipline (caught two
  inline-JS syntax errors pre-ship via the parity harness below), native
  fallback table when the CDN is unreachable.
- `security-audit` (guidance; WEB-PROTOCOL, DATA-ISOLATION,
  RESOURCE-EXHAUSTION companions) → security headers on every response,
  1MB body cap with streaming abort, route-level rung key reads, redacted
  errors, HATEOAS-conflict → 409 mapping.
- `04-sequoia-ag-workbench` → route modules, zero trademarks, no secrets in
  client bundles, every view from live API data (verified: no fetch call
  has a static-data fallback).
- `05-security-and-benchmark` → synthetic trademark-free fixtures, replay
  never on live paths, report framed as a controlled suite with CIs.

## 2. What was built

### 2.1 Regression suite (72/72, committed)

- `benchmark/scenarios/scenarios.json` — 24 synthetic storefronts (8/8/8
  benign/drift/adversarial) with full HTML, mandates, callback totals,
  expectations, and post-purchase mutations; `schema.json` updated to the
  new shape.
- `packages/sdk/src/regression.ts` — `loadScenarios`,
  `wilsonConfidenceInterval95` (exact, z=1.96), `buildScenarioMandate`,
  `runRegressionSuite` (fresh zero-key client per run; snapshot → gate →
  checkout → referee), `writeRegressionReport`; exported from the SDK.
- `benchmark/results/regression_benchmark_report.json` — committed 72-run
  report: gate 72/72 [0.949,1.000], post-auth 57/57 [0.937,1.000], referee
  21/21 [0.845,1.000], overall 72/72 [0.949,1.000], groups 24/24
  [0.862,1.000], perfectly diagonal confusion (24/33/15).
- `npm run regression` (+ `scripts/run-regression.ts`, `scripts/tsconfig.json`):
  rebuild → compile scripts → run any pass count (default 3), exit 1 on any
  failure. Scripts use direct `tsc` chains (no nested `npm run`, per the Run
  01 nested-npm lesson).

### 2.2 Workbench (12 routes, 2 views)

- `packages/workbench/src/{server,routes,ui-template,storefront-template,index}.ts`;
  deps added (core, term-extractor, witness-client, paypal-client, sdk).
- Routes: `/health` (new shape), `/`, `/store/:id` ×3, buyer sign/verify,
  witness snapshot, merchant checkout, disputes (Case B first + forensics),
  resolve, **granular dispute actions** (require/provide/escalate/accept/
  adjudicate against a shared replay engine so chains persist across
  requests), verify, benchmark (committed file + live-run fallback),
  demo reset. 404/405/413/409 JSON errors; `resetDemoState` for test
  isolation.
- Key isolation: `readRungKey(rung)` reads exactly one env key; buyer and
  witness routes are single-rung; merchant/verify routes are the documented
  composition points (README §7.2: logical isolation, one process).
- UI: Sequoia header + rung legend + view switcher; View 1 (store iframe,
  scenario buttons, B00x quote badges, mutation preview, 4 sufficiency
  pills, rung flow, checkout, WebCrypto auditor recomputing `VP1:` in the
  browser); View 2 (remounted 560px live/regression grids, confusion
  matrix, 3-column inspector with HATEOAS-gated buttons + evidence form,
  deterministic prompt bar with 3 presets, canvas charts with data-table
  fallbacks, printable evidence sheet + print CSS).
- AG Grid 32.3.9 UMD + quartz CSS pinned via jsDelivr — **both URLs
  verified HTTP 200 this session**; `createGrid` feature-detected with a
  styled native fallback (offline-safe).

### 2.3 Seeder, README, root scripts

- `scripts/seed-live-sandbox.ts` + `npm run seed:sandbox`: witnessed
  snapshot → AUTHORIZE + `custom_id` → PATCH → read-back, second surcharge
  order, live dispute listing; writes `docs/sandbox-receipts.json` and
  prints the strip. Live with `.env` creds, labeled replay without.
- `README.md`: pitch + positioning, receipts strip (matches the committed
  file), verified arXiv context (all three IDs fetched live 2026-11-02;
  18/330 + 555-census separation abstract-confirmed), ladder diagram,
  omni-surface quickstart, Wilson results table, 5-point §7 honesty block,
  compliance (correct devpost domain, zero banned claims — grep-verified).
- Root scripts: `start` (workbench), `regression`, `seed:sandbox`. Also
  added the missing MCP `index.js` entrypoint guard so `node
  packages/mcp-server/dist/index.js` serves stdio (CLI `bin` was already
  wired; both smoke-tested).

## 3. Self-corrections

1. **Two inline-JS syntax errors** (JCS `\u` escaping through the TS
   template literal; a paren imbalance in a chart label) — invisible to
   `tsc`, caught by a vm-based extraction harness, fixed (backslash-free
   `fromCharCode` JCS; simplified label), and locked in as a **committed
   test**: the auditor `jcs()` is extracted from the rendered template and
   asserted byte-identical to server `canonicalizeJson` on a receipt-like
   fixture and a nasty edge fixture (`"`, `\`, control chars, `-0`, `1e21`,
   `undefined`, functions) — JCS-PARITY-OK.
2. **Granular dispute actions need cross-request state** — added the shared
   replay engine + `resetDemoState` + `/api/demo/reset` instead of
   pretending stateless buttons work.
3. **`npm test` parallel race on the report file** — pre-generate the
   committed report before the suite (the sdk test still regenerates it;
   the workbench route falls back to a live run if the file is missing).
4. **Nested-npm avoidance** in the new root scripts (direct `tsc` chains).
5. **Test bug**: asserted raw `dispute_state` instead of normalized
   `disputeState` — fixed the test, not the product.

## 4. Verification (observed)

- `npm run lint` / `typecheck` / `build`: exit 0. (Lint once failed on my
  own stale `.vitest-tmp` extraction — deleted; scratch was mine.)
- `npm test`: **8 files / 124 green** (was 109: workbench 4→15 incl. JCS
  parity, sdk 13→17 incl. 72-run generator).
- `npm run regression` (3-pass): 72/72, exit 0. `npm run seed:sandbox`:
  replay receipts + strip, exit 0. `npx veripact witness` + MCP stdio
  `tools/list`: verified live. Workbench `listen()` is EACCES-blocked in
  this sandbox (known constraint) — routes are covered by 15 handler
  tests; the entrypoint prints correctly up to the bind.
- Grep compliance: zero `VerdiPact`/`Trustrail`/`paypalai.devpost`/`20%`/
  `Nov 5` in new files and README; receipts strip matches
  `docs/sandbox-receipts.json`.
