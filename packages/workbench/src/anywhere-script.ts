/**
 * GET /embed/veripact-anywhere.js — universal `@veripact` intent catcher.
 *
 * Shadow DOM keeps the pill and command bar off the host page's layout, so
 * `/store/*` iframes stay inside the 310px frame (scrollHeight <= 312).
 * Every listener takes an explicit parameter. A VP1 commitment shown in the
 * overlay proves a receipt hash existed at time T; it does not prove the
 * merchant page was true.
 */
export function renderAnywhereScript(): string {
  return `(function(){
"use strict";
if(window.__veripactAnywhere){return;}
window.__veripactAnywhere=true;
var HOST_STYLE="position:fixed;bottom:8px;right:8px;z-index:2147483647;pointer-events:none;";
var CSS=""
+".vp-root{font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#101828;}"
+"#vp-anywhere-pill{pointer-events:auto;display:inline-flex;align-items:center;height:26px;max-width:280px;padding:0 10px;border-radius:999px;border:1px solid #d0d5dd;background:#fff;color:#182230;font-size:11px;font-weight:650;line-height:26px;letter-spacing:-.01em;cursor:pointer;box-shadow:0 6px 16px rgba(16,24,40,.16);white-space:nowrap;}"
+"#vp-anywhere-pill:focus-visible{outline:2px solid #175cd3;outline-offset:2px;}"
+"#vp-anywhere-modal{display:none;position:fixed;right:8px;bottom:42px;width:min(420px,calc(100vw - 16px));max-height:min(280px,calc(100vh - 24px));overflow:auto;pointer-events:auto;background:#fff;color:#101828;border:1px solid #e4e7ec;border-radius:14px;box-shadow:0 18px 48px rgba(16,24,40,.22);padding:12px 12px 10px;box-sizing:border-box;}"
+"#vp-anywhere-modal.open{display:block;}"
+".vp-kicker{margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#175cd3;}"
+".vp-note{margin:0 0 8px;font-size:11px;line-height:1.35;color:#475467;}"
+"#vp-intent-input{width:100%;box-sizing:border-box;border:1px solid #d0d5dd;border-radius:8px;padding:7px 8px;font:12px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;color:#101828;background:#f8f9fb;}"
+".vp-actions{display:flex;gap:8px;margin-top:8px;}"
+"#vp-intent-run{flex:1;border:0;border-radius:8px;background:#182230;color:#fff;font-size:12px;font-weight:650;padding:8px 10px;cursor:pointer;}"
+"#vp-intent-run:disabled{opacity:.55;cursor:wait;}"
+"#vp-intent-close{border:1px solid #d0d5dd;background:#fff;border-radius:8px;padding:8px 10px;font-size:12px;cursor:pointer;}"
+"#vp-intent-results{margin-top:8px;display:flex;flex-direction:column;gap:4px;}"
+".vp-row{font-size:11px;line-height:1.35;color:#344054;}"
+".vp-pill{display:inline-block;border-radius:999px;padding:1px 7px;font-size:10px;font-weight:700;margin-right:4px;}"
+".vp-pill.bad{background:#fef3f2;color:#b42318;}"
+".vp-pill.good{background:#dcfce7;color:#15803d;}"
+".vp-commit{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10px;color:#15803d;word-break:break-all;}"
+".vp-status{margin:6px 0 0;font-size:11px;color:#475467;}";
function esc(s){
var t=s==null?"":String(s);
return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function money(n){
var v=Number(n);
if(!isFinite(v)){v=0;}
return v.toFixed(2);
}
function parseTarget(text){
var m=String(text||"").match(/\\$\\s*(\\d+(?:\\.\\d+)?)/);
if(!m){return 300;}
var n=Number(m[1]);
if(!isFinite(n)||n<1||n>10000){return null;}
return n;
}
function detectSku(){
var q="";
try{q=new URLSearchParams(window.location.search).get("sku")||"";}catch(err){q="";}
if(/^[A-Za-z0-9_-]{1,64}$/.test(q)){return q;}
var text="";
try{text=(document.body&&document.body.textContent)||"";}catch(err2){text="";}
var found=text.match(/\\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+){1,6}\\b/);
if(found&&/^[A-Za-z0-9_-]{1,64}$/.test(found[0])){return found[0];}
return "APEX-27-4K-IPS";
}
function intentLine(target){
return "@veripact snipe under $"+String(target)+" all-in · NEW · >=30d free returns";
}
var host=document.createElement("div");
host.id="veripact-anywhere-host";
host.setAttribute("style",HOST_STYLE);
var parentNode=document.body||document.documentElement;
parentNode.appendChild(host);
if(!host.attachShadow){return;}
var root=host.attachShadow({mode:"open"});
root.innerHTML="<style>"+CSS+"</style>"
+"<div class=\\"vp-root\\">"
+"<button type=\\"button\\" id=\\"vp-anywhere-pill\\">@veripact · Snipe &amp; Witness (Alt+V)</button>"
+"<div id=\\"vp-anywhere-modal\\" role=\\"dialog\\" aria-label=\\"VeriPact anywhere\\">"
+"<p class=\\"vp-kicker\\">@veripact anywhere</p>"
+"<p class=\\"vp-note\\">A VP1 commitment proves the receipt hash existed at time T. It does not prove the merchant page was true.</p>"
+"<input id=\\"vp-intent-input\\" type=\\"text\\" autocomplete=\\"off\\" value=\\""+esc(intentLine(300))+"\\">"
+"<div class=\\"vp-actions\\"><button type=\\"button\\" id=\\"vp-intent-run\\">&#127919; Hunt Vouchers &amp; Auto-Buy via PayPal Partition</button>"
+"<button type=\\"button\\" id=\\"vp-intent-close\\">Close</button></div>"
+"<div id=\\"vp-intent-results\\"></div>"
+"<p class=\\"vp-status\\" id=\\"vp-intent-status\\"></p>"
+"</div></div>";
var modal=root.getElementById("vp-anywhere-modal");
var input=root.getElementById("vp-intent-input");
var runBtn=root.getElementById("vp-intent-run");
var statusEl=root.getElementById("vp-intent-status");
var resultsEl=root.getElementById("vp-intent-results");
var pill=root.getElementById("vp-anywhere-pill");
var inIframe=false;
try{inIframe=window.self!==window.top;}catch(errIf){inIframe=true;}
if(inIframe&&pill){pill.style.display="none";}
function isOpen(){return modal.className.indexOf("open")>=0;}
function openBar(target,raw){
var next=typeof target==="number"?target:parseTarget(raw||input.value);
if(raw&&String(raw).toLowerCase().indexOf("@veripact")>=0){input.value=String(raw);}
else if(typeof next==="number"){input.value=intentLine(next);}
modal.className="open";
try{input.focus();}catch(err){}
}
function closeBar(){
modal.className="";
if(inIframe&&pill){pill.style.display="none";}
}
function toggleBar(){
if(isOpen()){closeBar();}
else{
if(inIframe&&pill){pill.style.display="inline-flex";}
openBar(parseTarget(input.value),"");
}
}
function paintReport(data){
var rows=data&&data.evaluations?data.evaluations:[];
var html="";
var i;
for(i=0;i<rows.length;i++){
var row=rows[i]||{};
var won=row.verdict==="VERIFIED_VOUCHER_CAPTURED";
html+="<div class=\\"vp-row\\">";
if(won){
html+="<span class=\\"vp-pill good\\">"+esc(row.voucherCode||"PAYPAL50")+"</span>";
html+="<span class=\\"vp-pill good\\">-$"+esc(money(row.voucherDiscountUsd))+"</span>";
html+="<span class=\\"vp-pill good\\">$"+esc(money(row.allInTotalUsd))+"</span>";
html+="<span class=\\"vp-commit\\">"+esc(row.commitment||"")+"</span>";
}else{
html+="<span class=\\"vp-pill bad\\">"+esc(row.verdict||"REJECTED")+"</span>";
html+="<span class=\\"vp-pill bad\\">"+esc(row.merchantName||"trap")+"</span>";
}
html+="</div>";
}
resultsEl.innerHTML=html;
var outcome=data&&data.outcome?data.outcome:"done";
statusEl.textContent=outcome+" · saved $"+money(data&&data.totalSavedUsd);
}
function publish(data){
try{
window.parent.postMessage({type:"VERIPACT_SNIPER_COMPLETED",report:data},window.location.origin);
}catch(err){}
}
function runHunt(){
var sku=detectSku();
var target=parseTarget(input.value);
if(typeof target!=="number"){
statusEl.textContent="targetMaxAllInUsd must be between 1 and 10000";
resultsEl.innerHTML="";
return;
}
runBtn.disabled=true;
statusEl.textContent="Hunting "+sku+" under $"+money(target)+"…";
resultsEl.innerHTML="";
fetch("/api/wallet/sniper",{
method:"POST",
headers:{"content-type":"application/json"},
body:JSON.stringify({sku:sku,targetMaxAllInUsd:target})
}).then(function(res){
return res.json().then(function(data){
if(!res.ok){
var msg=data&&data.error?String(data.error):"sniper failed";
throw new Error(msg);
}
return data;
});
}).then(function(data){
paintReport(data);
publish(data);
}).catch(function(err){
statusEl.textContent=err&&err.message?err.message:"sniper failed";
resultsEl.innerHTML="<div class=\\"vp-row\\"><span class=\\"vp-pill bad\\">"+esc(statusEl.textContent)+"</span></div>";
}).then(function(){runBtn.disabled=false;});
}
root.getElementById("vp-anywhere-pill").addEventListener("click",function(e){
if(e&&e.preventDefault){e.preventDefault();}
toggleBar();
});
root.getElementById("vp-intent-close").addEventListener("click",function(e){
if(e&&e.preventDefault){e.preventDefault();}
closeBar();
});
runBtn.addEventListener("click",function(e){
if(e&&e.preventDefault){e.preventDefault();}
runHunt();
});
input.addEventListener("keydown",function(e){
if(e&&e.key==="Enter"){
if(e.preventDefault){e.preventDefault();}
runHunt();
}
});
document.addEventListener("input",function(e){
var node=e&&e.target;
if(!node){return;}
var tag=node.tagName;
if(tag!=="INPUT"&&tag!=="TEXTAREA"){return;}
if(node===input){return;}
var val=node.value||"";
if(String(val).toLowerCase().indexOf("@veripact")<0){return;}
openBar(parseTarget(val),val);
},true);
document.addEventListener("keydown",function(e){
if(!e){return;}
var key=String(e.key||"").toLowerCase();
var alt=e.altKey&&!e.ctrlKey&&!e.metaKey&&key==="v";
var chord=e.ctrlKey&&e.shiftKey&&key==="v";
if(!alt&&!chord){return;}
if(e.preventDefault){e.preventDefault();}
toggleBar();
});
window.addEventListener("message",function(e){
if(!e||!e.data){return;}
if(e.data.type==="VERIPACT_TOGGLE_ANYWHERE"){
toggleBar();
}
});
})();
`;
}
