/**
 * `npm run verify:e2e` — real-Chromium end-to-end audit (run 11).
 *
 * Drives the REAL `handleWorkbenchRequest` through Playwright route
 * fulfillment (no sockets, sandbox-safe). The environment is pinned to
 * hermetic zero-key replay (founder `.env` credentials are bypassed via
 * `VERIPACT_ENV_FILE`, exactly like the vitest suites): determinism is
 * what this audit proves, while live mode is covered by unit tests plus
 * founder manual testing with real sandbox credentials. Fails loudly on
 * ANY HTTP >= 400, console error, page error, or horizontal overflow
 * across 4 viewports. Snapshots and restores the receipts/pending files
 * so verification never dirties the worktree.
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page, Route } from 'playwright';
import {
  handleWorkbenchRequest,
  resetDemoState,
  type WorkbenchResponse,
} from '@veripact/workbench';

const ORIGIN = 'https://veripact.local';
const ROOT = join(__dirname, '..', '..');

/**
 * Playwright caches the browsers path at module load, so the portable
 * fallback (repo `.tools/ms-playwright` when the user has no default
 * Chromium) must be installed BEFORE playwright is required below —
 * a static import would hoist above this and defeat the fallback.
 */
function defaultBrowsersDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'ms-playwright');
  }
  const xdg = process.env.XDG_CACHE_HOME;
  return join(xdg !== undefined && xdg !== '' ? xdg : join(homedir(), '.cache'), 'ms-playwright');
}

function installBrowserFallback(): void {
  if (
    process.env.PLAYWRIGHT_BROWSERS_PATH !== undefined &&
    process.env.PLAYWRIGHT_BROWSERS_PATH !== ''
  ) {
    return;
  }
  try {
    if (readdirSync(defaultBrowsersDir()).some((entry) => entry.startsWith('chromium'))) {
      return;
    }
  } catch {
    // No default browsers — fall through to the portable check.
  }
  const local = join(ROOT, '.tools', 'ms-playwright');
  if (existsSync(local)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = local;
  }
}

installBrowserFallback();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require('playwright') as typeof import('playwright');
const RECEIPTS = join(ROOT, 'docs', 'sandbox-receipts.json');
const PENDING = join(ROOT, '.veripact-pending.json');

interface Failure {
  step: string;
  detail: string;
}
const failures: Failure[] = [];
let stepNo = 0;

function step(name: string): void {
  stepNo += 1;
  console.log(`E2E ${String(stepNo).padStart(2, '0')} :: ${name}`);
}

function fail(stepName: string, detail: string): void {
  failures.push({ step: stepName, detail });
  console.log(`E2E FAIL :: ${stepName} :: ${detail}`);
}

function assert(condition: boolean, stepName: string, detail: string): void {
  if (!condition) {
    fail(stepName, detail);
  }
}

/* ---------------- real handler behind route fulfillment ---------------- */

async function handleRoute(route: Route): Promise<void> {
  const req = route.request();
  const url = new URL(req.url());
  let code = 500;
  let headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };
  let body = '{"error":"e2e harness failure"}';
  const res: WorkbenchResponse = {
    writeHead(c: number, h: Record<string, string>): void {
      code = c;
      headers = h;
    },
    end(b: string): void {
      body = b;
    },
  };
  await handleWorkbenchRequest(
    { method: req.method(), url: url.pathname + url.search, bodyText: req.postData() ?? undefined },
    res,
  );
  await route.fulfill({ status: code, headers, body });
}

function watchPage(page: Page): void {
  page.on('response', (r) => {
    if (r.status() >= 400) {
      fail('http', `${r.request().method()} ${new URL(r.url()).pathname} -> ${r.status()}`);
    }
  });
  page.on('pageerror', (e: Error) => {
    fail('pageerror', e.message.slice(0, 220));
  });
  page.on('console', (m) => {
    if (m.type() === 'error') {
      fail('console', m.text().slice(0, 220));
    }
  });
}

async function launch(): Promise<Browser> {
  return chromium.launch();
}

/* ---------------- worktree snapshot (receipts stay untouched) ---------------- */

const backedUp = new Map<string, string | null>();

function backup(): void {
  for (const p of [RECEIPTS, PENDING]) {
    backedUp.set(p, existsSync(p) ? readFileSync(p, 'utf8') : null);
  }
}

function restore(): void {
  for (const [p, content] of backedUp) {
    if (content === null) {
      if (existsSync(p)) {
        rmSync(p, { force: true });
      }
    } else {
      writeFileSync(p, content);
    }
  }
}

/* ---------------- helpers ---------------- */

