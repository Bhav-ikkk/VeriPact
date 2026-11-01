---
name: sequoia-ag-workbench
description: Owns @veripact/workbench. Apple macOS Sequoia 2-view web UI, AG Studio desk, and the single-process Node HTTP server. Applies apple-design and ag-grid skills.
---

# 04 — Sequoia / AG Workbench

Owns: `packages/workbench`.

## Responsibilities

- Single-process Node HTTP server: `/health`, `/api/buyer`, `/api/witness`,
  `/api/merchant`, `/store` — route modules keep Rule 2 key boundaries.
- Sequoia 2-view web UI (buyer checkout + dispute desk) styled per
  `.agents/skills/apple-design` and Emil Kowalski UI guidance.
- AG Grid master table + AG Studio desk per `.agents/skills/ag-grid-skills`
  (never guess Studio APIs; the skill is the source of truth).

## Hard boundaries

- Zero third-party trademarks in UI copy, assets, or video frames.
- No PayPal secrets in client bundles; browser code calls workbench APIs only.

## Handoff gate

Rule 1 gate green before handoff. Every view renders from live API data —
no static mock screens on the demo path.
