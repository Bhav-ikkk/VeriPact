/**
 * @veripact/workbench deterministic sandbox buyer-approval popup.
 *
 * Replay twin of PayPal's `checkoutnow` approval page: the buyer reviews
 * the witnessed order (item, callback breakdown, bound `custom_id`) and
 * approves the hold with one click. Unmissably labeled as a zero-key
 * simulation — it never touches real PayPal and never collects input.
 */
import type { ScenarioName } from '@veripact/sdk';

/** Data the approval page renders (all server-read, escaped at render). */
export interface ApprovalPageData {
  orderId: string;
  orderStatus: string;
  description: string;
  itemTotalUsd: number;
  shippingUsd: number;
  taxUsd: number;
  finalTotalUsd: number;
  customId: string;
  transportMode: string;
  scenario: ScenarioName | 'custom';
  alreadyApproved: boolean;
  error?: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const money = (n: number): string => `$${n.toFixed(2)}`;

/** Render the buyer-approval popup (or its error/approved states). */
export function renderApprovalPage(d: ApprovalPageData): string {
  // `<`-free JSON so a hostile token can never break out of the script block.
  const orderIdJs = JSON.stringify(d.orderId).replace(/</g, '\\u003c');
  const failed = d.error !== undefined && d.error !== '';
  const done = d.alreadyApproved && !failed;
  const body = failed
    ? `<div class="banner bad"><b>Cannot load order.</b> ${esc(d.error ?? '')}</div>`
    : `<p class="crumb">${esc(d.description)}</p>
<dl class="kv"><dt>Order</dt><dd class="mono">${esc(d.orderId)}</dd>
<dt>Status</dt><dd>${esc(d.orderStatus)}</dd>
<dt>Item total</dt><dd class="num">${money(d.itemTotalUsd)}</dd>
<dt>Shipping</dt><dd class="num">${money(d.shippingUsd)}</dd>
<dt>Tax</dt><dd class="num">${money(d.taxUsd)}</dd>
<dt><b>Final total</b></dt><dd class="num"><b>${money(d.finalTotalUsd)}</b></dd>
<dt>Commitment</dt><dd class="mono wrap">${esc(d.customId)}</dd>
<dt>Mode</dt><dd class="mono">${esc(d.transportMode)}</dd></dl>
<div id="act">${done ? '<div class="banner ok"><b>Already approved.</b> Return to the workbench — it will finalize automatically.</div>' : '<button type="button" id="approve-btn">Approve Order Hold as Buyer</button><p class="hint" id="approve-hint"></p>'}</div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VeriPact Sandbox Buyer Approval — ${esc(d.orderId)}</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;background:#eef2f7;color:#14202e}
.wrap{max-width:560px;margin:0 auto;padding:26px 18px 60px}
.sim{font-size:12px;font-weight:700;letter-spacing:.02em;color:#8a5a00;background:#fcefd2;border:1px solid #ecd9a8;border-radius:10px;padding:8px 12px;margin-bottom:12px}
h1{font-size:20px;margin:0 0 4px}
.card{background:#fff;border:1px solid #dfe6f0;border-radius:16px;padding:18px 20px}
.crumb{font-size:13px;color:#44536a;margin:0 0 10px}
.kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 14px;font-size:14px;margin:0}
.kv dt{color:#44536a}.kv dd{margin:0;min-width:0}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px;font-variant-numeric:tabular-nums}
.num{font-variant-numeric:tabular-nums}
.wrap-all{overflow-wrap:anywhere}
#approve-btn{font-size:15px;font-weight:700;color:#fff;background:#0e6efd;border:0;border-radius:10px;padding:13px 22px;cursor:pointer;margin-top:14px;min-height:44px;width:100%}
#approve-btn:disabled{opacity:.6;cursor:wait}
.hint{font-size:13px;color:#44536a;min-height:20px}
.banner{border-radius:10px;padding:12px 14px;font-size:14px;margin-top:12px}
.banner.ok{background:#e2f4eb;color:#1f8a70}
.banner.bad{background:#fbe3e8;color:#c81e3a}
.foot{margin-top:16px;font-size:12px;color:#44536a}
:focus-visible{outline:2px solid #0e6efd;outline-offset:2px}
@media (prefers-color-scheme:dark){body{background:#0f141b;color:#e8eef6}.card{background:#161d27;border-color:#2a3444}.crumb,.hint,.foot{color:#9aa7bb}}
</style></head>
<body><main class="wrap">
<div class="sim">VeriPact Deterministic Sandbox Buyer Approval — Zero-Key Mode. Simulation only: no real PayPal, no real money, no login.</div>
<h1>Approve this order hold?</h1>
<div class="card">${body}</div>
<p class="foot">Approving notifies the workbench window and marks the replay order APPROVED so it can be authorized. Live PayPal orders approve at sandbox.paypal.com instead.</p>
</main>
<script>
'use strict';
(function(){
var btn=document.getElementById('approve-btn');
if(!btn)return;
btn.addEventListener('click',function(){
btn.disabled=true;
var hint=document.getElementById('approve-hint');
hint.textContent='Approving…';
fetch('/api/sandbox/approve-order',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({orderId:${orderIdJs}})}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j;});}).then(function(){
document.getElementById('act').innerHTML='<div class="banner ok"><b>Approved! Return to the workbench.</b> Finalize there to authorize and capture.</div>';
try{if(window.opener){var targetOrigin=window.location.origin&&window.location.origin!=='null'?window.location.origin:'*';window.opener.postMessage({type:'VERIPACT_ORDER_APPROVED',orderId:${orderIdJs}},targetOrigin);}}catch(e){}
setTimeout(function(){window.close();},1200);
}).catch(function(e){hint.textContent=e.message;btn.disabled=false;});
});
})();
</script>
</body></html>`;
}