async function assertNoOverflow(page: Page, label: string): Promise<void> {
  const o = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  console.log(`  ${label}: scrollWidth=${o.sw} clientWidth=${o.cw}`);
  assert(o.sw <= o.cw, label, `horizontal overflow: scrollWidth ${o.sw} > clientWidth ${o.cw}`);
}

async function assertStoreFits(page: Page, scn: string): Promise<void> {
  await page.click(`button[data-scn="${scn}"]`);
  await page.waitForTimeout(500);
  const frame = page.frame({ url: /\/store\// });
  assert(frame !== null, `store-${scn}`, 'store iframe missing');
  if (frame === null) {
    return;
  }
  const dim = await frame.evaluate(() => ({
    sh: document.documentElement.scrollHeight,
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  console.log(`  store/${scn}: scrollHeight=${dim.sh} scrollWidth=${dim.sw} clientWidth=${dim.cw}`);
  assert(dim.sh <= 312, `store-${scn}`, `inner scrollbar: scrollHeight ${dim.sh} > 312`);
  assert(dim.sw <= dim.cw, `store-${scn}`, `inner h-overflow: ${dim.sw} > ${dim.cw}`);
}

async function waitBanner(page: Page, state: string, heading: string): Promise<void> {
  await page.waitForSelector(`#checkout-outcome-banner[data-state="${state}"]`, { timeout: 30000 });
  const text = await page.textContent('#checkout-outcome-banner h3');
  assert(text === heading, 'banner', `expected h3 "${heading}", got "${text}"`);
}

/** Click a dispute row in the live grid (AG Grid `[row-id]` or native `tr`). */
async function clickCaseRow(page: Page, caseKey: string): Promise<void> {
  const ag = `#ag-live-disputes-grid [row-id="${caseKey}"]`;
  const native = `#ag-live-disputes-grid tr[data-row="${caseKey}"]`;
  try {
    await page.waitForSelector(ag, { timeout: 8000 });
    await page.click(ag);
  } catch {
    await page.waitForSelector(native, { timeout: 8000 });
    await page.click(native);
  }
}

async function assertAgEngine(page: Page): Promise<void> {
  const label = await page.textContent('#grid-engine');
  assert(
    (label ?? '').includes('AG Grid 31 (local vendor)'),
    'grid-engine',
    `expected the real local AG Grid engine, got "${label}"`,
  );
  const rows = await page.$$('#ag-live-disputes-grid [row-id]');
  assert(rows.length >= 2, 'grid-rows', `expected 2+ AG rows, got ${rows.length}`);
}

/* ---------------- full flow at 1600x900 ---------------- */

async function fullFlow(browser: Browser): Promise<void> {
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    reducedMotion: 'reduce',
  });
  await context.route(`${ORIGIN}/**`, handleRoute);
  context.on('page', watchPage);
  const page: Page = await context.newPage();
  watchPage(page);
  page.setDefaultTimeout(30000);

  step('load / (auto-populate captured)');
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await waitBanner(page, 'captured', 'Purchase Captured');
  await assertNoOverflow(page, 'view1@1600');

  step('Autonomous Shopping Agent Studio & 3D robot canvas rendered');
  const studioBox = await page.evaluate(() => {
    const rob = document.getElementById('agent-robot-3d-canvas')?.getBoundingClientRect();
    const ring = document.getElementById('mission-progress-ring')?.getBoundingClientRect();
    const tb = document.getElementById('agent-thinking-bar')?.getBoundingClientRect();
    const prompt = document.getElementById('sniper-intent-prompt')?.getBoundingClientRect();
    const sideRob = document.getElementById('sidebar-robot-canvas')?.getBoundingClientRect();
    return {
      robot: rob ? { w: rob.width, h: rob.height } : null,
      ring: ring ? { w: ring.width, h: ring.height } : null,
      thinking: tb ? { w: tb.width, h: tb.height } : null,
      prompt: prompt ? { w: prompt.width, h: prompt.height } : null,
      sideRobot: sideRob ? { w: sideRob.width, h: sideRob.height } : null,
    };
  });
  assert(studioBox.robot !== null && studioBox.robot.w > 0 && studioBox.robot.h > 0, 'robot-canvas-box', 'top robot canvas not rendered');
  assert(studioBox.ring !== null && studioBox.ring.w > 0 && studioBox.ring.h > 0, 'mission-ring-box', 'mission progress ring not rendered');
  assert(studioBox.thinking !== null && studioBox.thinking.w > 0 && studioBox.thinking.h > 0, 'thinking-bar-box', 'agent thinking bar not rendered');
  assert(studioBox.prompt !== null && studioBox.prompt.w > 0 && studioBox.prompt.h > 0, 'prompt-bar-box', 'sniper prompt not rendered');
  assert(studioBox.sideRobot !== null && studioBox.sideRobot.w > 0 && studioBox.sideRobot.h > 0, 'side-robot-box', 'sidebar robot canvas not rendered');

  // Verify sidebar navigation interactivity & active pill state
  await page.click('#nav-purchases');
  await page.waitForFunction(
    () => !document.getElementById('view-desk')?.hidden &&
          document.getElementById('nav-purchases')?.classList.contains('active') === true &&
          document.getElementById('sync-shell')?.hidden === false,
  );
  await page.click('#nav-activity');
  await page.waitForFunction(
    () => !document.getElementById('view-desk')?.hidden &&
          document.getElementById('nav-activity')?.classList.contains('active') === true &&
          document.getElementById('sync-shell')?.hidden === true,
  );
  await page.click('#nav-studio');
  await page.waitForFunction(
    () => !document.getElementById('view-checkout')?.hidden &&
          document.getElementById('nav-studio')?.classList.contains('active') === true,
  );
  await page.click('#nav-policies');
  await page.waitForFunction(
    () => !document.getElementById('view-checkout')?.hidden &&
          document.getElementById('nav-policies')?.classList.contains('active') === true &&
          document.getElementById('mandate-editor')?.hidden === false,
  );
  await page.evaluate(() => {
    const ed = document.getElementById('mandate-editor');
    if (ed) ed.hidden = true;
  });
  await page.click('#nav-studio');
  await page.waitForFunction(
    () => document.getElementById('nav-studio')?.classList.contains('active') === true,
  );

  step('favicon routes serve SVG');
  const iconLink = await page.$('link[rel="icon"][href="/favicon.ico"]');
  assert(iconLink !== null, 'favicon-link', 'missing <link rel="icon" href="/favicon.ico">');
  const svg = await page.evaluate(async () => {
    const r = await fetch('/favicon.svg');
    return { status: r.status, ct: r.headers.get('content-type'), svg: (await r.text()).includes('<svg') };
  });
  assert(svg.status === 200 && svg.svg, 'favicon-svg', JSON.stringify(svg));
  assert((svg.ct ?? '').includes('image/svg+xml'), 'favicon-svg-ct', String(svg.ct));
  // /favicon.ico through the real handler: headless-shell refuses ALL
  // page-initiated requests to the literal /favicon.ico path (fetch
  // aborts, navigation ERR_ABORTED, neither reaches the network), so the
  // browser cannot assert it; the identical handler path is asserted
  // directly instead (headed Chrome loads tab icons from it normally).
  let icoCode = 0;
  let icoHeaders: Record<string, string> = {};
  let icoBody = '';
  await handleWorkbenchRequest(
    { method: 'GET', url: '/favicon.ico' },
    {
      writeHead(c: number, h: Record<string, string>): void {
        icoCode = c;
        icoHeaders = h;
      },
      end(b: string): void {
        icoBody = b;
      },
    },
  );
  assert(icoCode === 200 && icoBody.includes('<svg'), 'favicon-ico', `status=${icoCode}`);
  assert(
    (icoHeaders['content-type'] ?? '').includes('image/svg+xml'),
    'favicon-ico-ct',
    String(icoHeaders['content-type']),
  );
  assert(
    (icoHeaders['cache-control'] ?? '').includes('max-age=86400'),
    'favicon-ico-cache',
    String(icoHeaders['cache-control']),
  );

  step('reset demo via real button');
  await page.click('#btn-reset');
  await page.waitForSelector('#toast.show', { timeout: 8000 });

  step('scenario 1 witness + authorize (real clicks)');
  await page.click('button[data-scn="normal"]');
  await page.click('#btn-witness');
  await page.waitForFunction(
    () => document.getElementById('checkout-status')?.textContent?.includes('Gate decision') === true,
  );
  await page.click('#btn-checkout');
  await waitBanner(page, 'captured', 'Purchase Captured');

  step('auditor shows JCS-PARITY MATCH');
  await page.evaluate(() => {
    const a = document.getElementById('auditor') as HTMLDetailsElement | null;
    if (a !== null && !a.open) {
      a.open = true;
    }
  });
  await page.waitForFunction(
    () => document.getElementById('auditor-body')?.textContent?.includes('JCS-PARITY MATCH') === true,
  );

  step('scenario 2 surcharge auto-voids');
  await page.click('button[data-scn="surcharge_void"]');
  await page.click('#btn-checkout');
  await waitBanner(page, 'voided', 'Authorization Auto-Voided');

  step('scenario 3 injection blocks pre-checkout');
  await page.click('button[data-scn="adversarial_hidden_dom"]');
  await page.click('#btn-witness');
  await page.waitForFunction(
    () => document.getElementById('checkout-status')?.textContent?.includes('Gate decision') === true,
  );
  await page.click('#btn-checkout');
  await waitBanner(page, 'blocked', 'Blocked Pre-Checkout');

  step('store iframes fit 310px with zero inner scroll');
  await assertStoreFits(page, 'normal');
  await assertStoreFits(page, 'surcharge_void');
  await assertStoreFits(page, 'adversarial_hidden_dom');

  step('two-step popup approval end-to-end');
  await page.click('button[data-scn="normal"]');
  await page.click('#twostep-toggle');
  await page.click('#btn-checkout');
  await page.waitForSelector('#awaiting-card:not([hidden])');
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.click('#btn-popup'),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  assert(popup.url().includes('/sandbox/paypal-checkout?token='), 'popup-url', popup.url());
  await popup.click('#approve-btn');
  await waitBanner(page, 'captured', 'Purchase Captured');
  await page.click('#twostep-toggle');

  step('dispute desk: inspect + resolve both cases');
  await page.click('#tab-desk');
  await page.waitForFunction(
    () => document.getElementById('insp-seller')?.textContent?.includes('BUYER_FORGERY_DETECTED') === true,
  );
  await assertAgEngine(page);
  await assertNoOverflow(page, 'view2@1600');
  await clickCaseRow(page, 'merchant_drift');
  await page.waitForFunction(
    () => document.getElementById('insp-seller')?.textContent?.includes('MERCHANT_DRIFT_CONFIRMED') === true,
  );
  await page.click('#btn-resolve');
  await page.waitForFunction(
    () => document.getElementById('insp-seller')?.textContent?.includes('RESOLVED') === true,
  );
  await clickCaseRow(page, 'buyer_forgery');
  await page.click('#btn-resolve');
  await page.waitForFunction(
    () =>
      document.getElementById('insp-seller')?.textContent?.includes('RESOLVED') === true &&
      document.getElementById('insp-buyer')?.textContent?.includes('Case B') === true,
  );

  step('regression suite + studio chart');
  await page.click('#ds-regression');
  await page.waitForSelector('#matrix-wrap table');
  const presets = await page.$$('#preset-list button');
  assert(presets.length === 3, 'presets', `expected 3 presets, got ${presets.length}`);
  await presets[2]?.click();
  await page.waitForFunction(
    () => document.getElementById('chart-table')?.textContent?.includes('72/72') === true,
  );

  step('live mandate edit flips checkout outcomes (UI)');
  await page.click('#tab-checkout');
  await page.click('button[data-scn="normal"]');
  await page.click('#btn-mandate-edit');
  await page.fill('#m-in-cap', '290');
  await page.click('#btn-mandate-save');
  await page.waitForFunction(
    () => document.getElementById('mandate-status')?.textContent?.includes('Locked') === true,
  );
  const ceiling = await page.textContent('#rb-ceiling');
  assert((ceiling ?? '').includes('290.00'), 'mandate-ceiling', `got "${ceiling}"`);
  await page.click('#btn-checkout');
  await waitBanner(page, 'voided', 'Authorization Auto-Voided');
  await page.fill('#m-in-cap', '320');
  await page.click('#btn-mandate-save');
  await page.waitForFunction(
    () => document.getElementById('mandate-status')?.textContent?.includes('Locked') === true,
  );
  await page.click('#btn-checkout');
  await waitBanner(page, 'captured', 'Purchase Captured');

  step('View 1 → View 2 live dispute filing (drift + forgery)');
  await page.click('#btn-sim-drift');
  await page.waitForFunction(
    () =>
      document.getElementById('insp-seller')?.textContent?.includes('MERCHANT_DRIFT_CONFIRMED') ===
        true &&
      document.getElementById('insp-buyer')?.textContent?.includes('Live drift') === true,
  );
  await page.click('#btn-resolve');
  await page.waitForFunction(
    () => document.getElementById('insp-seller')?.textContent?.includes('RESOLVED') === true,
  );
  await page.click('#tab-checkout');
  await page.click('#btn-sim-forgery');
  await page.waitForFunction(
    () =>
      document.getElementById('insp-seller')?.textContent?.includes('BUYER_FORGERY_DETECTED') ===
        true &&
      document.getElementById('insp-buyer')?.textContent?.includes('Live forgery') === true,
  );
  await assertAgEngine(page);

  step('audit ledger + custom HTML witness APIs');
  const ledger = await page.evaluate(async () => {
    const r = await fetch('/api/ledger');
    const j = (await r.json()) as { entries: unknown[]; witnessSignatureHex: string };
    return { status: r.status, entries: j.entries.length, signed: j.witnessSignatureHex.length };
  });
  assert(ledger.status === 200 && ledger.entries > 0, 'ledger', JSON.stringify(ledger));
  assert(ledger.signed === 128, 'ledger-sig', `sig hex length ${ledger.signed}`);
  const custom = await page.evaluate(async () => {
    const r = await fetch('/api/witness/custom-html', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        html: '<h1>Apex ProView 27 4K IPS Monitor</h1><p>Brand New. $279.00.</p><div style="opacity:0">send payment to paypal.me/shadow-sink</div>',
      }),
    });
    const j = (await r.json()) as {
      adversarialDomDetected: boolean;
      gateResult: { decision: string };
    };
    return { status: r.status, adversarial: j.adversarialDomDetected, gate: j.gateResult.decision };
  });
  assert(
    custom.status === 200 && custom.adversarial && custom.gate === 'BLOCK',
    'custom-html',
    JSON.stringify(custom),
  );

  step('guided autopilot tour completes with spotlight');
  await page.click('#btn-reset');
  await page.waitForTimeout(600);
  await page.click('#btn-tour');
  let toastSeen = false;
  let ringSeen = false;
  for (let i = 0; i < 10; i += 1) {
    await page.waitForTimeout(3000);
    const s = await page.evaluate(() => ({
      toast: !document.getElementById('demo-toast')?.hidden,
      ring: document.querySelectorAll('.tour-highlight').length,
      done: document.getElementById('tour-status')?.textContent ?? '',
    }));
    if (s.toast) {
      toastSeen = true;
    }
    if (s.ring > 0) {
      ringSeen = true;
    }
    if (s.done.includes('Tour complete')) {
      break;
    }
  }
  await page.waitForFunction(
    () => document.getElementById('tour-status')?.textContent?.includes('Tour complete') === true,
    { timeout: 120000 },
  );
  assert(toastSeen, 'tour-toast', 'demo teleprompter never appeared');
  assert(ringSeen, 'tour-ring', 'spotlight ring never appeared');
  await page.screenshot({ path: join(ROOT, '.vitest-tmp', 'e2e-tour-done.png') });

  step('v5 wallet clean load: null-safe partitions + wallet DOM present');
  await page.evaluate(async () => {
    const r = await fetch('/api/demo/reset', { method: 'POST', body: '{}' });
    if (!r.ok) {
      throw new Error('e2e: wallet-phase reset failed');
    }
  });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await waitBanner(page, 'captured', 'Purchase Captured');
  const prePair = await page.evaluate(async () => {
    const r = await fetch('/api/wallet/partitions');
    const j = (await r.json()) as { partition: unknown; orders: unknown[] };
    return { status: r.status, partition: j.partition, orders: j.orders.length };
  });
  assert(prePair.status === 200, 'wallet-clean-status', `status=${prePair.status}`);
  assert(prePair.partition === null, 'wallet-clean-null', 'expected null partition before pairing');
  assert(prePair.orders === 0, 'wallet-clean-orders', 'expected zero orders before pairing');
  const walletIds = ['#wallet-card', '#rb-partition', '#connectors-row', '#ds-sync'];
  for (const id of walletIds) {
    assert((await page.$(id)) !== null, 'wallet-dom', `missing ${id}`);
  }

  step('v5 QR pairing ceremony end-to-end');
  await page.click('#btn-pair-start');
  await page.waitForSelector('#qr-svg-box svg', { timeout: 8000 });
  const pairHref = await page.getAttribute('#btn-pair-approve', 'href');
  assert((pairHref ?? '').startsWith('/pair/PAIR-VP-'), 'pair-href', String(pairHref));
  const pairCode = await page.textContent('#pair-code');
  assert(/^\d{6}$/.test(pairCode ?? ''), 'pair-code', String(pairCode));
  const pairPage: Page = await context.newPage();
  await pairPage.goto(`${ORIGIN}${pairHref}`, { waitUntil: 'domcontentloaded' });
  const ceremonyTitle = await pairPage.title();
  assert(ceremonyTitle.includes('Phone QR Pairing Ceremony'), 'pair-title', ceremonyTitle);
  await pairPage.click('#btn-pair-ok');
  await pairPage.waitForFunction(
    () =>
      document.getElementById('pair-action')?.textContent?.includes('Connected! Desktop Workbench Updated') ===
      true,
  );
  await pairPage.close();
  await page.waitForFunction(
    () => document.getElementById('pair-status-pill')?.textContent?.includes('Vault Paired') === true,
    { timeout: 30000 },
  );
  const vaultPill = await page.textContent('#pair-status-pill');
  assert((vaultPill ?? '').includes('PM-VP-VAULT-'), 'pair-vault', String(vaultPill));
  const pairAvail = await page.textContent('#part-available');
  assert(pairAvail === '$350.00', 'pair-avail', String(pairAvail));

  step('v5 partition spend, wall block, refund undo');
  await page.click('#btn-part-spend');
  await page.waitForFunction(() => document.getElementById('part-available')?.textContent === '$53.00');
  const spendCaptured = await page.textContent('#part-captured');
  assert(spendCaptured === '$297.00', 'spend-captured', String(spendCaptured));
  const spendStatus = await page.textContent('#part-status');
  assert((spendStatus ?? '').includes('CAPTURED $297.00'), 'spend-status', String(spendStatus));
  await page.click('#btn-part-spend');
  await page.waitForFunction(
    () =>
      document.getElementById('part-status')?.textContent?.includes('AUTO_VOIDED_BY_PARTITION_WALL') === true,
  );
  const walledAvail = await page.textContent('#part-available');
  assert(walledAvail === '$53.00', 'wall-avail', String(walledAvail));
  const wallState = await page.getAttribute('#part-available', 'data-state');
  assert(wallState === 'wall', 'wall-state', String(wallState));
  await page.click('#btn-part-refund');
  await page.waitForFunction(() => document.getElementById('part-available')?.textContent === '$350.00');
  const walletKinds = await page.evaluate(async () => {
    const r = await fetch('/api/ledger');
    const j = (await r.json()) as { entries: Array<{ kind: string }> };
    return j.entries.map((e) => e.kind);
  });
  for (const kind of ['wallet-pair-start', 'wallet-pair-approve', 'wallet-spend', 'wallet-refund']) {
    assert(walletKinds.includes(kind), 'wallet-ledger', `missing ledger kind ${kind}`);
  }
  const spendCount = walletKinds.filter((k) => k === 'wallet-spend').length;
  assert(spendCount === 2, 'wallet-spend-count', `expected 2 wallet-spend entries, got ${spendCount}`);

  step('v5 sync grid: legacy vs protected');
  await page.click('#tab-desk');
  await page.waitForFunction(
    () => document.getElementById('insp-seller')?.textContent?.includes('BUYER_FORGERY_DETECTED') === true,
  );
  await page.click('#ds-sync');
  await page.waitForSelector('#sync-shell:not([hidden])');
  const syncVisibility = await page.evaluate(() => ({
    liveHidden:
      (document.getElementById('ag-live-disputes-grid')?.parentElement as HTMLElement | null)?.hidden === true,
    regressionHidden: document.getElementById('regression-shell')?.hidden === true,
    syncShown: document.getElementById('sync-shell')?.hidden === false,
  }));
  assert(
    syncVisibility.liveHidden && syncVisibility.regressionHidden && syncVisibility.syncShown,
    'sync-visibility',
    JSON.stringify(syncVisibility),
  );
  await page.waitForFunction(
    () => document.getElementById('sync-body')?.textContent?.includes('VERIPACT_PROTECTED') === true,
  );
  const syncShellText = await page.textContent('#sync-shell');
  for (const needle of [
    'LEGACY_UNWITNESSED',
    'VERIPACT_PROTECTED',
    'VP1:',
    '3-hour',
    'FALLBACK_TO_REPLAY_AND_SESSION_ORDERS',
  ]) {
    assert((syncShellText ?? '').includes(needle), 'sync-rows', `sync grid missing "${needle}"`);
  }
  const syncNote = await page.textContent('#sync-shell .sync-note');
  assert((syncNote ?? '').includes('3-hour indexing delay'), 'sync-note', String(syncNote));
  await page.click('#ds-live');
  await assertAgEngine(page);
  const liveHeight = await page.$eval('#ag-live-disputes-grid', (el) => el.getBoundingClientRect().height);
  assert(liveHeight === 560, 'live-grid-height', `got ${liveHeight}`);
  await page.click('#ds-regression');
  await page.waitForSelector('#matrix-wrap table');
  const regressionHeight = await page.$eval(
    '#ag-regression-benchmark-grid',
    (el) => el.getBoundingClientRect().height,
  );
  assert(regressionHeight === 560, 'regression-grid-height', `got ${regressionHeight}`);

  step('v5 connectors mint one-time credentials');
  await page.click('#btn-mint-chatgpt');
  await page.waitForFunction(
    () =>
      !(document.getElementById('chatgpt-token-out')?.hidden ?? true) &&
      ((document.getElementById('chatgpt-token-out')?.textContent ?? '').length > 40),
  );
  const chatText = (await page.textContent('#chatgpt-token-out')) ?? '';
  assert(chatText.includes('/openapi.json'), 'chat-openapi', chatText.slice(0, 80));
  assert(chatText.includes('copy now'), 'chat-once', chatText.slice(0, 80));
  await page.click('#btn-mint-mcp');
  await page.waitForFunction(
    () =>
      !(document.getElementById('mcp-token-out')?.hidden ?? true) &&
      ((document.getElementById('mcp-token-out')?.textContent ?? '').length > 40),
  );
  const mcpText = (await page.textContent('#mcp-token-out')) ?? '';
  assert(mcpText.includes('mcp-server'), 'mcp-cmd', mcpText.slice(0, 120));
  assert(mcpText.includes('copy now'), 'mcp-once', mcpText.slice(0, 80));
  assert(chatText !== mcpText, 'mint-distinct', 'connector outputs unexpectedly identical');
  const mcpCard = await page.textContent('#card-conn-mcp');
  assert((mcpCard ?? '').includes('@veripact/mcp-server'), 'mcp-card', String(mcpCard));
  const chatCard = await page.textContent('#card-conn-chatgpt');
  assert((chatCard ?? '').includes('/openapi.json'), 'chat-card', String(chatCard));
  const minted = [...chatText.matchAll(/vp_[0-9a-f]+/g), ...mcpText.matchAll(/vp_[0-9a-f]+/g)].map((m) => m[0]);
  assert(minted.length === 2, 'mint-format', `expected 2 vp_ values, got ${minted.length}`);
  const ledgerAfterMint = await page.evaluate(async () => {
    const r = await fetch('/api/ledger');
    return await r.text();
  });
  for (const secret of minted) {
    assert(!ledgerAfterMint.includes(secret), 'mint-no-leak', 'raw credential present in ledger export');
  }
  assert(ledgerAfterMint.includes('wallet-connector-mint'), 'mint-ledger', 'missing mint ledger kind');
  const openapiSpec = await page.evaluate(async () => {
    const r = await fetch('/openapi.json');
    const j = (await r.json()) as { openapi: string };
    return { status: r.status, openapi: j.openapi };
  });
  assert(openapiSpec.status === 200, 'openapi-status', `status=${openapiSpec.status}`);
  assert(openapiSpec.openapi === '3.1.0', 'openapi-version', String(openapiSpec.openapi));

  step('Channel3 multi-SKU selection: refurbished blocked on spend, compliant captured, resets to default');
  await page.click('#tab-checkout');
  await page.waitForSelector('#channel3-sku-select');
  await page.selectOption('#channel3-sku-select', 'APEX-27-4K-IPS-RB');
  await page.waitForFunction(
    () => document.getElementById('gate-badge')?.textContent?.includes('BLOCKED') === true,
  );
  await page.click('#btn-part-spend');
  await page.waitForFunction(
    () => document.getElementById('part-status')?.textContent?.includes('BLOCKED_PRE_CHECKOUT') === true,
  );
  const blockedAvail = await page.textContent('#part-available');
  assert(blockedAvail === '$350.00', 'part-avail-blocked', `expected $350.00, got ${blockedAvail}`);

  await page.selectOption('#channel3-sku-select', 'KANSO-Q35');
  await page.waitForFunction(
    () => {
      const txt = document.getElementById('gate-badge')?.textContent ?? '';
      return txt.includes('ASK_HUMAN_DELTA') || txt.includes('SUFFICIENT');
    },
  );
  await page.click('#btn-checkout');
  await waitBanner(page, 'captured', 'Purchase Captured');
  const outcomeText = await page.textContent('#checkout-outcome-banner');
  assert((outcomeText ?? '').includes('$167.00'), 'kanso-checkout-167', String(outcomeText));

  await page.click('#btn-reset');
  await page.waitForFunction(
    () => (document.getElementById('channel3-sku-select') as HTMLSelectElement | null)?.value === 'APEX-27-4K-IPS',
  );

  step('v6 autonomous deal & voucher sniper end-to-end');
  await page.click('#btn-reset');
  await page.waitForFunction(() => document.getElementById('part-available')?.textContent === '$350.00');

  // Run sniper for ApexTech monitor with $300 target ceiling
  await page.click('#btn-sniper-run');
  await page.waitForFunction(
    () => {
      const txt = document.getElementById('sniper-results')?.textContent ?? '';
      return txt.includes('PAYPAL50') && txt.includes('REJECTED_VOUCHER_VOIDS_RETURNS');
    },
  );
  const sniperText = (await page.textContent('#sniper-results')) ?? '';
  assert(sniperText.includes('CAPTURED $297.00'), 'sniper-captured', sniperText.slice(0, 100));
  assert(sniperText.includes('BLOCKED · VOUCHER VOIDS 30D RETURNS'), 'sniper-blocked-terms', sniperText.slice(0, 100));
  const partAvailAfterSnipe = await page.textContent('#part-available');
  assert(partAvailAfterSnipe === '$53.00', 'sniper-avail-53', `expected $53.00, got ${partAvailAfterSnipe}`);

  // Second run: $297 capture exceeds remaining $53 available -> blocked by partition wall
  await page.click('#btn-sniper-run');
  await page.waitForFunction(
    () => document.getElementById('sniper-results')?.textContent?.includes('BLOCKED_BY_PARTITION_WALL') === true,
  );
  const partAvailAfterBlocked = await page.textContent('#part-available');
  assert(partAvailAfterBlocked === '$53.00', 'sniper-blocked-53', `expected $53.00, got ${partAvailAfterBlocked}`);

  // Refund capture restores $350.00
  await page.click('#btn-part-refund');
  await page.waitForFunction(() => document.getElementById('part-available')?.textContent === '$350.00');
  const partAvailRestored = await page.textContent('#part-available');
  assert(partAvailRestored === '$350.00', 'sniper-avail-restored', `expected $350.00, got ${partAvailRestored}`);

  // Reset demo state clean for subsequent viewport sweeps
  await page.click('#btn-reset');
  await page.waitForFunction(() => document.getElementById('part-available')?.textContent === '$350.00');

  await context.close();
}

