# Run 14 — v5 Step 2: wallet routes, QR pairing UI, partition bar, sync grid, connectors

Parent: run 13 (v5 Step 1 backend landed, 223/223 tests, 18/18 E2E).
Blueprint authority: `docs/architecture/VERIPACT_V5_AGENTIC_WALLET_PLAN.md` Step 2.
Prompt: v5 atomic Step 2 (workbench wallet routes, phone QR pairing
ceremony, partition bar, legacy-vs-protected sync grid, ChatGPT/Claude
connectors UI — additive only).

## 1. What was built

**Part 1 — `packages/workbench/src/wallet-routes.ts` (new, ~450 lines).**
Ten routes behind the shared security headers, 1 MB body cap, and
redacted JSON errors, mounted from `routes.ts` dispatch (circular
import is call-deferred, safe under CJS/ESM): `GET /pair/:sessionId`
(safe-token regex, `400` malformed / `404` unknown, `SAMEORIGIN`
ceremony page), `POST /api/wallet/pair/start`,
`GET /api/wallet/pair/status` (polling, null-safe partition),
`POST /api/wallet/pair/approve` (vault + $350 partition init),
`GET/POST /api/wallet/partitions` (GET is 200-with-null before
pairing so page load never 4xx), `POST /api/wallet/spend-check`
(`dryRun` pure-verdict mode vs full witnessed
capture/wall-void/block execution, optional `executionMode` +
`withLiveFallback` harmony), `POST /api/wallet/refund` (defaults to
latest capture), `GET /api/wallet/sync` (records + summary counts +
3-hour disclosure + honest `FALLBACK_TO_REPLAY_AND_SESSION_ORDERS`
scope — the merge never calls Transaction Search, and says so),
`POST /api/wallet/connectors` (CHATGPT_ACTION/CLAUDE_MCP/CURSOR_MCP;
raw one-time value leaves the server exactly once, ledger carries
the masked form only). Wallet-domain `wallet: ...` errors map to
honest 400s; method mismatches answer 405 in-module; unknown
sub-paths fall through to the generic 404. `routes.ts` gained three
additive `@internal` exports (`demoClientFor`, `parseExecutionMode`,
`withLiveFallback`), a `...WALLET_ROUTES` spread in `ROUTES`, and
the dispatch hook.

**Part 2a — `packages/workbench/src/wallet-template.ts` (new, 699 lines).**
Dependency-free QR encoder (byte mode, ECC-M, V1-V6,
Reed-Solomon, all-8-mask penalty selection) verified
matrix-for-matrix against the independent `qrcode` oracle (scratch,
removed after green), `qrMatrixToSvg` (76 px, quiet zone),
`QR_CLIENT_JS` (self-contained functions serialized for the
browser), `WALLET_CSS` (new selectors only, `min-width:0`
everywhere, internal-scroll shells), `walletCardHtml`,
`connectorsRowHtml`, `syncShellHtml`, and `renderPairPage`
(standalone mobile ceremony: session + 6-digit code + payer +
$350 terms + 1-tap approve + green connected state +
same-origin `VERIPACT_WALLET_PAIRED` postMessage).

**Part 2b — `ui-template.ts` integration (additive).**
Tier B pill `#rb-partition` inside `.rb-title` (no grid-track
changes, wraps clean); `#wallet-card` between the checkout split
and Tier D (`#store-frame` 310 px untouched); `#connectors-row`
above the dataset bar with `#btn-mint-chatgpt` / `#btn-mint-mcp`;
`#ds-sync` third toggle + `#sync-shell` (live/regression grids
byte-identical); `setDataset` extended to a 3-way switch with
identical live/regression behavior; CSV export guards sync;
`resetDemo` resets wallet UI; client JS in house ES5 style with
explicit `function(e)` params (no global `event`), QR render,
2 s approval polling + postMessage fast path, partition paint
(healthy/low/wall), spend/refund/config flows, connector mint
render, sync-table render reusing `.matrix` + `.pill` + `esc()`.
Initial load issues one null-safe `GET /api/wallet/partitions`
(200 always, silent catch) — zero load-time 4xx by construction.

**Part 1c — SDK + OpenAPI.** `VeriPactWallet` gained two read-only
getters the routes need (`getPairingSession`, `listOrders`; +11
lines, no behavior change). `openapi-route.ts` now documents all
ten wallet routes as live (pair/start, pair/status,
pair/approve, partitions, spend-check dual mode, refund,
connectors) with `PairingSession` + `ConnectorScope` schemas;
partitions GET and sync response shapes corrected to route truth.

**Part 3 — `packages/workbench/test/wallet-routes.test.ts` (new, 13 tests).**
Hermetic env (mirrors `workbench.test.ts` + isolated
`VERIPACT_WALLET_STATE_FILE`): full pairing ceremony incl. pair-page
HTML + headers, 400/404/405 matrix, null-partition GET + upsert +
validation 400s, dry-run verdicts (ALLOW/UNWITNESSED/ASK_HUMAN,
zero state movement), $297 capture ($350 to $53) then
`AUTO_VOIDED_BY_PARTITION_WALL` ($53 held) + ledger kinds, refund
restore ($53 to $350) + double-refund 400, sync split (3 legacy,
protected VP1:, disclosure, scope) + 405, connector mint (distinct
one-time values, absent from all later reads) + 400s, unknown-path
404, QR determinism/V2/finders/SVG, `node:vm` browser-source
parity, pair-page pending/approved/escape units.

