# VeriPact v4.0 Final — Ruthless Judge Audit

**Role:** Lead Hackathon Judge + Principal PayPal Systems Architect + Competitive Intel Analyst.
**Event:** Build What's Next with PayPal and AI (Devpost).
**Date:** November 1, 2026. **Target:** Main Prize stacked with AG Grid/AG Studio or Channel3 Sponsor Prize.
**Verdict first:** the angle is genuinely differentiated, the PayPal API plan is 85% correct, and the schedule is achievable only if you cut three scope traps on Day 1. Details below. Zero flattery follows.

## Method and evidence base

This audit fuses (a) live web verification run today (6 research agents, 100+ tool calls, official PayPal Developer docs + raw GitHub READMEs + Devpost pages fetched 2026-11-01), and (b) a full read of the locked spec in this repo ([Idea.md](Idea.md)).

Primary Devpost rules pages returned HTTP 403 to fetch, so rules/prize facts below are corroborated by the PayPal Developer blog, CourseJoiner, StartupGrantsIndia, Eventopia, and a Devpost transcription doc — not by Devpost directly. Every unverified claim is named in the Appendix. Where the deep-research aggregator returned "no source-backed claims," that was an aggregation failure, not an evidence failure: the five child evidence packs below are real and cited inline.

## Verified hackathon ground truth (correct the plan where marked FIX)