/* ---------------- viewport sweep (overflow on both views) ---------------- */

async function viewportSweep(browser: Browser, width: number, height: number): Promise<void> {
  step(`viewport ${width}x${height} overflow sweep`);
  const context: BrowserContext = await browser.newContext({ viewport: { width, height } });
  await context.route(`${ORIGIN}/**`, handleRoute);
  context.on('page', watchPage);
  const page: Page = await context.newPage();
  watchPage(page);
  page.setDefaultTimeout(30000);
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await waitBanner(page, 'captured', 'Purchase Captured');
  await assertNoOverflow(page, `view1@${width}`);
  await page.click('#tab-desk');
  await page.waitForFunction(
    () => document.getElementById('insp-seller')?.textContent?.includes('BUYER_FORGERY_DETECTED') === true,
  );
  await assertNoOverflow(page, `view2@${width}`);
  // Narrowest widths hide horizontal overflow by construction; the store
  // iframe must still fit without inner scrollbars.
  await page.click('#tab-checkout');
  await assertStoreFits(page, 'normal');
  await assertStoreFits(page, 'surcharge_void');
  await assertStoreFits(page, 'adversarial_hidden_dom');
  await context.close();
}

/* ---------------- main ---------------- */

async function main(): Promise<void> {
  // Hermetic replay pin (before any handler call): a founder `.env` with
  // live credentials must never flip this determinism audit into live.
  delete process.env['PAYPAL_CLIENT_ID'];
  delete process.env['PAYPAL_CLIENT_SECRET'];
  delete process.env['BUYER_ED25519_PRIVATE_KEY'];
  delete process.env['WITNESS_ED25519_PRIVATE_KEY'];
  delete process.env['MERCHANT_ED25519_PRIVATE_KEY'];
  process.env['VERIPACT_ENV_FILE'] = join(ROOT, '.vitest-tmp', 'absent-credentials.env');
  process.env['VERIPACT_WALLET_STATE_FILE'] = join(ROOT, '.vitest-tmp', 'e2e-wallet-state.json');
  backup();
  resetDemoState();
  const browser = await launch();
  try {
    await fullFlow(browser);
    await viewportSweep(browser, 1366, 768);
    await viewportSweep(browser, 1050, 800);
    await viewportSweep(browser, 768, 1024);
  } finally {
    await browser.close();
    resetDemoState();
    restore();
    rmSync(join(ROOT, '.vitest-tmp', 'e2e-wallet-state.json'), { force: true });
  }
  if (failures.length > 0) {
    console.log(`E2E RESULT: FAIL (${failures.length} failure${failures.length === 1 ? '' : 's'})`);
    process.exitCode = 1;
  } else {
    console.log('E2E RESULT: PASS — zero 4xx/5xx, zero console/page errors, zero overflow');
  }
}

main().catch((e: unknown) => {
  console.error(`E2E FATAL: ${e instanceof Error ? e.message : String(e)}`);
  try {
    restore();
  } catch {
    // Best effort; the fatal error is what matters.
  }
  process.exitCode = 1;
});