## 2. Skills and tools consulted

No marketplace skills were loaded this run. Two system nudges were
assessed and declined on the record: `paypal-api-context` (no new
PayPal calls were added — vault/refund/reporting reuse the
Step-1-verified modules) and the frontend design skills (the work
extends pinned editorial-fintech CSS/DOM by hand; no redesign).
All verification used the repo toolchain (portable node,
proxy-aware npm, sandbox-safe env).

## 3. Decisions and self-corrections

1. **Secret-redactor discovery (root-caused, not worked around
   blindly).** Exact-match edits containing the `Bearer` + `token`
   word pair failed while every sub-span matched. Byte dumps
   proved the file held a plain `0x20` space: the harness rewrites
   that bigram to `[REDACTED]` in tool I/O. Fix: the ChatGPT card
   renders the phrase via `Bearer&#32;token` (entity;
   textContent is byte-identical to a plain space), and all new
   prose avoids the bigram. One redactor-mangled comment was
   reworded after a repo-wide `[REDACTED]` scan.
2. **NBSP emission quirk (measured, contained).** Separate from
   the redactor: spaces adjacent to middle dots (and one
   multi-space run) landed as U+00A0 in two client-JS lines,
   found by char-code dumps. Since the poisoned spans are
   unmatchable, the authoritative `paintPartition`/`paintPair`
   are clean ASCII-only redefinitions (single spaces,
   `\uXXXX` escapes) appended later in the same script — last
   declaration wins, all versions parse. A full NBSP scan shows
   zero strays in `wallet-template.ts`, `wallet-routes.ts`,
   `openapi-route.ts`, `routes.ts`, and the live UI code; the
   four dead lines plus one pre-existing run-11 NBSP (tour
   button label, untouched pinned code) are the complete
   inventory. Direct non-ASCII literals (dots, dashes, circle)
   were byte-verified correct everywhere else.
3. **Template-literal `\n` bug (real 500-class defect, fixed).**
   `\n` inside the page template literal renders as a raw
   newline, which broke two single-quoted JS strings and failed
   the pinned VM tests. Fixed to `\\n` at all 8 sites; dist
   `vm.Script` compile plus the full suite now pass.
4. **Test bug owned, not code-weakened.** A new assertion
   wrongly expected the pending pair page to lack the
   connected-state string that legitimately lives in its
   `<script>`; the check was rewritten to assert on the
   `#pair-action` container instead.
5. **Honesty calls.** Sync scope reports FALLBACK (no Reporting
   call is made); pair/status and partitions GET are 200-with-null
   before pairing; connector ledger rows carry masked values
   only; no PayPal behavior changed on any live path (Rule 3
   intact — this step adds no live PayPal calls at all).

## 4. Verification (all from repo root, exit 0)

- `npm run lint` — exit 0.
- `npm run typecheck` — exit 0.
- `npm run build` — exit 0.
- `npm test` — **236/236 across 16 files** (223 prior untouched
  and green + 13 new), incl. the strict VM client-script tests.
- `npm run verify:e2e` — **PASS**: 18/18 steps, zero 4xx/5xx,
  zero console/page errors, zero overflow:
  1600x900 (view1/view2 1600=1600), 1366x768 (1366=1366),
  1050x800 (1050=1050), 768x1024 (768=768); all store
  iframes scrollHeight=310 with zero inner scroll.
- Byte-level checks: `Bearer&#32;token` entity bytes,
  `\uXXXX` ASCII escapes, NBSP inventory scan, dist
  `vm.Script` compile of the 85,684-char inline script.

## 5. Gaps carried (no new gaps opened)

GAP-04/05/06/09/10/11/12/13/14/15 unchanged from run 13 (live
vault shape, Transaction Search scope, live CAPTURED/VOIDED
rows, surcharge match, hosted URL/video, contest numbers,
LOCAL SIMULATION desk, visual audit, QR store/SSE). Known
cosmetic debt: four dead overridden client-JS lines carry
NBSP artifacts (unreachable, parse-clean); removal awaits a
byte-exact edit path and is safe to defer.

## 6. Files changed

- New: `packages/workbench/src/wallet-routes.ts`,
  `packages/workbench/src/wallet-template.ts`,
  `packages/workbench/test/wallet-routes.test.ts`,
  this ledger.
- Modified: `packages/workbench/src/routes.ts` (mount +
  3 additive exports), `packages/workbench/src/ui-template.ts`
  (additive UI + client JS), `packages/workbench/src/openapi-route.ts`
  (live wallet surface), `packages/sdk/src/wallet.ts` (+11-line
  read getters). `witness-client` / `term-extractor` untouched;
  benchmark churn reverted; no existing assertion modified.
