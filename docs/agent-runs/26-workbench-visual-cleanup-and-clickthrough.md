# Agent Run 26 — Workbench visual cleanup and full click-through

**Date:** 2026-11-07  
**Status:** PASS (`npm run verify:e2e` 24 checks; live click-through of every workbench control)  
**Task:** Make the workbench look like one product instead of a stack of nested cards, then open it and click every control.

## What changed

The control ids, labels, and API calls are the same. The visual system is not.

- Canvas `#e7ebf0`, surfaces white, ink `#1a2332`, seal green `#0f6e56` only for a verified state. Borders are hairlines. Drop shadows on every card are gone.
- The wordmark uses Palatino (already on the machine). The rest of the UI uses Segoe UI. Numbers stay tabular. No font is loaded from a network.
- The evidence pipeline is one ruled row. The three steps are no longer cards inside a card.
- Witness and PayPal sit in an open action row. Checkboxes keep a quiet field behind them.
- Outcome banners are flat green or red. Dashed dividers are solid hairlines.
- The phone pairing ceremony uses the same ink, type, and seal. Its approval line is unchanged: `Connected! Desktop Workbench Updated`.
- A VP1 commitment still proves a receipt hash existed at time T. It does not prove the merchant page was true.

Files: `packages/workbench/src/ui-template.ts`, `packages/workbench/src/wallet-template.ts`.

## Skills consulted

- `.agents/skills/frontend-design/SKILL.md` — one type system, one ink, no extra chrome. The pipeline is the memorable element. Cream, acid-green, and identical floating cards were rejected for this desk.
- `scripts/verify-ui-e2e.ts` — ids the suite clicks were left in place, and store `scrollHeight` stays 310.

## Click-through

Live server `http://127.0.0.1:4173/`, absent credentials, deterministic replay, isolated wallet file. Every row below is a real click or an equivalent control change.

### Header

| Control | Result |
|---|---|
| Replay · deterministic (`#mode-pill`) | Opened the sandbox credential modal |
| Use Replay Instead | Mode stayed Replay · deterministic |
| Download Signed Ledger (.json) | Download action fired |
| Close | Modal closed |
| Reset Demo | Outcome returned to Awaiting checkout |
| Run 60s Guided Demo Tour | Toast showed STEP 1 / 7 |
| Stop Tour | Toast closed, status `Tour stopped.` |
| Buyer Checkout / Dispute Desk | Each view became the pressed tab |

### Buyer checkout

| Control | Result |
|---|---|
| Scenario 2 Surcharge | Store URL `/surcharge_void`. Witness: `ASK_HUMAN_DELTA`. Checkout: **Authorization Auto-Voided** |
| Scenario 3 Injection | Witness: `BLOCK` / `ADVERSARIAL_DOM`. Checkout: **Blocked Pre-Checkout** |
| Scenario 1 Normal | Store URL returned to the Apex product |
| Channel3 catalog, all 8 SKUs | Northloop switched the store URL to `NORTHLOOP-14-AIR`, then back to `APEX-27-4K-IPS` |
| Inspect extracted DOM quote blocks | Drawer opened |
| Apex flagship, Northloop 14, Hidden opacity trap, Prompt-injection trap | Each preset filled the HTML box. Opacity and injection scans both returned `BLOCK` / `ADVERSARIAL_DOM` |
| Scan & Witness Custom HTML | Same BLOCK results as the presets |
| Post-purchase policy mutation preview | Mutation panel opened, then closed |
| Edit Mandate | Editor opened |
| Sign & Lock Mandate (SELF) | Cap `$300.00` locked and re-gated, then restored to `$320.00` |
| I've reviewed the merchant terms, unchecked | Checkout refused: `Please confirm you have reviewed the merchant terms.` |
| Two-step approval | Checkout created `ORD-VP-0005` and showed **Open Buyer Approval Popup** and **Finalize** |
| Open Buyer Approval Popup | Status: popup opened, waiting |
| Finalize approved order | `Gate: ASK_HUMAN_DELTA · Outcome: CAPTURED` |
| 1-Click Instant Checkout (two-step off) | **Purchase Captured** |
| Verify it yourself | Auditor: JCS recompute, hash match, terms consistent |
| Commitment chip | Click copied the `VP1:` value |
| Simulate Merchant Drift → File Dispute | Desk opened on `MERCHANT_DRIFT_CONFIRMED` |
| Simulate Buyer Forgery → File Dispute | Desk showed `BUYER_FORGERY_DETECTED` |

### Wallet

| Control | Result |
|---|---|
| Start QR Pair | Code `107919`, link `/pair/PAIR-VP-0001` |
| Approve & Link PayPal Account (ceremony page) | Button disabled while linking, then **Connected! Desktop Workbench Updated** |
| Agent Spend ($297 via Partition) | `CAPTURED $297.00`, available `$53.00` |
| Agent Spend again | `AUTO_VOIDED_BY_PARTITION_WALL ($297.00 > $53.00 available)`, available stayed `$53.00` |
| Undo / Refund Last Capture | `Refunded +$297.00`, available `$350.00` |
| Set $350 Partition, after typing 400 | Allocated became `$400.00`, then was set back to `$350.00` |

### Dispute desk

| Control | Result |
|---|---|
| Live contested disputes | Seller column rendered |
| 24-scenario regression suite | Grid engine `AG Grid 31 (local vendor)` |
| Payment Sync (Legacy vs Protected) | Note about the PayPal 3-hour search delay |
| Three studio presets | First preset filled the query and drew a chart. Third preset table: Gate `72/72` [0.949, 1.000], Post-auth `57/57`, Referee `21/21` |
| Run | Query `show blocked cases` ran |
| Export CSV | Export action fired |
| Require evidence | Form opened. **Buyer** and **Seller** both clicked |
| Contest & submit counter-evidence | Disabled. PayPal HATEOAS does not advertise `provide-evidence` on this seeded case, so the notes form does not mount |
| Escalate to claim | `Action applied: escalate` |
| Accept claim | Disabled by the same HATEOAS list |
| Adjudicate in sandbox | Disabled by the same HATEOAS list |
| Auto-resolve this case | Seller column `RESOLVED` |
| Printable evidence sheet | Sheet opened |
| Print | `window.print` was invoked and then restored, so a system dialog did not block the run |
| Close | Sheet closed |
| Mint ChatGPT Bearer token | Token area filled (141 chars, `vp_` present) |
| Mint Claude/Cursor Token | Token area filled (234 chars) |

## Layout

- Desktop emulation 1440px: page `scrollWidth` equals `clientWidth` (1425 in the measured frame). Store iframe `scrollHeight` 310, no inner horizontal scroll.
- 768×1024: page and dispute desk both `768/768`. No button drawn outside the viewport. Store iframe `scrollHeight` 310, `scrollWidth` 713 equals the frame width. Header wraps onto two rows: view switch, then mode, reset, and tour.
- `npm run verify:e2e`: 24 checks passed. Viewports 1600, 1366, 1050, and 768 reported `scrollWidth === clientWidth`. All three store scenarios stayed at `scrollHeight` 310. Result line: zero 4xx/5xx, zero console/page errors, zero overflow.

The first spend click in the same turn as the tour was overwritten by a later partition update. A solo click afterward captured, walled, and refunded as listed above.
