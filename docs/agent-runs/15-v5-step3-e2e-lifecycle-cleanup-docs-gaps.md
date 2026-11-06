# Run 15 — v5 Step 3: byte cleanup, E2E wallet lifecycle, docs, gap reconciliation

Parent: run 14 (v5 Step 2 UI landed, 236/236 tests, 18/18 E2E).
Blueprint authority: `docs/architecture/VERIPACT_V5_AGENTIC_WALLET_PLAN.md`
Section 6, Step 3 + the GAP-01..15 register at line 160.
Prompt: v5 atomic Step 3 (E2E wallet lifecycle extension, byte
cleanup, docs and gap-register reconciliation).

## 1. What was built

**Part 1 — byte-exact NBSP cleanup (`ui-template.ts`).**
A Node codepoint script (scratch, `.vitest-tmp/`, kept out of the
commit) inventoried every U+00A0 in `ui-template.ts` under real
UTF-8 decoding: exactly 20, all inside the 4 dead overridden
`paintPartition`/`paintPair` lines from run 14. Both dead
generations were deleted with structural asserts (3 defs found, 1
kept; `paintQr` preserved between the gen-1 pair); the surviving
generation is the ASCII-only one (single spaces plus u-escapes).
Notable correction: the supposed Run-11 tour-button NBSP never
existed — ground-truth bytes are `27 25A0 20 ...` (quote, U+25A0,
plain `0x20` space); the old hit was a Windows-1252 misdecode of
the `E2 96 A0` bytes by `Get-Content`. Repo-wide scan after
cleanup: 56 files, `nbsp=0 redactedTokens=0` across all of
`packages/*/src` and `packages/*/test`; `scripts/*.ts` likewise
clean. Inline page script recompiled via `vm.Script` (83,050
chars, down from 85,684).

**Part 2 — E2E wallet lifecycle (steps 19-23 new, 23 total).**
`scripts/verify-ui-e2e.ts` keeps all 18 prior steps byte-identical
in behavior and adds, after the tour: (16) clean-load null-safe
partitions (200 + null + zero orders) and wallet DOM presence;
(17) full QR ceremony through a second context page (QR svg,
`/pair/PAIR-VP-` href, 6-digit code, ceremony title, 1-tap
approve, connected state, desktop poll to `Vault Paired` with
`PM-VP-VAULT-` and $350.00 available); (18) $297.00 capture
($350 to $53), second-spend `AUTO_VOIDED_BY_PARTITION_WALL`
($53 held, `data-state=wall`), refund restore ($53 to $350),
ledger kinds incl. exactly 2 `wallet-spend`; (19) sync grid
(shell visible, both AG shells hidden, legacy + protected +
`VP1:` + disclosure + `FALLBACK_TO_REPLAY_AND_SESSION_ORDERS`
scope text, then live/regression switch-back with AG engine and
560 px heights); (20) connector mints (chat + MCP outputs
distinct, `/openapi.json` + `mcp-server` instructions, card copy,
exactly 2 `vp_` values, zero raw values in later ledger reads).
`main()` pins `VERIPACT_WALLET_STATE_FILE` to `.vitest-tmp` and
removes the store in `finally`, extending the hermetic discipline.
One-line UI addition supports step 19: the sync summary line now
renders `[scope: <reportingScopeStatus>]` (pure ASCII). Two unit
guards added to `wallet-routes.test.ts`: rendered index page has
zero NBSP (regex built from an ASCII escape after a literal NBSP
was caught landing in the first draft and fixed by codepoint
surgery) and zero redactor-output tokens (needle assembled from
parts so the guard itself keeps the scan at zero), plus first-paint
v5 DOM-id presence. Suite now **238/238 across 16 files**.

