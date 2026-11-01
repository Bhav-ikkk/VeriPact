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
veripact witness --url <storefront-url> --mandate <mandate.json>
veripact verify --receipt <term-receipt.json> --order <paypal-order-id>
veripact dispute --case <contested-case.json>
```

Keys come from environment variables only (`BUYER_*`, `WITNESS_*`,
`MERCHANT_*`, `PAYPAL_*` — see `.env.example`). Never pass key material
as CLI flags.

## MCP usage (stdio JSON-RPC 2.0)

Server: `@veripact/mcp-server`. Methods: `initialize`, `tools/list`,
`tools/call`. Tools:

| Tool | Purpose |
|---|---|
| `witness_terms` | Witness merchant terms at a URL against a mandate |
| `verify_receipt` | Verify a receipt against a PayPal order `custom_id` |
| `format_commitment` | Format/validate a `VP1:` commitment from a sha256 hex digest |

## Honesty contract

- A timestamp proves hash existence at time T plus independent witness
  observation. It never proves content truth.
- Live mode calls the real PayPal Sandbox. Fixtures labeled `REPLAY`
  are deterministic test data, never live evidence.

Status: v0.1.0 foundation skeleton — interfaces and smoke tests are real;
networked PayPal/TSA/Channel3 calls land in Prompts #2–#6.
