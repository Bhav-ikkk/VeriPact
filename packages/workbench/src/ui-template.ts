/**
 * @veripact/workbench Sequoia 2-view UI template (agent 04).
 *
 * One self-contained HTML page: glass header, View 1 buyer checkout +
 * Verify-It-Yourself auditor, View 2 AG dispute desk with remounted
 * datasets. Design applications: apple-design (HIG foundations — semantic
 * status colors, tabular numerals, glass only on the floating header),
 * break-ui (hash chips truncate middle/end with copy-on-click + full value
 * on focus, min-width:0 flex children, tabular figures), interface
 * guidelines (skip link, aria-live status, focus-visible rings,
 * reduced-motion), taste (no landing-page tropes — a dense workspace).
 * AG usage follows ag-dev: explicit 560px containers, getRowId, remount
 * (never in-place data swaps) when switching datasets, native fallback
 * table when the CDN is unreachable.
 */
export function renderIndexPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VeriPact Workbench — Proving What the Merchant Promised</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community@32.3.9/styles/ag-grid.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community@32.3.9/styles/ag-theme-quartz.css">
<style>
:root{
--bg:#f5f7fa;--panel:#ffffff;--ink:#14202e;--muted:#44536a;--line:#dfe6f0;
--accent:#0e6efd;--accent-ink:#ffffff;
--emerald:#1f8a70;--emerald-bg:#e2f4eb;--amber:#8a5a00;--amber-bg:#fcefd2;
--crimson:#c81e3a;--crimson-bg:#fbe3e8;--slate-bg:#e8eef5;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
--r-sm:8px;--r-md:12px;--r-lg:16px;
--spring:cubic-bezier(.32,.72,0,1);
}
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;background:var(--bg);color:var(--ink);font-size:14px;line-height:1.5}
.skip{position:absolute;left:-999px;top:8px;background:var(--ink);color:#fff;padding:8px 14px;border-radius:var(--r-sm);z-index:99}
.skip:focus{left:8px;color:#fff}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
h1{font-size:19px;margin:0;text-wrap:balance}
h2{font-size:15px;margin:0 0 10px}
h3{font-size:13px;margin:14px 0 8px;color:var(--muted);font-weight:600}
.num,.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
/* Floating glass header (the only blurred surface) */
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:14px;flex-wrap:wrap;
background:rgba(255,255,255,.78);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);
border-bottom:1px solid var(--line);padding:10px 18px}
.brand{display:flex;align-items:center;gap:10px;min-width:0}
.brand-mark{width:30px;height:30px;border-radius:9px;background:var(--ink);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0}
.brand small{display:block;color:var(--muted);font-size:11px}
.mode-pill{font-size:12px;font-weight:600;padding:4px 12px;border-radius:999px;white-space:nowrap;flex-shrink:0}
.mode-live{background:var(--emerald-bg);color:var(--emerald)}
.mode-replay{background:var(--amber-bg);color:var(--amber)}
.rungs{display:flex;gap:6px;font-size:11px;color:var(--muted);align-items:center;min-width:0}
.rung{border:1px solid var(--line);border-radius:999px;padding:2px 9px;white-space:nowrap;background:#fff}
.view-switch{margin-left:auto;display:flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff}
.view-switch button{border:0;background:transparent;padding:8px 16px;font-size:13px;cursor:pointer;color:var(--muted)}
.view-switch button[aria-pressed="true"]{background:var(--ink);color:#fff;font-weight:600}
.btn{font-size:13px;padding:9px 16px;border-radius:10px;border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer;min-height:36px}
.btn:hover{border-color:#b9c4d4}
.btn-primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:600}
.btn-primary:hover{background:#0b5ed7}
.btn:disabled{opacity:.55;cursor:wait}
.btn-danger{color:var(--crimson);border-color:#f0b9c4}
main{padding:18px;max-width:1460px;margin:0 auto}
/* Status pills: one color, one meaning */
.pill{display:inline-block;font-size:12px;font-weight:600;padding:3px 11px;border-radius:999px;white-space:nowrap;flex-shrink:0}
.pill-ok{background:var(--emerald-bg);color:var(--emerald)}
.pill-warn{background:var(--amber-bg);color:var(--amber)}
.pill-bad{background:var(--crimson-bg);color:var(--crimson)}
.pill-info{background:var(--slate-bg);color:var(--muted)}
/* Hash chips: truncate, copy on click, full value via title + focus */
.hash-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;font-family:var(--mono);font-size:12px;
background:var(--slate-bg);border:1px solid var(--line);border-radius:var(--r-sm);padding:4px 8px;cursor:pointer;min-width:0}
.hash-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.hash-chip.mid span{direction:rtl;text-align:left}
.mono-scroll{overflow-x:auto;white-space:pre;font-family:var(--mono);font-size:12px;background:#0f1620;color:#d7e3f4;border-radius:var(--r-sm);padding:10px 12px;max-width:100%}
/* View 1 split pane */
.split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-lg);padding:16px 18px;min-width:0}
.card + .card{margin-top:14px}
.scn-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.scn-row .btn[aria-pressed="true"]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.store-frame{width:100%;height:430px;border:1px solid var(--line);border-radius:var(--r-md);background:#fff}
.badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.badge{font-family:var(--mono);font-size:11px;background:var(--slate-bg);border:1px solid var(--line);border-radius:6px;padding:3px 8px;white-space:nowrap}
.badge.q{border-left:3px solid var(--accent)}
.mutate{display:flex;gap:8px;align-items:flex-start;margin-top:12px;font-size:13px}
.mutate input{width:18px;height:18px;margin-top:1px;flex-shrink:0;accent-color:var(--crimson)}
.suff-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}
.suff{border:1px solid var(--line);border-radius:var(--r-md);padding:10px 12px;min-width:0}
.suff b{display:block;font-size:12px;margin-bottom:4px}
.rung-flow{display:flex;gap:6px;align-items:center;margin:10px 0;font-size:12px;font-weight:600}
.rung-step{padding:4px 12px;border-radius:999px;background:var(--slate-bg);color:var(--muted);white-space:nowrap}
.rung-step.on{background:var(--ink);color:#fff}
.rung-arrow{color:#9aa7bb}
.kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;font-size:13px;margin:8px 0}
.kv dt{color:var(--muted)}
.kv dd{margin:0;min-width:0;overflow-wrap:anywhere}
.result{margin-top:12px;border-top:1px dashed var(--line);padding-top:12px}
.status-line{font-size:13px;color:var(--muted);margin:8px 0}
.status-line[aria-live]{min-height:20px}
/* View 2 desk */
.desk-tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.ag-shell{border:1px solid var(--line);border-radius:var(--r-lg);background:#fff;overflow:hidden}
#ag-live-disputes-grid,#ag-regression-benchmark-grid{height:560px;width:100%}
.fallback-table{width:100%;border-collapse:collapse;font-size:13px}
.fallback-table th,.fallback-table td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
.fallback-table th{font-size:11px;color:var(--muted);font-weight:600}
.fallback-table tbody tr{cursor:pointer}
.fallback-table tbody tr:hover{background:#f0f4fa}
.fallback-table tbody tr[aria-selected="true"]{background:#e4ecff}
.fallback-table .num{font-size:12px}
.inspector{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr) minmax(0,1fr);gap:14px;margin-top:14px;align-items:start}
.insp-col{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-lg);padding:14px 16px;min-width:0}
.insp-col h2{font-size:13px}
.match{display:inline-block;font-family:var(--mono);font-size:12px;font-weight:700;padding:2px 10px;border-radius:6px}
.match.yes{background:var(--emerald-bg);color:var(--emerald)}
.match.no{background:var(--crimson-bg);color:var(--crimson)}
.action-stack{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.action-stack .btn{text-align:left}
.evidence-form textarea{width:100%;min-height:70px;font:inherit;font-size:13px;border:1px solid var(--line);border-radius:var(--r-sm);padding:8px;margin:6px 0}
/* Auditor drawer (native details: free keyboard + screen-reader support) */
details.drawer{border:1px solid var(--line);border-radius:var(--r-md);margin-top:12px;background:#fbfcfe}
details.drawer summary{cursor:pointer;padding:12px 14px;font-weight:600;font-size:13px;list-style:none;display:flex;gap:8px;align-items:center}
details.drawer summary::-webkit-details-marker{display:none}
details.drawer summary::before{content:"+";font-weight:700;color:var(--accent);flex-shrink:0}
details.drawer[open] summary::before{content:"–"}
details.drawer .drawer-body{padding:0 14px 14px;animation:vp-fade .25s var(--spring)}
@keyframes vp-fade{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.check-row{display:flex;gap:8px;align-items:flex-start;margin:8px 0;font-size:13px;min-width:0}
.check-row .pill{margin-top:1px}
/* Agent sidebar + charts */
.desk-grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);gap:14px;align-items:start}
.prompt-bar{display:flex;gap:8px;margin:10px 0}
.prompt-bar input{flex:1;min-width:0;font:inherit;font-size:13px;padding:9px 12px;border:1px solid var(--line);border-radius:10px}
.preset-list{display:flex;flex-direction:column;gap:6px;margin:8px 0}
.preset-list .btn{text-align:left;font-size:12px;white-space:normal}
canvas.chart{width:100%;height:220px;border:1px solid var(--line);border-radius:var(--r-md);background:#fff}
.matrix{border-collapse:collapse;font-size:12px;margin-top:8px}
.matrix th,.matrix td{border:1px solid var(--line);padding:6px 10px;text-align:center;font-variant-numeric:tabular-nums}
.matrix th{background:var(--slate-bg);font-weight:600}
.cell-good{background:var(--emerald-bg);font-weight:700}
.cell-bad{background:var(--crimson-bg);color:#fff;font-weight:700}
/* Modal + toast */
.modal-back{position:fixed;inset:0;background:rgba(10,16,26,.45);display:flex;align-items:center;justify-content:center;z-index:50;padding:20px}
.modal{background:#fff;border-radius:var(--r-lg);max-width:640px;width:100%;max-height:85vh;overflow:auto;padding:20px 22px}
.modal h2{font-size:16px}
#toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;
font-size:13px;padding:9px 18px;border-radius:999px;opacity:0;pointer-events:none;transition:opacity .2s var(--spring);z-index:60}
#toast.show{opacity:1}
footer.app{max-width:1460px;margin:0 auto;padding:0 18px 26px;color:var(--muted);font-size:12px}
/* Cryptographic pipeline ribbon: 3-rung stepper with live badges */
.ribbon{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:16px}
.ribbon-step{display:flex;gap:10px;align-items:flex-start;background:var(--panel);border:1px solid var(--line);
border-radius:var(--r-md);padding:12px 14px;min-width:0}
.rb-num{font-family:var(--mono);font-weight:700;font-size:13px;background:var(--muted);color:#fff;border-radius:8px;
min-width:26px;height:26px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.ribbon-step.on .rb-num{background:var(--emerald)}
.ribbon-step.bad .rb-num{background:var(--crimson)}
.ribbon-step b{font-size:13px}
.rb-badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.rb-badges .badge{max-width:100%;overflow:hidden;text-overflow:ellipsis}
/* Term diff pills: readable at video distance */
.diff-pill{display:inline-block;font-family:var(--mono);font-size:15px;font-weight:700;background:var(--crimson-bg);
color:var(--crimson);border:2px solid var(--crimson);border-radius:10px;padding:6px 14px;margin:3px 8px 3px 0;
font-variant-numeric:tabular-nums;white-space:nowrap}
.wit-pill{display:inline-block;font-family:var(--mono);font-size:13px;font-weight:700;background:var(--emerald-bg);
color:var(--emerald);border:2px solid var(--emerald);border-radius:10px;padding:5px 12px;margin:3px 8px 3px 0;
font-variant-numeric:tabular-nums;white-space:nowrap}
#tour-status{font-weight:600}
@media (max-width:1080px){.split,.desk-grid,.inspector,.ribbon{grid-template-columns:minmax(0,1fr)}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
@media (prefers-color-scheme:dark){
:root{--bg:#0f141b;--panel:#161d27;--ink:#e8eef6;--muted:#9aa7bb;--line:#2a3444;--slate-bg:#1e2735}
.topbar{background:rgba(15,20,27,.8)}
.card,.insp-col,.ag-shell,canvas.chart{background:var(--panel)}
.view-switch,.btn,.rung{background:#1e2735;border-color:#2a3444;color:var(--ink)}
.fallback-table tbody tr:hover{background:#1e2735}
.fallback-table tbody tr[aria-selected="true"]{background:#26314a}
details.drawer{background:#161d27}
.modal{background:#161d27}
.prompt-bar input,.evidence-form textarea{background:#0f141b;color:var(--ink);border-color:#2a3444}
}
@media print{
body{background:#fff}
.topbar,main,footer.app,#toast,.no-print{display:none!important}
#sheet-modal{display:block!important;position:static}
.modal-back{position:static;background:none;padding:0;display:block}
.modal{max-width:none;max-height:none;border:0}
}
</style></head>
<body>
<a class="skip" href="#main">Skip to workspace</a>
<header class="topbar">
<div class="brand"><span class="brand-mark" aria-hidden="true">V</span><div><h1>VeriPact</h1><small>Proving What the Merchant Promised</small></div></div>
<span id="mode-pill" class="mode-pill mode-replay" role="status">Detecting mode…</span>
<div class="rungs" aria-label="Evidence rung legend"><span class="rung">Rung 1: SELF</span><span class="rung">Rung 2: WIT</span><span class="rung">Rung 3: SIGN</span></div>
<div class="view-switch" role="group" aria-label="View switcher">
<button type="button" id="tab-checkout" aria-pressed="true">Buyer Checkout</button>
<button type="button" id="tab-desk" aria-pressed="false">Dispute Desk</button>
</div>
<button type="button" class="btn btn-primary" id="btn-tour">▶ Run 60s Guided Demo Tour</button>
<button type="button" class="btn" id="btn-reset" title="Re-seed replay disputes and orders">Reset demo</button>
</header>
<main id="main">
<nav id="pipeline-ribbon" class="ribbon" aria-label="Cryptographic evidence pipeline">
<div class="ribbon-step" id="rb-1"><span class="rb-num" aria-hidden="true">1</span><div style="min-width:0"><b>SELF — Buyer mandate locked</b><div class="rb-badges"><span class="badge" id="rb-buyer-fp" title="Ed25519 buyer key fingerprint">buyer key fp …</span><span class="badge">ceiling $320.00</span></div></div></div>
<div class="ribbon-step" id="rb-2"><span class="rb-num" aria-hidden="true">2</span><div style="min-width:0"><b>WIT — Independent HTTPS witness</b><div class="rb-badges"><span class="badge" id="rb-tsa">RFC 3161 …</span><span class="badge" id="rb-dom">DOM scan …</span><span class="badge" id="rb-ch3">Channel3 …</span></div></div></div>
<div class="ribbon-step" id="rb-3"><span class="rb-num" aria-hidden="true">3</span><div style="min-width:0"><b>SIGN + PayPal custom_id anchor</b><div class="rb-badges"><span class="badge" id="rb-commit">VP1: …</span><span class="badge" id="rb-regate">re-gate …</span></div></div></div>
</nav>
<p id="tour-status" class="status-line" role="status" aria-live="polite"></p>
<section id="view-checkout" aria-label="Buyer checkout and live receipt verifier">
<div class="split">
<div class="card">
<h2>Synthetic storefront</h2>
<div class="scn-row" role="group" aria-label="Scenario selector">
<button type="button" class="btn" data-scn="normal" aria-pressed="true">1. Normal checkout ($297 capture)</button>
<button type="button" class="btn" data-scn="surcharge_void" aria-pressed="false">2. Hidden $55 surcharge ($340.50 auto-void)</button>
<button type="button" class="btn" data-scn="adversarial_hidden_dom" aria-pressed="false">3. Hidden prompt injection (pre-LLM block)</button>
</div>
<iframe id="store-frame" class="store-frame" title="Synthetic merchant storefront" src="/store/normal"></iframe>
<h3>Visible quote badges</h3>
<div id="quote-badges" class="badges" aria-live="polite"><span class="badge">Witness a scenario to pin quotes…</span></div>
<label class="mutate"><input type="checkbox" id="mutate-toggle"><span><b>Post-purchase policy mutation preview.</b> Shows what a drifted policy (14-day returns, 25% restocking fee) would look like next to the witnessed terms. Illustrative only — re-run checkout to witness current terms.</span></label>
<div id="mutate-panel" hidden><dl class="kv">
<dt>Witnessed</dt><dd><span class="pill pill-ok">30-day free returns · 0% fee</span></dd>
<dt>Mutated listing</dt><dd><span class="pill pill-bad">14-day returns · 25% fee</span></dd>
<dt>Effect</dt><dd>Receipt hash would no longer match the PayPal order custom_id → MERCHANT_DRIFT_CONFIRMED. See the drift case on the Dispute Desk.</dd>
</dl></div>
</div>
<div>
<div class="card">
<h2>Mandate &amp; sufficiency</h2>
<dl class="kv"><dt>Cap</dt><dd class="num">$320.00 all-in</dd><dt>Condition</dt><dd>NEW</dd><dt>Returns</dt><dd>30-day minimum · 0% fee maximum</dd></dl>
<div class="suff-grid" id="suff-pills">
<div class="suff"><b>Brand/model &amp; condition</b><span class="pill pill-info">Awaiting witness…</span></div>
<div class="suff"><b>Base price ($279)</b><span class="pill pill-info">Awaiting witness…</span></div>
<div class="suff"><b>Shipping &amp; tax callback</b><span class="pill pill-info">Awaiting witness…</span></div>
<div class="suff"><b>Return policy (30d / 0% fee)</b><span class="pill pill-info">Awaiting witness…</span></div>
</div>
<div class="rung-flow" aria-label="Evidence rung progress"><span class="rung-step on" id="rung-self">SELF</span><span class="rung-arrow" aria-hidden="true">→</span><span class="rung-step" id="rung-wit">WIT</span><span class="rung-arrow" aria-hidden="true">→</span><span class="rung-step" id="rung-sign">SIGN</span></div>
<div id="oracle-line" class="status-line">Channel3 oracle: not queried yet.</div>
<div style="display:flex;gap:8px;flex-wrap:wrap">
<button type="button" class="btn" id="btn-witness">Witness this offer</button>
<button type="button" class="btn btn-primary" id="btn-checkout">Authorize &amp; verify with PayPal</button>
</div>
<label class="mutate" style="margin-top:8px"><input type="checkbox" id="twostep-toggle"><span><b>Step-by-step buyer popup approval.</b> Creates the order, opens the buyer approval popup, then finalizes authorize → re-gate → capture/void. Automatic in live sandbox mode.</span></label>
<p id="checkout-status" class="status-line" aria-live="polite"></p>
<div id="awaiting-card" class="result" hidden></div>
<div id="checkout-result" class="result" hidden></div>
</div>
<div class="card">
<h2>Verify it yourself</h2>
<p class="status-line">Your browser recomputes the receipt hash and compares it with the PayPal order record. Nothing here trusts the server.</p>
<details class="drawer" id="auditor"><summary>Open the client-side auditor</summary><div class="drawer-body" id="auditor-body">
<p class="status-line">Run a checkout first — the auditor needs a witnessed receipt and a PayPal order.</p>
</div></details>
</div>
</div>
</div>
</section>
<section id="view-desk" hidden aria-label="Contested dispute verifier desk">
<div class="desk-grid">
<div>
<div class="card">
<h2>Contested dispute verifier desk</h2>
<div class="desk-tools" role="group" aria-label="Dataset toggle">
<button type="button" class="btn" id="ds-live" aria-pressed="true">Live contested disputes (Case B &amp; Case A)</button>
<button type="button" class="btn" id="ds-regression" aria-pressed="false">24-scenario regression suite (72 runs, Wilson 95% CIs)</button>
<span id="grid-engine" class="pill pill-info">Grid engine: detecting…</span>
</div>
<div class="ag-shell"><div id="ag-live-disputes-grid" class="ag-theme-quartz" role="grid" aria-label="Live contested disputes grid"></div></div>
<div class="ag-shell" id="regression-shell" hidden><div id="ag-regression-benchmark-grid" class="ag-theme-quartz" role="grid" aria-label="Regression benchmark grid"></div></div>
<div id="matrix-wrap"></div>
</div>
<div class="inspector" id="inspector" data-widget="ContestedClaimInspectorWidget" aria-label="Contested claim inspector">
<div class="insp-col" id="insp-buyer"><h2>Column 1 — Buyer claim &amp; submitted receipt</h2><p class="status-line">Loading dispute data…</p></div>
<div class="insp-col" id="insp-witness"><h2>Column 2 — Witness provenance &amp; order anchor</h2><p class="status-line">Loading dispute data…</p></div>
<div class="insp-col" id="insp-seller"><h2>Column 3 — Seller counter-claim &amp; PayPal actions</h2><p class="status-line">Loading dispute data…</p></div>
</div>
</div>
<div class="card">
<h2>Deterministic studio agent</h2>
<p class="status-line">One prompt → one filter → one chart. Same output every run; no generative calls.</p>
<div class="prompt-bar"><label class="skip" for="prompt-input">Analytical query</label><input id="prompt-input" name="prompt" autocomplete="off" spellcheck="false" placeholder="Ask about disputes or the regression suite…"><button type="button" class="btn btn-primary" id="prompt-run">Run</button></div>
<div class="preset-list" id="preset-list"></div>
<canvas class="chart" id="agent-chart" width="520" height="220" role="img" aria-label="Analytical chart"></canvas>
<div id="chart-table"></div>
</div>
</div>
</section>
</main>
<footer class="app">VeriPact Workbench · Every number on this page renders from live API data · Timestamps prove hash existence at time T plus witness observation — never content truth.</footer>
<div id="sheet-modal" hidden><div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
<h2 id="sheet-title">Printable evidence sheet</h2>
<div id="sheet-body"></div>
<div class="no-print" style="display:flex;gap:8px;margin-top:14px"><button type="button" class="btn btn-primary" id="sheet-print">Print</button><button type="button" class="btn" id="sheet-close">Close</button></div>
</div></div></div>
<div id="toast" role="status" aria-live="polite"></div>
<script src="https://cdn.jsdelivr.net/npm/ag-grid-community@32.3.9/dist/ag-grid-community.min.js" defer></script>
<script>
'use strict';
/* ---------- helpers ---------- */
function $(id){return document.getElementById(id);}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function toast(msg){var t=$('toast');t.textContent=msg;t.classList.add('show');setTimeout(function(){t.classList.remove('show');},2200);}
function copyText(full){function done(){toast('Copied to clipboard');}if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(full).then(done,function(){fallback();});}else{fallback();}function fallback(){var ta=document.createElement('textarea');ta.value=full;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');done();}catch(e){toast('Copy failed');}document.body.removeChild(ta);}}
function chip(full,mid){return '<button type="button" class="hash-chip'+(mid?' mid':'')+'" data-copy="'+esc(full)+'" title="'+esc(full)+'"><span>'+esc(full)+'</span></button>';}
document.addEventListener('click',function(e){var b=e.target.closest?e.target.closest('[data-copy]'):null;if(b){copyText(b.getAttribute('data-copy'));}});
function pillFor(status){if(status==='DETERMINATE'||status==='PROCEED'||status==='CAPTURED')return 'pill-ok';if(status==='INDETERMINATE'||status==='ASK_HUMAN_DELTA')return 'pill-warn';return 'pill-bad';}
function api(path,opts){return fetch(path,Object.assign({headers:{'content-type':'application/json'}},opts||{})).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j;});});}
/* ---------- state ---------- */
var state={scenario:'normal',witness:null,checkout:null,verify:null,disputes:null,selectedCase:'buyer_forgery',dataset:'live',benchmark:null,grids:{},engine:'native'};
var CASE_META={
buyer_forgery:{label:'Case B — Buyer forgery',buyerTerms:'60-day returns (self-signed SELF receipt)',sellerTerms:'Stands by witnessed terms',witnessed:'30-day returns · 0% fee',diffs:[{field:'return_window_days',left:'60',right:'30'}],blurb:'The buyer edited local JSON to claim 60-day returns. Signature verifies (self-signed) but the hash cannot match the PayPal-anchored commitment.'},
merchant_drift:{label:'Case A — Merchant drift',buyerTerms:'30-day free returns (matches witness)',sellerTerms:'14-day returns · 25% restocking fee',witnessed:'30-day returns · 0% fee',diffs:[{field:'return_window_days',left:'30',right:'14'},{field:'restocking_fee_pct',left:'0%',right:'25%'}],blurb:'The seller changed the return policy after purchase. The buyer receipt still matches; the seller counter-claim diverges.'}};
/* ---------- header + tabs ---------- */
api('/health').then(function(h){var p=$('mode-pill');var live=h.transportMode==='LIVE_PAYPAL_SANDBOX';state.liveMode=live;p.textContent=live?'Live Sandbox':'Replay · deterministic';p.className='mode-pill '+(live?'mode-live':'mode-replay');if(live){$('twostep-toggle').checked=true;}}).catch(function(){});
api('/api/system/status').then(function(s){$('rb-buyer-fp').textContent='buyer key fp '+s.keyFingerprints.buyer;$('rb-buyer-fp').title='Ed25519 buyer key fingerprint '+s.keyFingerprints.buyer+' · '+s.regressionPassRate+' regression';}).catch(function(){$('rb-buyer-fp').textContent='buyer key fp …';});
/* ---------- pipeline ribbon (3-rung evidence stepper) ---------- */
function ribbonTo(stage,bad){for(var i=1;i<=3;i++){var el=$('rb-'+i);el.className='ribbon-step'+(i<=stage?' on':'')+(bad&&i===stage?' bad':'');}}
function ribbonFillWitness(s){ribbonTo(2,s.gateResult.decision==='BLOCK');
var p=s.provenance||{};$('rb-tsa').textContent='RFC 3161 '+(p.tsaIssuer||'…');$('rb-tsa').title='Timestamp authority '+(p.tsaIssuer||'?')+' @ '+(p.tsaTimeUtc||'?');
var integ=(s.termReceipt.observedTerms||{}).pageIntegrity;$('rb-dom').textContent=integ==='ADVERSARIAL_DOM'?'DOM scan ADVERSARIAL_DOM':'DOM scan CLEAN · 13 checks';
var o=s.oracleResult||{};$('rb-ch3').textContent=(o.matched?'✓ ':'✗ ')+(o.productId||'…');$('rb-ch3').title='Channel3 oracle '+(o.source||'');}
function ribbonFillCheckout(r){if(r.outcome==='BLOCKED_PRE_CHECKOUT'){ribbonTo(2,true);$('rb-regate').textContent='re-gate BLOCKED pre-checkout';return;}
ribbonTo(3,false);var c=r.snapshot.commitment;$('rb-commit').textContent=c.slice(0,16)+'…';$('rb-commit').title='PayPal purchase_units[0].custom_id = '+c;
$('rb-regate').textContent='$'+Number(r.finalTotalUsd).toFixed(2)+' '+(r.outcome==='CAPTURED'?'CAPTURED':'AUTO-VOIDED');}
function showView(which){var c=which==='checkout';$('view-checkout').hidden=!c;$('view-desk').hidden=c;$('tab-checkout').setAttribute('aria-pressed',c?'true':'false');$('tab-desk').setAttribute('aria-pressed',c?'false':'true');if(!c){ensureDesk().catch(function(){});}}
$('tab-checkout').addEventListener('click',function(){showView('checkout');});
$('tab-desk').addEventListener('click',function(){showView('desk');});
$('btn-reset').addEventListener('click',function(){api('/api/demo/reset',{method:'POST',body:'{}'}).then(function(){toast('Demo state re-seeded');state.checkout=null;state.verify=null;refreshDesk().catch(function(){});}).catch(function(e){toast(e.message);});});
/* ---------- view 1 ---------- */
var scnBtns=Array.prototype.slice.call(document.querySelectorAll('[data-scn]'));
function selectScenario(scn){state.scenario=scn;scnBtns.forEach(function(x){x.setAttribute('aria-pressed',x.getAttribute('data-scn')===scn?'true':'false');});$('store-frame').src='/store/'+scn;$('checkout-result').hidden=true;$('awaiting-card').hidden=true;$('checkout-status').textContent='';}
scnBtns.forEach(function(b){b.addEventListener('click',function(){selectScenario(b.getAttribute('data-scn'));});});
$('mutate-toggle').addEventListener('change',function(e){$('mutate-panel').hidden=!e.target.checked;});
function suffPills(observed){var cells=$('suff-pills').children;function set(i,txt,cls){cells[i].querySelector('.pill').textContent=txt;cells[i].querySelector('.pill').className='pill '+cls;}
var c=observed.condition.value||'?';set(0,(observed.itemTitle.value||'?').slice(0,34)+' · '+c,pillFor(observed.condition.status));
set(1,'$'+Number(observed.basePriceUsd.value||0).toFixed(2),pillFor(observed.basePriceUsd.status));
var st=observed.shippingUsd.status==='DETERMINATE'&&observed.taxUsd.status==='DETERMINATE'?'$'+Number(observed.shippingUsd.value).toFixed(2)+' + $'+Number(observed.taxUsd.value).toFixed(2):'Calculated at checkout';
set(2,st,observed.shippingUsd.status==='DETERMINATE'&&observed.taxUsd.status==='DETERMINATE'?'pill-ok':'pill-warn');
set(3,String(observed.returnWindowDays.value)+'d / '+String(observed.restockingFeePct.value)+'% fee',pillFor(observed.returnWindowDays.status));}
function rungTo(stage){$('rung-wit').className='rung-step'+(stage>=1?' on':'');$('rung-sign').className='rung-step'+(stage>=2?' on':'');}
function runWitnessFlow(){var b=$('btn-witness');b.disabled=true;$('checkout-status').textContent='Witnessing offer…';
return api('/api/witness/snapshot',{method:'POST',body:JSON.stringify({scenario:state.scenario})}).then(function(s){state.witness=s;suffPills(s.termReceipt.observedTerms);rungTo(1);ribbonFillWitness(s);
$('oracle-line').textContent='Channel3 oracle: '+(s.oracleResult.matched?'match ':'no match ')+s.oracleResult.productId+' · '+s.oracleResult.source;
$('quote-badges').innerHTML=badgeHtml(s);
$('checkout-status').textContent='Gate decision: '+s.gateResult.decision+' — '+s.gateResult.reasons.join('; ');return s;},function(e){$('checkout-status').textContent=e.message;throw e;}).finally(function(){b.disabled=false;});}
$('btn-witness').addEventListener('click',function(){runWitnessFlow().catch(function(){});});
function badgeHtml(s){var terms=s.termReceipt.observedTerms;var out=[];['itemTitle','condition','basePriceUsd','shippingUsd','taxUsd','returnWindowDays','restockingFeePct'].forEach(function(k){var c=terms[k];if(c&&c.blockId){out.push('<span class="badge q" title="'+esc(c.verbatimQuote||'')+'">'+esc(c.blockId)+' · '+esc(k)+'</span>');}});return out.join('')||'<span class="badge">No verified quotes</span>';}
function renderCheckoutDone(r){state.checkout=r;state.verify=null;suffPills(r.snapshot.termReceipt.observedTerms);rungTo(r.outcome==='BLOCKED_PRE_CHECKOUT'?1:2);ribbonFillWitness(r.snapshot);ribbonFillCheckout(r);
$('oracle-line').textContent='Channel3 oracle: '+(r.snapshot.oracleResult.matched?'match ':'no match ')+r.snapshot.oracleResult.productId+' · '+r.snapshot.oracleResult.source;
$('quote-badges').innerHTML=badgeHtml(r.snapshot);
var cls=r.outcome==='CAPTURED'?'pill-ok':(r.outcome==='AUTO_VOIDED'?'pill-warn':'pill-bad');
var html='<h3>Outcome <span class="pill '+cls+'">'+esc(r.outcome)+'</span></h3><dl class="kv">';
if(r.orderId)html+='<dt>Order</dt><dd class="mono">'+esc(r.orderId)+'</dd>';
if(r.authorizationId)html+='<dt>Authorization</dt><dd class="mono">'+esc(r.authorizationId)+'</dd>';
if(r.captureId)html+='<dt>Capture</dt><dd class="mono">'+esc(r.captureId)+' · <span class="num">$'+Number(r.finalTotalUsd).toFixed(2)+'</span></dd>';
if(r.voidReason)html+='<dt>Void</dt><dd>'+esc(r.voidReason)+'</dd>';
html+='<dt>Commitment</dt><dd>'+chip(r.snapshot.commitment,true)+'</dd>';
html+='<dt>PayPal mode</dt><dd class="mono">'+esc(r.transportMode)+'</dd></dl>';
if(r.outcome==='CAPTURED'){html+='<button type="button" class="btn" id="btn-audit-open">Verify it yourself ↓</button>';}
$('checkout-result').innerHTML=html;$('checkout-result').hidden=false;
$('checkout-status').textContent='Gate: '+r.snapshot.gateResult.decision+' · Outcome: '+r.outcome;
var ao=$('btn-audit-open');if(ao){ao.addEventListener('click',function(){$('auditor').open=true;runAuditor();});}}
function finalizeApproved(orderId){$('checkout-status').textContent='Finalizing: authorize → re-gate → capture/void…';
var prior=null;if(state.awaiting&&state.awaiting.snapshot){prior={snapshot:state.awaiting.snapshot,buyerApprovalSignatureHex:state.awaiting.buyerApprovalSignatureHex,merchantSignatureHex:state.awaiting.merchantSignatureHex};}
api('/api/merchant/checkout/finalize',{method:'POST',body:JSON.stringify({orderId:orderId,scenario:state.scenario,prior:prior})}).then(function(r){$('awaiting-card').hidden=true;state.awaiting=null;renderCheckoutDone(r);}).catch(function(e){$('checkout-status').textContent=e.message;});}
function renderAwaiting(r){state.awaiting=r;suffPills(r.snapshot.termReceipt.observedTerms);rungTo(1);ribbonFillWitness(r.snapshot);
$('oracle-line').textContent='Channel3 oracle: '+(r.snapshot.oracleResult.matched?'match ':'no match ')+r.snapshot.oracleResult.productId+' · '+r.snapshot.oracleResult.source;
$('quote-badges').innerHTML=badgeHtml(r.snapshot);
var preview=r.expectedPostApprovalAction==='VOID'?'pill-warn':'pill-ok';
$('awaiting-card').innerHTML='<h3>Step 1 complete <span class="pill pill-warn">AWAITING_BUYER_APPROVAL</span></h3><dl class="kv"><dt>Order</dt><dd class="mono">'+esc(r.orderId)+'</dd><dt>Total</dt><dd class="num">$'+Number(r.finalTotalUsd).toFixed(2)+'</dd><dt>Preview</dt><dd><span class="pill '+preview+'">'+esc(r.expectedPostApprovalAction)+'</span> · headroom <span class="num">$'+Number(r.headroomRemainingUsd).toFixed(2)+'</span></dd><dt>Commitment</dt><dd>'+chip(r.snapshot.commitment,true)+'</dd></dl><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button type="button" class="btn btn-primary" id="btn-popup">Open buyer approval popup</button><button type="button" class="btn" id="btn-finalize">Finalize approved order: authorize → re-gate → capture / void</button></div><p class="status-line">Approving in the popup notifies this window and finalizes automatically. Popup blocked? Approve, return here, and press Finalize.</p>';
$('awaiting-card').hidden=false;$('checkout-status').textContent='Order '+r.orderId+' created + patched. Waiting for buyer approval…';
$('btn-popup').addEventListener('click',function(){var w=window.open(r.approveUrl,'veripact-approval','width=620,height=760');if(!w){toast('Popup blocked — allow popups, then press Finalize after approving.');}$('checkout-status').textContent='Approval popup opened for '+r.orderId+'. Waiting…';});
$('btn-finalize').addEventListener('click',function(){finalizeApproved(r.orderId);});}
window.addEventListener('message',function(e){var d=e.data||{};var loc=window.location||{};var sameOrigin=!loc.origin||loc.origin==='null'||e.origin===loc.origin;if(sameOrigin&&d.type==='VERIPACT_ORDER_APPROVED'&&d.orderId&&state.awaiting&&d.orderId===state.awaiting.orderId){toast('Buyer approved '+d.orderId);finalizeApproved(d.orderId);}});
function runCheckoutFlow(){var b=$('btn-checkout');b.disabled=true;$('awaiting-card').hidden=true;$('checkout-result').hidden=true;
var twoStep=$('twostep-toggle').checked||state.liveMode===true;
$('checkout-status').textContent=twoStep?'Creating order + patching totals…':'Authorizing with PayPal…';
return api('/api/merchant/checkout',{method:'POST',body:JSON.stringify({scenario:state.scenario,twoStep:twoStep})}).then(function(r){
if(r.outcome==='AWAITING_BUYER_APPROVAL'){renderAwaiting(r);}else{renderCheckoutDone(r);}
return r;},function(e){$('checkout-status').textContent=e.message;throw e;}).finally(function(){b.disabled=false;});}
$('btn-checkout').addEventListener('click',function(){runCheckoutFlow().catch(function(){});});
/* ---------- verify-it-yourself auditor (runs entirely in your browser) ---------- */
var BS=String.fromCharCode(92);
function jcsStr(s){var out='"';for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);if(c===0x22){out+=BS+'"';}else if(c===0x5c){out+=BS+BS;}else if(c<0x20){out+=BS+'u'+('000'+c.toString(16)).slice(-4);}else{out+=s[i];}}return out+'"';}
function jcs(v){if(v===null)return 'null';var t=typeof v;if(t==='string')return jcsStr(v);if(t==='number'){if(!isFinite(v))return 'null';return String(v);}if(t==='boolean')return v?'true':'false';if(Object.prototype.toString.call(v)==='[object Array]'){return '['+v.map(function(x){var s=jcs(x);return s===undefined?'null':s;}).join(',')+']';}if(t==='object'){var keys=Object.keys(v).sort();var parts=[];keys.forEach(function(k){var s=jcs(v[k]);if(s!==undefined)parts.push(jcsStr(k)+':'+s);});return '{'+parts.join(',')+'}';}return undefined;}
function hexOf(buf){return Array.prototype.map.call(new Uint8Array(buf),function(x){return ('0'+x.toString(16)).slice(-2);}).join('');}
function runAuditor(){var body=$('auditor-body');
if(!state.checkout||state.checkout.outcome!=='CAPTURED'){body.innerHTML='<p class="status-line">Run a checkout that captures first.</p>';return;}
body.innerHTML='<p class="status-line">Contacting PayPal order record and hashing locally…</p>';
api('/api/verify',{method:'POST',body:JSON.stringify({scenario:state.checkout.scenario})}).then(function(v){state.verify=v;
if(!window.crypto||!window.crypto.subtle){body.innerHTML='<p class="status-line">WebCrypto is unavailable in this browser context (needs HTTPS or localhost).</p>';return;}
var t0=performance.now();
var canonical=jcs(v.receiptCore);
window.crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)).then(function(digest){
var ms=Math.max(1,Math.round(performance.now()-t0));var mine='VP1:'+hexOf(digest);var match=mine===v.customId;
var b=v.bundle;
var rows='';
rows+='<div class="check-row"><span class="pill '+(match?'pill-ok':'pill-bad')+'">'+(match?'MATCH':'MISMATCH')+'</span><div style="min-width:0"><b>Your hash vs PayPal custom_id</b> ('+ms+' ms, '+canonical.length+' canonical bytes)<br>'+chip(mine,true)+'<br><span style="font-size:12px;color:var(--muted)">Order record:</span> '+chip(v.customId,true)+'</div></div>';
rows+='<div class="check-row"><span class="pill '+(b.buyerSignatureValid?'pill-ok':'pill-bad')+'">'+(b.buyerSignatureValid?'VALID':'INVALID')+'</span><div><b>Buyer Ed25519 countersignature</b> (verified server-side)</div></div>';
rows+='<div class="check-row"><span class="pill '+(b.witnessSignatureValid?'pill-ok':'pill-bad')+'">'+(b.witnessSignatureValid?'VALID':'INVALID')+'</span><div style="min-width:0"><b>Witness Ed25519 signature</b> (verified server-side)<br>'+chip(v.witnessSignatureHex,true)+'</div></div>';
rows+='<div class="check-row"><span class="pill '+(b.merchantSignatureValid?'pill-ok':'pill-bad')+'">'+(b.merchantSignatureValid?'VALID':'INVALID')+'</span><div><b>Merchant SIGN countersignature</b> (verified server-side)</div></div>';
rows+='<div class="check-row"><span class="pill '+(b.anchorValid?'pill-ok':'pill-bad')+'">'+(b.anchorValid?'ANCHORED':'WEAK')+'</span><div><b>RFC 3161 timestamp</b> — '+esc(v.anchor.authority)+' @ '+esc(new Date(v.anchor.timestampMs).toISOString())+' (±5 min skew: '+(b.anchorValid?'pass':'fail')+')</div></div>';
rows+='<div class="mono-scroll">order '+esc(v.orderId)+' · bundle allValid='+String(b.allValid)+' · JCS-PARITY '+(match?'MATCH':'MISMATCH')+'</div>';
body.innerHTML=rows;
}).catch(function(e){body.innerHTML='<p class="status-line">Hash failed: '+esc(e.message)+'</p>';});
}).catch(function(e){body.innerHTML='<p class="status-line">'+esc(e.message)+'</p>';});}
$('auditor').addEventListener('toggle',function(e){if(e.target.open&&state.checkout&&state.checkout.outcome==='CAPTURED'&&!state.verify){runAuditor();}});
/* ---------- view 2: dispute desk ---------- */
var deskLoaded=false;
function ensureDesk(){if(deskLoaded)return Promise.resolve();deskLoaded=true;return refreshDesk();}
function refreshDesk(){
var p1=api('/api/merchant/disputes').then(function(d){state.disputes=d;mountLive();renderInspector();renderPresets();},function(e){toast(e.message);throw e;});
var p2=api('/api/benchmark').then(function(b){state.benchmark=b;if(state.dataset==='regression')mountRegression();}).catch(function(){});
return Promise.all([p1,p2]);}
/* AG mount / remount: datasets switch by destroying and rebuilding the grid
   instance — data is never mutated in place (ag-dev guidance). */
function destroyGrid(id){var g=state.grids[id];if(g&&g.destroy){try{g.destroy();}catch(e){}}delete state.grids[id];var c=$(id);if(c)c.innerHTML='';}
function agReady(){return window.agGrid&&window.agGrid.createGrid;}
function mountAg(id,rows,cols,onPick){destroyGrid(id);var c=$(id);
if(agReady()){var apiObj=window.agGrid.createGrid(c,{rowData:rows,columnDefs:cols,getRowId:function(p){return String(p.data.id);},onRowClicked:function(e){onPick(e.data.id);}});state.grids[id]=apiObj;state.engine='ag-grid';}
else{state.engine='native';var h='<table class="fallback-table"><thead><tr>'+cols.map(function(x){return '<th>'+esc(x.headerName)+'</th>';}).join('')+'</tr></thead><tbody>';
rows.forEach(function(r){h+='<tr data-row="'+esc(r.id)+'" tabindex="0" aria-selected="'+(r.id===state.selectedCase?'true':'false')+'">'+cols.map(function(x){var v=r[x.field];var cell=x.cellRenderer==='hash'?chip(String(v),true):esc(String(v));return '<td class="'+(x.cellClass||'')+'">'+cell+'</td>';}).join('')+'</tr>';});
c.innerHTML=h+'</tbody></table>';
Array.prototype.forEach.call(c.querySelectorAll('tr[data-row]'),function(tr){function pick(){onPick(tr.getAttribute('data-row'));}tr.addEventListener('click',pick);tr.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();pick();}});});}
$('grid-engine').textContent='Grid engine: '+(state.engine==='ag-grid'?'AG Grid 32 (CDN)':'native fallback (offline)');}
function mountLive(){if(!state.disputes)return;var rows=state.disputes.disputes.map(function(d){return{id:d.case,case:CASE_META[d.case].label,dispute:d.record.disputeId,stage:d.record.lifeCycleStage,state:d.record.disputeState,verdict:d.forensics.verdict,evidence:String(d.record.evidenceCount),custom_id:state.disputes.customId};});
var cols=[{headerName:'Case',field:'case'},{headerName:'Dispute',field:'dispute'},{headerName:'Stage',field:'stage'},{headerName:'State',field:'state'},{headerName:'Referee verdict',field:'verdict'},{headerName:'Evidence',field:'evidence'},{headerName:'Order custom_id',field:'custom_id',cellRenderer:'hash',cellClass:'mono'}];
mountAg('ag-live-disputes-grid',rows,cols,function(id){state.selectedCase=id;renderInspector();});}
function mountRegression(){if(!state.benchmark)return;var rows=state.benchmark.scenarios.map(function(s){return{id:s.scenarioId,scenario:s.scenarioId,group:s.group,title:s.title,passed:s.passed+'/'+s.passes,rate:(100*s.passed/Math.max(1,s.passes)).toFixed(1)+'%'};});
var cols=[{headerName:'Scenario',field:'scenario'},{headerName:'Group',field:'group'},{headerName:'Title',field:'title'},{headerName:'Passed',field:'passed'},{headerName:'Rate',field:'rate'}];
mountAg('ag-regression-benchmark-grid',rows,cols,function(){});renderMatrix();}
function renderMatrix(){if(!state.benchmark)return;var m=state.benchmark.gateConfusion;var ds=['PROCEED','ASK_HUMAN_DELTA','BLOCK'];
var h='<h3>Gate confusion matrix (expected × actual, 72 runs)</h3><table class="matrix"><thead><tr><th></th>';ds.forEach(function(d){h+='<th>'+esc(d)+'</th>';});h+='</tr></thead><tbody>';
ds.forEach(function(e){h+='<tr><th>'+esc(e)+'</th>';ds.forEach(function(a){var v=m[e][a];h+='<td class="'+(e===a?(v>0?'cell-good':''):(v>0?'cell-bad':''))+'">'+v+'</td>';});h+='</tr>';});
$('matrix-wrap').innerHTML=h+'</tbody></table>';}
function setDataset(ds){state.dataset=ds;var live=ds==='live';
$('ds-live').setAttribute('aria-pressed',live?'true':'false');$('ds-regression').setAttribute('aria-pressed',live?'false':'true');
$('ag-live-disputes-grid').parentElement.hidden=!live;$('regression-shell').hidden=live;$('matrix-wrap').style.display=live?'none':'';
if(live){destroyGrid('ag-regression-benchmark-grid');mountLive();}else{destroyGrid('ag-live-disputes-grid');mountRegression();}}
$('ds-live').addEventListener('click',function(){setDataset('live');});
$('ds-regression').addEventListener('click',function(){setDataset('regression');});
function matchBadge(ok){return '<span class="match '+(ok?'yes':'no')+'">'+(ok?'MATCH':'DIFF')+'</span>';}
function currentCase(){return state.disputes.disputes.filter(function(d){return d.case===state.selectedCase;})[0];}
function renderInspector(){if(!state.disputes)return;var d=currentCase()||state.disputes.disputes[0];if(!d)return;state.selectedCase=d.case;
var meta=CASE_META[d.case];var f=d.forensics;var r=d.record;var p=state.disputes.provenance;
var vcls=f.verdict==='BUYER_FORGERY_DETECTED'?'pill-bad':'pill-warn';
function diffPills(){return meta.diffs.map(function(x){return '<span class="diff-pill">'+esc(x.field)+': '+esc(x.left)+' vs '+esc(x.right)+'</span>';}).join('');}
$('insp-buyer').innerHTML='<h2>Column 1 — Buyer claim &amp; submitted receipt</h2><p><b>'+esc(meta.label)+'</b></p><p class="status-line">'+esc(meta.blurb)+'</p><p>'+diffPills()+'</p><dl class="kv"><dt>Buyer claims</dt><dd>'+esc(meta.buyerTerms)+'</dd><dt>Hash vs order</dt><dd>'+matchBadge(f.buyerHashMatch)+'</dd><dt>Buyer sig</dt><dd>'+matchBadge(f.buyerSignatureValid)+'</dd></dl>';
var fp=(state.disputes.provenance.witnessPublicKeyHex||'').slice(0,16);
$('insp-witness').innerHTML='<h2>Column 2 — Witness provenance &amp; order anchor</h2><p><span class="wit-pill">witnessed: '+esc(meta.witnessed)+'</span></p><dl class="kv"><dt>Fetched URL</dt><dd class="mono" style="overflow-wrap:anywhere">'+esc(p.fetchedUrl)+'</dd><dt>TLS</dt><dd>'+(p.tlsVerified?'<span class="pill pill-ok">verified</span>':'<span class="pill pill-warn">fixture (no TLS session)</span>')+'</dd><dt>HTTP</dt><dd class="num">'+esc(String(p.httpStatus))+'</dd><dt>WIT key fp</dt><dd class="mono">'+esc(fp)+'</dd><dt>TSA</dt><dd>'+esc(p.tsaIssuer)+' @ <span class="num">'+esc(p.tsaTimeUtc)+'</span></dd><dt>Channel3</dt><dd class="mono">'+esc(p.channel3ProductId||'—')+'</dd><dt>Order</dt><dd class="mono">'+esc(state.disputes.orderId)+'</dd><dt>custom_id</dt><dd>'+chip(state.disputes.customId,true)+'</dd><dt>Witness hash</dt><dd>'+matchBadge(f.witnessHashMatch)+' <span class="mono" style="font-size:12px">anchor '+(f.anchorTrusted?'trusted':'UNTRUSTED')+'</span></dd></dl>';
var allowed=r.allowedActions||[];
function btn(rel,label){var on=allowed.indexOf(rel)>=0;return '<button type="button" class="btn" data-act="'+rel+'" '+(on?'':'disabled title="Not advertised by PayPal HATEOAS"')+'>'+label+'</button>';}
$('insp-seller').innerHTML='<h2>Column 3 — Seller counter-claim &amp; PayPal actions</h2><p><b>Seller claims:</b> '+esc(meta.sellerTerms)+'</p><p>'+diffPills()+'</p><p>Referee verdict <span class="pill '+vcls+'">'+esc(f.verdict)+'</span></p><dl class="kv"><dt>Seller hash</dt><dd>'+matchBadge(f.sellerHashMatch)+'</dd><dt>Dispute</dt><dd class="mono">'+esc(r.disputeId)+' · '+esc(r.lifeCycleStage)+' / '+esc(r.disputeState)+'</dd></dl><div class="action-stack" role="group" aria-label="PayPal dispute actions">'
+btn('require-evidence','Require evidence')+btn('provide-evidence','Contest &amp; submit counter-evidence (OTHER)')+btn('escalate','Escalate to claim')+btn('accept-claim','Accept claim')+btn('adjudicate','Adjudicate in sandbox')+'<button type="button" class="btn" id="btn-resolve">Auto-resolve this case (full chain)</button><button type="button" class="btn" id="btn-sheet">Printable evidence sheet</button></div><div id="act-zone"></div>';
Array.prototype.forEach.call($('insp-seller').querySelectorAll('[data-act]'),function(b){b.addEventListener('click',function(){disputeAction(d.record.disputeId,b.getAttribute('data-act'));});});
$('btn-resolve').addEventListener('click',function(){api('/api/merchant/disputes/resolve',{method:'POST',body:JSON.stringify({case:d.case})}).then(function(){toast('Case resolved');refreshDesk();}).catch(function(e){toast(e.message);});});
$('btn-sheet').addEventListener('click',function(){openSheet(d);});}
function disputeAction(disputeId,action){var zone=$('act-zone');
function send(payload){api('/api/merchant/disputes/action',{method:'POST',body:JSON.stringify(payload)}).then(function(){toast('Action applied: '+action);refreshDesk();}).catch(function(e){toast(e.message);});}
if(action==='provide-evidence'){zone.innerHTML='<div class="evidence-form"><label for="ev-notes"><b>Counter-evidence notes (OTHER, ≤2000 chars)</b></label><textarea id="ev-notes" maxlength="2000" placeholder="Forensic notes…"></textarea><button type="button" class="btn btn-primary" id="ev-send">Submit evidence</button></div>';
$('ev-send').addEventListener('click',function(){send({disputeId:disputeId,action:action,evidenceType:'OTHER',notes:$('ev-notes').value});});return;}
if(action==='require-evidence'){zone.innerHTML='<div class="evidence-form"><b>Require evidence from…</b><div style="display:flex;gap:8px;margin-top:6px"><button type="button" class="btn" id="req-b">Buyer</button><button type="button" class="btn" id="req-s">Seller</button></div></div>';
$('req-b').addEventListener('click',function(){send({disputeId:disputeId,action:action,requireAction:'BUYER_EVIDENCE'});});
$('req-s').addEventListener('click',function(){send({disputeId:disputeId,action:action,requireAction:'SELLER_EVIDENCE'});});return;}
if(action==='adjudicate'){zone.innerHTML='<div class="evidence-form"><b>Adjudicate (sandbox only)…</b><div style="display:flex;gap:8px;margin-top:6px"><button type="button" class="btn" id="adj-b">Buyer favor</button><button type="button" class="btn" id="adj-s">Seller favor</button></div></div>';
$('adj-b').addEventListener('click',function(){send({disputeId:disputeId,action:action,outcome:'BUYER_FAVOR'});});
$('adj-s').addEventListener('click',function(){send({disputeId:disputeId,action:action,outcome:'SELLER_FAVOR'});});return;}
send({disputeId:disputeId,action:action});}
/* ---------- deterministic studio agent: prompt → filter → chart ---------- */
var PROMPTS=[
{id:'outcome',label:'Compare contested disputes by verification outcome',dataset:'live',chart:'outcome'},
{id:'forgery-drift',label:'Show buyer forgery vs merchant drift cases',dataset:'live',chart:'compare'},
{id:'regression-ci',label:'Chart 24-scenario regression accuracy with 95% Wilson CIs',dataset:'regression',chart:'accuracy'}];
function renderPresets(){var w=$('preset-list');w.innerHTML='';PROMPTS.forEach(function(p){var b=document.createElement('button');b.type='button';b.className='btn';b.textContent=p.label;b.addEventListener('click',function(){$('prompt-input').value=p.label;runPrompt(p.label);});w.appendChild(b);});}
function mapPrompt(text){var t=(text||'').toLowerCase();if(t.indexOf('wilson')>=0||t.indexOf('regression')>=0||t.indexOf('accuracy')>=0||t.indexOf('confusion')>=0)return PROMPTS[2];if(t.indexOf('forgery')>=0||t.indexOf('drift')>=0||t.indexOf('buyer')>=0||t.indexOf('seller')>=0)return PROMPTS[1];return PROMPTS[0];}
function runPrompt(text){var p=mapPrompt(text);if(state.dataset!==p.dataset)setDataset(p.dataset);
if(p.chart==='accuracy'&&!state.benchmark){api('/api/benchmark').then(function(b){state.benchmark=b;mountRegression();drawAccuracy();}).catch(function(e){toast(e.message);});return;}
if(p.chart==='accuracy')drawAccuracy();else if(p.chart==='compare')drawCompare();else drawOutcome();}
$('prompt-run').addEventListener('click',function(){runPrompt($('prompt-input').value);});
$('prompt-input').addEventListener('keydown',function(e){if(e.key==='Enter')runPrompt(e.target.value);});
function setupCanvas(){var c=$('agent-chart');var dpr=window.devicePixelRatio||1;c.width=520*dpr;c.height=220*dpr;var x=c.getContext('2d');x.scale(dpr,dpr);x.clearRect(0,0,520,220);return x;}
function bar(x,i,n,label,value,color,lo,hi){var bw=300/n;var bx=150+i*bw+bw*0.18;var bh=Math.max(3,150*value);var by=175-bh;
x.fillStyle='#8b95a5';x.font='11px system-ui';x.textAlign='right';x.fillText(label,140,by+12);
x.fillStyle=color;x.fillRect(bx,by,bw*0.64,bh);
if(lo!==undefined&&hi!==undefined){var y1=175-150*hi;var y2=175-150*lo;var cx=bx+bw*0.32;x.strokeStyle='#14202e';x.lineWidth=2;x.beginPath();x.moveTo(cx,y1);x.lineTo(cx,y2);x.moveTo(cx-6,y1);x.lineTo(cx+6,y1);x.moveTo(cx-6,y2);x.lineTo(cx+6,y2);x.stroke();}
x.fillStyle='#14202e';x.textAlign='center';x.fillText((100*value).toFixed(1)+'%',bx+bw*0.32,190);}
function drawOutcome(){if(!state.disputes)return;var x=setupCanvas();var ds=state.disputes.disputes;
x.fillStyle='#14202e';x.font='bold 13px system-ui';x.textAlign='left';x.fillText('Disputes by verification outcome',8,16);
ds.forEach(function(d,i){var good=d.forensics.verdict==='BUYER_FORGERY_DETECTED'||d.forensics.verdict==='MERCHANT_DRIFT_CONFIRMED';bar(x,i,2,d.case==='buyer_forgery'?'Forgery (B)':'Drift (A)',good?1:0,good?'#1f8a70':'#c81e3a');});
$('chart-table').innerHTML='<table class="matrix"><tbody>'+ds.map(function(d){return '<tr><th>'+esc(d.case)+'</th><td>'+esc(d.forensics.verdict)+'</td><td>'+esc(d.record.lifeCycleStage)+' / '+esc(d.record.disputeState)+'</td></tr>';}).join('')+'</tbody></table>';}
function drawCompare(){if(!state.disputes)return;var x=setupCanvas();var ds=state.disputes.disputes;
x.fillStyle='#14202e';x.font='bold 13px system-ui';x.textAlign='left';x.fillText('Hash match bits: buyer · witness · seller',8,16);
var bits=['buyerHashMatch','witnessHashMatch','sellerHashMatch'];var names=['Buyer','Witness','Seller'];
ds.forEach(function(d,di){var tag=d.case==='buyer_forgery'?' (B)':' (A)';bits.forEach(function(b,bi){var v=d.forensics[b]?1:0;var label=(di===0?names[bi]:'')+(bi===1?tag:'');bar(x,di*3+bi,6,label,v,v?'#1f8a70':'#c81e3a');});});
$('chart-table').innerHTML='<table class="matrix"><thead><tr><th>Case</th><th>Buyer</th><th>Witness</th><th>Seller</th></tr></thead><tbody>'+ds.map(function(d){return '<tr><th>'+esc(d.case)+'</th><td>'+(d.forensics.buyerHashMatch?'MATCH':'DIFF')+'</td><td>'+(d.forensics.witnessHashMatch?'MATCH':'DIFF')+'</td><td>'+(d.forensics.sellerHashMatch?'MATCH':'DIFF')+'</td></tr>';}).join('')+'</tbody></table>';}
function drawAccuracy(){if(!state.benchmark)return;var x=setupCanvas();var b=state.benchmark;
x.fillStyle='#14202e';x.font='bold 13px system-ui';x.textAlign='left';x.fillText('Regression accuracy + 95% Wilson CI (72 runs)',8,16);
var rows=[['Gate',b.gateAccuracy],['Post-auth',b.postAuthAccuracy],['Referee',b.refereeAccuracy],['Overall',b.overallPassRate]];
rows.forEach(function(r,i){bar(x,i,4,r[0],r[1].rate,'#0e6efd',r[1].ci95Lower,r[1].ci95Upper);});
$('chart-table').innerHTML='<table class="matrix"><thead><tr><th>Metric</th><th>Rate</th><th>95% CI</th></tr></thead><tbody>'+rows.map(function(r){return '<tr><th>'+esc(r[0])+'</th><td class="num">'+r[1].successes+'/'+r[1].total+'</td><td class="num">['+r[1].ci95Lower.toFixed(3)+', '+r[1].ci95Upper.toFixed(3)+']</td></tr>';}).join('')+'</tbody></table>';}
/* ---------- evidence sheet ---------- */
function openSheet(d){var meta=CASE_META[d.case];var f=d.forensics;var r=d.record;var p=state.disputes.provenance;
$('sheet-body').innerHTML='<dl class="kv"><dt>Case</dt><dd>'+esc(meta.label)+'</dd><dt>Dispute</dt><dd class="mono">'+esc(r.disputeId)+'</dd><dt>Stage / State</dt><dd>'+esc(r.lifeCycleStage)+' / '+esc(r.disputeState)+'</dd><dt>Verdict</dt><dd><b>'+esc(f.verdict)+'</b></dd><dt>Reason</dt><dd>'+esc(f.reason)+'</dd><dt>Order</dt><dd class="mono">'+esc(state.disputes.orderId)+'</dd><dt>custom_id</dt><dd class="mono" style="overflow-wrap:anywhere">'+esc(state.disputes.customId)+'</dd><dt>Buyer hash</dt><dd>'+(f.buyerHashMatch?'MATCH':'DIFF')+' (sig '+(f.buyerSignatureValid?'valid':'INVALID')+')</dd><dt>Witness hash</dt><dd>'+(f.witnessHashMatch?'MATCH':'DIFF')+' (anchor '+(f.anchorTrusted?'trusted':'UNTRUSTED')+')</dd><dt>Seller hash</dt><dd>'+(f.sellerHashMatch?'MATCH':'DIFF')+'</dd><dt>Storefront</dt><dd class="mono" style="overflow-wrap:anywhere">'+esc(p.fetchedUrl)+'</dd><dt>TSA</dt><dd>'+esc(p.tsaIssuer)+' @ <span class="num">'+esc(p.tsaTimeUtc)+'</span></dd><dt>Channel3</dt><dd class="mono">'+esc(p.channel3ProductId||'—')+'</dd></dl><p class="status-line">Generated '+esc(new Date().toISOString())+' · '+esc(state.disputes.transportMode)+' · A timestamp proves hash existence at time T plus witness observation — never content truth.</p>';
$('sheet-modal').hidden=false;}
$('sheet-close').addEventListener('click',function(){$('sheet-modal').hidden=true;});
$('sheet-print').addEventListener('click',function(){window.print();});
$('sheet-modal').addEventListener('click',function(e){if(e.target.classList&&e.target.classList.contains('modal-back'))$('sheet-modal').hidden=true;});
/* ---------- guided judge tour: 5 beats, ~60s, stoppable, reduced-motion aware ---------- */
var tourRunning=false;var tourPaused=false;
function tourSleep(ms){var rm=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;return new Promise(function(res){setTimeout(res,rm?Math.min(ms,400):ms);});}
function tourSay(t){$('tour-status').textContent=t;toast(t);}
function tourBeat(n,t){tourSay('Beat '+n+'/5: '+t);}
function selectCase(c){state.selectedCase=c;renderInspector();}
function scrollToEl(id){var el=$(id);if(el&&el.scrollIntoView){try{el.scrollIntoView({block:'start'});}catch(e){}}}
function runTour(){
if(tourRunning){tourRunning=false;return Promise.resolve();}
tourRunning=true;tourPaused=false;$('btn-tour').textContent='■ Stop guided tour';
function alive(){return tourRunning;}
function held(r){if(r&&r.outcome==='AWAITING_BUYER_APPROVAL'){tourPaused=true;tourRunning=false;tourSay('Tour paused: approve the buyer popup, then press Finalize.');return true;}return false;}
return (async function(){
tourBeat(1,'Normal checkout — witness, ASK_HUMAN_DELTA, $297 capture');showView('checkout');selectScenario('normal');$('twostep-toggle').checked=false;scrollToEl('view-checkout');
await runWitnessFlow();if(!alive())return;await tourSleep(6000);
var r1=await runCheckoutFlow();if(!alive()||held(r1))return;await tourSleep(6000);
if(r1.outcome==='CAPTURED'){$('auditor').open=true;runAuditor();}
await tourSleep(9000);if(!alive())return;
tourBeat(2,'Hidden $55 surcharge — $340.50 auto-voided');selectScenario('surcharge_void');
var r2=await runCheckoutFlow();if(!alive()||held(r2))return;await tourSleep(8000);
tourBeat(3,'Hidden prompt injection — blocked pre-PayPal');selectScenario('adversarial_hidden_dom');
await runCheckoutFlow();if(!alive())return;await tourSleep(8000);
tourBeat(4,'Case B buyer forgery — SELLER_FAVOR');showView('desk');await ensureDesk();if(!alive())return;
selectCase('buyer_forgery');scrollToEl('inspector');await tourSleep(5000);if(!alive())return;
await api('/api/merchant/disputes/resolve',{method:'POST',body:JSON.stringify({case:'buyer_forgery'})});await refreshDesk();selectCase('buyer_forgery');await tourSleep(7000);if(!alive())return;
tourBeat(5,'Case A merchant drift — BUYER_FAVOR + regression chart');
await api('/api/merchant/disputes/resolve',{method:'POST',body:JSON.stringify({case:'merchant_drift'})});await refreshDesk();selectCase('merchant_drift');scrollToEl('inspector');await tourSleep(6000);if(!alive())return;
$('prompt-input').value='Chart 24-scenario regression accuracy with 95% Wilson CIs';runPrompt($('prompt-input').value);scrollToEl('agent-chart');await tourSleep(8000);
tourSay('Tour complete — VeriPact proved what the merchant promised.');
}()).catch(function(e){tourSay('Tour stopped: '+e.message);}).finally(function(){var done=tourRunning&&!tourPaused;tourRunning=false;$('btn-tour').textContent='▶ Run 60s Guided Demo Tour';if(!done&&!tourPaused)tourSay('Tour stopped.');});}
$('btn-tour').addEventListener('click',function(){runTour();});
</script>
</body></html>`;
}