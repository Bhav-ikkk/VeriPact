# VeriPact — Proving What the Merchant Promised

VeriPact is independent witness infrastructure for agentic commerce. An AI
shopping agent scans a merchant page, VeriPact witnesses exactly what the
page promised (price, condition, shipping, tax, return terms), time-anchors
the evidence, and binds a `VP1:` commitment into the PayPal order record —
so buyer-forgery and merchant-drift disputes settle on cryptographic
evidence instead of screenshots.

> **Buyer guardrails control what an agent is allowed to spend. VeriPact
> proves what the merchant actually promised.**

Built for [Build What's Next with PayPal and
AI](https://paypalaihackathon.devpost.com). Solo build + AI agents.

## Sandbox Receipts Strip

`transport: DETERMINISTIC_SANDBOX_REPLAY` · regenerate with `npm run
seed:sandbox` (live credentials in `.env` switch it to the real sandbox;
full values in `docs/sandbox-receipts.json`).

| Scenario | Order ID | custom_id | Total | Status |
|---|---|---|---|---|
| normal | `ORD-VP-0001` | `VP1:7615e5ea63d4f8…` | $297.00 | CREATED (match=true) |
| surcharge_void | `ORD-VP-0002` | `VP1:d1250b9a150c63…` | $340.50 | created |

## Verified Research Context

- [arXiv:2610.17378](https://arxiv.org/abs/2610.17378) — *Get In, Decide,
  Prove: A Merchant-Side Readiness Benchmark for Agentic Commerce.* In a
  330-merchant assessment, the all-in total was determinate at only **18 of
  330** merchants; the paper reports **137 of 178** decision failures traced
  to tax. Kept strictly separate from the paper's **555-site access
  census** (105 sites, 18.9%, unreadable to agents). VeriPact's
  `ASK_HUMAN_DELTA` gate exists for exactly this gap: ship/tax indeterminate
  pre-checkout, enforced post-approval by the re-gate.
- [arXiv:2606.08790](https://arxiv.org/abs/2606.08790) — *RAILS:
  Verification-Native Clearing For Agentic Commerce.* The verification
  ladder this project climbs: human-verified settlement for agent-arranged
  transactions.
- [arXiv:2609.11757](https://arxiv.org/abs/2609.11757) — *Signing the
  Transaction but Not the Decision.* Whisper attacks flip agent payment
  choices without touching signed bytes (90% / 56% / 73.3% across three
  attack families); VeriPact answers with witnessed, order-anchored
  commitments — the same binding class as the paper's A-VIP defense.

## Three-Rung Evidence Ladder

```text
Rung 1: SELF   buyer signs mandate + local terms ......... (buyer key)
Rung 2: WIT    independent witness snapshots the page,
               Channel3 cross-check, RFC 3161 anchor .... (witness key)
Rung 3: SIGN   merchant countersigns, PayPal AUTHORIZE
               binds VP1: commitment into custom_id ...... (merchant key)
```

```text
Merchant page → term-extractor (DOM scan, verified quotes, gate)
                    → witness-client (Channel3, TSA, signed WIT receipt)
                    → paypal-client (Orders v2 / Disputes v1 HATEOAS)
                    → sdk / cli / mcp-server / workbench
```

Keys never cross rungs: buyer, witness, and merchant private keys live in
separate env vars and separate code paths (`AGENTS.md` Rule 2). The
workbench demo server mounts the three boundaries as route groups in one
process for judge-click latency; production deploys them as disjoint
services (see §7).

## Omni-Surface Quickstart

Prerequisites: Node 20+, `npm install`, `npm run build`. Everything below
runs **offline with zero paid keys** (deterministic demo fixtures, labeled
`demoKeys` / `DETERMINISTIC_SANDBOX_REPLAY`). Drop sandbox credentials into
`.env` (see `.env.example`) to go live.

```bash
# 1. Web workbench (Sequoia UI + AG dispute desk) on :3000
npm start

# 2. CLI
npx veripact witness --scenario normal
npx veripact checkout --scenario surcharge_void
npx veripact audit-dispute --case buyer_forgery
npx veripact verify --scenario normal

# 3. MCP server (stdio JSON-RPC for shopping agents)
node packages/mcp-server/dist/index.js
# tools: veripact_witness_offer, veripact_execute_guarded_checkout,
#        veripact_verify_order_receipt, veripact_adjudicate_contested_dispute

# 4. Regression suite (24 scenarios × 3 passes, Wilson 95% CIs)
npm run regression

# 5. Live sandbox seeder (writes docs/sandbox-receipts.json)
npm run seed:sandbox
```

One-click deploy: `render.yaml` builds the monorepo and starts the
workbench (`npm ci && npm run build` → `npm start`).

## 24-Scenario Regression Results (72 Runs, 95% Wilson CIs)

Controlled synthetic suite (`benchmark/scenarios/`): 8 benign retail flows,
8 fee/policy-drift flows, 8 adversarial/forgery flows — each through the
real witness → gate → PayPal replay → referee pipeline, 3 passes, zero
network cost. Full report: `benchmark/results/regression_benchmark_report.json`.

| Metric | Result | 95% Wilson CI |
|---|---|---|
| Gate decision (PROCEED / ASK / BLOCK) | 72/72 (100.0%) | [0.949, 1.000] |
| Post-approval re-gate (CAPTURE / VOID) | 57/57 (100.0%) | [0.937, 1.000] |
| Dispute referee (forgery / drift) | 21/21 (100.0%) | [0.845, 1.000] |
| Overall pass rate | 72/72 (100.0%) | [0.949, 1.000] |
| Benign group | 24/24 (100.0%) | [0.862, 1.000] |
| Drift group | 24/24 (100.0%) | [0.862, 1.000] |
| Adversarial group | 24/24 (100.0%) | [0.862, 1.000] |

Gate confusion (expected × actual): PROCEED 24, ASK_HUMAN_DELTA 33, BLOCK
15 — perfectly diagonal, zero off-diagonal cells.

## §7 Honesty & Limitations

1. **Timestamps prove hash existence at time T** plus independent witness
   observation. They never prove content truth.
2. **Witness isolation is logical in this demo.** Production deploys buyer,
   witness, and merchant as disjoint services (PayPal Store Sync is the
   production observation target); the workbench packages the three
   boundaries as route groups in one process so judges reach evidence in
   one click.
3. **Sandbox adjudication is simulated.** `adjudicate` exists only in the
   PayPal sandbox; live disputes resolve through PayPal's real flow, with
   VeriPact evidence attached as `OTHER`.
4. **The 18/330 figure is exact and bounded.** It counts merchants where
   the all-in total was determinate (arXiv:2610.17378) — not agent task
   success, and not the paper's separate 555-site access census.
5. **The regression suite is controlled, not a field benchmark.** 24
   synthetic storefronts assert the pipeline behaves as specified; they do
   not measure the open web. Intervals above are honest Wilson bounds on
   that suite.

Rule compliance: built for
[paypalaihackathon.devpost.com](https://paypalaihackathon.devpost.com). No
third-party trademarks in fixtures, UI, or video frames; no mocked PayPal
calls on live paths; every replay artifact is labeled.

---

MIT licensed. Repository: `https://github.com/Bhav-ikkk/VeriPact.git`.
