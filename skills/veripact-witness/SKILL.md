---
name: veripact-witness
description: Witness merchant promises for AI shopping agents and bind VP1 commitments into PayPal orders via CLI or MCP. Use when an agent needs witnessed checkout evidence, dispute verdicts, or PayPal custom_id commitments.
---

# VeriPact Witness Skill

Any external AI shopping agent can invoke VeriPact to capture what a merchant
page promised, have it independently witnessed and time-anchored, and bind the
result into the PayPal order record.

## Commitment format

Every witnessed receipt produces a 68-character PayPal `custom_id`:

```text
VP1:<64 lowercase hex chars of sha256(canonical receipt bytes)>
```

Validate with `formatCommitmentPrefix(sha256Hex)` from `@veripact/sdk`
(throws on non-64-char-hex input).

## CLI usage

```bash
veripact --help
veripact --version
veripact witness --scenario <normal|surcharge_void|adversarial_hidden_dom> [--json]
veripact checkout --scenario <normal|surcharge_void|adversarial_hidden_dom> [--json]
veripact audit-dispute --case <buyer_forgery|merchant_drift> [--json]
veripact verify --scenario <normal> [--json]
veripact wallet-pair [--email <addr>] [--approve --session-id <id>] [--json]
veripact wallet-sync [--json]
veripact partition-create [--label <t>] [--total <usd>] [--max-order <usd>] [--ask-above <usd>] [--json]
veripact partition-list [--json]
veripact wallet-sniper [--sku <sku>] [--target <usd>] [--voucher <code>] [--json]
```

- `witness` snapshots a scenario storefront (hidden-DOM scan, verified
  quotes, Channel3 cross-check, TSA anchor). Zero PayPal calls.
- `checkout` runs the bilateral guarded flow: snapshot → gate → AUTHORIZE →
  patch → authorize → post-approval re-gate → `CAPTURED` | `AUTO_VOIDED` |
  `BLOCKED_PRE_CHECKOUT`.
- `audit-dispute` referees the contested case against the PayPal-anchored
  commitment and drives the dispute to `RESOLVED` via HATEOAS-gated actions.
- `verify` re-verifies a captured bundle: commitment recompute, `custom_id`
  exact match, buyer/witness/merchant signatures, TSA anchor (±5 min skew).
- `wallet-pair` starts (or `--approve`s) a QR pairing ceremony; approval
  vaults the payer and mints the $350 agentic partition.
- `wallet-sync` lists payments labeled `VERIPACT_PROTECTED` vs
  `LEGACY_UNWITNESSED` with counts.
- `partition-create` / `partition-list` manage buyer-signed agentic
  partitions with live availability.
- `wallet-sniper` hunts six storefronts and vouchers. It captures only when
  the post-voucher page passes the witness gate and the partition can fund
  the all-in total. `--json` prints the `DealSniperReport`. The captured
  order `custom_id` is that candidate page's `VP1:` commitment.

Keys come from environment variables only (`BUYER_*`, `WITNESS_*`,
`MERCHANT_*`, `PAYPAL_*` — see `.env.example`). Never pass key material
as CLI flags. Without env keys every command runs fully offline on
deterministic demo fixtures (results carry `demoKeys: true`).

## MCP usage (stdio JSON-RPC 2.0)

Server: `@veripact/mcp-server`. Methods: `initialize`, `tools/list`,
`tools/call`. Tools:

| Tool | Arguments | Purpose |
|---|---|---|
| `veripact_witness_offer` | `{ scenario }` | Witness a scenario storefront (no PayPal calls) |
| `veripact_execute_guarded_checkout` | `{ scenario }` | Run a guarded witnessed checkout |
| `veripact_verify_order_receipt` | `{ scenario }` or `{ bundle }` | Verify a bundle (demo or explicit `TransactionBundleInput`) |
| `veripact_adjudicate_contested_dispute` | `{ case }` | Audit a contested dispute to `RESOLVED` |
| `veripact_pair_wallet` | `{ action: 'start' }` or `{ action: 'approve', sessionId, payerEmail }` | Pair a wallet over QR (approval vaults + mints $350 partition) |
| `veripact_sync_payments` | `{}` | Sync protected vs legacy payments |
| `veripact_partition_spend` | `{ scenario, amountUsd?, agentToken? }` | Partitioned agent payment (capture / wall-void / ask-human) |
| `veripact_run_deal_sniper` | `{ sku?, targetMaxAllInUsd?, customVoucherCode? }` | Deal/voucher hunt; capture binds the post-voucher `VP1:` into `custom_id` |

`scenario` ∈ `normal | surcharge_void | adversarial_hidden_dom`;
`case` ∈ `buyer_forgery | merchant_drift`. Results arrive as
`content[0].text` JSON. Key material is never accepted over stdin —
arguments carrying private-key/secret keys are rejected.

## Honesty contract

- A timestamp proves hash existence at time T plus independent witness
  observation. It never proves content truth.
- Live mode calls the real PayPal Sandbox. Responses labeled
  `DETERMINISTIC_SANDBOX_REPLAY` (or fixtures labeled `REPLAY`) are
  deterministic test data, never live evidence.
- Every SDK/CLI/MCP result carries `transportMode` and `demoKeys` labels.

Status: v1.0.0 — CLI, MCP tools, bilateral checkout, and dispute audit are
production against the PayPal Sandbox (live) or the deterministic replay
engine (offline). Workbench UI and benchmark harness land in later prompts.
