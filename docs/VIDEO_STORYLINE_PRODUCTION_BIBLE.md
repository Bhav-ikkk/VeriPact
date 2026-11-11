# VeriPact — 2:35 Storyline Video Production Bible

**Format:** story-first animated explainer + UI cuts. NOT a screen-share
walkthrough: the narrative carries, the monochrome workbench appears only
as proof at decision moments. **Runtime:** 2 minutes 35 seconds (155s).
**Aspect:** 16:9, 1600×900 UI cuts (from `npm run demo:record`).
**Voice:** one calm narrator, zero hype adjectives. Every number below is
real codebase data — no invented figures, IDs, or hashes on screen.

## Cast of real data (do not change)

| Beat | Datum | Source |
|---|---|---|
| Hero deal | APEX-27-4K-IPS, retail $347.00 → $297.00 all-in with PAYPAL50 | sniper best-compliant candidate |
| Trap 1 | FlashTech CLEARANCE70: "Final Sale. 0-day returns. 25% restocking fee." — rejected, voids returns | sniper candidate EC-1 |
| Trap 2 | FreightKing FREIGHT50: $50 off, then a +$55 shipping callback surcharge | sniper candidate EC-4, `FREIGHT_SHIP_USD = 55` |
| Watcher | KANSO-Q35 retail $149.00 → $100.00 background webhook auto-capture with AUDIO67 | fleet price-drop webhook |
| Dispute | `PP-D-CASE-A-DRIFT`: merchant drifts 30→14 days + 0%→25% fee post-purchase → `MERCHANT_DRIFT_CONFIRMED` | dispute referee fixture |
| Proof strip | 349/349 tests, 28/28 E2E, 60/60 swarm, 72/72 regression, `VP1:` in `custom_id` | this tree |

## Scene 0 — Cold open (0:00–0:12, 12s)

**Visual:** black frame. A single checkout button pulses; price flickers
$297.00 → $340.50 → $297.00. Freeze on $340.50. Lower-third: *"Who
promised what?"*
**VO:** "An AI agent just bought you a monitor. The price changed twice
before the receipt arrived. Who promised what?"
**UI cut:** none. Title card: **VeriPact — Proving What the Merchant
Promised.**

## Scene 1 — The two breaks (0:12–0:30, 18s)

**Visual:** split-screen animation. Left: agent with a credit card,
spending bar climbing past a dotted budget line — *"Break 1: nothing
clears intent before settlement."* Right: merchant page melting —
prices and return clauses morphing after purchase — *"Break 2: nothing
proves the promise after settlement."*
**VO:** "Give an agent a payment method and two things break. Nobody
constrains what it may spend. And nobody can prove what the merchant
promised once the page changes."
**UI cut:** none (motion graphics only).

## Scene 2 — The witness pipeline (0:30–0:55, 25s)

**Visual:** animated 3-rung ladder building left to right.
Rung 1 SELF: buyer mandate card signs with Ed25519.
Rung 2 WIT: page snapshot → 13-rule DOM scan (one hidden node flashes
red, quarantined) → quotes → `ASK_HUMAN_DELTA` → Channel3 oracle check
→ RFC 3161 timestamp.
Rung 3 SIGN: `VP1:` hash stamps into a PayPal order's `custom_id`.
**VO:** "VeriPact witnesses the page before money moves. The buyer
signs intent. An independent witness scans the DOM, extracts
exact-match quotes, cross-checks the catalog, and time-anchors the
evidence. The commitment lands inside the PayPal order itself."
**UI cut (0:48–0:55):** `live-08-capture-auditor.png` — $297.00
CAPTURED + Verify-It-Yourself auditor. Lower-third: *"JCS-PARITY MATCH —
your browser recomputes the hash."*

## Scene 3 — The sniper and the traps (0:55–1:20, 25s)

