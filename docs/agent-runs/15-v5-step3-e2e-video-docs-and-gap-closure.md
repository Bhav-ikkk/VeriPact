# Run 15 (final lock) — v5 Step 3: tour step 7, video, docs, gap closure

Parent: f1a0f78 (previous turn's Run-15 lifecycle work, verified and
committed first this turn). Blueprint: v5 plan §6 Step 3. Note: the
prompt's baseline (Run 14, 236/236, 18 E2E) predates f1a0f78, so
this run builds on 238/238 + 23/23 and reports superset numbers
throughout; mappings to the prompt's step/count scheme are below.

## 1. What was built

**Tour step 7 (`ui-template.ts`).** `runTour` keeps steps 1-6
byte-identical and appends a skip-safe step 7 (guarded on
`#btn-pair-approve` presence): highlight `#wallet-card`, mint a QR
session, spotlight the ceremony link, approve through the same
real `POST /api/wallet/pair/approve` the phone page calls
(narrated as the phone tap), capture $297 ($350 to $53), second
spend into `AUTO_VOIDED_BY_PARTITION_WALL`, Refund Undo back to
$350, then View 2 `#ds-sync` + connectors highlight, finishing on
the unchanged `Tour complete`. Badges moved `STEP n / 6` to
`STEP n / 7` (static toast, `tourStep`, comment). Deviation from
the prompt letter, documented: `#btn-pair-approve` is a ceremony
link (`target=_blank`), not an approver — clicking it in-tour
would strand a tab, so the tour performs the equivalent real
approval call instead. Real-time tour now runs ~85s; the pinned
"60s" button label is untouched (prompt-silent, snapshot risk).

**E2E hardening (`verify-ui-e2e.ts`).** Connectors step asserts
`GET /openapi.json` 200 + `openapi: "3.1.0"`. Step 16 gained a
wallet-phase `/api/demo/reset` first: without it, the tour's own
step-7 pairing/spend/refund breaks step 16's null/0 and step 18's
spend-count determinism. Prompt-map: prompt steps 19-22 equal
shipped steps 17, 18, 20, 19 (order differs; shipped suite adds
clean-load 16 and keeps sweeps 21-23) — 23/23 is the prompt's 22
plus one.

**Visual assets (`generate-visual-assets.ts`).** New
`06-v5-agentic-wallet-partition-and-sync.svg` (QR pair, partition
wall, sync, connectors — every number from live route calls,
masked credentials only). Also fixed a real defect the gate
exposed: with live `.env` on disk, `/api/demo/reset` 400s, so the
script now pins the hermetic env (keys deleted, absent env file,
isolated wallet store) exactly like E2E. 01-05 regenerated:
timestamp + real-clock commitment refresh only, fingerprints
identical, zero external references to the old hashes.

**Demo recorder (`playwright-record-demo.ts`).** Wallet arc first
(beats 1-3: QR, paired, spend, wall, refund, sync, connectors),
then the checkout arc re-shot (beats 4-8); 14 PNGs
(`live-01..14`, old 7 names `git rm`d) + 8.1 MB
`videos/veripact-demo-tour.webm`, zero page problems. Wallet
state isolated via tmp store + `finally` cleanup.

**Docs.** Verbatim v5 thesis sentence prominent at the top of
README (blockquote) and DEVPOST (new `## v5 Thesis`): "PayPal
moves the money. VeriPact clears the intent — combining a
Partitioned Agentic Wallet (QR pairing, hard sub-balance caps,
ChatGPT/Claude connectors) with automatic 3-Rung (SELF → WIT →
SIGN) merchant-promise witnessing on every payment." CLI wallet
commands added to README quickstart with verified flags
(`--total/--max-order/--ask-above` — checked against the parser,
not memory); DEVPOST gained a Try-it line; `receiptCore`
determinism appended to README §7.8 + DEVPOST honesty 8;
`VIDEO_VOICEOVER_SCRIPT.md` rewritten to the recorded 8-beat
order (352 words, ~140s, acronym-free, header count verified by
script); `SECURITY_AUDIT.md` gained §8 (v5 surface review:
possession-only pairing demo model, one-time credential handling,
ceremony escaping, Rule-2 intact); DEVPOST gained §5 founder
checklist with `TBD_OWNER_RENDER_URL` / `TBD_OWNER_YOUTUBE_URL`
slots (no fabricated URLs anywhere); fixed two stale claims
found en route (recorder 1920x1080 → 1600x900, "5 SVGs" → 6 in
two places). README tour embeds 06. Submission surfaces still
carry zero competitor claims (GAP-07/08 hold by absence).

## 2. Skills and tools consulted

No skill loads this turn. The behavior change (tour step 7) keeps
its maintained proof in-repo: E2E 15 runs the full 7-step tour,
E2E 16-20 re-prove the wallet arc independently, and the VM
handler test still passes (tour aborts at step 1 under stubs by
design). `paypal-api-context` not applicable (no PayPal call
changes).

## 3. Decisions and self-corrections

