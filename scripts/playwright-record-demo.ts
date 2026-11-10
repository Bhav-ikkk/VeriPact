/**
 * `npm run demo:record` — deterministic demo recorder (run 11).
 *
 * Uses the exact same battle-tested harness as `scripts/verify-ui-e2e.ts`
 * (portable-browser discovery, route fulfillment of the REAL
 * `handleWorkbenchRequest`, hermetic zero-key replay pin) so the video
 * can never drift from what E2E proves. Records an 8-beat walkthrough at
 * 1600x900 with natural pacing pauses, saves PNGs to
 * `docs/screenshots/live-*.png`, and the `.webm` to
 * `videos/veripact-demo-tour.webm` (gitignored).
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
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
const VIDEOS = join(ROOT, 'videos');
const SHOTS = join(ROOT, 'docs', 'screenshots');

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

const problems: string[] = [];

async function handleRoute(route: Route): Promise<void> {
  const req = route.request();
  const url = new URL(req.url());
  let code = 500;
  let headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };
  let body = '{"error":"demo harness failure"}';
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

async function launch(): Promise<Browser> {
  return chromium.launch();
}

async function shot(page: Page, name: string): Promise<void> {
  const dest = join(SHOTS, name);
  await page.screenshot({ path: dest });
  console.log(`demo: shot ${name}`);
}

async function waitBanner(page: Page, state: string): Promise<void> {
  await page.waitForSelector(`#checkout-outcome-banner[data-state="${state}"]`, {
    timeout: 30000,
  });
}

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

/** Pacing pause so the video breathes between beats. */
async function hold(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}