**Part 3 — docs.** New README thesis section (v5 Agentic Wallet
and Witnessed Clearing, with verified 238/238 + 23-step counts);
MCP quickstart corrected to 7 tools (4 base + pair/sync/spend);
receipts strip gained a CREATED-only founder-manual note;
README §7 and DEVPOST honesty each extended 5 → 9 bullets (LOCAL
SIMULATION desk, CREATED-only receipts, withheld surcharge match,
async Transaction Search reconciliation); DEVPOST counts fixed
156/156 → 238/238 + 23-step E2E (route-count clause dropped
rather than re-staled), What-It-Does + sponsor bullets gained v5
paragraphs; WIN_CHANCE contest figures bannered stale as of
2026-11-02. Deliberately untouched: dated historical counts in
run ledgers and `SECURITY_AUDIT.md` (§5/§6 record the gate at
audit time — rewriting them would falsify the record), frozen
`Idea.md` / judge-audit analysis, and the untracked v5 plan
itself. Submission surfaces carry zero competitor claims
(verified by search), so GAP-07/08 hold by absence.

## 2. Skills and tools consulted

`bundled:durable-test-collateral` was loaded for the E2E sync-scope
correction (test-expectation fix, no product change; the maintained
E2E step keeps the corrected assertion). `paypal-api-context` was
assessed and declined: this run changes no PayPal calls, only docs,
E2E assertions, dead-code deletion, and one ASCII UI string. No
marketplace design skills apply to the ASCII-only template edits.

## 3. Decisions and self-corrections

1. **Node script via file, not literal `node -e`.** The prompt
   asks for `node -e`; the script went in a scratch file for
   quoting safety through PowerShell. Identical operation (raw
   codepoints, assert-then-write), noted here instead of silently
   substituted.
2. **E2E sync-needle scoping (test bug, owned).** Step 19 first
   failed asserting `3-hour` inside `#sync-body`; the disclosure
   lives by design in the `.sync-note` banner. Fixed the
   expectation to scope row needles at `#sync-shell` (banner +
   body), keeping the dedicated banner assertion. No product
   change; re-ran green.
3. **Task-ID drift resolved against code truth.** The prompt
   names `#qr-box` and `#btn-wallet-refund`; the shipped DOM uses
   `#qr-svg-box` and `#btn-part-refund`. E2E asserts the real IDs.
4. **GAP-14 split reconciled.** The prompt labels both the thesis
   section and the visual audit GAP-14; the blueprint defines
   GAP-14 as audit + missing AI sentence jointly. Docs half is
   delivered this run; the human audit stays founder-external, so
   the gap dispositions as DISCLOSED with the docs evidence cited.
5. **Redactor discipline held.** No `Bearer` + space + `token`
   bigram in any param, file, or message; entity pattern reused
   from run 14 where the visible phrase must render; prose uses
   scoped API credential / one-time credential value.

## 4. Verification (repo root)

- `npm run lint` — exit 0.
- `npm run typecheck` — exit 0.
- `npm run build` — exit 0.
- `npm test` — **238/238 across 16 files** (236 prior + 2 byte
  guards), zero edits to existing assertions.
- `npm run verify:e2e` — **PASS, 23/23**: steps 01-15 prior flow,
  16 clean load, 17 pairing, 18 spend/wall/refund, 19 sync grid,
  20 connectors, 21-23 viewport sweeps (1366/1050/768 all
  `scrollWidth == clientWidth` both views; store iframes 310 px,
  zero inner scroll). Zero 4xx/5xx, zero console/page errors.
- Byte scans: ui-template NBSP 20 → 0 with tour-label ground
  truth `27 25A0 20`; repo `scanned=56 nbsp=0
  redactedTokens=0`; `scripts/` clean; edited markdown clean.
- Worktree: benchmark timestamp churn reverted again after E2E;
  `.vitest-tmp` scratch scripts stay untracked (gitignored).

## 5. GAP-01..15 final dispositions

CLOSED = code + test verified, with references. DISCLOSED =
founder-external gate with the honest disclosure location.