| Fact | Status | Evidence |
|---|---|---|
| Canonical URL is `paypalaihackathon.devpost.com`, NOT `paypalai.devpost.com` | FIX plan + README + video links | [PayPal blog](https://developer.paypal.com/community/blog/PayPal_AI_Hackathon/), [listing](https://www.startupgrantsindia.com/competitions/paypal-ai-hackathon) |
| Window Oct 1 – Nov 12, 2026; cutoff Nov 12 12:00 PM PST = Nov 13 1:30 AM IST; winners ~Dec 21 | Confirmed | [PayPal blog](https://developer.paypal.com/community/blog/PayPal_AI_Hackathon/), [Eventopia](https://eventopia.in/event/paypal-ai-hackathon-2026-10-01-gs2) |
| Only hard requirement: meaningfully use BOTH PayPal (sandbox) AND AI | Confirmed | [PayPal blog](https://developer.paypal.com/community/blog/PayPal_AI_Hackathon/) |
| 8 Main Prizes: 1st $12k, 2nd $8k, 3rd $5k + five $5k (Creative, Impactful, Demo Delivery, PayPal+AI, Agentic Commerce) | Confirmed | [PayPal blog](https://developer.paypal.com/community/blog/PayPal_AI_Hackathon/), [CourseJoiner](https://coursejoiner.com/hackathon/paypal-ai-hackathon-2026/) |
| Sponsor cash: AG Grid 1st $5k / 2nd $2k / 3x$1k; Channel3 $1.5k; APIMatic 3x$1k; Bryntum 3x$1k | Confirmed | [PayPal blog](https://developer.paypal.com/community/blog/PayPal_AI_Hackathon/) |
| Eligibility: runnable demo (hosted URL or setup instructions; mocks do not qualify) + public OSS repo with license file at top/About + public YouTube video under 3:00, project functioning, no third-party trademarks | Confirmed | [Devpost transcription](https://raw.githubusercontent.com/ma-za-kpe/stood/main/docs/06-paypal-hackathon.md), [Eventopia](https://eventopia.in/event/paypal-ai-hackathon-2026-10-01-gs2) |
| 5 judging criteria: Technological Implementation, Design, Potential Impact, Innovation/Idea, Presentation | Confirmed, but NO weights stated | [Transcription](https://raw.githubusercontent.com/ma-za-kpe/stood/main/docs/06-paypal-hackathon.md) |
| "20% each" equal weighting | CONTRADICTED — remove from README/video | Same transcription: "no weights stated" |
| Prize stacking cap "at most one Main + one Sponsor" | UNVERIFIED — no source mentions any cap | Named gap; verify on Devpost rules in a browser |
| "Stage 1 Pass/Fail + Stage 2 scored" two-stage framing | UNVERIFIED — no source describes stages | Named gap |
| PayPal "Early Eligibility Check, Thu Nov 5" | UNVERIFIED — no source; only webinars Oct 6/7/12/13 | Named gap; keep Nov 5 as internal gate only |
| "~25,200 registrants" funnel figure | UNVERIFIED — no source cites counts | Named gap; probabilities below show sensitivity |
| Sponsor prize is named "Best Use of AG Grid" (AG Studio is AG Grid's product, per PayPal blog) | FIX naming in submission | [PayPal blog](https://developer.paypal.com/community/blog/PayPal_AI_Hackathon/), [AG Grid](https://www.ag-grid.com/blog/hackathon-paypal-and-ag-studio/) |

---

## 1. Executive Verdict & Calibrated Judge Scorecard

Scored as a written plan on Nov 1 (pre-code), against the five Devpost criteria. Presentation scores the storyboard, not a delivered video.

| Criterion | Score /10 | Rationale and exact deductions |
|---|---|---|
| Technological Implementation | 7.5 | Breadth is elite: Orders v2 AUTHORIZE + PATCH + authorize + capture/final_capture + void, Disputes v1 full lifecycle with HATEOAS gating, webhook verify + polling fallback, RFC 3161 TSA, Ed25519 three-key split, Channel3 oracle, AG Studio widget + agent + MCP tools, substring-verified LLM extraction, Wilson-CI regression. Deductions: −1.0 synthetic storefront + self-hosted "independent" witness weakens the trust story a judge can credit; −0.5 SDK version straddle (onShippingChange vs onShippingAddressChange) and two unverified request fields (capture `custom_id`, capture `note_to_payer`); −0.5 LLM extractor determinism + 72-eval regression unproven; −0.5 AG Studio inline-dataset toggle fights a documented init-time-only data model. |
| Design | 7.0 | Two-view workspace (checkout + dispute desk) is the right shape; sufficiency pills, rung badge, 3-column inspector, and Verify-It-Yourself drawer map 1:1 to judging narrative. Deductions: −1.0 clutter risk (pills + badges + drawer + popup + grid + widget + sidebar agent in 140 seconds); −1.0 AG Studio `mode` defaults to `view` and container-height/init traps mean the design only works if Day-1 spikes land; −0.5 synthetic SVG store must still look premium on camera or "Design" bleeds into "Presentation." Ceiling is 8.5 with disciplined visual execution. |
| Potential Impact | 8.0 | Problem is real and quantified (18/330 all-in determinability, tax the modal gap), bilateral (protects honest buyers AND honest merchants), and has a credible production path (PayPal Store Sync as neutral witness). Deductions: −1.0 adoption friction: requires merchant-signed offers pre-checkout, which the cited benchmark says were observed zero times in the wild; −0.5 DigiCert TSA is not EU-qualified (eIDAS) and proves existence-not-truth, capping legal-grade claims; −0.5 witness centralization question (who runs WIT at scale, who pays) unanswered. |
| Innovation / Quality of Idea | 8.5 | Highest score. "Buyer guardrails control spend; VeriPact proves what the merchant promised" is genuinely separated: all three inspected mandate/dispute rivals prove what the BUYER allowed to defend the MERCHANT; none proves what the MERCHANT promised to arm the BUYER. Symmetric forgery detection (drift + buyer-forged receipts) is a second novel beat. Deductions: −0.5 buyer-guardrail lane is crowded and PayPal's own agent-toolkit + agent-ready platform commoditize the baseline; −0.5 three-rung SELF/WIT/SIGN ladder is internal taxonomy with no external reference; −0.5 name collision with PACT costs distinctiveness despite the positioning paragraph. |
| Presentation | 6.5 | The 140-second storyboard is well-structured (hook with 18/330 + mutation graphic; Scene 1 capture + 4-sec void inset + live read-back; Scene 2 both contested cases; Scene 3 agent prompt + regression chart). But as of Nov 1 there is no live URL, no video, no Sandbox IDs — while Warrant, Mandate, and Carte Blanche already ship Render apps + videos. Deductions: −2.0 nothing demonstrable yet vs shipped rivals; −1.0 storyboard tries to show ~8 beats in 140 seconds (void inset, both forgery directions, agent, regression) — pacing risk; −0.5 wrong Devpost domain + asserted 20% weights + unverified Nov-5 check would cost credibility if uttered on camera. Ceiling 9.0 if the video lands exactly as scripted. |

**Composite: 37.5/50 → 75/100.**

Calibration: 75 as a plan is fundable-to-build. Winning submissions typically present at 82+ as built artifacts. The gap is entirely execution: live Render URL, both contested cases closing real sandbox disputes on camera, Verify-It-Yourself read-back working, and a 140-second video that shows no more than five beats. Nothing in the idea needs rethinking; three scope traps need cutting (Section 4–6).

---

## 2. Quantitative Win Probability Matrix

Funnel math first, because the "~25,200 registrants" figure is UNVERIFIED (no source cites registrant counts). Standard global Devpost conversion is 2–6% registrants → submissions, with a further ~40–60% failing the runnable-demo + video + license gate. Two scenarios:

- If 25,000 registrants is real: ~500–1,500 submissions, ~300–800 eligible. 8 Main + 12 cash Sponsor prizes = 20 cash prizes → naive base rate 1.3–6.7% per eligible entry for any cash.
- If the real funnel is smaller (10,000 registrants): ~200–600 submissions → base rate 3–10%.

VeriPact is not a median entry: differentiated angle + full PayPal API depth + dual-sponsor stack lifts it above base rate, but three rivals already ship live demos + videos, which discounts every overall-placement probability. Sponsor pools are much smaller than Main pools (only entries that genuinely integrate AG Grid/Channel3 compete), which is why sponsor probabilities dominate the combined number. All estimates assume you ship the full plan by Nov 11 with a live Render URL and a compliant video; shipping less collapses every row toward the base rate.

| Prize | Point estimate | Uncertainty band | Reasoning |
|---|---|---|---|
| 1st Place Overall ($12,000) | 1% | 0.3–2.5% | Single winner from hundreds of eligible entries against already-shipped Warrant/CarteBlanche/Mandate + unknown late entries. Differentiation is real but 1st demands flawless demo + video + luck. |
| Top 3 Overall ($5,000–$12,000) | 4% | 1.5–7% | Three slots, same field. VeriPact's bilateral story (buyer AND merchant protection) plays well for overall judges, but overall podiums skew to polished, broadly legible demos — VeriPact is deep/narrow. |
| Best Use of PayPal + AI ($5,000) | 5% | 2–9% | Strong fit (Orders + Payments + Disputes + webhooks + LLM extraction), but this is the most contested thematic prize: every serious entry claims PayPal+AI. Warrant's 246-test sandbox depth is the bar. |
| Best Demo Delivery ($5,000) | 4% | 1–8% | Entirely execution-dependent. Storyboard is good but overstuffed; rivals already have published videos. If the 140-sec video lands cleanly, this is winnable; widest band for that reason. |
| Best Use of Agentic Commerce ($5,000) | 7% | 3–12% | Best Main-prize fit: mandate → witness → authorize → re-gate → dispute is a genuine agentic-commerce loop, and PayPal's own AP2 representment call + agent-ready narrative rhymes with it. |
| Any Main Prize (8 categories) | 16% | 8–26% | Union across 8 shots, but correlated (same judges, same demo). Roughly 3–4x the naive base rate — the differentiation premium. |
| Best Use of AG Grid 1st Place ($5,000) | 8% | 3–15% | Small pool (serious AG Grid/Studio integrators, est. 30–120), but Warrant (AG Grid queue + Studio dashboard), Carte Blanche (AG Grid + Bryntum), and Mandate (AG Grid) already occupy it. Winning 1st requires the inspector widget + agent sidebar to clearly exceed their depth. |
| Any AG Grid Prize (5 prizes) | 25% | 12–40% | Five prizes from a small pool is the fattest target on the board. A working master table + custom widget + one agent-driven chart should clear 3rd-place depth; the band reflects unknown AG-pool size. |
| Best Use of Channel3 ($1,500) | 15% | 6–28% | Single winner but a tiny pool (est. 20–80 genuine Channel3 integrations). Probability is bimodal: ~25% if the `PAYPAL-HACKATHON-2026` REST key is real and the oracle runs live on camera, ~5% if you fall back to keyless MCP search only. Spike this Day 1. |
| COMBINED: at least one cash prize | 35% | 20–50% | Dominated by (Any AG Grid) ∪ (Channel3) ∪ (Any Main), which are only partly correlated (different judges). Assumes full shipment + stacking allowed; if stacking is banned or pools are larger than estimated, use the low end. Below 20% would mean execution slipped; above 50% would require a rival stumbling. |

What moves the needle most: (1) a live Render URL judges can click (doubles every row vs repo-only); (2) two real sandbox dispute closures on camera (separates you from every mock-webhook entry); (3) verified Channel3 + DigiCert calls with IDs on screen (sponsor judges reward receipts, not logos).

---

## 3. Head-to-Head Competitor Breakdown

Core finding: the buyer-mandate + merchant-dispute-defense combo is taken three times over (Warrant strongest, then Carte Blanche, then Mandate). VeriPact's merchant-promise-attestation-for-buyers framing has NO inspected direct rival — the positioning sentence survives contact with reality. But all three rivals set a deployed-demo bar (live Render apps, published videos, real sandbox dispute paths, AG + Channel3 stacks) that VeriPact must match on screen by Nov 11 or the better idea loses to the better demo.

### 3.1 Warrant (electrum21/paypal-warrant) — PRIMARY RIVAL, already shipped

What it is: merchant-side dispute defense. A buyer agent presents a signed mandate (spending limits, cryptographically signed) at purchase; on dispute, Warrant checks the purchase against that mandate with deterministic code, assembles evidence, and proposes a response through the PayPal Disputes API in sandbox — human merchant approves before anything is submitted. Design rule enforced in code: "the LLM writes words; code decides; the merchant approves; only then does anything reach PayPal." Source: [Warrant README](https://raw.githubusercontent.com/electrum21/paypal-warrant/master/README.md).

What they have on screen RIGHT NOW that you must match or beat: 246+ automated tests plus live sandbox runs (order creation + capture, dispute creation + import, contest and accept-claim paths, a live webhook turning a real sandbox dispute into a proposal with zero manual steps, browser-driven autonomous Vault checkout); three live sponsor integrations (Channel3 product search AND verification of what was bought, Elastic semantic precedent search, Zapier two-way delivery-evidence loop); a real AG Grid dispute queue plus AG Studio dashboard; live Render deployment; published demo video.

Their gap (your opening): checks ONLY buyer spending limits. No independent witness fetch, no Channel3-catalog-as-oracle for merchant terms, no shipping-callback auto-void, no merchant-promise commitment in `custom_id`, and — critically — cannot catch buyer-forged DOM receipts because its trust root IS the buyer's mandate. Your Case B (forged 60-day receipt caught by WIT + custom_id mismatch) is the single demo beat Warrant cannot replicate. Lead with it in Scene 2, not Case A: Case A (drift) looks like "dispute helper" (their turf); Case B (forgery caught) looks like "new trust primitive" (your turf).

Threat level: CRITICAL. If judges compare two working dispute desks, the one with 246 tests + live Render + video today beats the better idea with a localhost demo. You must ship a live URL + video of equal production quality.

### 3.2 Mandate — TWO live entries share the name; both matter

(a) Chinorab/mandate: "Proof of what your agent was allowed to buy." Buyer-signed fingerprinted mandates (canonical JSON hashed with SHA256 + mandate code + version, timestamped); every PayPal payment checked against the mandate and carrying a reference to it; merchant answers later disputes with that record. Live demo until Dec 15 + 2-minute video. Source: [Mandate README](https://raw.githubusercontent.com/Chinorab/mandate/HEAD/README.md).

(b) sadrax4/mandate: Go + Claude + PayPal Orders v2 + AG Grid + Channel3 + Render, live demo on PayPal sandbox with Claude Opus 5.5 and live Channel3 catalog. Source: [sadrax4 README](https://raw.githubusercontent.com/sadrax4/mandate/HEAD/README.md). This entry proves your exact sponsor stack alone does not differentiate.

What you must match: fingerprint-carrying payments (you do, via `custom_id`), live demo + short video (you must), Channel3 live on camera (you must). What beats them: neither witnesses merchant terms; both trust buyer-side records. Your WIT re-fetch + TSA + custom_id triangle is the separator — but only if the witness fetch is visibly out-of-band (deployed URL, distinct service logs, distinct key fingerprint), not three ports on one box.

### 3.3 Carte Blanche (slabbdev/carte-blanche) — the dark horse

Signed spending mandates, sealed SHA-256 journal of receipts AND signed refusals, public no-login verification, and a seller Resolution Center that scores evidence against PayPal's real evidence slots and submits to the Disputes API in one click. Planner uses live Channel3 catalog; auto-generated AG Grid + Bryntum board fill with signed receipts and refusals. Live Render app on sandbox rails. Source: [Carte Blanche README](https://raw.githubusercontent.com/slabbdev/carte-blanche/HEAD/README.md).

Why it is dangerous: it already does "evidence pack scored against PayPal's real evidence slots" — uncomfortably close to your inspector widget — plus no-login public verification, which judges love. Your counters: (1) they journal buyer-side receipts; you witness merchant-side promises — say this sentence verbatim in the video; (2) your Verify-It-Yourself browser auditor (client SHA-256 + live order read-back) can match their no-login verification beat if it works in the judge's browser; (3) their Bryntum board is breadth; your 3-column buyer-vs-order-vs-seller inspector is depth — keep it visibly deeper (hashes, timestamps, diffs, HATEOAS-gated buttons, not just statuses).

### 3.4 Trustrail Hold (northstar-trustrail/trustrail-hold) — DOES NOT EXIST

The repo URL returns HTTP 404. The similarly named Portaudit/trustrail-pipelines is deterministic Solana escrow settlement (devnet only, unaudited), not a PayPal competitor — a name collision only. Source: [trustrail-pipelines](https://github.com/Portaudit/trustrail-pipelines).

This is a plan-integrity emergency, not a competitive finding: your spec's competitor table describes Trustrail Hold's MiniLM model, 25 test cases, and "AG Studio was not used" in confident detail. If that entry was hallucinated or sourced from a deleted/private repo, and you repeat it in your README or video, a technical judge who clicks the link and gets a 404 will discount ALL your competitive intel. Action: delete Trustrail Hold from every public artifact before Nov 5, or replace it with a verifiable entry. Same hygiene pass for every competitor row: every name in the README must link to a live URL you opened this week.

### 3.5 PACT, Mandat, PartDrop, Upstream, Dispute Copilot, guardrail lane

- PACT (conditional settlement, Groq + hash chains): your table claims no AG Studio / Channel3 / Disputes API — but this row was NOT independently fetched (search-snippet only). Either verify or soften to "as described on Devpost" with a link. The PACT/VeriPact name collision is real; keep the distinct-name paragraph but do not assert their architecture without a citation.
- Mandat (photo-to-errand concierge, APIMatic/Vault/Invoicing/AG Studio/Bryntum/Channel3): different problem (errands + QR invoices), no checkout-evidence or dispute story. Sponsor-pool competitor only.
- PartDrop (CNC quotes, Claude Vision, Bryntum, AG Grid): README reportedly discloses mock PayPal mode in the video — if true, your "100% live sandbox calls" contrast is a legitimate kill shot, but re-verify the disclosure link before claiming it.
- Upstream (Claude Code plugin, Payouts to maintainers): strong utility, zero visual sponsor frameworks — Main-prize lane only.
- PayPal Dispute Copilot (Devpost): merchant AI assistant with win-confidence score, but PayPal submission path is simulated (mock webhooks). Technically weaker than Warrant/Mandate/CarteBlanche. One README line suffices: "unlike mock-webhook entries, every PayPal call below ran against sandbox — IDs listed."
- Guardrail lane (paypal-agent-firewall with Z3 proofs; PayAgent OS intercepting agent tool calls): crowded, and your spec correctly refuses to compete there. Keep the one-line dismissal and move on.
- Platform baseline: PayPal's official agent-toolkit already ships dispute tools, and PayPal's agent-ready service promises fraud/protection/disputes with no merchant lift (early 2026). Your value must sit visibly ABOVE toolkit calls: the witness + commitment + contested-verifier chain is that value. Never demo a bare "list disputes" screen — it looks like the toolkit.

### 3.6 What "must match or beat on screen" reduces to

1. Live Render URL + sub-3:00 video (Warrant, both Mandates, Carte Blanche have these TODAY; you have neither).
2. Real sandbox dispute closure with visible IDs (Warrant's zero-manual-step webhook proposal is the bar; your two-case close must look at least as real).
3. Sponsor depth, not logos: Channel3 verification of what was bought (Warrant already does this), AG Grid queue + Studio dashboard (Warrant/CarteBlanche do this) — your inspector + agent-chart must be deeper.
4. One unreplicable beat: buyer-forgery caught by witness + `custom_id` mismatch (nobody has this — make it the video's climax, not an afterthought).

---

## 4. Remaining Technical Risks, Sandbox Traps & Scope Bottlenecks

Ranked by severity. CRITICAL = can kill the demo or the submission; MODERATE = can burn a day or cost a prize lane; MINOR = fix in under an hour.

### CRITICAL

1. Trustrail Hold 404 + unverified competitor rows (plan integrity). Detailed in 3.4. Purge or verify before Nov 5. A single dead link in competitive intel poisons judge trust in all technical claims.
2. Channel3 `PAYPAL-HACKATHON-2026` key provenance unknown. Research verified Channel3's MCP surface (stateless Streamable HTTP at `https://mcp.trychannel3.com/`, tools `search_products`/`get_products`, no-key free tier, `X-API-Key` for unlimited) but found NO documentation of a `PAYPAL-HACKATHON-2026` REST key or REST endpoint shape — REST details beyond MCP appeared only in snippets. If that string came from a hackathon resource email/Discord, fine — but if it was invented in planning, your witness-oracle leg has no API. Spike Day 1 morning: redeem the key, print one live product lookup, cache the response. Fallback (decide by EOD Nov 2): keyless MCP `search_products` + file cache + honest "catalog oracle via Channel3 MCP" label. Sources: [Channel3 MCP blog](https://trychannel3.com/blog/channel3-mcp), [mcp-server README](https://raw.githubusercontent.com/channel3-ai/mcp-server/HEAD/README.md).
3. AG Studio inline 24-scenario dataset toggle vs init-time-only data. AG's own guidance: "Updating `data` after init is largely a no-op: only changes to synchronous data are processed; adding/removing sources, changing fields, async changes are ignored." Your header toggle (live disputes ↔ regression suite) is exactly the ignored case if implemented as a data swap. Also `mode` defaults to `view` (builder needs `edit`), versions lockstep with Grid/Charts, and the container needs explicit height. And Studio is "very underrepresented in training data," so Claude Code WILL hallucinate APIs — all Studio code must be written against [ag-grid/skills Studio recommendations](https://raw.githubusercontent.com/ag-grid/skills/HEAD/skills/ag-dev/references/studio/recommendations.md), never from memory. Fix: implement the toggle as two mounted Studio/Grid instances (or full remount with distinct `key`), not a data mutation; spike this Day 1–2 with a 5-row fixture before building the real widget.
4. Sandbox dispute pre-seeding needs buyer-side credentials + fresh transactions per dispute. Creating a sandbox dispute requires a personal sandbox buyer account, consent/JWT wired with merchant `CLIENT_ID` + `BUYER_EMAIL`, and a REAL sandbox transaction ID; duplicate disputes on the same transaction are blocked; unauthorized-dispute IDs differ between buyer and merchant views. Your two contested cases therefore need two separate completed sandbox purchases plus the buyer-cred handshake. Budget a full Day 3–4 spike, script it (`npm run seed:disputes`), and never demo-case-share a transaction. Sources: [disputes integration guide](https://developer.paypal.com/limited-release/commerce-platform/manage-risks-liabilities/disputes-chargebacks/integration-guide/), [simulate test scenarios](https://developer.paypal.com/limited-release/commerce-platform/manage-risks-liabilities/disputes-chargebacks/test-dispute-workflows/simulate-test-scenarios/).
5. Reaching adjudicatable status requires the missing `require-evidence` step. `adjudicate` is sandbox-only AND requires status `UNDER_REVIEW` plus an `adjudicate` HATEOAS link; `provide-evidence` is status-gated (merchant only at `WAITING_FOR_SELLER_RESPONSE`, buyer only at `WAITING_FOR_BUYER_RESPONSE`); `escalate` moves INQUIRY → CHARGEBACK but does not itself set the evidence/adjudication statuses. Your plan never names `POST .../require-evidence` (update dispute status, sandbox-only) — without it the demo's Provide-Evidence and Adjudicate buttons will be HATEOAS-disabled on camera. Add the status-driving chain to the seed script: create → (escalate) → require-evidence → provide-evidence → adjudicate, asserting HATEOAS links at each step. Sources: [settle/adjudicate](https://developer.paypal.com/api/customer-disputes/v1/disputes-adjudicate), [integration guide](https://developer.paypal.com/limited-release/commerce-platform/manage-risks-liabilities/disputes-chargebacks/integration-guide/).
6. Witness "independent HTTPS fetch" of `http://localhost:4003/store/...` is not independent. The spec's canonical receipt shows a localhost listing URL. A witness that curls the builder's own localhost is theater, and technical judges WILL pause the video on that JSON. Fix: witness fetches the DEPLOYED Render storefront URL over real HTTPS; keep localhost only for unit tests. Log the fetch (URL, status, bytes, TLS) visibly in the UI.
7. JS SDK major version straddle. Current v6 reference documents `onShippingAddressChange` + `onShippingOptionsChange` (promise-based, rejection refuses the change) with orders-patch as the update mechanism; `onShippingChange` exists only in the legacy Buttons/checkout-components SDK. Your spec uses BOTH names in different sections. Pin ONE major in `package.json`/script tag on Day 1: if v6, implement both new handlers; if v5/Buttons, keep `onShippingChange` and cite the legacy doc. A mismatched handler name silently never fires — the surcharge trap then never triggers and your centerpiece demo dies quietly. Sources: [SDK v6 reference](https://developer.paypal.com/sdk/js/reference/) (updated 2026-10-29), [legacy checkout doc](https://raw.githubusercontent.com/paypal/paypal-checkout-components/main/docs/implement-checkout.md).
8. Render cold starts × 4 processes. Three services + web app on Render free tier sleep; each cold start costs 30–60s. A judge clicking your URL and waiting 2+ minutes (or hitting a sleeping witness during checkout) scores Design/Presentation down before seeing anything. Fix: deploy the demo as ONE process with route-mounted services (keys still disjoint via env vars), keep the three-service split as code topology + documented production target. This is the highest-ROI scope cut in the plan.

### MODERATE

9. Capture `custom_id` + `note_to_payer` fields unverified. Research verified capture endpoint, `final_capture` semantics (optional, default false), and void-before-capture rule — but NOT that the capture request accepts `custom_id` or `note_to_payer`. Your Step 3 sends both. Spike against the [capture reference](https://developer.paypal.com/api/payments/v2/authorizations-capture): if rejected, move the addendum hash into `invoice_id` (verified pattern) or keep it server-side keyed by authorization ID. Fallback costs nothing if decided early.
10. PATCH path + timing. PATCH works only in `CREATED`/`APPROVED` (never `COMPLETED`), needs `reference_id` (defaults to `default` for single-unit orders — yours is single-unit, good), and the order stays in `CREATED` for ~3 hours. Verify the exact path `/purchase_units/@reference_id=='default'/amount` against the [PATCH reference](https://developer.paypal.com/api/orders/v2/orders-patch) on Day 1; a wrong path returns 422 mid-popup. Also note AUTHORIZE forbids multiple purchase units and has a 3-day honor window (re-authorize after expiry) — single-unit design is mandatory, and demo authorizations must be fresh. Sources: [create order](https://developer.paypal.com/api/orders/v2/orders-create), [PATCH](https://developer.paypal.com/api/orders/v2/orders-patch).
11. Void/capture race. `void` fails on fully captured authorizations; the re-gate must be strictly ordered (read total → decide → EXACTLY ONE of capture/void) with `PayPal-Request-Id` idempotency on capture. Add a server-side state machine (`AUTHORIZED → DECIDED → CAPTURED|VOIDED`); never let the client call both.
12. Webhook simulator does not verify. Mock events carry ID string `WEBHOOK_ID` and do NOT support `verify-webhook-signature` postback; real verification needs the subscribed listener's Webhook ID plus all transmission headers, HTTPS on 443, and 2xx on every delivery (else 25 retries/3 days). Your polling fallback (GET disputes list + detail) is the right call — keep webhooks as enhancement, polling as the demo's backbone, and never film the simulator as "verification." Source: [webhooks REST](https://developer.paypal.com/api/rest/webhooks/rest), [verify signature](https://developer.paypal.com/api/webhooks/v1/verify-webhook-signature-post).
13. Inquiry opt-out branches lifecycle. Merchants opted out of inquiry create disputes directly in `CHARGEBACK`, skipping `INQUIRY`; inquiry applies only to internal INR/SNAD (external chargebacks are adjudicated by financial institutions, not PayPal). Your "pre-seed both stages" plan is right, but the seed script must READ the merchant's sandbox inquiry setting and branch assertions — otherwise Case A/Case B setup flakes by account config. Also `provide-evidence OTHER` is mandated in sandbox test conditions — keep `OTHER`, but the exact notes/documents JSON shape beyond prose was not fetched; open the provide-evidence reference before coding the dossier upload. Sources: [simulate scenarios](https://developer.paypal.com/limited-release/commerce-platform/manage-risks-liabilities/disputes-chargebacks/test-dispute-workflows/simulate-test-scenarios/), [disputes API reference](https://developer.paypal.com/docs/multiparty/disputes-chargebacks/disputes-api-reference/).
14. DigiCert verification reproducibility. `http://timestamp.digicert.com` is free/no-auth but a code-signing TSA with no single published CA-cert download page; `openssl ts -verify` needs the chain you must assemble and pin yourself. Recommendation from prior art: default to freeTSA.org (stable published CA+TSA certs, reproducible fixtures) for tests, use DigiCert live with pinned roots, and consider `rfc3161-client` (Trail of Bits, Apache-2.0, Sigstore-battle-tested; builds/parses/verifies, HTTP stays yours) instead of hand-rolled ASN.1. Note the endpoint is plain HTTP and DigiCert returned no TSA name field — display "hash existed by T per TSA cert X," never "DigiCert certifies the terms are true." And never claim EU-qualified timestamps: none of nine surveyed free endpoints (Oct 2026) is eIDAS-qualified. Sources: [prior-art brief](https://raw.githubusercontent.com/timsimpsonjr/magpie/HEAD/skills/archive-evidence/references/prior-art.md), [Hartman TSA survey](https://kennethghartman.com/blog/one-hash-three-timestamp-authorities/), [eIDAS check](https://dev.to/lizhuojunx86/i-checked-nine-free-rfc-3161-endpoints-against-the-eu-trusted-list-none-is-qualified-five-of-the-djc).
15. WebCrypto Ed25519 in the Verify drawer. `window.crypto.subtle.digest('SHA-256')` is universal — fine. But client-side Ed25519 VERIFY via WebCrypto is not universally supported (browser-dependent). Keep SHA-256 + order read-back client-side; do Ed25519 verification server-side (or bundle `noble-ed25519`). A drawer that throws in the judge's browser is worse than no drawer.
16. Deterministic Studio Agent + "MCP-compatible" framing. AG's MCP server is a docs-search coding assistant, not a verification-tool harness; WebMCP in Studio is early-stage, Chrome-only under a dev flag. Your "deterministic tool-mapped adapter" framing is honest — keep it, and do NOT call the sidebar a real MCP server in the video. One prompt → one chart, same output every run, is the demo; anything generative-looking invites "is this real?" from judges. Sources: [AG MCP docs](https://www.ag-grid.com/react-data-grid/mcp-server/), [WebMCP in Studio](https://www.ag-grid.com/blog/webmcp-in-ag-studio-dashboards/).
17. arXiv citations must be opened Day 1. The 18/330 stat, the 555-site census, RAILS, Whisper Attacks, and the PayPal AP2 blog are load-bearing for Impact/Innovation — and several IDs are 2026-dated. This audit did not verify them. Open every arXiv URL + the PayPal AP2 post on Day 1; hyperlink each in the README; quote the 18/330 line EXACTLY as the spec does (never blend the 555 census into it). A dead or misquoted citation is a credibility kill.
18. 24×3=72 LLM evaluations will flake. Keep the local-OpenSSL-signer decision (never hit DigiCert in batch), but ALSO record/freeze LLM extractor outputs per fixture (VCR-style) so `npm run regression` is deterministic and free; run the LIVE LLM only on the 3 filmed checkout scenarios. Otherwise Wilson CIs will wobble between runs and the AG chart will disagree with the README.

### MINOR

19. `custom_id` 68 chars is safe under both limits (current 255, legacy example 127) — no action, just cite the [create-order reference](https://developer.paypal.com/api/orders/v2/orders-create) in code comments.
20. Do not hand-roll JCS (RFC 8785) — use the `canonicalize` package; hand-rolled canonicalization is a hash-mismatch farm.
21. TSA-vs-`order.create_time` comparison needs a ±5-minute tolerance (clock skew), not exact ordering.
22. `application_context` (`GET_FROM_FILE`, `PAY_NOW`) values: re-confirm against the create-order reference when pinning SDK major.
23. AG Studio trial license: redeem Day 1 and confirm trial terms cover public demo video; do not promise "zero watermarks" until the key renders clean.
24. Time-box the "Verify It Yourself" drawer: SHA-256 match + custom_id highlight is the whole feature. Any more (cert chains, JCS viewers) is scope creep that steals video seconds.

---

## 5. High-ROI Surgical Upgrades (each under 4 hours)

1. Sandbox Receipts Strip at the top of the README + video description (2h). A copy-paste block with REAL IDs from your seed runs: Order ID, Authorization ID, Capture ID, Void ID, both Dispute IDs, `custom_id` value, Channel3 product ID, TSA serial/time. Sponsor and technical judges scan for receipts before reading prose; Warrant's README wins partly because it reads like a lab notebook. Re-run the seed script the night before lock and refresh the strip so no ID is expired (3-day honor / 3-hour CREATED windows).
2. Restructure Scene 2 around Case B first, Case A second (3h: re-edit + re-record voiceover only). As storyboarded, drift-then-forgery buries your unreplicable beat. Open Scene 2 with the forged "60-day + $50 rebate" receipt visibly REJECTED (red mismatch on `custom_id` + WIT), then show drift ACCEPTED for the honest buyer. The judge takeaway flips from "another dispute helper" to "a forgery detector that also resolves drift." No code change required.
3. Witness Provenance Card in the inspector's Column 2 (3–4h). Show: fetched URL (deployed HTTPS, not localhost), HTTP status + bytes + duration, TLS indicator, WIT key fingerprint (first 16 hex), TSA issuer + timestamp, Channel3 product match (ID + price + condition). This single card converts "three ports on one box" skepticism into "oh, it actually fetched." It is also the Channel3 judge's screenshot.
4. Single-process Render deployment with a topology diagram update (3h). Mount the three services as route groups in one process for the demo; keep disjoint keys via env vars; update the README diagram caption to "logical isolation (disjoint keys/processes in production) packaged as one process for judge-click latency." You keep the architecture story and delete 2+ minutes of cold starts. Highest expected-value change in this report.
5. Five-beat video diet + compliance pass (2h scripting, saves the video). Cut the storyboard from ~8 beats to 5: (1) hook + mutation graphic, (2) witnessed $297 capture + Verify-It-Yourself read-back, (3) 4-second void inset, (4) Case B forgery rejected → Case A drift resolved (one continuous desk sequence), (5) one agent prompt → one chart. Then verify: public YouTube, under 3:00, zero third-party trademarks/logos/music, correct Devpost URL in the description, no "20% weights" or "Nov 5 early check passed" claims uttered or captioned.

---

## 6. Final Actionable Build Directives (Nov 1 → Nov 5 → Nov 11)

### Verdict: FREEZE PLANNING. Write code today. The plan is strong enough; every remaining question is answered by a spike, not another revision.

Non-negotiable Day-1 spikes (time-box each; a spike that exceeds its box triggers its fallback the same day):

- [ ] P0 (2h): Pin PayPal JS SDK major; fire one AUTHORIZE → PATCH (shipping/tax) → authorize → capture (`final_capture:true`) and one authorize → void in sandbox; log all IDs. Fallback: whichever major fires first wins; delete the other handler's name from the codebase.
- [ ] P0 (2h): Redeem AG Studio trial key + Channel3 key; render one Studio grid from a 5-row fixture with explicit height + `mode:'edit'`; print one live Channel3 lookup. Fallbacks: Studio toggle becomes two remounted instances; Channel3 becomes keyless MCP + cache.
- [ ] P0 (1h): One DigiCert TSA round-trip + `openssl ts -verify` with pinned chain; one freeTSA round-trip as the test default. Fallback: freeTSA everywhere, DigiCert live-only.
- [ ] P0 (1h): Open every arXiv + PayPal AP2 citation; fix the Devpost URL everywhere; delete Trustrail Hold; scrub "20% weights" and "Early Eligibility Check" from all artifacts (keep Nov 5 as an internal gate, never as a claimed PayPal program).

Build order after spikes (strict priority; do not start N+1 until N runs end-to-end):

1. Days 1–2: crypto-core (`canonicalize` package, SHA-256/`VP1:` formatter, Ed25519 via Node, TSA client) + single-process server skeleton + synthetic storefront with drift toggle + quote highlighting.
2. Days 3–4: PayPal Orders chain (create/PATCH/authorize/capture/void + re-gate state machine) FIRST, then `seed:disputes` (two fresh transactions → create → escalate → require-evidence → provide-evidence → adjudicate, asserting HATEOAS at each hop) + contested-verifier (Case B before Case A).
3. Day 5 (internal gate): View 1 + Verify drawer (SHA-256 + read-back only) + View 2 grid + inspector widget + witness provenance card; deploy single-process Render; record a rough walkthrough; publish a DRAFT Devpost with repo + video links (this is your real "early check": a judge-clickable draft a week before cutoff).
4. Days 6–8: regression fixtures with frozen LLM outputs + Wilson CIs + AG chart; deterministic agent sidebar (one prompt, one chart, zero generative surface); webhook verifier (enhancement) behind polling (backbone).
5. Days 9–11: receipts strip refresh, 5-beat video, compliance pass (license in About, <3:00, no trademarks), README with live links only, lock Nov 11 9:00 PM IST. Re-run seeds the night before so no captured ID is stale.

Simplification triggers (pre-authorized — use them without guilt):

- If any PayPal spike exceeds its box: cut the void inset's live popup and film the void as a server-log + API-response sequence; keep exactly one live popup (the $297 capture).
- If AG Studio fights back: ship the master table as plain AG Grid (a verified win condition for "Best Use of AG Grid") with the inspector as a side panel; Studio becomes the chart surface only.
- If Channel3 REST fails: MCP + cache, labeled honestly; do not burn more than 4 hours total on the oracle.
- If the LLM extractor wobbles: freeze extractor outputs for all 24 fixtures; live LLM only on the 3 filmed pages.
- If webhooks lag: ship polling-only ingestion; webhooks become a README "production note."

Biggest time-sink risks, in order: (1) sandbox dispute status-driving (require-evidence chain), (2) AG Studio API hallucinations + dataset toggle, (3) Channel3 key/endpoint uncertainty, (4) 72-eval regression determinism, (5) multi-process Render deployment (deleted by directive #4 above).

You are ready to build. The idea beats the field; only the demo can now lose to it.

---

## Appendix: named gaps and unread material

Effects on this audit: none of these gaps change the build directives; they cap how strongly the probability and rules claims can be stated.

- Primary Devpost rules/judging/prize pages (HTTP 403 to fetch): stacking cap, stage framing, criterion weights, and the Nov 5 check could not be confirmed or denied from the primary source. Re-verify in a browser before locking Devpost text.
- Channel3 REST/SDK reference beyond MCP (seen in snippets only): endpoint shape, auth, filters, rate limits. Day-1 spike resolves.
- `provide-evidence` full JSON schema for `OTHER` notes/documents (prose excerpts only): open the API reference before coding the dossier upload.
- Capture-request `custom_id` / `note_to_payer` acceptance (not in fetched excerpts): Day-1 spike resolves.
- Competitor rows for PACT, Upstream, PartDrop, Mandat-details, Dispute Autopilot, Rebuttal, spendwall and others (search-snippet only, not fetched): do not cite architecturally until opened.
- Devpost project gallery (not directly enumerated; pre-deadline entries surface via search): unknown late entries are the largest residual risk to overall-placement probabilities.
- arXiv/industry citations (not opened in this audit): Day-1 verification required (directive above).
- SELF/WIT/SIGN three-key isolation (no external reference exists): judged as internal architecture; make keys visibly distinct and honestly scoped.
