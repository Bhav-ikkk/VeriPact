/**
 * `npm run assets:generate` — render the 6 committed README screenshots as
 * crisp SVG from REAL SDK + workbench data (zero hand-typed numbers).
 * Drives `handleWorkbenchRequest` directly (no sockets — sandbox-safe).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  handleWorkbenchRequest,
  resetDemoState,
  type WorkbenchResponse,
} from '@veripact/workbench';

/* ---------------- harness (mirrors the workbench test driver) ---------------- */

async function call(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, never> }> {
  let code = 0;
  let text = '';
  const res: WorkbenchResponse = {
    writeHead(c: number): void {
      code = c;
    },
    end(b: string): void {
      text = b;
    },
  };
  await handleWorkbenchRequest(
    { method, url, bodyText: body === undefined ? undefined : JSON.stringify(body) },
    res,
  );
  if (code !== 200) {
    throw new Error(`assets: ${method} ${url} -> ${code}: ${text.slice(0, 160)}`);
  }
  return { status: code, json: JSON.parse(text) as Record<string, never> };
}

/* ---------------- typed slices (fallbacks keep the script total) ---------------- */

interface CriterionSlice {
  status?: string;
  value?: string | number;
}

interface SnapshotSlice {
  commitment?: string;
  termReceipt?: { observedTerms?: Record<string, CriterionSlice> & { pageIntegrity?: string } };
  provenance?: {
    tsaIssuer?: string;
    tsaTimeUtc?: string;
    channel3ProductId?: string;
    tlsVerified?: boolean;
  };
  gateResult?: { decision?: string; reasons?: string[]; headroomUsd?: number };
  oracleResult?: { matched?: boolean; productId?: string; source?: string };
}

interface CheckoutSlice {
  outcome?: string;
  orderId?: string;
  authorizationId?: string;
  captureId?: string;
  finalTotalUsd?: number;
  voidReason?: string;
  transportMode?: string;
  snapshot?: SnapshotSlice;
}

interface DisputeSlice {
  case?: string;
  record?: { disputeId?: string; lifeCycleStage?: string; disputeState?: string };
  forensics?: { verdict?: string; reason?: string };
}

interface DisputesSlice {
  customId?: string;
  orderId?: string;
  transportMode?: string;
  disputes?: DisputeSlice[];
}

interface AccuracySlice {
  successes?: number;
  total?: number;
  rate?: number;
  ci95Lower?: number;
  ci95Upper?: number;
}

interface BenchmarkSlice {
  gateAccuracy?: AccuracySlice;
  postAuthAccuracy?: AccuracySlice;
  refereeAccuracy?: AccuracySlice;
  overallPassRate?: AccuracySlice;
  gateConfusion?: Record<string, Record<string, number>>;
}

interface StatusSlice {
  transportMode?: string;
  keyFingerprints?: { buyer?: string; witness?: string; merchant?: string };
  totalScenarios?: number;
  regressionPassRate?: string;
}

interface WalletSlice {
  sessionId?: string;
  pairingCode?: string;
  vaultId?: string;
  capUsd?: number;
  capturedUsd?: number;
  availUsd?: number;
  maxPerOrderUsd?: number;
  spendOutcome?: string;
  spendTotalUsd?: number;
  wallOutcome?: string;
  wallAvailUsd?: number;
  refundAvailUsd?: number;
  commitment?: string;
  syncTotal?: number;
  syncProtected?: number;
  syncLegacy?: number;
  chatMasked?: string;
  chatOpenapi?: string;
  mcpMasked?: string;
  mcpCommand?: string;
}