| Gap | Disposition | Evidence |
|---|---|---|
| GAP-01 spec absent | CLOSED | Frozen by `docs/architecture/VERIPACT_V5_AGENTIC_WALLET_PLAN.md` §6; implemented across runs 13-15 per that spec |
| GAP-02 leaf bodies unread | CLOSED | Full-body reads in run 13 (crypto, paths, extractor, witness-client); `witness-client` + `term-extractor` byte-identical since (zero diffs, all extraction/TSA tests green) |
| GAP-03 workbench/sdk bodies unread | CLOSED | Full-body reads in run 13 (server, approval/storefront templates, sdk client/regression); routes/ui-template extended additively only |
| GAP-04 PayPal primitives zero code | CLOSED (as scoped) | `paypal-client/src/{vault,reporting,refunds,payment-sync}.ts` + replay engine seams; `wallet-paypal.test.ts` (7). Payouts/Invoicing explicitly out of v5 scope per plan §3 |
| GAP-05 reporting sandbox unconfirmed | CLOSED (fallback exit) | Honest 403/transport fallback + `FALLBACK_TO_REPLAY_AND_SESSION_ORDERS` scope in `reporting.ts`/`wallet-routes.ts`; paypal + route + E2E-step-19 coverage |
| GAP-06 reporting constraints unhandled | CLOSED | `validateSearchWindow` (RFC 3339, 31-day, pageSize), D/P/S/V mapping, 3-hour disclosure constant; unit-tested |
| GAP-07 Warrant/Mandate single-source | CLOSED | Zero competitor claims in README/DEVPOST (search-verified); frozen judge-audit docs stay internal analysis, not submission copy |
| GAP-08 Carte Blanche concept-only | CLOSED | Same absence as GAP-07; v5 copy never names it, implementing the prescribed fix without rival framing |
| GAP-09 CREATED-only live proof | DISCLOSED | README §7.7 + strip note, DEVPOST honesty 7, `docs/sandbox-receipts.json`; founder path: approve each seeded order as sandbox buyer, run Finalize |
| GAP-10 surcharge match withheld | DISCLOSED | README §7.8, DEVPOST honesty 8; real-clock TSA non-reproducibility stated, judge re-witness untested |
| GAP-11 no hosted URL/video | DISCLOSED | No URL/video claimed in any submission surface; founder gates: Render deploy + sub-3-min YouTube upload |
| GAP-12 stale numbers | CLOSED | DEVPOST 156 → 238/238 + 23-step E2E; README thesis counts; WIN_CHANCE bannered stale as of 2026-11-02; dated audit/ledger counts preserved as history |
| GAP-13 desk locality | CLOSED | `simulationDesk: true` in engine + UI copy + README §7.6 + DEVPOST honesty 6; covered by desk/dispute unit tests |
| GAP-14 audit + AI sentence | DISCLOSED (docs half done) | AI sentence now in README thesis + DEVPOST v5 copy; human visual audit vs Hallmark bar remains founder-external |
| GAP-15 isolation/store/polling/locks | CLOSED | Rule-2 route modules, disk-mirrored wallet store + `resetDemoState`, polling-first pairing + postMessage, voided/refunded one-way locks; wallet unit + route + E2E 16-20 coverage |

## 6. Files changed

- Modified: `packages/workbench/src/ui-template.ts` (dead-code
  deletion + `[scope: ...]` summary text),
  `packages/workbench/test/wallet-routes.test.ts` (+2 guards),
  `scripts/verify-ui-e2e.ts` (steps 16-20 + wallet-state
  isolation), `README.md`, `docs/DEVPOST_SUBMISSION.md`,
  `docs/WIN_CHANCE_ANALYSIS.md`, this ledger (new).
- Untouched: `witness-client`, `term-extractor`, all 236 prior
  assertions, all 18 prior E2E steps, benchmark churn reverted,
  scratch Node scripts kept in gitignored `.vitest-tmp/`.
