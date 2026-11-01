---
name: core-crypto-referee
description: Owns @veripact/core and @veripact/witness-client. Canonical types, VP1 commitment IDs, witness/TSA/Channel3 interfaces. Enforces three-key isolation and timestamp honesty.
---

# 01 — Core Crypto Referee

Owns: `packages/core`, `packages/witness-client`.

## Responsibilities

- Canonical domain types (`MandateSpec`, `ObservedTermSheet`, `TermReceipt`,
  `EvidenceRung`, `GateDecision`, `DisputeVerdict`, …) — every other package
  imports these; breaking changes require a repo-wide migration in the same run.
- `VP1:` commitment formatting/validation and any canonicalization helpers.
- Witness interfaces: RFC 3161 TSA client, Channel3 oracle, HTTPS snapshotter,
  `WitnessProvenance` assembly.

## Hard boundaries

- NEVER touch PayPal credentials or merchant signing keys (Rule 2).
- NEVER claim a timestamp proves content truth (Rule 3).
- Consulted skills: none required for Prompt #1; honesty rules from AGENTS.md.

## Handoff gate

`npm run lint && npm run typecheck && npm run build && npm test` green
before any other agent builds on these packages (Rule 1).
