# Agent Run 25 — v6 red team, partition mutex, and input hardening

**Date:** 2026-11-07  
**Status:** PASS (lint, typecheck, build, `npm test` 17 files / 264 tests, `npm run verify:e2e` 24 checks, live browser break pass)  
**Task:** Break the v6 sniper, partition lock, voucher parser, and embed surface, then lock every vector that failed. Recheck Parts 1–4 in a live browser and close the flaws that pass found.

## What was built

1. `withWalletFileLock` and `VeriPactWallet.runExclusive` serialize partition mutations per state file. The sniper holds the lock for the whole hunt and reloads the file before it reads `availableUsd`. Nested capture on the same instance does not deadlock.
2. `syncPartitionStatus` returns a partition to `ACTIVE` when a wall void restores funds. A buyer `FROZEN` partition stays frozen. This removed a 500 (`BLOCKED_PARTITION_FROZEN`) on the third concurrent sniper.
3. Voucher codes `__proto__`, `constructor`, and `prototype` are rejected. `parseJsonBody` drops those keys and rejects JSON nested deeper than 32. Partition labels are limited to letters, digits, and simple punctuation.
4. The DOM scanner treats `clip-path: inset(100%)` as off-screen and ignores zero-width joiners when matching adversarial phrases. The 13 `HiddenReason` names are unchanged. Visible editorial text is not newly flagged.
5. `packages/workbench/test/security.test.ts` locks the six vectors: one-of-five `$297` capture, voucher and hidden-DOM injection, cent boundaries (`296.99` vs `297.00`), script breakout, prototype and depth bombs, and secret absence on the v6 reads.
6. `docs/SECURITY_AUDIT.md` §9 records the same results.

An RFC 3161 timestamp still proves a receipt hash existed at time T. It does not prove the merchant page was true.

## Four-prompt recheck

Parts 1–4 were exercised again beyond the original assertions. The receipt binding, HTTP/CLI/MCP/OpenAPI sniper, overlay, and red-team suite still match the prompts. The live workbench on `http://127.0.0.1:4173/` (isolated wallet, absent credentials, deterministic replay) confirmed the store iframe stays at `scrollHeight` 310 with `scrollWidth === clientWidth`.

Browser clicks:

- Typing `@veripact` under `$250` opened the bar and finished `NO_COMPLIANT_DEAL_UNDER_TARGET` with six rejections, `$0` saved, and the partition still `$350.00` available. The parent checkout status updated. At `$250`, FlashTech is `REJECTED_OVER_TARGET_CAP` because the tighter mandate fails before the returns rule.
- Alt+V closed the bar and Ctrl+Shift+V reopened it.
- A `$300` hunt captured one deal: emerald `PAYPAL50` / `-$50.00` / `$297.00` / a `VP1:` commitment, parent partition `$53.00` available, transaction record order, authorization, capture, and the same commitment. A VP1 commitment proves the receipt hash existed at time T. It does not prove the merchant page was true.
- A second hunt, including a double click on Hunt, returned `BLOCKED_BY_PARTITION_WALL` and left available at `$53.00`. The captured transaction record stayed on screen.
- `$99999` and `$0` in the intent box now stop before `fetch`, with `targetMaxAllInUsd must be between 1 and 10000`. A `<script>` in the same field did not execute and was not written into the results.
- Custom HTML scan: “system prompt engineering” stays non-adversarial (BLOCK only because price, condition, and returns are missing). The same phrase split by U+200D is `ADVERSARIAL_DOM`. A hidden `opacity:0` injection is still `ADVERSARIAL_DOM`.

Flaws closed in this pass, without changing the capture, wall, or 13 `HiddenReason` names:

1. The overlay no longer rewrites an out-of-range dollar amount to `$300` and buys. A missing amount still defaults to `$300`.
2. `trapsRejectedCount` counts only `REJECTED_*` verdicts, so a wall reports 5 traps rather than counting the wall itself.
3. The parent paints a sniper transaction record only when that result has a `captureId`, so a wall does not replace the captured order.
4. Visible text is scanned for an adversarial phrase only when it contains a zero-width character. Plain editorial text is unchanged.

`npm test` is 264 passed. `npm run verify:e2e` is 24 passed, store `scrollHeight` 310 at 1600, 1366, 1050, and 768. The embed script still sends `Cache-Control: public, max-age=3600`, so a browser that already holds the previous script keeps it until that hour expires.

## Skills consulted

- `.agents/skills/security-audit/skills/security-audit/SKILL.md` and the AI, attack-class, client-side, and web-protocol companions. This pass followed the product request: fix the confirmed races and lock them in the existing security suite and `docs/SECURITY_AUDIT.md`. It did not open a separate external findings workspace.
- `.agents/subagents/05-security-and-benchmark.md` — findings land in the run ledger with severity and fix status.
- `docs/SECURITY_AUDIT.md` and `packages/workbench/test/security.test.ts` — prior vectors (body cap, mandate XSS, prototype pollution on checkout) were left intact.

## Verification

`npm test` (264 passed) and `npm run verify:e2e` (24 passed, store `scrollHeight` 310) both exited 0. Stderr during unit tests is the existing malformed-key, custom-id mismatch, live 401, and 2000-character dispute-note cases. The live browser pass above is the extra check the unit and Playwright suites do not click.
