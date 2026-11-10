/**
 * Details & Cryptographic Proof Component (#details-modal):
 * - Keeps the primary dashboard 100% clean and uncrowded while housing the deep technical inspection tools
 * - Section 1: 6 Stores & Coupons Compared (#sniper-box / #sniper-results)
 * - Section 2: Order Receipt & Browser Verifier (#checkout-result, #auditor, #auditor-body)
 * - Section 3: Buyer Protection Rules & HTML Scanner (#mandate-card, #mandate-editor, #scanner-drawer, #pipeline-drawer)
 * - Accessible to Playwright E2E selectors without requiring modal open/close gymnastics
 */
export function renderDetailsModal(): string {
  return `
<div class="card" id="details-modal" style="margin-top:16px;background:#ffffff;border:1px solid var(--border-subtle);border-radius:6px;">
  <!-- Details Header & Tabs -->
  <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-subtle);padding-bottom:10px;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
    <div style="display:flex;align-items:center;gap:8px;">
      <h2 style="margin:0;font-size:14px;font-weight:700;">ⓘ Proof, Evidence &amp; Store Comparison Details</h2>
      <span class="pill pill-info" style="font-size:11px;">Client-Side Verifier</span>
    </div>
    <div style="display:flex;gap:4px;" role="tablist">
      <button type="button" class="btn btn-sm btn-ghost active" id="tab-det-sniper" style="font-size:11.5px;">6 Stores Compared</button>
      <button type="button" class="btn btn-sm btn-ghost" id="tab-det-auditor" style="font-size:11.5px;">Receipt &amp; Auditor</button>
      <button type="button" class="btn btn-sm btn-ghost" id="tab-det-rules" style="font-size:11.5px;">Protection Rules &amp; Scanner</button>
    </div>
  </div>

  <!-- Section 1: 6 Stores & Coupons Compared -->
  <div id="sec-det-sniper" class="det-section">
    <div id="sniper-box">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h3 style="margin:0;font-size:12.5px;font-weight:700;">Autonomous Deal &amp; Voucher Sniper (@veripact)</h3>
        <span class="pill pill-info">Hunt Vouchers &amp; Auto-Buy Under $300</span>
      </div>
      <div id="sniper-results" class="sniper-results" aria-live="polite">
        <div style="padding:12px;background:#f8fafc;border:1px dashed var(--border-subtle);border-radius:6px;text-align:center;color:var(--text-muted);font-size:12px;">
          <p style="margin:0;">Click <b>Find Best Deal</b> in the task bar to evaluate 6 competing merchant listings and coupon codes against your budget.</p>
        </div>
      </div>
    </div>
  </div>

  <!-- Section 2: Order Receipt & Browser Verifier -->
  <div id="sec-det-auditor" class="det-section" style="margin-top:14px;border-top:1px solid var(--border-subtle);padding-top:14px;">
    <div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px;align-items:start;">
      <!-- Transaction Record -->
      <div class="card" id="checkout-result" style="padding:12px;box-shadow:none;background:#f8fafc;">
        <div class="card-head" style="margin-bottom:8px;">
          <h2 style="font-size:13px;">Transaction Record</h2>
        </div>
        <dl class="record-kv">
          <dt>Order ID</dt><dd class="mono">— (awaiting checkout)</dd>
          <dt>Authorization</dt><dd class="mono">—</dd>
          <dt>Capture</dt><dd class="mono">—</dd>
          <dt>Commitment</dt><dd class="mono">—</dd>
          <dt>PayPal Mode</dt><dd class="mono">Sandbox (Deterministic)</dd>
        </dl>
        <div class="post-purchase" style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm btn-ghost" id="btn-sim-drift">Simulate Merchant Drift → File Dispute</button>
          <button type="button" class="btn btn-sm btn-ghost" id="btn-sim-forgery">Simulate Buyer Forgery → File Dispute</button>
        </div>
      </div>

      <!-- Client-Side Auditor -->
      <div class="card auditor-card" style="padding:12px;box-shadow:none;background:#f8fafc;">
        <div class="card-head" style="margin-bottom:6px;">
          <h2 style="font-size:13px;">Verify-It-Yourself (Auditor)</h2>
        </div>
        <p class="status-line" style="margin:0 0 6px;font-size:11px;">Your browser independently recomputes the receipt hash and compares it with PayPal.</p>
        <details class="drawer" id="auditor" style="background:#ffffff;">
          <summary style="font-size:11.5px;">Open the client-side auditor</summary>
          <div class="drawer-body" id="auditor-body" style="font-size:11.5px;">
            <p class="status-line">Run a checkout first — the auditor needs a witnessed receipt and a PayPal order.</p>
          </div>
        </details>
      </div>
    </div>
  </div>

  <!-- Section 3: Buyer Protection Rules & HTML Scanner -->
  <div id="sec-det-rules" class="det-section" style="margin-top:14px;border-top:1px solid var(--border-subtle);padding-top:14px;">
    <!-- Buyer Mandate Strip -->
    <div id="mandate-card" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h3 style="margin:0;font-size:12.5px;font-weight:700;">Buyer Mandate &amp; Sufficiency Rules</h3>
        <button type="button" class="btn btn-sm btn-ghost" id="btn-mandate-edit">Edit Mandate</button>
      </div>
      <div class="mandate-strip" style="border:1px solid var(--border-subtle);border-radius:6px;padding:8px;background:#f8fafc;">
        <div><b class="big" id="m-cap">$320.00</b><span>Cap (all-in)</span></div>
        <div><b class="mid" id="m-cond">NEW</b><span>Condition</span></div>
        <div><b class="mid" id="m-days">≥ 30 days</b><span>Return window</span></div>
        <div><b class="mid" id="m-fee">0%</b><span>Restocking fee</span></div>
      </div>
      <div class="mandate-editor" id="mandate-editor" hidden>
        <label>Cap, all-in (USD)<input id="m-in-cap" type="number" min="1" max="1000000" step="0.01" value="320"></label>
        <label>Condition<select id="m-in-cond"><option value="NEW">NEW</option><option value="REFURBISHED">REFURBISHED</option></select></label>
        <label>Return window (days)<select id="m-in-days"><option value="14">14</option><option value="30" selected>30</option><option value="45">45</option><option value="60">60</option></select></label>
        <label>Restocking fee (%)<select id="m-in-fee"><option value="0" selected>0%</option><option value="10">10%</option><option value="15">15%</option><option value="25">25%</option></select></label>
        <div class="row-end">
          <button type="button" class="btn btn-primary" id="btn-mandate-save">Sign &amp; Lock Mandate (SELF)</button>
          <span class="status-line" id="mandate-status" aria-live="polite"></span>
        </div>
      </div>
    </div>

    <!-- Hidden-DOM Quote Inspector & Live HTML Scanner -->
    <details class="drawer" id="scanner-drawer" style="margin-top:8px;">
      <summary style="font-size:11.5px;">Inspect extracted DOM quote blocks &amp; live HTML scanner</summary>
      <div class="drawer-body">
        <div id="quote-badges" class="badges" aria-live="polite" style="margin-bottom:8px;">
          <span class="badge">Witness a scenario to pin quotes…</span>
        </div>
        <div class="custom-lab" id="custom-lab">
          <h3 style="font-size:12px;margin:4px 0 6px;">Test Custom Merchant HTML / Inject Trap</h3>
          <div class="preset-row" role="group" aria-label="Custom HTML presets" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
            <button type="button" class="btn btn-sm btn-ghost" id="cx-preset-apex">Apex flagship</button>
            <button type="button" class="btn btn-sm btn-ghost" id="cx-preset-laptop">Northloop 14 ($899)</button>
            <button type="button" class="btn btn-sm btn-ghost" id="cx-preset-opacity">Hidden opacity trap</button>
            <button type="button" class="btn btn-sm btn-ghost" id="cx-preset-inject">Prompt-injection trap</button>
          </div>
          <label class="skip" for="custom-html">Custom merchant HTML</label>
          <textarea id="custom-html" spellcheck="false" placeholder="Paste merchant listing HTML here, or pick a preset…" style="width:100%;height:80px;font-family:var(--font-mono);font-size:11px;padding:6px;border:1px solid var(--border-strong);border-radius:4px;box-sizing:border-box;margin-bottom:6px;"></textarea>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <button type="button" class="btn btn-primary btn-sm" id="btn-custom-scan">Scan &amp; Witness Custom HTML</button>
            <span class="status-line" id="custom-status" aria-live="polite"></span>
          </div>
          <div id="custom-result" aria-live="polite" style="margin-top:6px;"></div>
        </div>
        <label class="mutate" style="display:flex;gap:6px;align-items:center;margin-top:8px;font-size:11.5px;">
          <input type="checkbox" id="mutate-toggle">
          <span><b>Post-purchase policy mutation preview.</b> Shows drifted policy compared with witnessed terms.</span>
        </label>
        <div id="mutate-panel" hidden style="margin-top:6px;background:#f8fafc;padding:8px;border-radius:4px;">
          <dl class="kv">
            <dt>Witnessed</dt><dd><span class="pill pill-ok">30-day free returns · 0% fee</span></dd>
            <dt>Mutated listing</dt><dd><span class="pill pill-bad">14-day returns · 25% fee</span></dd>
            <dt>Effect</dt><dd>Receipt hash would no longer match the PayPal order custom_id → MERCHANT_DRIFT_CONFIRMED.</dd>
          </dl>
        </div>
      </div>
    </details>

    <!-- Cryptographic Evidence Pipeline Ribbon -->
    <details class="drawer" id="pipeline-drawer" style="margin-top:8px;">
      <summary style="font-size:11.5px;">Evidence Pipeline &mdash; Verifiable &bull; Tamper-proof &bull; PayPal-anchored</summary>
      <div class="drawer-body">
        <nav id="pipeline-ribbon" class="ribbon" aria-label="Cryptographic evidence pipeline">
          <div class="rb-title"><b>Evidence Pipeline</b><span>Verifiable · Tamper-proof · PayPal-anchored</span></div>
          <div class="ribbon-step" id="rb-1">
            <span class="rb-num" aria-hidden="true">1</span>
            <div style="min-width:0">
              <b>1. SELF — Buyer mandate locked</b>
              <div class="rb-badges">
                <span class="badge" id="rb-buyer-fp" title="Ed25519 buyer key fingerprint">buyer key fp …</span>
                <span class="badge" id="rb-ceiling">ceiling: $320.00</span>
              </div>
            </div>
          </div>
          <div class="rb-connector" id="rb-conn-1" aria-hidden="true"></div>
          <div class="ribbon-step" id="rb-2">
            <span class="rb-num" aria-hidden="true">2</span>
            <div style="min-width:0">
              <b>2. WIT — Independent HTTPS witness</b>
              <div class="rb-badges">
                <span class="badge" id="rb-tsa">RFC 3161 …</span>
                <span class="badge" id="rb-dom">DOM scan …</span>
                <span class="badge" id="rb-ch3">Channel3 …</span>
              </div>
            </div>
          </div>
          <div class="rb-connector" id="rb-conn-2" aria-hidden="true"></div>
          <div class="ribbon-step" id="rb-3">
            <span class="rb-num" aria-hidden="true">3</span>
            <div style="min-width:0">
              <b>3. SIGN — PayPal custom_id anchor</b>
              <div class="rb-badges">
                <span class="badge" id="rb-commit">VP1: …</span>
                <span class="badge" id="rb-regate">re-gate …</span>
              </div>
            </div>
          </div>
        </nav>
      </div>
    </details>
  </div>
</div>
`;
}

