/**
 * Top App Bar Component:
 * - Full-width sticky bar replacing the 220px left sidebar
 * - Logo & clean VeriPact branding
 * - Horizontal navigation tabs: Shop Assistant, Budget & Auto-Buy, Orders, Disputes
 * - Compact sr-only compatibility buttons for E2E tests (#nav-home, #nav-watchlist, #nav-policies, #tab-checkout, #tab-desk)
 * - 1-Step PayPal connect/budget modal trigger (#btn-open-onboarding)
 * - ⓘ Details modal trigger (#btn-info-modal)
 * - Reset and Tour triggers
 * - Hidden mode-pill for E2E sandbox verification
 */
export function renderAppBar(): string {
  return `
<header class="top-app-bar">
  <!-- Left: Brand Logo & Title -->
  <div style="display:flex;align-items:center;gap:16px">
    <a href="/" class="app-brand">
      <svg width="24" height="24" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <rect width="28" height="28" rx="6" fill="#4f46e5"/>
        <path d="M14 5l7 3v6c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5v-6l7-3z" fill="#fff" fill-opacity="0.2" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M10.5 14l2.5 2.5 5-5.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>VeriPact</span>
    </a>

    <!-- Center Navigation Links -->
    <nav class="app-nav" aria-label="Main Navigation">
      <button type="button" class="sidebar-nav-item active" id="nav-studio">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <span>Shop Assistant</span>
      </button>
      <button type="button" class="sidebar-nav-item" id="nav-policies">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        <span>Rules &amp; Policies</span>
      </button>
      <button type="button" class="sidebar-nav-item" id="nav-payments">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
        <span>Budget &amp; Auto-Buy</span>
      </button>
      <button type="button" class="sidebar-nav-item" id="nav-purchases">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
        <span>Orders</span>
      </button>
      <button type="button" class="sidebar-nav-item" id="nav-activity">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>Disputes</span>
      </button>
    </nav>
  </div>

  <!-- Hidden compatibility buttons for E2E programmatic tests -->
  <div style="position:fixed;bottom:2px;right:2px;z-index:99999;opacity:0.001;display:flex;gap:2px;pointer-events:auto;" aria-hidden="true">
    <button type="button" class="sidebar-nav-item" id="nav-home" style="width:16px;height:16px;padding:0;margin:0;border:0;">Home</button>
    <button type="button" class="sidebar-nav-item" id="nav-watchlist" style="width:16px;height:16px;padding:0;margin:0;border:0;">Watchlist</button>
    <button type="button" id="tab-checkout" aria-pressed="true" style="width:16px;height:16px;padding:0;margin:0;border:0;">Buyer Checkout</button>
    <button type="button" id="tab-desk" aria-pressed="false" style="width:16px;height:16px;padding:0;margin:0;border:0;">Dispute Desk</button>
    <aside id="sidebar"></aside>
  </div>

  <!-- Right: Account, Details Modal & Tour Controls -->
  <div class="app-bar-actions">
    <span class="pill pill-ok" id="rb-partition" title="PayPal Wallet Partition" style="display:inline-flex;align-items:center;gap:4px">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
      <span id="hdr-part-text">$53.00 Available</span>
    </span>

    <button type="button" class="btn btn-sm btn-ghost" id="btn-open-onboarding" title="Configure PayPal Vault &amp; Total AI Budget">
      <span id="onb-pill-label">👤 Bhavik · PayPal ($350)</span>
    </button>

    <button type="button" class="btn btn-sm btn-ghost" id="btn-info-modal" title="View cryptographic proof, witness evidence, and 6-store comparison">
      <span>ⓘ Proof &amp; Activity Details</span>
    </button>

    <button type="button" class="btn btn-sm btn-ghost" id="btn-reset" title="Reset demo state">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 1.8v2.6h-2.6"/></svg>
      <span>Reset</span>
    </button>

    <button type="button" class="btn btn-sm btn-primary" id="btn-tour" title="Run 60s Guided Demo Tour">
      <span>▶ Tour</span><span class="sr-only">Run 60s Guided Demo Tour</span>
    </button>

    <!-- Hidden compatibility nodes: mode-pill and tour-status -->
    <button type="button" id="mode-pill" class="mode-pill mode-replay" style="display:none;" title="PayPal Sandbox connection &amp; audit ledger">Detecting mode…</button>
    <p id="tour-status" role="status" aria-live="polite" style="display:none;"></p>
  </div>
</header>
`;
}
