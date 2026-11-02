/**
 * `npm run demo:record` — HOST-ONLY automated demo recorder.
 *
 * Boots the workbench server, launches Chromium at 1920x1080 with video
 * capture, clicks the in-page 60s Guided Demo Tour, screenshots every beat,
 * and saves a sub-140-second `.webm` plus PNGs into `videos/` (gitignored).
 *
 * Prereqs (host machine — the sandbox blocks socket binding):
 *   npm install            # playwright ships as a devDependency
 *   npx playwright install chromium
 *   npm run demo:record
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = Number(process.env['DEMO_PORT'] ?? 4123);
const BASE = `http://127.0.0.1:${PORT}`;
const VIDEOS = join(process.cwd(), 'videos');

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function waitForHealth(server: ChildProcess, stderr: string[], timeoutMs: number): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // Server not up yet.
    }
    if (server.exitCode !== null) {
      throw new Error(`demo: workbench exited during boot:\n${stderr.join('').slice(-2000)}`);
    }
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`demo: ${BASE}/health never came up:\n${stderr.join('').slice(-2000)}`);
    }
    await sleep(500);
  }
}

async function main(): Promise<void> {
  mkdirSync(VIDEOS, { recursive: true });
  console.log(`demo: booting workbench on ${BASE} …`);
  const stderr: string[] = [];
  const server = spawn(process.execPath, ['packages/workbench/dist/index.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr?.on('data', (chunk: Buffer) => {
    stderr.push(chunk.toString('utf8'));
  });
  const stopServer = async (): Promise<void> => {
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      const t0 = Date.now();
      while (server.exitCode === null && Date.now() - t0 < 5000) {
        await sleep(200);
      }
      if (server.exitCode === null) {
        server.kill('SIGKILL');
      }
    }
  };
  try {
    await waitForHealth(server, stderr, 30000);
    console.log('demo: workbench healthy, launching Chromium (1920x1080 + video) …');
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        recordVideo: { dir: VIDEOS, size: { width: 1920, height: 1080 } },
      });
      const page = await context.newPage();
      const waitBeat = async (want: string, timeoutMs: number): Promise<void> => {
        const t0 = Date.now();
        for (;;) {
          const status = (await page.textContent('#tour-status')) ?? '';
          if (status.includes('Tour stopped') || status.includes('Tour paused')) {
            throw new Error(`demo: tour failed early (${status})`);
          }
          if (status.includes(want)) {
            return;
          }
          if (Date.now() - t0 > timeoutMs) {
            throw new Error(`demo: timed out waiting for "${want}" (last: "${status}")`);
          }
          await page.waitForTimeout(1000);
        }
      };
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.screenshot({ path: join(VIDEOS, 'shot-00-landing.png') });
      console.log('demo: starting the 5-beat guided tour …');
      await page.click('#btn-tour');
      const beats = ['Beat 1/5', 'Beat 2/5', 'Beat 3/5', 'Beat 4/5', 'Beat 5/5'];
      for (const [i, beat] of beats.entries()) {
        await waitBeat(beat, 90000);
        await page.waitForTimeout(4000);
        const shot = join(VIDEOS, `shot-0${String(i + 1)}-beat-${String(i + 1)}.png`);
        await page.screenshot({ path: shot });
        console.log(`demo: ${beat} captured (${shot})`);
      }
      await waitBeat('Tour complete', 120000);
      await page.screenshot({ path: join(VIDEOS, 'shot-06-finale.png') });
      const video = page.video();
      await context.close();
      if (video !== null) {
        const rawPath = await video.path();
        if (existsSync(rawPath)) {
          const dest = join(VIDEOS, 'veripact-demo-tour.webm');
          renameSync(rawPath, dest);
          console.log(`demo: video saved to ${dest}`);
        }
      }
      console.log('demo: done — PNGs + .webm are in videos/ (gitignored).');
    } finally {
      await browser.close();
    }
  } finally {
    await stopServer();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
