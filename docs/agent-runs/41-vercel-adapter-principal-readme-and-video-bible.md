# Run Ledger 41 -- Vercel Adapter, Principal README, and Video Bible

**Date:** 2026-11-11
**Prompt Target:** Step 1A (Vercel serverless adapter + EROFS guard + GET poll-now), Step 1B (`demo:record` monochrome screenshot refresh), Step 1C (README + DEVPOST rewrite), Step 1D (`VIDEO_STORYLINE_PRODUCTION_BIBLE.md`), Step 1E (gate + atomic commit). Critical rule: zero UI CSS/component-geometry changes.
**Parent State:** Run 40 complete (`347/347` unit tests, `28/28` E2E). Note: run 40's `9a8947a` was confirmed on `origin/main` (user pushed manually; local ref matches).
**Result:** Run 41 complete. Gate green: `lint` 0, `typecheck` 0, `build` 0, `349/349` unit tests across 19 files (+2), E2E `PASS` across 28 steps. UI lock verified: `git status` shows zero changes under `packages/workbench/src/components/`. Committed locally; push attempted (sandbox has no GitHub auth — same blocker as runs 39/40, user pushes manually).

---

## 1. What Was Built

### A. Step 1A -- Vercel serverless adapter

- EROFS guard: `resolveWalletStateFile` (`packages/sdk/src/wallet.ts`) and `resolveFleetStateFile` (`packages/workbench/src/fleet-store.ts`) now resolve defaults into `os.tmpdir()` when `process.env.VERCEL` is truthy and no explicit path/env override was given. Explicit paths and `VERIPACT_*_STATE_FILE` overrides still win everywhere; local behavior without `VERCEL` is byte-identical.
- `api/index.mjs` (new): default Vercel handler passing `(req, res)` straight to `handleWorkbenchRequest` — valid because the handler already accepts raw Node req/res (streams bodies via `req.on`, documented on `WorkbenchRequest`). The named ESM→CJS import was verified working under Node 22 before committing to it.
- `vercel.json` (new, exactly as specified): `npm run build`, `public` output dir, `api/index.mjs` 30s max duration with `includeFiles`, full rewrite to the adapter. `public/.gitkeep` keeps the output-directory check green.
- `GET /api/agents/poll-now` alongside POST for Vercel Cron (empty body parses to `{}`, so the existing handler path serves both; other methods still 405).
- `api/` is invisible to all gates (tsc references, typecheck include, and eslint cover only `packages/` + configs), so the adapter cannot break them; it was validated instead by direct execution (GET poll-now 200 + streamed-POST web-hunt 200 with a real `HUNT-VP-*` result).
- Tests (+2 in `wallet-routes.test.ts`): GET+POST poll-now 200 with `polledAgents` array; `VERCEL=1` resolves both state files into `os.tmpdir()` with explicit-path precedence (full env save/restore hygiene since `VERCEL` is outside the file's ENV_VARS list).

### B. Step 1B -- Screenshot refresh

- `npm run demo:record`: 16 PNGs regenerated (`live-00` … `live-14` incl. `live-05b`) + `.webm`, zero page problems. Spot-checked `live-00-agent-studio.png`: locked Run 39 monochrome UI confirmed (carbon/zinc, equal-height rows, 36px buttons, concise labels, grayscale store art, zero purple, zero 3D robot).

### C. Step 1C -- README + DEVPOST rewrite

- `README.md` restructured to principal-engineer standard: 3-sentence architectural statement, Visual Evidence (5 required PNG views + the 6 data-driven SVGs), 3 Mermaid architecture diagrams (3-rung pipeline, partition/watcher engine, web-hunt), 8-package map, exact verification table (**349/349**, **28/28**×4 viewports, **60/60** swarm, **72/72** regression with Wilson CIs), preserved live sandbox receipts + arXiv research context, quickstart with stale UI labels fixed (`Tour`, `Two-step popup (live)`, `Authorize $297.00`) + Vercel deploy note, and the new `## Where It Breaks` (5 boundaries, all codebase-grounded) alongside the kept §7 Honesty list.
- `docs/DEVPOST_SUBMISSION.md` rewritten paste-ready: updated numbers (349/349, 28-step), ASCII architecture diagrams (Devpost renders no Mermaid), screenshot upload list, condensed Where It Breaks, `vercel` added to Built With, ship checklist extended with `TBD_OWNER_VERCEL_URL` + video-bible pointer.
- Corrections to the brief's citations (Rule 3): the 72/72 regression file is `benchmark/results/regression_benchmark_report.json` (`latest_report.json` does not exist); the drift case id is `PP-D-CASE-A-DRIFT` (not `PP-D-CASE-A`); unit count is exactly 349 (not "348+"). Every stat and ID in both docs was verified against code or committed artifacts.

### D. Step 1D -- Video bible

- `docs/VIDEO_STORYLINE_PRODUCTION_BIBLE.md`: 2:35 scene-by-scene plan (cold open → two breaks → witness pipeline → sniper traps → watcher capture → dispute referee → proof strip), VO scripts, UI-cut references, and a real-data cast table (APEX $347→$297/PAYPAL50, FlashTech 0-day trap, FreightKing +$55, KANSO $149→$100/AUDIO67, `PP-D-CASE-A-DRIFT`).

## 2. Skills / Tools Consulted

- `bundled:git` (pre-commit history-write safety; user explicitly authorized this exact add/commit/push in the task text).
- No design or PayPal-API skill applied: the critical rule forbade UI changes, and no PayPal API logic was touched (the `paypal-api-context` reminder's condition did not hold).

## 3. Architectural Decisions and Self-Corrections

1. **Verbatim adapter snippet after empirical check.** The brief's `api/index.mjs` passes raw `(req, res)` through; valid only because `handleWorkbenchRequest` streams bodies itself. Verified the named ESM→CJS import under Node 22 first, then shipped the snippet verbatim plus a comment block.
2. **No `tsc`/`eslint` coverage for `api/`** — by existing config scope, not by exemption. Compensated with a direct-execution smoke test (GET + streamed POST both 200).
3. **README test contract caught a real regression.** My first rewrite dropped the SVG embeds and `ships 5 valid SVG screenshots referenced by the README` failed. Per the no-weakening rule, the SVGs went back into a dedicated subsection — the test was satisfied, not edited.
4. **Brief citations corrected, not obeyed blindly.** `latest_report.json`, `PP-D-CASE-A`, and "348+" were each verified wrong against the tree and replaced with the real `regression_benchmark_report.json`, `PP-D-CASE-A-DRIFT`, and 349.
5. **Stale UI labels fixed in passing.** The old docs named pre-Run-39 button copy (`Run 60s Guided Demo Tour`, `Two-step approval`, `Authorize with PayPal`, `● Live Sandbox Ready`); the rewrite uses current labels and drops the unverifiable header claim.

## 4. Verification Output

Gate (repo root, portable toolchain, in order):

```
npm run lint       -> exit 0 (eslint, clean)
npm run typecheck  -> exit 0 (tsc --noEmit, clean)
npm run build      -> exit 0 (tsc -b, clean)
npm test           -> Test Files 19 passed (19) / Tests 349 passed (349)
```

`npm run verify:e2e` -> `E2E RESULT: PASS -- zero 4xx/5xx, zero console/page errors, zero overflow` (exit 0, 28 steps).
`npm run demo:record` -> 16 PNGs + `.webm`, zero page problems.
Adapter smoke (direct execution): GET poll-now 200, streamed-POST web-hunt 200 with `HUNT-VP-*` result.

Commit: `feat(deploy,docs): add Vercel serverless adapter, refresh monochrome screenshots, and rewrite README with Where It Breaks` (scoped add of `api/`, `vercel.json`, `public/`, `packages/`, `README.md`, `docs/DEVPOST_SUBMISSION.md`, `docs/VIDEO_STORYLINE_PRODUCTION_BIBLE.md`, `docs/screenshots/`, this ledger). Push: sandbox has no GitHub auth (user pushes manually).
