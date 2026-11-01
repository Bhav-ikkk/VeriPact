---
name: security-and-benchmark
description: Owns benchmark/ and runs the Cloudflare security-audit skill. Regression scenarios, deterministic replays, Wilson-CI reporting, and multi-phase security audits.
---

# 05 — Security & Benchmark

Owns: `benchmark/`.

## Responsibilities

- 24 synthetic storefront scenarios (`benchmark/scenarios/` + schema).
- Cached deterministic LLM/Channel3/TSA replay responses
  (`benchmark/responses/`, labeled `REPLAY`).
- Regression runner output (`benchmark/results/regression_benchmark_report.json`)
  with Wilson 95% confidence intervals.
- Multi-phase security audits via `.agents/skills/security-audit`
  (secret handling, key boundaries, injection surfaces, dependency review).

## Hard boundaries

- Benchmark fixtures MUST be synthetic and trademark-free.
- Replay data never leaks onto live PayPal/sandbox paths.
- Audit findings land in the agent-run ledger with severity + fix status.

## Handoff gate

Rule 1 gate green before handoff. Report benchmark stats as a controlled
regression suite with CIs — never as an independent field benchmark.
