import { connectorsRowHtml, syncShellHtml } from '../wallet-template';

/**
 * View 2: Dispute Desk & Analytical Agent:
 * - AG Grid 31 local vendor integration
 * - Live Contested Disputes (Case A & Case B)
 * - 24-Scenario Regression Suite (72 runs, Wilson 95% CIs)
 * - Payment Sync (Legacy vs Protected)
 * - Inspector Columns 1, 2, and 3
 * - Deterministic Studio Analytical Chart
 * - Connectors Row (OpenAPI 3.1 & MCP)
 */
export function renderDeskView(): string {
  return `
<section id="view-desk" hidden data-dataset="live" aria-label="Contested dispute verifier desk">
  <div class="desk-grid">
    <div>
      <div class="card">
        <h2>Disputes</h2><span class="sr-only">Contested dispute verifier desk</span>
        <div class="desk-tools" role="group" aria-label="Dataset toggle">
          <span class="seg">
            <button type="button" class="btn" id="ds-live" aria-pressed="true">Live contested disputes (Case B &amp; Case A)</button>
            <button type="button" class="btn" id="ds-regression" aria-pressed="false">24-scenario regression suite (72 runs, Wilson 95% CIs)</button>
            <button type="button" class="btn" id="ds-sync" aria-pressed="false">Payment Sync (Legacy vs Protected)</button>
          </span>
          <span id="grid-engine" class="pill pill-info">Grid engine: detecting…</span>
          <button type="button" class="btn" id="grid-csv" title="Export the visible grid to CSV (AG Grid engine)">Export CSV</button>
        </div>

        <!-- AG Live Disputes Grid -->
        <div class="ag-shell">
          <div id="ag-live-disputes-grid" class="ag-theme-quartz" role="grid" aria-label="Live contested disputes grid"></div>
        </div>

        <!-- AG Regression Benchmark Grid -->
        <div class="ag-shell" id="regression-shell" hidden>
          <div id="ag-regression-benchmark-grid" class="ag-theme-quartz" role="grid" aria-label="Regression benchmark grid"></div>
        </div>

        <!-- Sync Payments Shell (Single Clean Table, no duplicate) -->
        ${syncShellHtml()}

        <div id="matrix-wrap"></div>
      </div>

      <!-- Contested Claim Inspector -->
      <div class="inspector" id="inspector" data-widget="ContestedClaimInspectorWidget" aria-label="Contested claim inspector">
        <div class="insp-col" id="insp-buyer">
          <h2>Buyer Claim</h2><span class="sr-only">Column 1 — Buyer claim &amp; submitted receipt</span>
          <p class="status-line">Loading dispute data…</p>
        </div>
        <div class="insp-col" id="insp-witness">
          <h2>VeriPact Proof</h2><span class="sr-only">Column 2 — Witness provenance &amp; order anchor</span>
          <p class="status-line">Loading dispute data…</p>
        </div>
        <div class="insp-col" id="insp-seller">
          <h2>Merchant Claim</h2><span class="sr-only">Column 3 — Seller counter-claim &amp; PayPal actions</span>
          <p class="status-line">Loading dispute data…</p>
        </div>
      </div>
    </div>

    <!-- Right Side: Deterministic Analytical Studio Agent -->
    <div class="card" id="studio-card">
      <h2>Dispute Analytics</h2><span class="sr-only">Deterministic studio agent</span>
      <p class="status-line">Compare case verification, forensics, and 72-run benchmark accuracy.</p>
      <div class="prompt-bar">
        <label class="skip" for="prompt-input">Analytical query</label>
        <input id="prompt-input" name="prompt" autocomplete="off" spellcheck="false" placeholder="Ask about disputes or the regression suite…">
        <button type="button" class="btn btn-primary" id="prompt-run-desk">Run</button>
      </div>
      <div class="preset-list" id="preset-list"></div>
      <canvas class="chart" id="agent-chart" width="520" height="220" role="img" aria-label="Analytical chart"></canvas>
      <div id="chart-table"></div>
    </div>
  </div>

  <!-- Wallet Connectors (ChatGPT Actions + Claude/Cursor MCP) -->
  ${connectorsRowHtml()}
</section>

<!-- Printable Evidence Sheet Modal -->
<div id="sheet-modal" hidden>
  <div class="modal-back">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <h2 id="sheet-title">Printable evidence sheet</h2>
      <div id="sheet-body"></div>
      <div class="no-print" style="display:flex;gap:8px;margin-top:14px;">
        <button type="button" class="btn btn-primary" id="sheet-print">Print</button>
        <button type="button" class="btn btn-ghost" id="sheet-close">Close</button>
      </div>
    </div>
  </div>
</div>

<!-- PayPal Sandbox Credentials & Audit Ledger Modal -->
<div id="creds-modal" hidden>
  <div class="modal-back">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="creds-title">
      <h2 id="creds-title">PayPal Sandbox Connection &amp; Audit Ledger</h2>
      <p class="status-line" style="margin-top:0;">Paste sandbox REST credentials to go live (saved to <span class="mono">.env</span>, OAuth-verified immediately). Invalid or unreachable credentials fall back to deterministic replay — never a dead page.</p>
      <div class="creds-form" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0;">
        <label style="display:flex;flex-direction:column;gap:3px;font-size:12px;">Sandbox Client ID<input id="pp-client-id" type="password" autocomplete="off" spellcheck="false" placeholder="Paste sandbox client ID" style="padding:6px;border:1px solid #ccc;border-radius:4px;"></label>
        <label style="display:flex;flex-direction:column;gap:3px;font-size:12px;">Sandbox Client Secret<input id="pp-client-secret" type="password" autocomplete="off" spellcheck="false" placeholder="Paste sandbox client secret" style="padding:6px;border:1px solid #ccc;border-radius:4px;"></label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button type="button" class="btn btn-primary" id="btn-creds-save">Save &amp; Verify Live</button>
        <button type="button" class="btn btn-ghost" id="btn-creds-replay">Use Replay Instead</button>
        <button type="button" class="btn btn-ghost" id="btn-creds-close">Close</button>
        <span class="status-line" id="creds-status" aria-live="polite"></span>
      </div>
      <h3>Cryptographic clearing ledger (this session)</h3>
      <ul class="ledger-list" id="ledger-list" style="list-style:none;margin:10px 0;padding:0;max-height:220px;overflow:auto;border:1px solid var(--border-subtle);border-radius:6px;font-size:12px;">
        <li><span class="sum">Loading ledger…</span></li>
      </ul>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button type="button" class="btn btn-ghost" id="btn-ledger-download">Download Signed Ledger (.json)</button>
      </div>
    </div>
  </div>
</div>
`;
}

