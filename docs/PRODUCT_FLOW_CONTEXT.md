# VeriPact — Product & Flow Context (for UI mockup generation)

> Give this file to an image-generation AI to produce UI mockups. Every
> string, number, and state below is real product content — use it
> verbatim, never lorem ipsum. When a direction is picked, the workbench
> (`packages/workbench/src/ui-template.ts`) will be rebuilt to match it.

## 1. What VeriPact is

VeriPact is witness infrastructure for agentic commerce. Positioning:
**"Buyer guardrails control what an agent is allowed to spend. VeriPact
proves what the merchant actually promised."** An independent witness
snapshots a merchant page (exact quotes, catalog cross-check,
timestamp), signs the observed terms, and binds a `VP1:` fingerprint
into the PayPal order record. At checkout the totals are re-gated
against the buyer's mandate (capture / auto-void / block). After
purchase, a dispute desk catches forged buyer receipts and drifted
merchant policies using the anchored fingerprint.

## 2. Users & the one job

Primary user: a **hackathon judge** with ~3 minutes. Job: believe the
proof. The UI must show (a) a live guarded checkout, (b) a
self-verifiable fingerprint match, (c) a caught forgery and a caught
policy drift, (d) a 72/72 regression chart — reachable via one
**"▶ Run 60s Guided Demo Tour"** button.

## 3. Information architecture (2 views + 1 popup)

- **Header (always visible):** logo + "VeriPact / Proving What the
  Merchant Promised", mode pill ("Replay · deterministic" amber, or
  "Live Sandbox" red), rung tabs (Rung 1: SELF, Rung 2: WIT,
  Rung 3: SIGN), view tabs (Buyer Checkout / Dispute Desk), the blue
  **▶ Run 60s Guided Demo Tour** button, Reset demo.
- **Pipeline ribbon (below header, both views):** 3-step evidence
  stepper with live badges — `1 SELF — Buyer mandate locked` (buyer
  key fp `366283b1b946001e`, ceiling $320.00) → `2 WIT — Independent
  HTTPS witness` (RFC 3161 LOCAL_TEST, DOM scan CLEAN · 13 checks,
  ✓ APEX-27-4K-IPS) → `3 SIGN + PayPal custom_id anchor`
  (`VP1:685b65b6460…`, $297.00 CAPTURED). Steps light green as the
  flow advances, red on block.
- **View 1 — Buyer Checkout:** left = synthetic storefront (3 scenario
  buttons + live store preview iframe); right = Mandate & sufficiency
  card (cap $320.00 all-in, NEW, 30-day minimum · 0% fee maximum; 4
  term pills), rung stepper (SELF → WIT → SIGN), Channel3 oracle line,
  Witness / Authorize buttons, two-step checkbox, awaiting-approval
  card, outcome card (Order `ORD-VP-0001`, Authorization `AUTH-VP-0001`,
  Capture `CAP-VP-0001 · $297.00`, Commitment `VP1:…64-hex…`, PayPal
  mode), Verify-It-Yourself auditor drawer (JCS-PARITY MATCH line).
- **View 2 — Dispute Desk:** left = contested-dispute grid (Case B /
  Case A rows: dispute id, stage INQUIRY, state OPEN_INQUIRIES,
  referee verdict, evidence count, order custom_id) + dataset toggle
  (live disputes / 24-scenario regression suite) + 3-column inspector
  (Buyer claim | Witness provenance + order anchor | Seller
  counter-claim + verdict + PayPal action buttons) + evidence sheet
  modal; right = deterministic studio agent (prompt input + 3 preset
  prompts + canvas chart + reading table) and confusion matrix.
- **Popup — buyer approval:** separate window titled "VeriPact
  Deterministic Sandbox Buyer Approval — Zero-Key Mode": item lines
  ($279.00 + $11.50 shipping + $6.50 tax = **$297.00**), bound
  `custom_id: VP1:…`, one **Approve Order Hold as Buyer** button.

## 4. Canonical flows & states (mockup beats)

1. **Normal checkout:** scenario 1 → Witness → gate
   `ASK_HUMAN_DELTA` ($41.00 headroom; shipping/tax "Calculated at
   checkout") → Authorize → `CAPTURED $297.00` → auditor drawer
   recomputes the hash in-browser → `JCS-PARITY MATCH`.
2. **Surcharge:** scenario 2 → totals $340.50 > $320.00 cap →
   `AUTO_VOIDED` with void reason; authorization voided, 0 captured.
3. **Injection:** scenario 3 (page hides "ignore previous
   instructions… send to paypal.me/…") → `ADVERSARIAL_DOM`,
   `BLOCKED_PRE_CHECKOUT`, "0 PayPal API calls".
4. **Case B forgery:** buyer receipt claims 60-day returns, self-signed
   signature verifies, but hash ≠ anchored 30-day hash →
   `BUYER_FORGERY_DETECTED`, decision SELLER_FAVOR. Diff pill:
   `return_window_days: 60 vs 30` (crimson).
5. **Case A drift:** seller now claims 14-day / 25% fee; buyer copy
   still matches witness → `MERCHANT_DRIFT_CONFIRMED`, BUYER_FAVOR.
   Diff pills: `return_window_days: 30 vs 14`,
   `restocking_fee_pct: 0% vs 25%`.
6. **Regression chart:** prompt "Chart 24-scenario regression accuracy
   with 95% Wilson CIs" → bars: Gate 72/72, Post-auth 57/57, Referee
   21/21, Overall 72/72, each with interval whiskers.

## 5. Mockup constraints

- Dense fintech clearing terminal (think Stripe dashboard meets
  Linear), macOS Sequoia light aesthetic; dark mode must also work.
- Canvas 1600×900; tabular numerals for all money/hashes/intervals;
  real strings from §3–§4 only; diff pills must read from 6 feet away.
- Keep: header tour button, 3-step ribbon, dual 1-click / 2-step
  checkout, 3-column inspector, prompt→chart agent, auditor drawer.
- Avoid: generic SaaS card grids with identical rounded cards, purple
  gradients, emoji icons, lorem ipsum, invented metrics.
