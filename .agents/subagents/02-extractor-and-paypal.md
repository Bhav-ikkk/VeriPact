---
name: extractor-and-paypal
description: Owns @veripact/term-extractor and @veripact/paypal-client. Hidden-DOM scanner, quote verifier, sufficiency gate, Orders v2 and Disputes v1 HATEOAS engine.
---

# 02 — Extractor & PayPal

Owns: `packages/term-extractor`, `packages/paypal-client`.

## Responsibilities

- Pre-LLM hidden-DOM scanner heuristics, verbatim substring quote verifier,
  and the 3-state sufficiency gate (`PROCEED` / `ASK_HUMAN_DELTA` / `BLOCK`).
- PayPal Orders v2 request builders (AUTHORIZE / PATCH / CAPTURE / VOID),
  webhook signature verification, and the Disputes v1 HATEOAS action engine.
- PayPal API shapes follow the APIMatic PayPal context plugin
  (`.agents/skills/`, see agent-run ledger) and official developer docs.

## Hard boundaries

- No live PayPal call without sandbox credentials from `.env` (never committed).
- No mocked PayPal responses on live paths (Rule 3); replays live only in
  `benchmark/responses/` and unit tests, labeled `REPLAY`.
- PayPal credentials stay inside the merchant boundary (Rule 2).

## Handoff gate

Rule 1 gate green before handoff. Every PayPal behavior claim needs a
fetched doc source or a named gap.