**Visual:** six merchant cards fan out; three get stamped.
Card 1 APEX: PAYPAL50 applies, $347 → **$297 all-in**, green ALLOW.
Card 2 FlashTech: CLEARANCE70 slashes the price, then the card flips —
"Final Sale. 0-day returns. 25% restocking fee." Red stamp: REJECTED —
voids returns.
Card 3 FreightKing: FREIGHT50 applies, then a +$55 shipping callback
slides in. Red stamp: TRAP — callback surcharge.
**VO:** "Six stores, one sweep. The sniper takes the $297 verified
deal — and kills the two traps: a coupon that voids your returns, and
a discount erased by a fifty-five-dollar shipping callback."
**UI cut (1:12–1:20):** `live-05b-deal-sniper.png` — 6-candidate audit
table. Lower-third: *"Best compliant: $297.00 · 2 traps rejected."*

## Scene 4 — The watcher that never sleeps (1:20–1:40, 20s)

**Visual:** night-mode animation — a watcher card for KANSO-Q35 ticks
($149 retail, $100 target). A webhook pulse hits at 2 AM. Allocation
check passes ($100 ≤ $100 sub-budget). Capture fires: $149 → **$100**,
badge flips Watching → GOAL CAPTURED, `VP1:` chip prints.
**VO:** "While you sleep, the watcher polls every fifteen seconds.
A price-drop webhook lands at two AM. Budget verified, coupon applied,
captured at a hundred dollars — with proof attached."
**UI cut (1:33–1:40):** `live-00-agent-studio.png`, lower-right
Watchers card region. Lower-third: *"KANSO-Q35 · AUDIO67 · $100.00
captured."*

## Scene 5 — The dispute referee (1:40–2:05, 25s)

**Visual:** the merchant quietly edits the returns page: 30 days → 14
days, 0% → 25% fee. A red diff blooms. Three columns slide in: buyer
claim (30-day, matches) vs witness provenance (`VP1:`, TSA +
Channel3) vs seller counter-claim (14-day / 25% — contradicts the
anchor). Gavel stamp: `MERCHANT_DRIFT_CONFIRMED`, case
`PP-D-CASE-A-DRIFT`.
**VO:** "After purchase, the merchant rewrote the returns policy.
The referee compares the claim against the anchored evidence — not
screenshots — and confirms merchant drift with the signed hash."
**UI cut (1:57–2:05):** `live-12-forgery-resolved.png` — 3-column
inspector, resolved state. Lower-third: *`PP-D-CASE-A-DRIFT` ·
evidence attached as OTHER.*

## Scene 6 — Proof strip and close (2:05–2:35, 30s)

**Visual:** rapid stat cards over a dark canvas, each with its
artifact filename: 349/349 unit tests · 28/28 E2E checks, 4 viewports
· 60/60 swarm runs · 72/72 regression, diagonal confusion matrix ·
live sandbox orders `1D1495603B138083R` / `1DM45086A58528407` with
`VP1:` custom_ids. Final frame: the VeriPact shield + repo URL.
**VO:** "Three hundred forty-nine tests. Twenty-eight end-to-end
checks. Sixty swarm runs, seventy-two regression runs — every claim
on this page reproducible from the repo. Buyer guardrails control
what an agent may spend. VeriPact proves what the merchant promised."
**UI cut (2:20–2:35):** `live-06-sync-grid.png` → `live-00-agent-studio.png`
slow crossfade under the stat cards. End card: repo URL + *"Zero-key
judging: npm install, npm run build, npm start."*

## Production notes

- UI cuts are PNGs from `docs/screenshots/` (1600×900, monochrome
  UI) — Ken Burns at ≤4% scale, never full-screen screen-share.
- Animated segments: flat zinc/carbon vector style matching the UI
  (#f4f4f5 / #09090b, Inter + JetBrains Mono).
- Lower-thirds always pair a number with its artifact (file, order
  ID, or case ID). No number appears without a source.
- Music: neutral pulse, −18 dB under VO. Sound design only for
  stamps (allow / reject / trap / capture / drift-confirmed).
- Accessibility: burn in open captions; every VO line above is the
  caption script.
