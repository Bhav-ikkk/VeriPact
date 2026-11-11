/**
 * `npm run verify:live` — live-deployment Playwright click-tester (run 42).
 *
 * Unlike `verify:e2e` (route fulfillment, no sockets), this audits a REAL
 * deployed URL — the Vercel production deployment or a local `npm start`
 * server — with a genuine interactive click-through:
 *
 *   1. `/health` + `/openapi.json` return 200 OK.
 *   2. `/` loads with zero console/page errors; 2-card rows are
 *      equal-height and action buttons are 36px.
 *   3. Onboarding wizard completes; wallet connects (Bhavik).
 *   4. Find Deal captures $297.00 with PAYPAL50.
 *   5. Details opens with the 6-store table + VP1: proof.
 *   6. Poll + Test $100 Drop reach GOAL CAPTURED.
 *   7. Orders + Disputes inspect both cases; resolve reaches RESOLVED.
 *
 * Target: `process.argv[2]` || `process.env.VERIPACT_LIVE_URL` ||
 * `http://localhost:3000`. Prints `LIVE DEPLOYMENT AUDIT: PASS` and exits
 * 0 on success; prints every failure and exits 1 otherwise.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';

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

const ROOT = join(__dirname, '..', '..');

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
const { chromium, request } = require('playwright') as typeof import('playwright');

const TARGET = (
  process.argv[2] ??
  process.env.VERIPACT_LIVE_URL ??
  'http://localhost:3000'
).replace(/\/+$/, '');

const problems: string[] = [];
let stepNo = 0;

function step(name: string): void {
  stepNo += 1;
  console.log(`LIVE ${String(stepNo).padStart(2, '0')} :: ${name}`);
}

function assert(cond: boolean, label: string, detail: string): void {
  if (!cond) {
    problems.push(`${label}: ${detail}`);
    console.log(`  FAIL ${label}: ${detail}`);
  }
}

function watchPage(page: Page): void {
  page.on('response', (r) => {
    if (r.status() >= 400) {
      problems.push(`http ${r.request().method()} ${new URL(r.url()).pathname} -> ${r.status()}`);
    }
  });
  page.on('pageerror', (e: Error) => {
    problems.push(`pageerror ${e.message.slice(0, 200)}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') {
      problems.push(`console ${m.text().slice(0, 200)}`);
    }
  });
}

async function assertGeometry(page: Page): Promise<void> {
  const rows = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('#view-checkout .two-card-row'));
    return els.map((row) =>
      Array.from(row.children).map((c) => {
        const r = c.getBoundingClientRect();
        return { top: r.top, height: r.height };
      }),
    );
  });
  assert(rows.length === 2, 'live-rows', `expected 2 card rows, got ${rows.length}`);
  rows.forEach((cards, i) => {
    if (cards.length !== 2) {
      assert(false, 'live-row-count', `row ${i + 1}: expected 2 cards, got ${cards.length}`);
      return;
    }
    const pair = cards as [{ top: number; height: number }, { top: number; height: number }];
    const a = pair[0];
    const b = pair[1];
    console.log(`  row${i + 1}: h=${a.height}/${b.height} top=${a.top}/${b.top}`);
    assert(
      Math.abs(a.height - b.height) <= 2,
      'live-row-height',
      `row ${i + 1}: heights differ ${a.height} vs ${b.height}`,
    );
    assert(
      Math.abs(a.top - b.top) <= 2,
      'live-row-top',
      `row ${i + 1}: tops differ ${a.top} vs ${b.top}`,
    );
  });
  const ids = [
    '#btn-sniper-run',
    '#btn-checkout',
    '#btn-witness',
    '#btn-part-spend',
    '#btn-part-refund',
    '#btn-sim-pricedrop',
  ];
  for (const id of ids) {
    const h = await page.$eval(id, (el) => el.getBoundingClientRect().height);
    console.log(`  ${id}: height=${h}`);
    assert(Math.abs(h - 36) <= 2, 'live-btn-36', `${id} height ${h} is not 36px (+-2)`);
  }
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

async function audit(browser: Browser): Promise<void> {
  const api = await request.newContext({ baseURL: TARGET });

  step('live endpoints /health + /openapi.json return 200');
  const health = await api.get('/health');
  assert(health.status() === 200, 'live-health', `status=${health.status()}`);
  const openapi = await api.get('/openapi.json');
  assert(openapi.status() === 200, 'live-openapi-status', `status=${openapi.status()}`);
  const spec = (await openapi.json()) as { openapi: string };
  assert(spec.openapi === '3.1.0', 'live-openapi-version', String(spec.openapi));
  await api.dispose();

  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  watchPage(page);

  step('live home loads cleanly with locked geometry');
  await page.goto(`${TARGET}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#checkout-outcome-banner[data-state="captured"]', { timeout: 60000 });
  await assertGeometry(page);

  step('live onboarding wizard connects the wallet');
  await page.click('#btn-open-onboarding');
  await page.waitForFunction(() => {
    const modal = document.getElementById('onboarding-modal');
    return modal !== null && !modal.hidden;
  });
  await page.click('#btn-clerk-google');
  await page.waitForFunction(() => {
    const p2 = document.getElementById('onb-pane-2');
    return p2 !== null && !p2.hidden;
  });
  await page.click('#btn-onb-paypal-connect');
  await page.click('#btn-onb-next-2');
  await page.waitForFunction(() => {
    const p3 = document.getElementById('onb-pane-3');
    return p3 !== null && !p3.hidden;
  });
  await page.click('#btn-onb-finish');
  await page.waitForFunction(() => {
    const modal = document.getElementById('onboarding-modal');
    return modal !== null && modal.hidden;
  });
  const pillLabel = await page.textContent('#onb-pill-label');
  assert(
    pillLabel?.includes('Bhavik') === true,
    'live-onb-pill',
    `expected Bhavik in pill, got ${pillLabel}`,
  );

  step('live Find Deal captures $297.00 with PAYPAL50');
  await page.fill('#sniper-intent-prompt', 'Find a 27" 4K IPS monitor under $300 with free 30-day returns');
  await page.click('#btn-sniper-run');
  await page.waitForFunction(() => {
    const txt = document.getElementById('sniper-results')?.textContent ?? '';
    return txt.includes('PAYPAL50') && txt.includes('CAPTURED $297.00');
  });
  const partAvail = await page.textContent('#part-available');
  assert(partAvail === '$53.00', 'live-snipe-spend', `expected $53.00 left, got ${partAvail}`);
  await page.click('#btn-part-refund');
  await page.waitForFunction(
    () => document.getElementById('part-available')?.textContent === '$350.00',
  );

  step('live Details opens the 6-store table with VP1 proof');
  await page.click('#btn-info-modal');
  await page.waitForSelector('#details-modal:not([hidden])');
  const detailsText = (await page.textContent('#details-modal')) ?? '';
  assert(detailsText.includes('VP1:'), 'live-details-vp1', 'details modal missing VP1: proof');
  assert(
    detailsText.includes('PAYPAL50') && detailsText.includes('CLEARANCE70'),
    'live-details-stores',
    'details modal missing the 6-store coupon audit',
  );

  step('live Poll + Test $100 Drop reach GOAL CAPTURED');
  await page.click('#btn-poll-now');
  await page.waitForTimeout(2000);
  const fleetCount = await page.$$eval('#fleet-agents-list .fleet-card', (els) => els.length);
  assert(fleetCount >= 1, 'live-fleet-poll', `expected 1+ watcher rows, got ${fleetCount}`);
  await page.click('#btn-sim-pricedrop');
  await page.waitForFunction(() => {
    const txt = document.getElementById('fleet-agents-list')?.textContent ?? '';
    return txt.includes('GOAL CAPTURED') && txt.includes('VP1:');
  });
  const fleetText = (await page.textContent('#fleet-agents-list')) ?? '';
  assert(
    fleetText.includes('$100.00 Allocated · $0.00 Left'),
    'live-captured-spent',
    fleetText.slice(0, 100),
  );

  step('live Orders + Disputes inspect both cases and resolve');
  await page.click('#nav-purchases');
  await page.waitForSelector('#sync-shell:not([hidden])');
  await page.waitForFunction(
    () => document.getElementById('sync-body')?.textContent?.includes('VERIPACT_PROTECTED') === true,
  );
  await page.click('#nav-activity');
  await page.waitForFunction(
    () => document.getElementById('insp-seller')?.textContent?.includes('BUYER_FORGERY_DETECTED') === true,
  );
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

  await context.close();
}

async function main(): Promise<void> {
  console.log(`verify:live target: ${TARGET}`);
  try {
    const browser = await chromium.launch();
    try {
      await audit(browser);
    } finally {
      await browser.close();
    }
  } catch (e) {
    problems.push(`fatal ${(e as Error).message.slice(0, 300)}`);
  }
  if (problems.length > 0) {
    console.log('LIVE DEPLOYMENT AUDIT: FAIL');
    for (const p of problems) {
      console.log(` - ${p}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('LIVE DEPLOYMENT AUDIT: PASS');
}

void main();
