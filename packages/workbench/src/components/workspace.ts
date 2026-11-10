import { walletCardHtml } from '../wallet-template';
import { renderDetailsModal } from './details-modal';

/**
 * Workspace Component:
 * - Top Task Bar (plain language, zero sniper jargon)
 * - Row 1 (strictly 2 cards):
 *     1. Store Preview (Channel3 SKU select, scenario pills, live store iframe 310px)
 *     2. Deal Summary & Checkout (status badge with tooltip, price strip, 3 pills, details button, checkout)
 * - Row 2 (strictly 2 cards):
 *     3. PayPal Budget & Allocation (walletCardHtml: balance, pairing, spend/refund buttons)
 *     4. Price-Drop Auto-Buy Tasks (fleet panel, polling badge, poll now, add task)
 * - Details & Proof Section (renderDetailsModal)
 * - Invisible 2x2 compatibility nodes for 3D robot canvases (#agent-robot-3d-canvas, #sidebar-robot-canvas)
 */
export function renderWorkspace(): string {
  return `
<!-- Invisible 2x2 Compatibility Nodes for 3D Robot Canvases (Takes 0px layout space) -->
<canvas id="agent-robot-3d-canvas" width="2" height="2" style="opacity:0;position:fixed;pointer-events:none;bottom:0;right:0;width:2px;height:2px;" aria-hidden="true"></canvas>
<canvas id="sidebar-robot-canvas" width="2" height="2" style="opacity:0;position:fixed;pointer-events:none;bottom:0;right:0;width:2px;height:2px;" aria-hidden="true"></canvas>

<!-- Clean Top Task Prompt Bar -->
<div class="task-prompt-bar" id="prompt-bar-wrap">
  <div class="task-prompt-icon" aria-hidden="true">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  </div>

  <input type="text" id="sniper-intent-prompt" class="task-prompt-input" value="Find a 27&quot; 4K IPS monitor under $300 with free 30-day returns" placeholder="Find best deal across merchant stores with return protection..." aria-label="Shopping task description">

  <div class="task-budget-pill">
    <label for="sniper-target-input" style="font-size:11px;color:var(--text-muted);">Max $</label>
    <input id="sniper-target-input" type="number" min="1" max="10000" step="1" value="300" aria-label="Budget limit in USD">
  </div>

  <!-- Progress Ring Indicator -->
  <div style="display:flex;align-items:center;" id="progress-ring-wrap" title="Autonomous Deal Analysis Progress">
    <svg id="mission-progress-ring" class="progress-ring" width="24" height="24" viewBox="0 0 44 44" style="flex-shrink:0;">
      <circle cx="22" cy="22" r="18" fill="none" stroke="#e2e8f0" stroke-width="4"/>
      <circle id="mission-progress-circle" cx="22" cy="22" r="18" fill="none" stroke="#4f46e5" stroke-width="4" stroke-dasharray="113.1" stroke-dashoffset="24.88"/>
      <text id="mission-progress-text" x="22" y="26" text-anchor="middle" font-size="11" font-weight="700" fill="#4f46e5" transform="rotate(90 22 22)">78%</text>
    </svg>
  </div>

  <button type="button" class="btn btn-sm btn-ghost" id="btn-mandate-filter-toggle" title="Edit buyer rules &amp; mandate constraints">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
    <span>Rules</span>
  </button>

  <button type="button" class="btn btn-primary" id="btn-sniper-run">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
    <span>Find Best Deal</span>
  </button>

  <!-- Legacy prompt-run compatibility hook -->
  <button type="button" id="prompt-run" class="sr-only">Run</button>
</div>

<!-- Main Section: View 1 (Shop Assistant & Autonomous Checkout) -->
<section id="view-checkout" aria-label="Buyer checkout and live receipt verifier">
  <!-- ROW 1: Strictly 2 Cards Side-by-Side -->
  <div class="two-card-row">
    <!-- Card 1: Store Preview -->
    <div class="card browser-card">
      <div class="card-head">
        <div style="display:flex;align-items:center;gap:8px;">
          <h2>Store Preview</h2>
          <span class="pill pill-ok" style="font-size:10.5px;">Live Sandbox</span>
        </div>

        <div style="display:flex;align-items:center;gap:6px;">
          <select id="channel3-sku-select" class="browser-sku-select" aria-label="Channel3 catalog SKU selector">
            <option value="APEX-27-4K-IPS">APEX-27-4K-IPS ($279)</option>
          </select>

          <!-- Scenario Pills -->
          <div class="scn-segmented" role="group" aria-label="Scenario selector">
            <button type="button" class="scn scn-pill" data-scn="normal" aria-pressed="true">Normal</button>
            <button type="button" class="scn scn-pill" data-scn="surcharge_void" aria-pressed="false">Hidden Fee</button>
            <button type="button" class="scn scn-pill" data-scn="adversarial_hidden_dom" aria-pressed="false">Scam Trap</button>
          </div>
        </div>
      </div>

      <!-- Browser Frame -->
      <div class="browser">
        <div class="browser-chrome">
          <span class="dots" aria-hidden="true"><i class="dot-red"></i><i class="dot-yellow"></i><i class="dot-green"></i></span>
          <span class="urlbar">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#15803d" stroke-width="1.8" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7"/></svg>
            <span id="store-url">https://store.example.com/product/APEX-27-4K-IPS</span>
          </span>
          <button type="button" class="btn-open-anywhere" id="btn-open-anywhere" title="Toggle @veripact overlay in Store (Alt+V)" aria-label="Toggle @veripact overlay">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            <span>@veripact</span>
          </button>
        </div>
        <iframe id="store-frame" class="store-frame" title="Synthetic merchant storefront" src="/store/normal" scrolling="no"></iframe>
      </div>

      <div id="agent-thinking-bar" class="agent-thinking-bar" aria-live="polite">
        ✦ Agent Thinking... Verifying seller reputation, PAYPAL50 voucher validity, and 30-day return policy...
      </div>
    </div>

    <!-- Card 2: Deal Summary & Checkout -->
    <div class="card approval-card" id="approval-card">
      <div class="card-head">
        <h2>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
          <span>Deal Summary &amp; Protection</span>
        </h2>

        <!-- Status Badge with CSS Hover Tooltip -->
        <div class="tooltip-wrap">
          <span id="gate-badge" class="pill pill-ok">
            ✓ Verified
            <span class="sr-only">SUFFICIENT Awaiting witness…</span>
          </span>
          <div class="tooltip-content">
            <b>VeriPact 3-Rung Guarantee:</b><br>
            1. Checked within your $300 max budget<br>
            2. Verified 30-day free returns on store page<br>
            3. Protected by PayPal receipt custom_id lock
          </div>
        </div>
      </div>

      <!-- Outcome Banner -->
      <div class="outcome-banner" id="checkout-outcome-banner" data-state="idle">
        <svg class="outcome-icon" viewBox="0 0 46 46" fill="none" aria-hidden="true"><circle cx="23" cy="23" r="21" stroke="#cbd5e1" stroke-width="2.5"/><path d="M15 23.5l5.5 5.5L31 18" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div>
          <h3>Recommended Purchase</h3>
          <p>Meets all your return terms, pricing constraints, and security checks.</p>
        </div>
      </div>

      <!-- Big, Uncluttered Price Row -->
      <div class="deal-price-strip">
        <div class="price-col">
          <b id="price-final-display">$297.00</b>
          <span class="price-lbl">Final Price</span>
        </div>
        <div class="price-col">
          <b class="discount" id="price-discount-display">15% Off</b>
          <span class="price-lbl">vs $347.00 Retail</span>
        </div>
        <div class="price-col">
          <span class="savings-badge" id="price-savings-display">$50.00</span>
          <span class="price-lbl">You Save (PAYPAL50)</span>
        </div>
      </div>

      <!-- 3 Concise Verification Pills -->
      <div class="deal-verif-pill-row">
        <span class="verif-pill-tag">✓ Brand New</span>
        <span class="verif-pill-tag">✓ 30-Day Free Returns</span>
        <span class="verif-pill-tag">✓ $0 Restocking Fee</span>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:11.5px;color:var(--text-muted);">
        <span id="oracle-line" class="pill pill-info" style="font-size:11px;">Channel3 oracle: not queried yet.</span>
        <button type="button" class="btn btn-sm btn-ghost" id="btn-witness">Witness Page</button>
      </div>

      <!-- Details Trigger Button -->
      <button type="button" class="btn btn-sm btn-ghost" id="btn-open-details-card" style="width:100%;margin-bottom:10px;justify-content:center;">
        <span>ⓘ View 6 Stores Checked &amp; Cryptographic Proof</span>
      </button>

      <!-- Primary Checkout Action -->
      <div class="checkout-actions-wrap">
        <button type="button" class="btn btn-primary btn-checkout-full" id="btn-checkout">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
          <span id="btn-checkout-label">Buy Now with PayPal — $297.00</span>
          <span>&rarr;</span>
        </button>

        <div class="checkout-toggles">
          <label><input type="checkbox" id="reviewed-toggle" checked><span>Merchant terms verified</span></label>
          <label><input type="checkbox" id="twostep-toggle"><span id="twostep-label"><b>Two-step popup</b> (recommended)</span></label>
        </div>

        <p id="checkout-status" class="status-line" aria-live="polite" style="margin:2px 0 0;font-size:11.5px;"></p>
        <div id="awaiting-card" hidden></div>
      </div>

      <!-- Hidden compatibility hooks for Rungs and Sufficiency -->
      <div class="sr-only" aria-hidden="true">
        <span id="rung-self">SELF Mandate Check</span>
        <span id="rung-wit">WIT Channel3 Check</span>
        <span id="rung-sign">SIGN PayPal Anchor</span>
        <div id="suff-pills">
          <div class="suff"><span class="pill">Condition</span></div>
          <div class="suff"><span class="pill">Base Price</span></div>
          <div class="suff"><span class="pill">Shipping &amp; Tax</span></div>
          <div class="suff"><span class="pill">Return Window</span></div>
        </div>
      </div>
    </div>
  </div>

  <!-- ROW 2: Strictly 2 Cards Side-by-Side Below Row 1 -->
  <div class="two-card-row" style="margin-top:16px;">
    <!-- Card 3: PayPal Budget & Allocation -->
    <div style="min-width:0;">
      ${walletCardHtml()}
    </div>

    <!-- Card 4: Price-Drop Auto-Buy Tasks -->
    <div class="card" id="fleet-panel">
      <div class="card-head">
        <div>
          <h2>Auto-Buy When Price Drops</h2>
          <span class="pill pill-ok" id="fleet-live-badge" style="font-size:11px;margin-top:2px;">
            <span class="dot"></span> Polling Every 15s + Webhook Active
          </span>
        </div>
        <div style="display:flex;gap:6px;">
          <button type="button" class="btn btn-sm btn-ghost" id="btn-poll-now" title="Check merchant catalog prices now">
            ↻ Poll Now
          </button>
          <button type="button" class="btn btn-sm btn-primary" id="btn-toggle-spawn-agent">
            + Add Task
          </button>
        </div>
      </div>

      <!-- Add Task Form -->
      <div id="form-spawn-agent" class="spawn-form-box" hidden style="margin:8px 0;padding:12px;border:1px solid var(--border-strong);border-radius:6px;background:#f8fafc;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(120px, 1fr));gap:8px;align-items:end;">
          <label style="font-size:11px;font-weight:600;">Task Name<input type="text" id="spawn-agent-name" placeholder="e.g. OLED TV Tracker" class="form-input" style="padding:4px 6px;"></label>
          <label style="font-size:11px;font-weight:600;">Product SKU<input type="text" id="spawn-agent-sku" placeholder="e.g. LG-OLED-55" class="form-input" style="padding:4px 6px;"></label>
          <label style="font-size:11px;font-weight:600;">Target Max $<input type="number" id="spawn-agent-target" placeholder="799" min="1" step="0.01" class="form-input" style="padding:4px 6px;"></label>
          <label style="font-size:11px;font-weight:600;">Sub-Budget $<input type="number" id="spawn-agent-suballoc" placeholder="800" min="1" step="0.01" class="form-input" style="padding:4px 6px;"></label>
          <div style="display:flex;gap:6px;">
            <button type="button" class="btn btn-sm btn-primary" id="btn-spawn-agent">Create</button>
            <button type="button" class="btn btn-sm btn-ghost" id="btn-cancel-spawn-agent">Cancel</button>
          </div>
        </div>
        <p class="status-line" id="spawn-agent-status" aria-live="polite" style="margin:4px 0 0;font-size:11px;"></p>
      </div>

      <!-- Active Tasks Container (populated by renderFleetAgents) -->
      <div id="fleet-agents-list" class="fleet-grid">
        <!-- Rendered dynamically -->
      </div>
    </div>
  </div>

  <!-- Details & Verification Modal / Deep Drawer Component -->
  ${renderDetailsModal()}

  <!-- Legacy Compatibility DOM for Stepper and Workflow Bar -->
  <div class="sr-only" aria-hidden="true">
    <div id="mission-card">
      <div class="mission-stepper" id="mission-stepper">
        <div class="step-item" id="step-1">1</div>
        <div class="step-item" id="step-2">2</div>
        <div class="step-item" id="step-3">3</div>
        <div class="step-item" id="step-4">4</div>
        <div class="step-item" id="step-5">5</div>
        <div class="step-item" id="step-6">6</div>
      </div>
    </div>
    <nav id="workflow-guide-bar" style="display:none;">
      <button type="button" id="wf-step-1">1</button>
      <button type="button" id="wf-step-2">2</button>
      <button type="button" id="wf-step-3">3</button>
      <button type="button" id="wf-step-4">4</button>
    </nav>
    <div id="trend-fill"></div>
    <div id="sidebar-companion-card"></div>
  </div>
</section>
`;
}