async function main(): Promise<void> {
  // Hermetic replay pin (before any handler call): the recorded demo is
  // the deterministic zero-key flow, byte-consistent with E2E.
  delete process.env['PAYPAL_CLIENT_ID'];
  delete process.env['PAYPAL_CLIENT_SECRET'];
  delete process.env['BUYER_ED25519_PRIVATE_KEY'];
  delete process.env['WITNESS_ED25519_PRIVATE_KEY'];
  delete process.env['MERCHANT_ED25519_PRIVATE_KEY'];
  process.env['VERIPACT_ENV_FILE'] = join(ROOT, '.vitest-tmp', 'absent-credentials.env');
  process.env['VERIPACT_WALLET_STATE_FILE'] = join(ROOT, '.vitest-tmp', 'demo-wallet-state.json');
  mkdirSync(VIDEOS, { recursive: true });
  mkdirSync(SHOTS, { recursive: true });
  resetDemoState();
  const browser = await launch();
  try {
    const context: BrowserContext = await browser.newContext({
      viewport: { width: 1600, height: 900 },
      recordVideo: { dir: VIDEOS, size: { width: 1600, height: 900 } },
    });
    await context.route(`${ORIGIN}/**`, handleRoute);
    const page: Page = await context.newPage();
    watchPage(page);
    page.setDefaultTimeout(30000);

    console.log('demo: beat 1 — Autonomous Shopping Agent Studio + QR pair & partition');
    await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
    await waitBanner(page, 'captured');
    await hold(page, 1200);
    await shot(page, 'live-00-agent-studio.png');
    await page.evaluate(() => {
      document.getElementById('wallet-card')?.scrollIntoView({ block: 'start' });
    });
    await hold(page, 600);
    await page.click('#btn-pair-start');
    await page.waitForSelector('#qr-svg-box svg', { timeout: 8000 });
    await hold(page, 1200);
    await shot(page, 'live-01-wallet-qr.png');
    await page.evaluate(async () => {
      const href = document.getElementById('btn-pair-approve')?.getAttribute('href') ?? '';
      const sessionId = href.split('/pair/')[1] ?? '';
      const r = await fetch('/api/wallet/pair/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (!r.ok) {
        throw new Error('demo: wallet approve failed');
      }
    });
    await page.waitForFunction(
      () => document.getElementById('pair-status-pill')?.textContent?.includes('Vault Paired') === true,
    );
    await hold(page, 1200);
    await shot(page, 'live-02-wallet-paired.png');

    console.log('demo: beat 2 — partition spend, wall block, refund undo');
    await page.click('#btn-part-spend');
    await page.waitForFunction(() => document.getElementById('part-available')?.textContent === '$53.00');
    await hold(page, 1200);
    await shot(page, 'live-03-partition-spend.png');
    await page.click('#btn-part-spend');
    await page.waitForFunction(
      () =>
        document.getElementById('part-status')?.textContent?.includes('AUTO_VOIDED_BY_PARTITION_WALL') === true,
    );
    await hold(page, 1200);
    await shot(page, 'live-04-partition-wall.png');
    await page.click('#btn-part-refund');
    await page.waitForFunction(() => document.getElementById('part-available')?.textContent === '$350.00');
    await hold(page, 1200);
    await shot(page, 'live-05-partition-refund.png');

    console.log('demo: beat 2b — autonomous deal sniper 6-candidate sweep');
    await page.click('#btn-sniper-run');
    await page.waitForFunction(
      () =>
        document.getElementById('sniper-results')?.textContent?.includes('PAYPAL50') === true &&
        document.getElementById('sniper-results')?.textContent?.includes('REJECTED_VOUCHER_VOIDS_RETURNS') === true,
    );
    await hold(page, 1500);
    await shot(page, 'live-05b-deal-sniper.png');
    await page.click('#btn-part-refund');
    await page.waitForFunction(() => document.getElementById('part-available')?.textContent === '$350.00');
    await hold(page, 800);

    console.log('demo: beat 3 — sync grid + connectors');
    await page.click('#tab-desk');
    await page.click('#ds-sync');
    await page.waitForFunction(
      () => document.getElementById('sync-body')?.textContent?.includes('VERIPACT_PROTECTED') === true,
    );
    await page.evaluate(() => {
      document.getElementById('sync-shell')?.scrollIntoView({ block: 'start' });
    });
    await hold(page, 1200);
    await shot(page, 'live-06-sync-grid.png');
    await page.click('#btn-mint-chatgpt');
    await page.waitForFunction(
      () =>
        !(document.getElementById('chatgpt-token-out')?.hidden ?? true) &&
        ((document.getElementById('chatgpt-token-out')?.textContent ?? '').length > 40),
    );
    await page.click('#btn-mint-mcp');
    await page.waitForFunction(
      () =>
        !(document.getElementById('mcp-token-out')?.hidden ?? true) &&
        ((document.getElementById('mcp-token-out')?.textContent ?? '').length > 40),
    );
    await page.evaluate(() => {
      document.getElementById('connectors-row')?.scrollIntoView({ block: 'start' });
    });
    await hold(page, 1200);
    await shot(page, 'live-07-connectors.png');

    console.log('demo: beat 4 — normal checkout ($297.00 CAPTURED) + auditor');
    await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
    await waitBanner(page, 'captured');
    await hold(page, 1200);
    await page.evaluate(() => {
      const a = document.getElementById('auditor') as HTMLDetailsElement | null;
      if (a !== null && !a.open) {
        a.open = true;
      }
    });
    await page.waitForFunction(
      () =>
        document.getElementById('auditor-body')?.textContent?.includes('JCS-PARITY MATCH') === true,
    );
    await hold(page, 1500);
    await shot(page, 'live-08-capture-auditor.png');

    console.log('demo: beat 5 — surcharge auto-void ($340.50 > $320.00 cap)');
    await page.click('button[data-scn="surcharge_void"]');
    await hold(page, 800);
    await page.click('#btn-checkout');
    await waitBanner(page, 'voided');
    await hold(page, 1500);
    await shot(page, 'live-09-void.png');

    console.log('demo: beat 6 — adversarial DOM blocked pre-checkout');
    await page.click('button[data-scn="adversarial_hidden_dom"]');
    await hold(page, 800);
    await page.click('#btn-witness');
    await page.waitForFunction(
      () =>
        document.getElementById('checkout-status')?.textContent?.includes('Gate decision') === true,
    );
    await page.click('#btn-checkout');
    await waitBanner(page, 'blocked');
    await hold(page, 1500);
    await shot(page, 'live-10-block.png');

    console.log('demo: beat 7 — restore capture, file + resolve buyer forgery');
    await page.click('button[data-scn="normal"]');
    await hold(page, 800);
    await page.click('#btn-checkout');
    await waitBanner(page, 'captured');
    await hold(page, 1000);
    await page.click('#btn-sim-forgery');
    await page.waitForFunction(
      () =>
        document
          .getElementById('insp-seller')
          ?.textContent?.includes('BUYER_FORGERY_DETECTED') === true,
    );
    await hold(page, 1500);
    await shot(page, 'live-11-forgery-filed.png');
    await page.click('#btn-resolve');
    await page.waitForFunction(
      () => document.getElementById('insp-seller')?.textContent?.includes('RESOLVED') === true,
    );
    await hold(page, 1200);
    await shot(page, 'live-12-forgery-resolved.png');

    console.log('demo: beat 8 — Case A drift + 24-scenario regression suite');
    await clickCaseRow(page, 'merchant_drift');
    await page.waitForFunction(
      () =>
        document
          .getElementById('insp-seller')
          ?.textContent?.includes('MERCHANT_DRIFT_CONFIRMED') === true,
    );
    await hold(page, 1200);
    await page.evaluate(() => {
      document.getElementById('inspector')?.scrollIntoView({ block: 'start' });
    });
    await hold(page, 600);
    await shot(page, 'live-13-drift-inspected.png');
    await page.click('#btn-resolve');
    await page.waitForFunction(
      () => document.getElementById('insp-seller')?.textContent?.includes('RESOLVED') === true,
    );
    await hold(page, 800);
    await page.click('#ds-regression');
    await page.waitForSelector('#matrix-wrap table');
    const presets = await page.$$('#preset-list button');
    if (presets[2] === undefined) {
      throw new Error('demo: regression preset button missing');
    }
    await presets[2].click();
    await page.waitForFunction(
      () => document.getElementById('chart-table')?.textContent?.includes('72/72') === true,
    );
    await hold(page, 1500);
    await shot(page, 'live-14-regression.png');

    const video = page.video();
    await context.close();
    if (video === null) {
      throw new Error('demo: no video attachment on the demo page');
    }
    const rawPath = await video.path();
    if (!existsSync(rawPath)) {
      throw new Error(`demo: recorded video missing at ${rawPath}`);
    }
    const dest = join(VIDEOS, 'veripact-demo-tour.webm');
    rmSync(dest, { force: true });
    renameSync(rawPath, dest);
    console.log(`demo: video saved to ${dest}`);
  } finally {
    await browser.close();
    resetDemoState();
    rmSync(join(ROOT, '.vitest-tmp', 'demo-wallet-state.json'), { force: true });
  }
  if (problems.length > 0) {
    console.log(`demo: FAIL — ${problems.length} page problem(s):`);
    for (const p of problems.slice(0, 10)) {
      console.log(`demo:   ${p}`);
    }
    process.exitCode = 1;
  } else {
    console.log('demo: DONE — 16 PNGs + .webm, zero page problems');
  }
}

main().catch((e: unknown) => {
  console.error(`demo: FATAL: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
