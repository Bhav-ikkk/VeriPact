import { WALLET_CSS } from '../wallet-template';

/**
 * Workbench visual styles — monochrome fintech system (Linear / Stripe / Mercury discipline):
 * - Zero AI purple: carbon-black (#09090b) primary actions on crisp zinc (#f4f4f5) canvas
 * - Inter UI type + JetBrains Mono numerals, tabular figures everywhere numbers appear
 * - Locked 6px radius on cards/buttons/inputs/selects/modals; 4px only on micro tags
 * - Locked 36px control geometry: every button/select/text-input in bars and cards
 * - Dynamic equal-height 2-card rows (align-items: stretch + column flex + pinned footers)
 * - Pure-CSS [data-tooltip] bubbles replace helper paragraphs
 * - Guaranteed high-contrast buttons (no transparent or white-on-white hover states)
 * NOTE: an RFC 3161 timestamp proves hash existence at time T plus independent
 * witness observation of the source page — it NEVER proves content truth.
 */
export function renderWorkbenchStyles(): string {
  return `
:root {
  --bg-canvas: #f4f4f5;
  --bg-card: #ffffff;
  --bg-subtle: #fafafa;
  --border: #e4e4e7;
  --ink: #09090b;
  --muted: #71717a;
  --bg-surface: #ffffff;
  --bg-muted: #fafafa;
  --text-primary: #09090b;
  --text-secondary: #3f3f46;
  --text-muted: #71717a;
  --border-subtle: #e4e4e7;
  --border-strong: #d4d4d8;
  --accent-purple: #09090b;
  --accent-indigo: #27272a;
  --accent-charcoal: #09090b;
  --accent-charcoal-hover: #27272a;
  --accent-blue: #09090b;
  --status-success-bg: #ecfdf5;
  --status-success-border: #a7f3d0;
  --status-success-ink: #059669;
  --status-success-solid: #059669;
  --status-warn-bg: #fffbeb;
  --status-warn-border: #fde68a;
  --status-warn-ink: #d97706;
  --status-danger-bg: #fef2f2;
  --status-danger-border: #fecaca;
  --status-danger-ink: #dc2626;
  --radius-card: 6px;
  --radius-control: 6px;
  --shadow-card: 0 1px 2px rgba(9, 9, 11, 0.05);
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
}

* { box-sizing: border-box; }
html { overflow-x: hidden; }
body {
  font-family: var(--font-sans);
  margin: 0;
  background: var(--bg-canvas);
  color: var(--text-primary);
  font-size: 13.5px;
  line-height: 1.45;
  letter-spacing: -0.015em;
  font-variant-numeric: tabular-nums;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}

.skip {
  position: absolute;
  left: -999px;
  top: 8px;
  background: var(--ink);
  color: #fff;
  padding: 8px 14px;
  border-radius: var(--radius-control);
  z-index: 99;
  font-size: 13px;
}
.skip:focus { left: 8px; color: #fff; }

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
  border-radius: 4px;
}

h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; margin: 0; color: var(--text-primary); }
h2 { font-size: 14px; font-weight: 650; letter-spacing: -0.01em; margin: 0 0 6px; color: var(--text-primary); }
h3 { font-size: 12.5px; margin: 10px 0 6px; color: var(--text-secondary); font-weight: 650; }
.num, .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

/* Sticky Top App Bar Layout (Zero Left Sidebar Whitespace) */
.app-layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg-canvas);
}

.top-app-bar {
  position: sticky;
  top: 0;
  height: 56px;
  background: #ffffff;
  border-bottom: 1px solid var(--border);
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  z-index: 40;
  box-shadow: 0 1px 2px rgba(9, 9, 11, 0.03);
}

.app-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: var(--text-primary);
  font-weight: 750;
  font-size: 16px;
  letter-spacing: -0.02em;
}

.app-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.sidebar-nav-item, .nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  min-height: 36px;
  padding: 0 12px;
  border-radius: var(--radius-control);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  text-decoration: none;
  box-sizing: border-box;
}

.sidebar-nav-item:hover, .nav-btn:hover {
  background: #f4f4f5;
  color: var(--text-primary);
}

.sidebar-nav-item.active, .nav-btn.active {
  background: #09090b !important;
  color: #ffffff !important;
  border-color: #09090b !important;
  font-weight: 650;
}
.sidebar-nav-item.active:hover, .nav-btn.active:hover {
  background: #27272a !important;
  color: #ffffff !important;
}

.app-bar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Main Workspace Container */
.app-main {
  width: 100%;
  max-width: 1360px;
  margin: 0 auto;
  padding: 16px 24px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Clean Top Task Prompt Bar */
.task-prompt-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #ffffff;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 12px 16px;
  box-shadow: var(--shadow-card);
}

.task-prompt-icon {
  color: var(--ink);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.task-prompt-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  min-height: 36px;
  border: 0;
  background: transparent;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-primary);
  outline: none;
  font-family: inherit;
  box-sizing: border-box;
}

.task-budget-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #fafafa;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 650;
  color: var(--text-primary);
  flex-shrink: 0;
  height: 36px;
  min-height: 36px;
  box-sizing: border-box;
}

.task-budget-pill input {
  border: 0;
  background: transparent;
  width: 55px;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
  outline: none;
  text-align: center;
}

/* Strict 2-Cards-Per-Row Grid Layout — dynamic equal heights */
.two-card-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: stretch;
  margin-bottom: 16px;
}
.two-card-row > .card,
.two-card-row > section,
.two-card-row > div.card {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-sizing: border-box;
  margin: 0;
}
@media (max-width: 1024px) {
  .two-card-row {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* Base Card (6px radius, hairline 1px border) */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 16px;
  min-width: 0;
  box-shadow: var(--shadow-card);
}

.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.card-head h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
}

/* Pinned card footer: margin-top auto beats space-between, so head/body stay natural */
.card-foot {
  margin-top: auto;
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Equal-width, equal-height action rows inside card footers */
.btn-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  width: 100%;
}

/* Scenario Segmented Selector */
.scn-segmented {
  display: inline-flex;
  align-items: stretch;
  gap: 2px;
  background: #f4f4f5;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 2px;
}

.scn-pill {
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  height: 36px;
  min-height: 36px;
  padding: 0 10px;
  border-radius: 4px;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  box-sizing: border-box;
}

.scn-pill:hover {
  color: var(--text-primary);
  background: #e4e4e7;
}

.scn-pill[aria-pressed="true"] {
  background: #09090b !important;
  color: #ffffff !important;
  font-weight: 700;
}

/* Browser Frame & Chrome */
.browser {
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  overflow: hidden;
  background: #fff;
  margin-bottom: 8px;
}

.browser-chrome {
  background: #fafafa;
  min-height: 32px;
  padding: 4px 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid var(--border);
}

.browser-sku-select {
  max-width: 170px;
  flex-shrink: 0;
  height: 36px;
  min-height: 36px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: #fff;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  padding: 0 6px;
  cursor: pointer;
  outline: none;
  box-sizing: border-box;
}

.btn-open-anywhere {
  padding: 2px 6px;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 4px;
  color: var(--text-primary);
  font-weight: 600;
  flex-shrink: 0;
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
}
.btn-open-anywhere:hover {
  background: #f4f4f5;
  border-color: var(--border);
}

.dots { display: flex; gap: 4px; flex-shrink: 0; }
.dots i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.dots i.dot-red { background: #ef4444; }
.dots i.dot-yellow { background: #f59e0b; }
.dots i.dot-green { background: #10b981; }

.urlbar {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: #3f3f46;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 6px;
}
.urlbar span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

.store-frame {
  width: 100%;
  height: 310px;
  border: 0;
  background: #fff;
  display: block;
  overflow: hidden;
}

.agent-thinking-bar {
  background: #09090b;
  color: #fafafa;
  border-radius: var(--radius-control);
  padding: 8px 12px;
  font-size: 11.5px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: auto 0 0;
}

/* Outcome Banner */
.outcome-banner {
  border-radius: var(--radius-card);
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid;
  min-width: 0;
  margin-bottom: 10px;
}
.outcome-banner[data-state="idle"] { background: #fafafa; border-color: var(--border); }
.outcome-banner[data-state="captured"] { background: var(--status-success-bg); border-color: var(--status-success-border); }
.outcome-banner[data-state="voided"], .outcome-banner[data-state="blocked"] { background: var(--status-danger-bg); border-color: var(--status-danger-border); }
.outcome-banner h3 { margin: 0; font-size: 13.5px; font-weight: 700; color: var(--text-primary); }
.outcome-banner p { margin: 2px 0 0; font-size: 11.5px; color: var(--text-secondary); }
.outcome-icon { width: 32px; height: 32px; flex-shrink: 0; display: block; }

/* Price strip */
.deal-price-strip {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr;
  gap: 8px;
  background: #fafafa;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 8px 10px;
  text-align: center;
  margin-bottom: 10px;
}
.price-col b { display: block; font-size: 18px; font-weight: 800; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.price-col b.discount { color: var(--ink); }
.price-col span.savings-badge { display: inline-block; background: var(--status-success-bg); color: var(--status-success-ink); border: 1px solid var(--status-success-border); padding: 1px 6px; border-radius: 4px; font-size: 12px; font-weight: 800; }
.price-col .price-lbl { font-size: 11px; color: var(--text-muted); margin-top: 2px; display: block; }

/* Verification Pills Row — equal-width tags */
.deal-verif-pill-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 10px;
}
.verif-pill-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 11.5px;
  font-weight: 650;
  background: var(--status-success-bg);
  color: var(--status-success-ink);
  border: 1px solid var(--status-success-border);
  white-space: nowrap;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Button & Hover Contrast Rules (CRITICAL FIX) */
.btn {
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  height: 36px;
  min-height: 36px;
  padding: 0 14px;
  line-height: 1;
  border-radius: var(--radius-control);
  border: 1px solid #d4d4d8;
  background: #ffffff;
  color: #09090b !important;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
  white-space: nowrap;
  box-sizing: border-box;
  text-decoration: none;
}
.btn:hover {
  background: #f4f4f5 !important;
  color: #09090b !important;
  border-color: #a1a1aa !important;
}
.btn:active {
  transform: scale(0.97);
}

/* Primary Action Buttons — carbon black, never purple */
.btn-primary,
#btn-sniper-run,
#btn-checkout,
#btn-part-spend,
#btn-sim-pricedrop,
#btn-resolve,
#prompt-run {
  background: #09090b !important;
  color: #ffffff !important;
  border: 1px solid #09090b !important;
  font-weight: 650;
}
.btn-primary:hover,
#btn-sniper-run:hover,
#btn-checkout:hover,
#btn-part-spend:hover,
#btn-sim-pricedrop:hover,
#btn-resolve:hover,
#prompt-run:hover {
  background: #27272a !important;
  color: #ffffff !important;
  border-color: #27272a !important;
}

/* Ghost / Secondary Buttons */
.btn-ghost, button.ghost, .scn-btn, .ds-tab, .btn-secondary {
  border-color: #d4d4d8;
  color: #09090b !important;
  background: #ffffff;
}
.btn-ghost:hover, button.ghost:hover, .scn-btn:hover, .ds-tab:hover, .btn-secondary:hover {
  background: #f4f4f5 !important;
  color: #09090b !important;
  border-color: #a1a1aa !important;
}

/* .btn-sm keeps the identical 36px geometry for a uniform control grid */
.btn-sm { font-size: 13px; }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }

/* Text inputs + selects share the 36px control grid (chips and tags excluded) */
input[type="text"], input[type="number"], select {
  height: 36px;
  min-height: 36px;
  box-sizing: border-box;
  font-family: inherit;
}
.task-budget-pill input { height: auto; min-height: 0; }

/* Checkout actions */
.checkout-actions-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
  padding-top: 12px;
}
.btn-checkout-full {
  width: 100%;
  font-size: 13.5px;
  font-weight: 700;
}
.checkout-toggles {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-secondary);
}
.checkout-toggles label {
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

/* Legacy hover tooltips (kept for compatibility) */
.tooltip-wrap {
  position: relative;
  display: inline-flex;
}
.tooltip-wrap .tooltip-content {
  display: none;
  position: absolute;
  bottom: 125%;
  left: 50%;
  transform: translateX(-50%);
  background: #09090b;
  color: #ffffff;
  font-size: 11px;
  line-height: 1.4;
  padding: 6px 10px;
  border-radius: 6px;
  white-space: normal;
  width: max-content;
  max-width: 280px;
  z-index: 100;
  box-shadow: 0 4px 12px rgba(0,0,0,0.18);
  pointer-events: none;
}
.tooltip-wrap:hover .tooltip-content,
.tooltip-wrap:focus-within .tooltip-content {
  display: block;
}

/* Pure-CSS hover tooltips: crisp dark bubble, instant on hover */
[data-tooltip] {
  position: relative;
}
[data-tooltip]::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%) scale(0.97);
  transform-origin: bottom center;
  background: #09090b;
  color: #ffffff;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.35;
  padding: 6px 10px;
  border-radius: 4px;
  white-space: normal;
  width: max-content;
  max-width: 260px;
  text-align: center;
  z-index: 100;
  pointer-events: none;
  opacity: 0;
  transition: opacity 125ms ease-out, transform 125ms ease-out;
}
[data-tooltip]:hover::after,
[data-tooltip]:focus-visible::after {
  opacity: 1;
  transform: translateX(-50%) scale(1);
}
.info-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  cursor: help;
  flex-shrink: 0;
  border-radius: 4px;
}
.info-dot:hover { color: var(--ink); }

/* Pills & Chips */
.pill {
  display: inline-block;
  font-size: 11.5px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
  border: 1px solid transparent;
}
.pill-ok { background: var(--status-success-bg); color: var(--status-success-ink); border-color: var(--status-success-border); }
.pill-warn { background: var(--status-warn-bg); color: var(--status-warn-ink); border-color: var(--status-warn-border); }
.pill-bad { background: var(--status-danger-bg); color: var(--status-danger-ink); border-color: var(--status-danger-border); }
.pill-info { background: #f4f4f5; color: var(--text-secondary); border-color: var(--border); }

.hash-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: auto;
  min-height: 0;
  max-width: 100%;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 400;
  background: #f4f4f5;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 6px;
  cursor: pointer;
  min-width: 0;
  color: var(--text-primary);
  line-height: 1.4;
  white-space: nowrap;
}
.hash-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.hash-chip.mid span { direction: rtl; text-align: left; }
.fallback-table .hash-chip{max-width:260px}

.mono-scroll {
  overflow-x: auto;
  white-space: pre;
  font-family: var(--font-mono);
  font-size: 11.5px;
  background: #09090b;
  color: #e4e4e7;
  border-radius: var(--radius-control);
  padding: 8px 10px;
  max-width: 100%;
}

.status-line { font-size: 11.5px; color: var(--text-secondary); margin: 4px 0; }

/* Modals & Dialogs */
.modal-back {
  position: fixed;
  inset: 0;
  background: rgba(9, 9, 11, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
  padding: 20px;
}
.modal {
  background: #fff;
  border-radius: var(--radius-card);
  max-width: 640px;
  width: 100%;
  max-height: 85vh;
  overflow: auto;
  padding: 20px;
  color: var(--text-primary);
  border: 1px solid var(--border);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 14px;
}
.modal-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 14px;
}
.modal-tab-btn {
  padding: 8px 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  height: 36px;
  min-height: 36px;
  box-sizing: border-box;
}
.modal-tab-btn.active {
  color: var(--ink);
  border-bottom-color: var(--ink);
  font-weight: 700;
}

/* Toast */
#toast {
  position: fixed;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--ink);
  color: #fff;
  font-size: 12.5px;
  padding: 6px 14px;
  border-radius: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease-out;
  z-index: 80;
}
#toast.show { opacity: 1; }

#demo-toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--ink);
  color: #fff;
  border-radius: 6px;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 80;
  box-shadow: 0 8px 24px rgba(9, 9, 11, 0.25);
  max-width: min(680px, 92vw);
}
#demo-toast[hidden] { display: none; }
#demo-step {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  background: #3f3f46;
  border-radius: 4px;
  padding: 2px 6px;
  white-space: nowrap;
  flex-shrink: 0;
}
#demo-text { font-size: 12px; font-weight: 500; min-width: 0; }
#demo-progress { width: 80px; height: 5px; background: #3f3f46; border-radius: 3px; overflow: hidden; flex-shrink: 0; }
#demo-bar { display: block; height: 100%; width: 0; background: #059669; }
#demo-stop {
  background: transparent;
  border: 1px solid #52525b;
  color: #fff;
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

@keyframes tour-pulse { 0%, 100% { outline-color: #09090b; } 50% { outline-color: #a1a1aa; } }
.tour-highlight { outline: 3px solid #09090b !important; outline-offset: 3px; animation: tour-pulse 1.1s ease-in-out infinite; }

/* AG Grid & View 2 Desk styling */
#ag-live-disputes-grid.ag-theme-quartz, #ag-regression-benchmark-grid.ag-theme-quartz {
  --ag-font-family: var(--font-sans);
  --ag-font-size: 12.5px;
  --ag-row-height: 38px;
  --ag-header-height: 40px;
  --ag-header-background-color: var(--bg-muted);
  --ag-odd-row-background-color: #fff;
  --ag-selected-row-background-color: #e4e4e7;
  --ag-border-color: var(--border);
  --ag-header-foreground-color: var(--text-muted);
}
#ag-live-disputes-grid, #ag-regression-benchmark-grid {
  height:560px;
  width: 100%;
  overflow-x: auto;
  max-width: 100%;
}
#ag-live-disputes-grid,#ag-regression-benchmark-grid{overflow-x:auto}

.fallback-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.fallback-table th, .fallback-table td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
  white-space: nowrap;
}
.fallback-table th { font-size: 11px; color: var(--text-muted); font-weight: 600; background: var(--bg-muted); }
.fallback-table tbody tr { cursor: pointer; }
.fallback-table tbody tr:hover { background: var(--bg-muted); }
.fallback-table tbody tr[aria-selected="true"] { background: #e4e4e7; }

.desk-tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.seg { display: inline-flex; gap: 2px; background: #f4f4f5; padding: 2px; border-radius: var(--radius-control); }
.seg .btn { border: 0; background: transparent; padding: 0 10px; font-size: 11.5px; font-weight: 600; color: var(--text-secondary); border-radius: 4px; }
.seg .btn[aria-pressed="true"] { background: #09090b; color: #fff; }

.ag-shell { border: 1px solid var(--border); border-radius: var(--radius-card); background: #fff; overflow: hidden; }
.inspector { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1fr); gap: 12px; margin-top: 12px; align-items: start; }
.insp-col { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-card); padding: 12px; box-shadow: var(--shadow-card); }
.desk-grid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); gap: 12px; align-items: start; }
#view-desk[data-dataset="sync"] .desk-grid { grid-template-columns: minmax(0, 1fr); }

.diff-pill{display:inline-block;font-family:var(--font-mono);font-size:14px;font-weight:700;background:var(--status-danger-bg);color:var(--status-danger-ink);border:2px solid var(--status-danger-ink);border-radius:6px;padding:4px 10px;margin:2px 6px 2px 0;max-width:100%;font-variant-numeric:tabular-nums;white-space:normal;overflow-wrap:anywhere}
.wit-pill{display:inline-block;font-family:var(--font-mono);font-size:12.5px;font-weight:700;background:var(--status-success-bg);color:var(--status-success-ink);border:2px solid var(--status-success-ink);border-radius:6px;padding:4px 10px;margin:2px 6px 2px 0;max-width:100%;font-variant-numeric:tabular-nums;white-space:normal;overflow-wrap:anywhere}

.match { display: inline-block; font-family: var(--font-mono); font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 4px; }
.match.yes { background: var(--status-success-bg); color: var(--status-success-ink); }
.match.no { background: var(--status-danger-bg); color: var(--status-danger-ink); }

.kv { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; font-size: 11.5px; margin: 6px 0; }
.kv dt { color: var(--text-secondary); }
.kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }

.record-kv { display: grid; grid-template-columns: 95px minmax(0, 1fr); row-gap: 4px; column-gap: 8px; font-size: 11.5px; margin: 0; align-items: baseline; }
.record-kv dt { color: var(--text-secondary); }
.record-kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }

.prompt-bar { display: flex; gap: 6px; margin: 8px 0; }
.prompt-bar input { flex: 1; min-width: 0; font: inherit; font-size: 12px; padding: 0 8px; border: 1px solid var(--border-strong); border-radius: var(--radius-control); background: #fff; color: var(--text-primary); }
.preset-list { display: flex; flex-direction: column; gap: 4px; margin: 6px 0; }
.preset-list .btn { text-align: left; justify-content: flex-start; font-size: 11px; white-space: normal; }
canvas.chart { width: 100%; height: 220px; border: 1px solid var(--border); border-radius: var(--radius-control); background: #fff; }
#chart-table { overflow-x: auto; max-width: 100%; }
.matrix { border-collapse: collapse; font-size: 11.5px; margin-top: 6px; width: 100%; }
.matrix th, .matrix td { border: 1px solid var(--border); padding: 4px 6px; text-align: center; }
.matrix th { background: var(--bg-muted); font-weight: 600; }
.cell-good { background: var(--status-success-bg); font-weight: 700; }
.cell-bad { background: var(--status-danger-bg); color: var(--status-danger-ink); font-weight: 700; }

/* Mandate styles */
.mandate-strip { display: grid; grid-template-columns: 1.2fr 1fr 1fr 1fr; border-top: 1px solid var(--border); padding-top: 8px; margin-top: 4px; }
.mandate-strip > div { padding: 0 8px; text-align: center; min-width: 0; }
.mandate-strip > div:first-child { padding-left: 0; text-align: left; }
.mandate-strip > div:last-child { padding-right: 0; }
.mandate-strip > div + div { border-left: 1px solid var(--border); }
.mandate-strip b { display: block; color: var(--text-primary); }
.mandate-strip .big { font-size: 20px; font-weight: 750; }
.mandate-strip .mid { font-size: 13.5px; font-weight: 700; }
.mandate-strip span { font-size: 11px; color: var(--text-muted); }
.mandate-editor { border-top: 1px solid var(--border); margin-top: 10px; padding-top: 10px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.mandate-editor label { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--text-secondary); font-weight: 600; }
.mandate-editor input, .mandate-editor select { font: inherit; font-size: 12px; padding: 0 6px; border: 1px solid var(--border-strong); border-radius: var(--radius-control); background: #fff; color: var(--text-primary); }
.mandate-editor .row-end { grid-column: 1 / -1; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
#mandate-editor[hidden]{display:none}

.suff-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 10px; margin: 8px 0 0; padding-top: 8px; border-top: 1px solid var(--border); }
.suff { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 11px; color: var(--text-secondary); }
.suff b { font-weight: 600; white-space: nowrap; }
.suff .pill { font-size: 10px; padding: 1px 5px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Details Drawer */
details.drawer { border: 1px solid var(--border); border-radius: var(--radius-control); margin-top: 10px; background: #fff; }
details.drawer summary { cursor: pointer; padding: 8px 10px; font-weight: 600; font-size: 12px; list-style: none; display: flex; gap: 6px; align-items: center; }
details.drawer summary::-webkit-details-marker { display: none; }
details.drawer summary::before { content: "+"; font-weight: 700; color: var(--ink); flex-shrink: 0; }
details.drawer[open] summary::before { content: "–"; }
details.drawer .drawer-body { padding: 0 10px 10px; }

/* Fleet Grid — compact scannable watcher rows */
.fleet-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; margin-top: 10px; min-width: 0; max-width: 100%; }
.fleet-card { background: #ffffff; border: 1px solid var(--border); border-radius: var(--radius-card); padding: 10px 12px; box-shadow: var(--shadow-card); display: flex; flex-direction: column; gap: 6px; min-width: 0; overflow: hidden; }
.fleet-card:hover { border-color: var(--border-strong); }
.fleet-card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.fleet-card-title { font-size: 13px; font-weight: 700; color: var(--text-primary); margin: 0; font-family: var(--font-mono); white-space: nowrap; }
.fleet-card-sku { font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); }
.fleet-card-body { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11.5px; color: var(--text-secondary); flex-wrap: wrap; }
.fleet-card-footer { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-top: 4px; padding-top: 6px; border-top: 1px solid var(--border); flex-wrap: wrap; }

.form-input { width: 100%; font: inherit; font-size: 12px; padding: 0 8px; border: 1px solid var(--border-strong); border-radius: var(--radius-control); background: #fff; color: var(--text-primary); }
.form-input:focus { outline: 2px solid var(--ink); border-color: var(--ink); }

/* Ribbon */
.ribbon { display: grid; grid-template-columns: 200px minmax(0, 1fr) 16px minmax(0, 1.05fr) 16px minmax(0, 1.1fr); align-items: center; gap: 10px; background: #fff; border: 1px solid var(--border); border-radius: var(--radius-card); padding: 10px 14px; box-shadow: var(--shadow-card); }
.rb-title { border-right: 1px solid var(--border); padding-right: 10px; display: flex; flex-direction: column; justify-content: center; gap: 2px; min-width: 0; }
.rb-title b { display: block; font-size: 13px; font-weight: 700; color: var(--text-primary); }
.rb-title span { font-size: 11px; color: var(--text-muted); }
.ribbon-step { display: flex; gap: 8px; align-items: center; min-width: 0; background: transparent; border: 0; padding: 2px 0; }
.ribbon-step.on { color: var(--text-primary); }
.ribbon-step.bad { color: var(--status-danger-ink); }
.rb-num { font-family: var(--font-mono); font-weight: 700; font-size: 11.5px; background: #fff; color: var(--text-muted); border: 1px solid var(--border-strong); border-radius: 50%; min-width: 22px; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.ribbon-step.on .rb-num { background: var(--status-success-solid); border-color: var(--status-success-solid); color: #fff; font-size: 0; }
.ribbon-step.on .rb-num::after { content: '✓'; font-size: 12px; font-weight: 700; }
.ribbon-step.bad .rb-num { background: var(--status-danger-ink); border-color: var(--status-danger-ink); color: #fff; }
.ribbon-step b { font-size: 11.5px; font-weight: 700; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rb-badges { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
.ribbon-step .badge { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-secondary); background: #fff; border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; white-space: nowrap; }
#rb-ch3 { color: var(--status-success-ink); font-weight: 600; }
.rb-connector { height: 2px; background: var(--border-strong); border-radius: 2px; align-self: center; }
.rb-connector.done { background: var(--status-success-solid); }

footer.app { max-width: 1360px; margin: 0 auto; padding: 12px 24px 24px; color: var(--text-muted); font-size: 11px; text-align: center; }

/* Responsive adjustments */
@media (max-width: 768px) {
  .top-app-bar { padding: 0 12px; }
  .app-main { padding: 12px; }
  .ribbon, .desk-grid, .inspector { grid-template-columns: minmax(0, 1fr); }
  .mandate-strip { grid-template-columns: 1fr 1fr; }
  .mandate-editor { grid-template-columns: 1fr 1fr; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
@media print {
  body { background: #fff; }
  .top-app-bar, footer.app, #toast, .no-print { display: none !important; }
}

/* Dispute action stack buttons */
.action-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.action-stack button[disabled] {
  display: none !important;
}
.action-stack .btn {
  border-radius: 6px !important;
  font-size: 12.5px;
  font-weight: 600;
  padding: 0 12px;
  text-align: left;
  justify-content: flex-start;
}
#btn-resolve {
  background: #09090b !important;
  color: #ffffff !important;
  border: 1px solid #09090b !important;
}
#btn-resolve:hover {
  background: #27272a !important;
  color: #ffffff !important;
  border-color: #27272a !important;
}
#btn-sheet {
  background: #ffffff !important;
  color: #09090b !important;
  border: 1px solid #d4d4d8 !important;
}
#btn-sheet:hover {
  background: #f4f4f5 !important;
  color: #09090b !important;
}

${WALLET_CSS}
`;
}
