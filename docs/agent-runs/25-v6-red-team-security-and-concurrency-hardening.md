# Agent Run 25 — v6 red team, partition mutex, and input hardening

**Date:** 2026-11-07  
**Status:** PASS (lint, typecheck, build, `npm test` 17 files / 263 tests, `npm run verify:e2e` 24 checks)  
**Task:** Break the v6 sniper, partition lock, voucher parser, and embed surface, then lock every vector that failed.

## What was built

1. `withWalletFileLock` and `VeriPactWallet.runExclusive` serialize partition mutations per state file. The sniper holds the lock for the whole hunt and reloads the file before it reads `availableUsd`. Nested capture on the same instance does not deadlock.
2. `syncPartitionStatus` returns a partition to `ACTIVE` when a wall void restores funds. A buyer `FROZEN` partition stays frozen. This removed a 500 (`BLOCKED_PARTITION_FROZEN`) on the third concurrent sniper.
3. Voucher codes `__proto__`, `constructor`, and `prototype` are rejected. `parseJsonBody` drops those keys and rejects JSON nested deeper than 32. Partition labels are limited to letters, digits, and simple punctuation.
4. The DOM scanner treats `clip-path: inset(100%)` as off-screen and ignores zero-width joiners when matching adversarial phrases. The 13 `HiddenReason` names are unchanged. Visible editorial text is not newly flagged.
5. `packages/workbench/test/security.test.ts` locks the six vectors: one-of-five `$297` capture, voucher and hidden-DOM injection, cent boundaries (`296.99` vs `297.00`), script breakout, prototype and depth bombs, and secret absence on the v6 reads.
6. `docs/SECURITY_AUDIT.md` §9 records the same results.

An RFC 3161 timestamp still proves a receipt hash existed at time T. It does not prove the merchant page was true.

## Skills consulted

- `.agents/skills/security-audit/skills/security-audit/SKILL.md` and the AI, attack-class, client-side, and web-protocol companions. This pass followed the product request: fix the confirmed races and lock them in the existing security suite and `docs/SECURITY_AUDIT.md`. It did not open a separate external findings workspace.
- `.agents/subagents/05-security-and-benchmark.md` — findings land in the run ledger with severity and fix status.
- `docs/SECURITY_AUDIT.md` and `packages/workbench/test/security.test.ts` — prior vectors (body cap, mandate XSS, prototype pollution on checkout) were left intact.

## Verification

`npm test` (263 passed) and `npm run verify:e2e` (24 passed, store `scrollHeight` 310) both exited 0. Stderr during unit tests is the existing malformed-key, custom-id mismatch, live 401, and 2000-character dispute-note cases.