1. **Two commits, previous first.** The prior turn's tree was
   diff-reviewed (test diff pure-additive, template deletions
   exactly the dead generations) and committed as f1a0f78 before
   any new edit; this run commits separately below.
2. **Prompt-count reconciliation.** Prompt says 236/236 + 22/22;
   verified truth is 238/238 (16 files) + 23/23 E2E + 72/72
   regression. Docs and ledger report truth; the mapping (extra
   clean-load step + 2 byte guards from f1a0f78) is stated, never
   hidden.
3. **E2E reset fix (no weakening).** Tour step 7 pollutes wallet
   state for later steps; fixed with a phase reset, not relaxed
   assertions.
4. **Recorder wallet-first.** Matches the prompt's arc order and
   the rewritten voiceover; PNG renames accepted (all bytes
   regenerate deterministically anyway).
5. **Audit history preserved.** SECURITY_AUDIT §§5-6 counts stay
   as the dated record; currency lives in the new §8 addendum.

## 4. Verification (repo root, exact)

- `npm run lint` — exit 0.
- `npm run typecheck` — exit 0.
- `npm run build` — exit 0.
- `npm test` — 238/238 across 16 files.
- `npm run assets:generate` — exit 0, 6 SVGs, wallet arc
  `CAPTURED/AUTO_VOIDED_BY_PARTITION_WALL`, 72/72 regression.
- `npm run verify:e2e` — PASS 23/23 (01 load, 02 favicon, 03
  reset, 04-07 scenarios, 08 iframes, 09 popup, 10 desk, 11
  regression, 12 mandate, 13 filing, 14 ledger, 15 7-step tour,
  16 clean load, 17 pairing, 18 spend/wall/refund, 19 sync, 20
  connectors+OpenAPI, 21-23 sweeps). Zero 4xx/5xx, zero
  console/page errors, zero overflow all viewports.
- `npm run demo:record` — exit 0, 14 PNGs + 8.1 MB webm, zero
  page problems.
- Byte scans: ui-template + scripts + all touched markdown at
  zero NBSP; thesis arrows verified U+2192 with `0x20`
  neighbors; voiceover recount 352 words after trimming from
  406 (one duplicated fragment caught and fixed).

## 5. GAP-01..15 final dispositions (reconciled)

CLOSED = code + test verified. DISCLOSED = founder-external gate.

| Gap | Disposition | Evidence (new in bold) |
|---|---|---|
| GAP-01 spec absent | CLOSED | v5 plan §6 frozen; runs 13-15 implement it to the letter |
| GAP-02/03 bodies unread | CLOSED | Run-13 full reads; witness/extractor byte-identical; UI/scripts extended additively (**tour**, **recorder**, **assets**) |
| GAP-04 primitives | CLOSED (scoped) | vault/reporting/refunds/sync + tests; Payouts/Invoicing out of v5 scope per plan |
| GAP-05 reporting sandbox | CLOSED (fallback) | 403/transport fallback + scope; paypal/route/E2E-19 coverage |
| GAP-06 reporting constraints | CLOSED | validateSearchWindow + mapping + disclosure; unit-tested |
| GAP-07/08 rival bounds | CLOSED | Zero competitor claims in submission surfaces (search-verified); **no rival names added by the v5 copy** |
| GAP-09 CREATED-only | DISCLOSED | README §7.7 + strip note, DEVPOST honesty 7, receipts file; founder approve+Finalize path documented |
| GAP-10 TSA non-repro | DISCLOSED | README §7.8 + DEVPOST 8 **with receiptCore determinism clause**; re-witness untested, stated |
| GAP-11 URL/video | DISCLOSED | **TBD_OWNER slots in DEVPOST §5**; webm recorded locally (gitignored); upload + deploy are founder steps |
| GAP-12 stale numbers | CLOSED | 238/238 + 23/23 + 72/72 + 6 SVGs current everywhere live; **recorder resolution + SVG counts fixed**; dated records preserved as history |
| GAP-13 desk locality | CLOSED | `simulationDesk: true` engine + UI + docs; desk/dispute tests |
| GAP-14 audit + AI sentence | DISCLOSED (docs done) | **Verbatim thesis atop README + DEVPOST**; human visual audit founder-external |
| GAP-15 isolation/store/polling | CLOSED | Rule-2 modules, mirrored store + resets (**E2E/recorder/assets all isolated**), polling-first pairing, one-way locks; unit + route + E2E coverage |

## 6. Files changed

- Modified: `ui-template.ts` (tour step 7 + badges),
  `verify-ui-e2e.ts` (OpenAPI assert + phase reset),
  `playwright-record-demo.ts` (8 beats + isolation),
  `generate-visual-assets.ts` (06 + hermetic pin),
  `README.md`, `DEVPOST_SUBMISSION.md`, `SECURITY_AUDIT.md`,
  `VIDEO_VOICEOVER_SCRIPT.md`, SVGs 01-05 (regen), this ledger.
- Added: `06-*.svg`, `live-01..14.png` (7 old names removed).
- Untouched: `witness-client`, `term-extractor`, all 238 prior
  assertions, videos/ (gitignored), scratch scripts (gitignored).