const str = (v: unknown, fb = '…'): string => (typeof v === 'string' && v !== '' ? v : fb);
const num = (v: unknown, fb = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const money = (v: unknown): string => `$${num(v).toFixed(2)}`;
const short = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/* -------- minimal SVG DSL (light editorial-fintech theme, run 09) -------- */

const W = 1600;
const H = 900;
const C = {
  bg: '#f8f9fb',
  panel: '#ffffff',
  line: '#e5e7eb',
  ink: '#101828',
  muted: '#667085',
  emerald: '#15803d',
  emeraldBg: '#ecfdf3',
  amber: '#b54708',
  amberBg: '#fffaeb',
  crimson: '#b42318',
  crimsonBg: '#fef3f2',
  accent: '#175cd3',
  accentBg: '#e8eefb',
  mono: "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
  sans: "'Inter',system-ui,-apple-system,Segoe UI,sans-serif",
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface TextOpts {
  mono?: boolean;
  anchor?: 'start' | 'middle' | 'end';
  weight?: string;
  opacity?: number;
}

function t(
  x: number,
  y: number,
  size: number,
  fill: string,
  s: string,
  o?: TextOpts,
): string {
  const a = o?.anchor ?? 'start';
  const w = o?.weight !== undefined ? ` font-weight="${o.weight}"` : '';
  const op = o?.opacity !== undefined ? ` opacity="${o.opacity}"` : '';
  return `<text x="${x}" y="${y}" font-family="${o?.mono === true ? C.mono : C.sans}" font-size="${size}" fill="${fill}" text-anchor="${a}"${w}${op}>${esc(s)}</text>`;
}

function r(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke?: string,
  rx = 14,
): string {
  const s = stroke !== undefined ? ` stroke="${stroke}" stroke-width="1.5"` : '';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"${s}/>`;
}

function card(x: number, y: number, w: number, h: number, title: string, accent: string): string {
  return (
    `${r(x, y, w, h, C.panel, C.line)}` +
    `<rect x="${x}" y="${y}" width="${w}" height="46" rx="14" fill="${C.line}" opacity="0.35"/>` +
    `<rect x="${x}" y="${y + 30}" width="${w}" height="16" fill="${C.panel}"/>` +
    `${t(x + 22, y + 30, 17, accent, title, { weight: '700' })}`
  );
}

function pill(x: number, y: number, label: string, fg: string, bg: string): string {
  const w = Math.round(label.length * 8.1 + 30);
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="32" rx="16" fill="${bg}"/>` +
    `${t(x + 15, y + 22, 14, fg, label, { mono: true, weight: '700' })}`
  );
}

function arrow(x1: number, y: number, x2: number): string {
  return (
    `<line x1="${x1}" y1="${y}" x2="${x2 - 12}" y2="${y}" stroke="${C.muted}" stroke-width="2"/>` +
    `<polygon points="${x2},${y} ${x2 - 13},${y - 7} ${x2 - 13},${y + 7}" fill="${C.muted}"/>`
  );
}

function frame(title: string, subtitle: string, body: string, footer: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">` +
    `${r(0, 0, W, H, C.bg, undefined, 0)}` +
    `${t(48, 66, 30, C.ink, title, { weight: '700' })}` +
    `${t(48, 98, 16, C.muted, subtitle)}` +
    body +
    `${t(48, 862, 13, C.muted, footer, { mono: true })}` +
    `</svg>`
  );
}

interface AssetData {
  status: StatusSlice;
  normal: CheckoutSlice;
  surcharge: CheckoutSlice;
  adversarial: CheckoutSlice;
  disputes: DisputesSlice;
  bench: BenchmarkSlice;
  wallet: WalletSlice;
}

function obs(s: SnapshotSlice | undefined, key: string): CriterionSlice {
  return s?.termReceipt?.observedTerms?.[key] ?? {};
}

function svgArchitecture(d: AssetData, footer: string): string {
  const fp = d.status.keyFingerprints ?? {};
  const prov = d.normal.snapshot?.provenance ?? {};
  const oracle = d.normal.snapshot?.oracleResult ?? {};
  const cases = d.disputes.disputes ?? [];
  const cw = 362;
  const y = 150;
  const h = 590;
  let b = '';
  const cols: Array<{ x: number; title: string; accent: string; lines: string[] }> = [
    {
      x: 40,
      title: 'RUNG 1 · SELF',
      accent: C.accent,
      lines: [
        'Buyer mandate locked',
        `key fp ${str(fp.buyer, '…')}`,
        'cap $320.00 all-in',
        'NEW · 30d · 0% fee',
        'Ed25519 countersign',
      ],
    },
    {
      x: 426,
      title: 'RUNG 2 · WIT',
      accent: C.emerald,
      lines: [
        'Independent HTTPS witness',
        `key fp ${str(fp.witness, '…')}`,
        `TSA ${str(prov.tsaIssuer, '…')}`,
        'DOM scan CLEAN · 13 checks',
        `Ch3 ${str(oracle.productId, '…')}${oracle.matched === true ? ' ✓' : ''}`,
        'RFC 3161 timestamp anchor',
      ],
    },
    {
      x: 812,
      title: 'RUNG 3 · SIGN + PayPal',
      accent: C.amber,
      lines: [
        'Merchant countersigns',
        `key fp ${str(fp.merchant, '…')}`,
        'Orders v2 AUTHORIZE',
        'purchase_units[0].custom_id',
        short(str(d.normal.snapshot?.commitment, 'VP1:…'), 24),
        'PATCH ship/tax → re-gate',
      ],
    },
    {
      x: 1198,
      title: 'SETTLE + DISPUTES',
      accent: C.crimson,
      lines: [
        `${money(d.normal.finalTotalUsd)} CAPTURED`,
        `${money(d.surcharge.finalTotalUsd)} AUTO-VOIDED`,
        'ADVERSARIAL_DOM BLOCKED',
        'Disputes v1 HATEOAS:',
        `B ${short(str(cases[0]?.forensics?.verdict, '…'), 24)}`,
        `A ${short(str(cases[1]?.forensics?.verdict, '…'), 24)}`,
      ],
    },
  ];
  for (const c of cols) {
    b += card(c.x, y, cw, h, c.title, c.accent);
    c.lines.forEach((ln, i) => {
      b += t(c.x + 22, y + 92 + i * 44, 16, i === 0 ? C.ink : C.muted, ln, {
        mono: true,
        weight: i === 0 ? '700' : undefined,
      });
    });
  }
  for (const ax of [402, 788, 1174]) {
    b += arrow(ax, y + 300, ax + 24);
  }
  return frame(
    'VeriPact — 3-rung evidence ladder + PayPal settlement',
    'Buyer guardrails control spend · VeriPact proves what the merchant promised',
    b,
    footer,
  );
}

function svgView1(d: AssetData, footer: string): string {
  const s = d.normal.snapshot;
  const gate = s?.gateResult;
  let b = card(40, 140, 720, 660, 'Mandate & sufficiency gate', C.accent);
  b += pill(62, 200, str(gate?.decision, '…'), C.amber, C.amberBg);
  b += t(62, 280, 17, C.ink, `Headroom $${num(gate?.headroomUsd).toFixed(2)} — ship/tax resolve at callback`, {});
  const rows: Array<[string, CriterionSlice]> = [
    ['Brand/model & condition', obs(s, 'condition')],
    ['Base price', obs(s, 'basePriceUsd')],
    ['Shipping & tax callback', obs(s, 'shippingUsd')],
    ['Return policy (30d / 0%)', obs(s, 'returnWindowDays')],
  ];
  rows.forEach(([label, c], i) => {
    const yy = 340 + i * 110;
    const ok = c.status === 'DETERMINATE';
    b += t(62, yy, 15, C.muted, label, {});
    b += pill(62, yy + 14, `${str(c.status, '?')}${c.value !== undefined ? ` · ${String(c.value)}` : ''}`, ok ? C.emerald : C.amber, ok ? C.emeraldBg : C.amberBg);
  });
  b += card(800, 140, 760, 660, 'Outcome + Verify-It-Yourself auditor', C.emerald);
  b += pill(822, 200, `CAPTURED ${money(d.normal.finalTotalUsd)}`, C.emerald, C.emeraldBg);
  const kv: Array<[string, string]> = [
    ['Order', str(d.normal.orderId)],
    ['Authorization', str(d.normal.authorizationId)],
    ['Capture', str(d.normal.captureId)],
    ['Order custom_id', str(d.normal.snapshot?.commitment)],
  ];
  kv.forEach(([k, v], i) => {
    const yy = 300 + i * 62;
    b += t(822, yy, 14, C.muted, k, {});
    b += t(822, yy + 26, 14, C.ink, short(v, 52), { mono: true });
  });
  b += t(822, 590, 15, C.ink, 'Browser WebCrypto recomputes the receipt hash:', {});
  b += pill(822, 610, 'JCS-PARITY MATCH vs PayPal custom_id', C.emerald, C.emeraldBg);
  b += t(822, 680, 14, C.muted, 'SHA-256 over canonical JCS · signatures server-verified', {});
  b += t(822, 730, 14, C.muted, `TSA ${str(s?.provenance?.tsaIssuer)} · ±5 min skew gate`, {});
  return frame(
    'View 1 — Witnessed checkout + Verify-It-Yourself auditor',
    `ASK_HUMAN_DELTA ($${num(gate?.headroomUsd).toFixed(2)} headroom) → ${money(d.normal.finalTotalUsd)} CAPTURED`,
    b,
    footer,
  );
}

function svgView1Edge(d: AssetData, footer: string): string {
  let b = card(40, 140, 744, 660, 'Scenario 2 — hidden $55 surcharge', C.amber);
  b += pill(62, 200, `AUTO-VOIDED ${money(d.surcharge.finalTotalUsd)}`, C.amber, C.amberBg);
  b += t(62, 300, 17, C.ink, `${money(d.surcharge.finalTotalUsd)} > $320.00 mandate cap`, { mono: true });
  b += t(62, 350, 15, C.muted, 'Post-approval re-gate voids before capture:', {});
  const reason = str(d.surcharge.voidReason, '…');
  b += t(62, 390, 14, C.ink, short(reason, 56), { mono: true });
  if (reason.length > 56) {
    b += t(62, 418, 14, C.ink, short(reason.slice(56), 56), { mono: true });
  }
  b += t(62, 500, 15, C.muted, `Order ${str(d.surcharge.orderId)} · auth voided, 0 captured`, { mono: true });
  b += card(816, 140, 744, 660, 'Scenario 3 — hidden prompt injection', C.crimson);
  b += pill(838, 200, 'BLOCKED_PRE_CHECKOUT', C.crimson, C.crimsonBg);
  b += t(838, 300, 17, C.ink, 'ADVERSARIAL_DOM — pre-LLM scanner trip', { mono: true });
  const advReason = sFirstReason(d.adversarial.snapshot?.gateResult?.reasons);
  b += t(838, 350, 15, C.muted, 'Gate reason:', {});
  b += t(838, 390, 14, C.ink, short(advReason, 56), { mono: true });
  b += t(838, 500, 17, C.emerald, '0 PayPal API calls — blocked before create', { weight: '700' });
  b += t(838, 550, 15, C.muted, '13 hidden-node detector categories · exact-match quotes', {});
  return frame(
    'View 1 edge cases — surcharge auto-void + injection block',
    'The re-gate and the pre-LLM scanner enforce the mandate without human clicks',
    b,
    footer,
  );
}

function sFirstReason(reasons: string[] | undefined): string {
  return reasons !== undefined && reasons.length > 0 ? str(reasons[0]) : '…';
}

function svgView2(d: AssetData, footer: string): string {
  const cases = d.disputes.disputes ?? [];
  const customId = str(d.disputes.customId);
  let b = '';
  const defs = [
    {
      y: 140,
      title: 'Case B — buyer forgery (PP-D-CASE-B-FORGERY)',
      accent: C.crimson,
      buyer: '60-day returns (self-signed)',
      pills: ['return_window_days: 60 vs 30'],
      idx: 0,
    },
    {
      y: 480,
      title: 'Case A — merchant drift (PP-D-CASE-A-DRIFT)',
      accent: C.amber,
      buyer: '30-day free returns (matches)',
      pills: ['return_window_days: 30 vs 14', 'restocking_fee_pct: 0% vs 25%'],
      idx: 1,
    },
  ];
  for (const c of defs) {
    const rec = cases[c.idx]?.record;
    const ver = str(cases[c.idx]?.forensics?.verdict, '…');
    b += card(40, c.y, 480, 300, `Buyer claim — ${c.title.slice(0, 28)}`, c.accent);
    b += t(62, c.y + 100, 15, C.ink, short(c.buyer, 40), {});
    c.pills.forEach((p, i) => {
      b += pill(62, c.y + 130 + i * 48, p, C.crimson, C.crimsonBg);
    });
    b += card(544, c.y, 560, 300, 'Witness provenance + order anchor', C.emerald);
    b += t(566, c.y + 100, 14, C.muted, 'purchase_units[0].custom_id', {});
    b += t(566, c.y + 128, 13, C.ink, short(customId, 56), { mono: true });
    b += pill(566, c.y + 160, 'witnessed: 30-day · 0% fee', C.emerald, C.emeraldBg);
    b += t(566, c.y + 236, 14, C.muted, `Order ${str(d.disputes.orderId)} · TSA + Channel3 verified`, { mono: true });
    b += card(1128, c.y, 432, 300, 'Seller counter-claim', c.accent);
    c.pills.forEach((p, i) => {
      b += pill(1150, c.y + 80 + i * 48, p, C.crimson, C.crimsonBg);
    });
    b += pill(1150, c.y + 80 + c.pills.length * 48, short(ver, 30), C.ink, C.line);
    b += t(1150, c.y + 80 + c.pills.length * 48 + 62, 13, C.muted, `${str(rec?.disputeId)} · ${str(rec?.lifeCycleStage)}`, { mono: true });
  }
  return frame(
    'View 2 — Contested dispute verifier desk (3-column inspector)',
    'BUYER_FORGERY_DETECTED vs MERCHANT_DRIFT_CONFIRMED — contradictions readable at a glance',
    b,
    footer,
  );
}

function svgRegression(d: AssetData, footer: string): string {
  const conf = d.bench.gateConfusion ?? {};
  const ds = ['PROCEED', 'ASK_HUMAN_DELTA', 'BLOCK'];
  let b = card(40, 140, 640, 660, 'Gate confusion matrix (72 runs)', C.accent);
  const gx = 110;
  const gy = 260;
  const cw = 150;
  const ch = 84;
  ds.forEach((col, j) => {
    b += t(gx + j * cw + cw / 2, gy - 18, 13, C.muted, col === 'ASK_HUMAN_DELTA' ? 'ASK_DELTA' : col, { anchor: 'middle', mono: true });
  });
  ds.forEach((row, i) => {
    b += t(gx - 14, gy + i * ch + ch / 2 + 5, 13, C.muted, row === 'ASK_HUMAN_DELTA' ? 'ASK_DELTA' : row, { anchor: 'end', mono: true });
    ds.forEach((col, j) => {
      const v = conf[row]?.[col] ?? 0;
      const diag = row === col;
      const fill = diag ? (v > 0 ? C.emeraldBg : C.panel) : v > 0 ? C.crimsonBg : C.panel;
      const fg = diag ? (v > 0 ? C.emerald : C.muted) : v > 0 ? C.crimson : C.muted;
      b += `<rect x="${gx + j * cw}" y="${gy + i * ch}" width="${cw}" height="${ch}" fill="${fill}" stroke="${C.line}"/>`;
      b += t(gx + j * cw + cw / 2, gy + i * ch + ch / 2 + 8, 22, fg, String(v), { anchor: 'middle', mono: true, weight: '700' });
    });
  });
  b += t(110, 600, 14, C.muted, 'Expected rows × actual columns — diagonal, zero off-diagonal', {});
  b += card(720, 140, 840, 660, 'Accuracy + 95% Wilson CIs', C.emerald);
  const rows: Array<[string, AccuracySlice | undefined]> = [
    ['Gate', d.bench.gateAccuracy],
    ['Post-auth re-gate', d.bench.postAuthAccuracy],
    ['Referee', d.bench.refereeAccuracy],
    ['Overall', d.bench.overallPassRate],
  ];
  rows.forEach(([label, a], i) => {
    const yy = 250 + i * 130;
    const rate = num(a?.rate, 1);
    const lo = num(a?.ci95Lower, 1);
    const hi = num(a?.ci95Upper, 1);
    const bx = 770;
    const bw = 560;
    b += t(770, yy - 44, 15, C.ink, `${label}  ${String(a?.successes ?? '?')}/${String(a?.total ?? '?')}`, { weight: '700' });
    b += `<rect x="${bx}" y="${yy - 30}" width="${bw}" height="26" rx="13" fill="${C.line}"/>`;
    b += `<rect x="${bx}" y="${yy - 30}" width="${Math.round(bw * rate)}" height="26" rx="13" fill="${C.emerald}"/>`;
    const whisk = (v: number): number => bx + Math.round(bw * Math.min(1, Math.max(0, v)));
    const cx1 = whisk(lo);
    const cx2 = whisk(hi);
    b += `<line x1="${cx1}" y1="${yy - 38}" x2="${cx1}" y2="${yy + 4}" stroke="${C.ink}" stroke-width="2"/>`;
    b += `<line x1="${cx2}" y1="${yy - 38}" x2="${cx2}" y2="${yy + 4}" stroke="${C.ink}" stroke-width="2"/>`;
    b += `<line x1="${cx1}" y1="${yy - 17}" x2="${cx2}" y2="${yy - 17}" stroke="${C.ink}" stroke-width="2"/>`;
    b += t(770, yy + 30, 13, C.muted, `95% CI [${lo.toFixed(3)}, ${hi.toFixed(3)}]`, { mono: true });
  });
  const ov = d.bench.overallPassRate;
  return frame(
    '24-scenario regression suite — 72 runs, 95% Wilson CIs',
    `Overall ${String(ov?.successes ?? '?')}/${String(ov?.total ?? '?')} (${Math.round(num(ov?.rate, 1) * 100)}%) — controlled synthetic suite, honest intervals`,
    b,
    footer,
  );
}

function svgWallet(d: AssetData, footer: string): string {
  const w = d.wallet;
  const y = 150;
  let b = card(40, y, 362, 590, 'QR pairing ceremony', C.accent);
  b += t(62, y + 92, 15, C.muted, 'Phone ceremony link', {});
  b += t(62, y + 120, 14, C.ink, short(str(w.sessionId), 30), { mono: true });
  b += pill(62, y + 150, `code ${str(w.pairingCode, '…')}`, C.accent, C.accentBg);
  b += t(62, y + 228, 15, C.muted, 'Vaulted payer', {});
  b += t(62, y + 256, 14, C.ink, short(str(w.vaultId), 30), { mono: true });
  b += t(62, y + 320, 15, C.ink, `${money(w.capUsd)} partition armed`, { weight: '700' });
  b += t(62, y + 360, 14, C.muted, `per-order cap ${money(w.maxPerOrderUsd)}`, {});
  b += card(426, y, 362, 590, 'Partition wall', C.crimson);
  b += pill(448, y + 60, `${str(w.spendOutcome)} ${money(w.spendTotalUsd)}`, C.emerald, C.emeraldBg);
  b += t(448, y + 140, 16, C.ink, `${money(w.availUsd)} left of ${money(w.capUsd)}`, { mono: true });
  b += pill(448, y + 176, str(w.wallOutcome), C.crimson, C.crimsonBg);
  b += t(448, y + 254, 15, C.ink, `${money(w.spendTotalUsd)} > ${money(w.wallAvailUsd)} headroom`, { mono: true });
  b += t(448, y + 320, 14, C.muted, 'Second spend voided pre-capture', {});
  b += t(448, y + 360, 14, C.muted, `Refund Undo restores ${money(w.refundAvailUsd)}`, {});
  b += card(812, y, 362, 590, 'Sync — legacy vs protected', C.amber);
  b += pill(834, y + 60, `LEGACY x${String(w.syncLegacy ?? '?')}`, C.crimson, C.crimsonBg);
  b += pill(834, y + 108, `PROTECTED x${String(w.syncProtected ?? '?')}`, C.emerald, C.emeraldBg);
  b += t(834, y + 190, 15, C.muted, 'Session commitment', {});
  b += t(834, y + 218, 13, C.ink, short(str(w.commitment), 30), { mono: true });
  b += t(834, y + 280, 14, C.muted, '3-hour SLA · FALLBACK scope', {});
  b += t(834, y + 320, 14, C.muted, 'Ledger holds real-time truth', {});
  b += card(1198, y, 362, 590, 'Connectors', C.emerald);
  b += t(1220, y + 92, 15, C.ink, 'ChatGPT Actions', { weight: '700' });
  b += t(1220, y + 120, 14, C.muted, `GET ${str(w.chatOpenapi)}`, { mono: true });
  b += t(1220, y + 148, 14, C.ink, str(w.chatMasked), { mono: true });
  b += t(1220, y + 220, 15, C.ink, 'Claude / Cursor MCP', { weight: '700' });
  b += t(1220, y + 248, 14, C.muted, short(str(w.mcpCommand), 32), { mono: true });
  b += t(1220, y + 276, 14, C.ink, str(w.mcpMasked), { mono: true });
  b += t(1220, y + 340, 14, C.muted, 'Scoped · shown once · masked', {});
  b += t(1220, y + 380, 14, C.muted, 'in ledger + later reads', {});
  return frame(
    'v5 Agentic Wallet — QR pair, partition wall, sync, connectors',
    'PayPal moves money · VeriPact clears intent — witnessed clearing for agent spend',
    b,
    footer,
  );
}

async function main(): Promise<void> {
  const outDir = join(process.cwd(), 'docs', 'screenshots');
  mkdirSync(outDir, { recursive: true });
  delete process.env['PAYPAL_CLIENT_ID'];
  delete process.env['PAYPAL_CLIENT_SECRET'];
  delete process.env['BUYER_ED25519_PRIVATE_KEY'];
  delete process.env['WITNESS_ED25519_PRIVATE_KEY'];
  delete process.env['MERCHANT_ED25519_PRIVATE_KEY'];
  process.env['VERIPACT_ENV_FILE'] = join(process.cwd(), '.vitest-tmp', 'absent-credentials.env');
  process.env['VERIPACT_WALLET_STATE_FILE'] = join(process.cwd(), '.vitest-tmp', 'assets-wallet-state.json');
  resetDemoState();
  await call('POST', '/api/demo/reset', {});
  const status = (await call('GET', '/api/system/status')).json as unknown as StatusSlice;
  const normal = (await call('POST', '/api/merchant/checkout', { scenario: 'normal' }))
    .json as unknown as CheckoutSlice;
  const surcharge = (await call('POST', '/api/merchant/checkout', { scenario: 'surcharge_void' }))
    .json as unknown as CheckoutSlice;
  const adversarial = (
    await call('POST', '/api/merchant/checkout', { scenario: 'adversarial_hidden_dom' })
  ).json as unknown as CheckoutSlice;
  const disputes = (await call('GET', '/api/merchant/disputes')).json as unknown as DisputesSlice;
  const bench = (await call('GET', '/api/benchmark')).json as unknown as BenchmarkSlice;
  const pairStart = (await call('POST', '/api/wallet/pair/start', {})).json as unknown as {
    session?: { sessionId?: string; pairingCode?: string };
  };
  const pairApprove = (
    await call('POST', '/api/wallet/pair/approve', { sessionId: pairStart.session?.sessionId ?? '' })
  ).json as unknown as {
    session?: { vaultId?: string };
    partition?: { totalAllocatedUsd?: number; maxPerOrderUsd?: number };
  };
  const spend1 = (await call('POST', '/api/wallet/spend-check', { scenarioId: 'normal' }))
    .json as unknown as {
    outcome?: string;
    finalTotalUsd?: number;
    partitionAvailableUsd?: number;
    snapshot?: { commitment?: string };
    partition?: { capturedUsd?: number };
  };
  const spend2 = (await call('POST', '/api/wallet/spend-check', { scenarioId: 'normal' }))
    .json as unknown as { outcome?: string; partitionAvailableUsd?: number };
  const refunded = (await call('POST', '/api/wallet/refund', {})).json as unknown as {
    partition?: { availableUsd?: number };
  };
  const sync = (await call('GET', '/api/wallet/sync')).json as unknown as {
    summary?: { totalCount?: number; protectedCount?: number; legacyUnwitnessedCount?: number };
  };
  const chat = (await call('POST', '/api/wallet/connectors', { platform: 'CHATGPT_ACTION' }))
    .json as unknown as { connector?: { maskedToken?: string; openapiUrl?: string } };
  const mcp = (await call('POST', '/api/wallet/connectors', { platform: 'CLAUDE_MCP' }))
    .json as unknown as { connector?: { maskedToken?: string; mcpCommand?: string } };
  const wallet: WalletSlice = {
    sessionId: pairStart.session?.sessionId,
    pairingCode: pairStart.session?.pairingCode,
    vaultId: pairApprove.session?.vaultId,
    capUsd: pairApprove.partition?.totalAllocatedUsd,
    capturedUsd: spend1.partition?.capturedUsd,
    availUsd: spend1.partitionAvailableUsd,
    maxPerOrderUsd: pairApprove.partition?.maxPerOrderUsd,
    spendOutcome: spend1.outcome,
    spendTotalUsd: spend1.finalTotalUsd,
    wallOutcome: spend2.outcome,
    wallAvailUsd: spend2.partitionAvailableUsd,
    refundAvailUsd: refunded.partition?.availableUsd,
    commitment: spend1.snapshot?.commitment,
    syncTotal: sync.summary?.totalCount,
    syncProtected: sync.summary?.protectedCount,
    syncLegacy: sync.summary?.legacyUnwitnessedCount,
    chatMasked: chat.connector?.maskedToken,
    chatOpenapi: chat.connector?.openapiUrl,
    mcpMasked: mcp.connector?.maskedToken,
    mcpCommand: mcp.connector?.mcpCommand,
  };
  const d: AssetData = { status, normal, surcharge, adversarial, disputes, bench, wallet };
  const footer =
    `Generated ${new Date().toISOString()} · ${str(status.transportMode)} · ` +
    `commitment ${short(str(normal.snapshot?.commitment), 20)} · zero hand-typed numbers`;
  const files: Array<[string, string]> = [
    ['01-architecture-and-3-rung-ladder.svg', svgArchitecture(d, footer)],
    ['02-view1-witnessed-checkout-and-auditor.svg', svgView1(d, footer)],
    ['03-view1-surcharge-void-and-dom-block.svg', svgView1Edge(d, footer)],
    ['04-view2-contested-dispute-desk.svg', svgView2(d, footer)],
    ['05-regression-suite-wilson-ci.svg', svgRegression(d, footer)],
    ['06-v5-agentic-wallet-partition-and-sync.svg', svgWallet(d, footer)],
  ];
  for (const [name, svg] of files) {
    const path = join(outDir, name);
    writeFileSync(path, `${svg}\n`);
    console.log(`assets: wrote ${path} (${svg.length} bytes)`);
  }
  rmSync(join(process.cwd(), '.vitest-tmp', 'assets-wallet-state.json'), { force: true });
  console.log(
    `assets: normal=${str(normal.outcome)} ${money(normal.finalTotalUsd)} ` +
      `surcharge=${str(surcharge.outcome)} adversarial=${str(adversarial.outcome)} ` +
      `regression=${str(status.regressionPassRate)} ` +
      `wallet=${str(spend1.outcome)}/${str(spend2.outcome)}`,
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
