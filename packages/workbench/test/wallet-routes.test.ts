import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script, runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ConnectorScope,
  PairingSession,
  PartitionSpec,
  PartitionSpendCheckVerdict,
  SyncPaymentRecord,
} from '@veripact/core';
import type { LiveWebHuntResult } from '@veripact/sdk';
import { resolveWalletStateFile } from '@veripact/sdk';
import { resolveFleetStateFile } from '../src/fleet-store';
import {
  handleWorkbenchRequest,
  resetDemoState,
  ROUTES,
  type AutonomousSubAgent,
  type FleetStateSnapshot,
  type WorkbenchResponse,
} from '../src/index';
import {
  PAIRING_PAYER_EMAIL,
  qrEncodeMatrix,
  QR_CLIENT_JS,
  qrMatrixToSvg,
  renderPairPage,
} from '../src/wallet-template';

interface CapturedResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

async function call(
  method: string,
  pathname: string,
  body?: unknown,
  rawBody?: string,
): Promise<CapturedResponse> {
  const captured: CapturedResponse = { status: 0, headers: {}, body: '' };
  const res: WorkbenchResponse = {
    writeHead(code: number, headers: Record<string, string>): void {
      captured.status = code;
      captured.headers = headers;
    },
    end(responseBody: string): void {
      captured.body = responseBody;
    },
  };
  await handleWorkbenchRequest(
    {
      method,
      url: pathname,
      bodyText: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    },
    res,
  );
  return captured;
}

const get = (pathname: string): Promise<CapturedResponse> => call('GET', pathname);
const post = (pathname: string, body?: unknown, rawBody?: string): Promise<CapturedResponse> =>
  call('POST', pathname, body, rawBody);

function json<T>(res: CapturedResponse): T {
  return JSON.parse(res.body) as T;
}

const ENV_VARS = [
  'BUYER_ED25519_PRIVATE_KEY',
  'WITNESS_ED25519_PRIVATE_KEY',
  'MERCHANT_ED25519_PRIVATE_KEY',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'VERIPACT_ENV_FILE',
  'VERIPACT_WALLET_STATE_FILE',
  'VERIPACT_FLEET_STATE_FILE',
] as const;

// Hermetic env (mirrors workbench.test.ts) + an isolated wallet store file
// so wallet route tests never touch the repo-root demo store.
const ABSENT_ENV = join(process.cwd(), '.vitest-tmp', 'absent-credentials.env');
const WALLET_STATE = join(process.cwd(), '.vitest-tmp', 'wallet-routes-state.json');
const FLEET_STATE = join(process.cwd(), '.vitest-tmp', 'fleet-routes-state.json');

const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of ENV_VARS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.VERIPACT_ENV_FILE = ABSENT_ENV;
  process.env.VERIPACT_WALLET_STATE_FILE = WALLET_STATE;
  process.env.VERIPACT_FLEET_STATE_FILE = FLEET_STATE;
  resetDemoState();
});
afterEach(() => {
  for (const key of ENV_VARS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

interface PairStartPayload {
  session: PairingSession;
  qrPairUrl: string;
  pairingCode: string;
}

interface PairStatusPayload {
  session: PairingSession;
  partition: PartitionSpec | null;
}

interface PairApprovePayload {
  session: PairingSession;
  partition: PartitionSpec;
}

interface PartitionsPayload {
  partition: PartitionSpec | null;
  orders: Array<{ orderId: string; status: string; captureId?: string }>;
}

interface SpendDryPayload {
  verdict: PartitionSpendCheckVerdict;
  partition: PartitionSpec;
}

interface SpendFullPayload {
  outcome: string;
  orderId?: string;
  captureId?: string;
  finalTotalUsd?: number;
  partitionAvailableUsd: number;
  partition: PartitionSpec;
  snapshot: { commitment: string };
}

interface RefundPayload {
  refund: { refundId: string; captureId: string; amountUsd: number };
  partition: PartitionSpec;
}

interface SyncPayload {
  records: SyncPaymentRecord[];
  summary: { totalCount: number; protectedCount: number; legacyUnwitnessedCount: number };
  indexingDelayDisclosure: string;
  reportingScopeStatus: string;
}

interface ConnectorPayload {
  connector: ConnectorScope;
  bearerTokenOnce: string;
}

interface LedgerPayload {
  entries: Array<{ seq: number; kind: string; summary: string }>;
}

async function pairAndApprove(): Promise<PairApprovePayload> {
  const started = json<PairStartPayload>(await post('/api/wallet/pair/start', {}));
  const approved = await post('/api/wallet/pair/approve', { sessionId: started.session.sessionId });
  expect(approved.status).toBe(200);
  return json<PairApprovePayload>(approved);
}

describe('@veripact/workbench v5 wallet routes', () => {
  it('lists wallet paths in ROUTES', () => {
    for (const path of [
      '/pair/:sessionId',
      '/api/wallet/pair/start',
      '/api/wallet/pair/status',
      '/api/wallet/pair/approve',
      '/api/wallet/partitions',
      '/api/wallet/spend-check',
      '/api/wallet/refund',
      '/api/wallet/sync',
      '/api/wallet/connectors',
    ]) {
      expect(ROUTES).toContain(path);
    }
  });

  it('runs the full QR pairing ceremony: start -> pair page -> approve -> status', async () => {
    const started = await post('/api/wallet/pair/start', {});
    expect(started.status).toBe(200);
    expect(started.headers['x-frame-options']).toBe('DENY');
    const body = json<PairStartPayload>(started);
    expect(body.session.sessionId).toBe('PAIR-VP-0001');
    expect(body.session.status).toBe('PENDING_SCAN');
    expect(body.qrPairUrl).toBe('/pair/PAIR-VP-0001');
    expect(body.pairingCode).toMatch(/^\d{6}$/);
    expect(body.session.transportMode).toBe('DETERMINISTIC_SANDBOX_REPLAY');

    const page = await get(`/pair/${body.session.sessionId}`);
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(page.body).toContain('Phone QR Pairing Ceremony');
    expect(page.body).toContain(body.session.sessionId);
    expect(page.body).toContain(body.pairingCode);
    expect(page.body).toContain(PAIRING_PAYER_EMAIL);
    expect(page.body).toContain('VERIPACT_WALLET_PAIRED');
    expect(page.body).toContain('Approve &amp; Link PayPal Account');

    const approved = await post('/api/wallet/pair/approve', {
      sessionId: body.session.sessionId,
    });
    expect(approved.status).toBe(200);
    const approval = json<PairApprovePayload>(approved);
    expect(approval.session.status).toBe('APPROVED');
    expect(approval.session.vaultId).toBe('PM-VP-VAULT-0001');
    expect(approval.session.payerEmail).toBe(PAIRING_PAYER_EMAIL);
    expect(approval.partition.totalAllocatedUsd).toBe(350);
    expect(approval.partition.maxPerOrderUsd).toBe(320);
    expect(approval.partition.askHumanAboveUsd).toBe(300);
    expect(approval.partition.availableUsd).toBe(350);
    expect(approval.partition.status).toBe('ACTIVE');

    const status = await get(`/api/wallet/pair/status?sessionId=${body.session.sessionId}`);
    expect(status.status).toBe(200);
    const statusBody = json<PairStatusPayload>(status);
    expect(statusBody.session.status).toBe('APPROVED');
    expect(statusBody.partition?.availableUsd).toBe(350);

    const ledger = json<LedgerPayload>(await get('/api/ledger'));
    const kinds = ledger.entries.map((e) => e.kind);
    expect(kinds).toContain('wallet-pair-start');
    expect(kinds).toContain('wallet-pair-approve');
  });

  it('rejects invalid pairing tokens with 400 and unknown sessions with 404', async () => {
    expect((await get('/pair/nope')).status).toBe(400);
    expect((await get('/pair/PAIR-VP-')).status).toBe(400);
    expect((await get('/pair/PAIR-VP-....')).status).toBe(400);
    expect((await get('/pair/PAIR-VP-9999')).status).toBe(404);
    expect((await get('/api/wallet/pair/status')).status).toBe(400);
    expect((await get('/api/wallet/pair/status?sessionId=bogus')).status).toBe(400);
    expect((await get('/api/wallet/pair/status?sessionId=PAIR-VP-9999')).status).toBe(404);
    const unknown = await post('/api/wallet/pair/approve', { sessionId: 'PAIR-VP-9999' });
    expect(unknown.status).toBe(400);
    expect((await post('/pair/PAIR-VP-0001', {})).status).toBe(405);
  });

  it('reports a null partition before pairing and upserts on POST', async () => {
    const empty = json<PartitionsPayload>(await get('/api/wallet/partitions'));
    expect(empty.partition).toBeNull();
    expect(empty.orders).toEqual([]);

    const created = await post('/api/wallet/partitions', {
      label: 'Agentic Partition',
      totalAllocatedUsd: 350,
      maxPerOrderUsd: 320,
      askHumanAboveUsd: 300,
    });
    expect(created.status).toBe(200);
    const partition = json<PartitionSpec>(created);
    expect(partition.availableUsd).toBe(350);
    expect(partition.buyerSignatureHex).toMatch(/^[0-9a-f]{128}$/);

    const after = json<PartitionsPayload>(await get('/api/wallet/partitions'));
    expect(after.partition?.availableUsd).toBe(350);

    expect((await post('/api/wallet/partitions', { label: '' })).status).toBe(400);
    expect(
      (
        await post('/api/wallet/partitions', {
          label: 'x',
          totalAllocatedUsd: -5,
          maxPerOrderUsd: 320,
          askHumanAboveUsd: 300,
        })
      ).status,
    ).toBe(400);
  });

  it('dry-runs spend verdicts without PayPal calls', async () => {
    await pairAndApprove();
    const allow = json<SpendDryPayload>(
      await post('/api/wallet/spend-check', {
        dryRun: true,
        requestedAmountUsd: 297,
        hasWitnessedReceipt: true,
      }),
    );
    expect(allow.verdict.decision).toBe('ALLOW_AUTONOMOUS');
    expect(allow.verdict.allowed).toBe(true);
    expect(allow.verdict.availableBeforeUsd).toBe(350);
    expect(allow.verdict.availableAfterUsd).toBe(53);

    const unwitnessed = json<SpendDryPayload>(
      await post('/api/wallet/spend-check', {
        dryRun: true,
        requestedAmountUsd: 10,
        hasWitnessedReceipt: false,
      }),
    );
    expect(unwitnessed.verdict.decision).toBe('BLOCK_UNWITNESSED_MERCHANT');

    const overAsk = json<SpendDryPayload>(
      await post('/api/wallet/spend-check', {
        dryRun: true,
        requestedAmountUsd: 310,
        hasWitnessedReceipt: true,
      }),
    );
    expect(overAsk.verdict.decision).toBe('ASK_HUMAN_OVER_THRESHOLD');

    // Pure preview: no orders persisted, no balance moved.
    const state = json<PartitionsPayload>(await get('/api/wallet/partitions'));
    expect(state.partition?.availableUsd).toBe(350);
    expect(state.orders).toEqual([]);
    expect((await post('/api/wallet/spend-check', { dryRun: true })).status).toBe(400);
  });

  it('captures $297 then walls the second $297 against $53 remaining', async () => {
    await pairAndApprove();
    const first = await post('/api/wallet/spend-check', { scenarioId: 'normal' });
    expect(first.status).toBe(200);
    const one = json<SpendFullPayload>(first);
    expect(one.outcome).toBe('CAPTURED');
    expect(one.finalTotalUsd).toBe(297);
    expect(one.orderId).toMatch(/^ORD-VP-/);
    expect(one.captureId).toBeDefined();
    expect(one.snapshot.commitment.startsWith('VP1:')).toBe(true);
    expect(one.partitionAvailableUsd).toBe(53);
    expect(one.partition.capturedUsd).toBe(297);
    expect(one.partition.availableUsd).toBe(53);

    const second = await post('/api/wallet/spend-check', { scenarioId: 'normal' });
    expect(second.status).toBe(200);
    const two = json<SpendFullPayload>(second);
    expect(two.outcome).toBe('AUTO_VOIDED_BY_PARTITION_WALL');
    expect(two.partitionAvailableUsd).toBe(53);
    expect(two.partition.capturedUsd).toBe(297);
    expect(two.partition.availableUsd).toBe(53);

    const ledger = json<LedgerPayload>(await get('/api/ledger'));
    const spends = ledger.entries.filter((e) => e.kind === 'wallet-spend');
    expect(spends.length).toBe(2);
    expect((await post('/api/wallet/spend-check', { scenarioId: 'nope' })).status).toBe(400);
  });

  it('blocks partition spend on refurbished SKU due to condition gate and keeps partition balance untouched', async () => {
    await pairAndApprove();
    const res = await post('/api/wallet/spend-check', {
      scenarioId: 'normal',
      sku: 'APEX-27-4K-IPS-RB',
    });
    expect(res.status).toBe(200);
    const body = json<{
      outcome: string;
      reason: string;
      gateResult: { decision: string; reasons: string[] };
      partition: PartitionSpec;
      sku: string;
    }>(res);
    expect(body.outcome).toBe('BLOCKED_PRE_CHECKOUT');
    expect(body.gateResult.decision).toBe('BLOCK');
    expect(body.reason).toMatch(/condition/i);
    expect(body.partition.capturedUsd).toBe(0);
    expect(body.partition.availableUsd).toBe(350);
  });

  it('captures compliant SKU (KANSO-Q35) on partition spend with exact amount $167.00', async () => {
    await pairAndApprove();
    const res = await post('/api/wallet/spend-check', {
      scenarioId: 'normal',
      sku: 'KANSO-Q35',
    });
    expect(res.status).toBe(200);
    const body = json<SpendFullPayload & { sku: string }>(res);
    expect(body.outcome).toBe('CAPTURED');
    expect(body.sku).toBe('KANSO-Q35');
    expect(body.finalTotalUsd).toBe(167);
    expect(body.partition.capturedUsd).toBe(167);
    expect(body.partition.availableUsd).toBe(183);
  });

  it('refunds the capture and restores $53 back to $350', async () => {
    await pairAndApprove();
    const spent = json<SpendFullPayload>(await post('/api/wallet/spend-check', { scenarioId: 'normal' }));
    expect(spent.partition.availableUsd).toBe(53);

    const refunded = await post('/api/wallet/refund', {});
    expect(refunded.status).toBe(200);
    const refund = json<RefundPayload>(refunded);
    expect(refund.refund.amountUsd).toBe(297);
    expect(refund.refund.captureId).toBe(spent.captureId);
    expect(refund.partition.refundedUsd).toBe(297);
    expect(refund.partition.availableUsd).toBe(350);

    // Second refund of the same capture is a loud 400, not a double credit.
    expect((await post('/api/wallet/refund', {})).status).toBe(400);
    expect((await post('/api/wallet/refund', { captureId: 'CAPTURE-VP-9999' })).status).toBe(400);
    const state = json<PartitionsPayload>(await get('/api/wallet/partitions'));
    expect(state.partition?.availableUsd).toBe(350);
  });

  it('syncs legacy vs protected payments with the indexing disclosure', async () => {
    await pairAndApprove();
    await post('/api/wallet/spend-check', { scenarioId: 'normal' });
    const res = await get('/api/wallet/sync');
    expect(res.status).toBe(200);
    const sync = json<SyncPayload>(res);
    const legacy = sync.records.filter((r) => r.protectionClass === 'LEGACY_UNWITNESSED');
    const guarded = sync.records.filter((r) => r.protectionClass === 'VERIPACT_PROTECTED');
    expect(legacy.length).toBe(3);
    expect(legacy.every((r) => r.commitment === undefined)).toBe(true);
    expect(guarded.length).toBeGreaterThan(0);
    expect(guarded.every((r) => r.commitment?.startsWith('VP1:') ?? false)).toBe(true);
    expect(sync.summary.legacyUnwitnessedCount).toBe(3);
    expect(sync.summary.protectedCount).toBe(guarded.length);
    expect(sync.summary.totalCount).toBe(sync.records.length);
    expect(sync.indexingDelayDisclosure).toContain('3-hour indexing delay');
    expect(sync.reportingScopeStatus).toBe('FALLBACK_TO_REPLAY_AND_SESSION_ORDERS');
    expect((await post('/api/wallet/sync', {})).status).toBe(405);
  });

  it('mints connector tokens once and never leaks them in later reads', async () => {
    await pairAndApprove();
    const chat = await post('/api/wallet/connectors', { platform: 'CHATGPT_ACTION' });
    expect(chat.status).toBe(200);
    const chatBody = json<ConnectorPayload>(chat);
    expect(chatBody.connector.platform).toBe('CHATGPT_ACTION');
    expect(chatBody.connector.openapiUrl).toBe('/openapi.json');
    expect(chatBody.bearerTokenOnce.startsWith('vp_')).toBe(true);
    expect(chatBody.connector.maskedToken).not.toContain(chatBody.bearerTokenOnce);

    const mcp = json<ConnectorPayload>(
      await post('/api/wallet/connectors', { platform: 'CLAUDE_MCP' }),
    );
    expect(mcp.connector.platform).toBe('CLAUDE_MCP');
    expect(mcp.bearerTokenOnce.startsWith('vp_')).toBe(true);
    expect(mcp.bearerTokenOnce).not.toBe(chatBody.bearerTokenOnce);

    // Raw values appear exactly once (their mint response) — later reads
    // (partitions, sync, ledger) must never carry them.
    for (const res of [
      await get('/api/wallet/partitions'),
      await get('/api/wallet/sync'),
      await get('/api/ledger'),
    ]) {
      expect(res.body).not.toContain(chatBody.bearerTokenOnce);
      expect(res.body).not.toContain(mcp.bearerTokenOnce);
    }
    expect((await post('/api/wallet/connectors', { platform: 'SKYNET' })).status).toBe(400);
    expect((await post('/api/wallet/connectors', {})).status).toBe(400);
  });

  it('answers 404 on unknown wallet sub-paths', async () => {
    expect((await get('/api/wallet/nope')).status).toBe(404);
    expect((await get('/api/wallet/pair/start')).status).toBe(405);
  });
});

describe('@veripact/workbench v5 QR encoder + pair page units', () => {
  it('encodes a deterministic version-2 matrix with finder patterns', () => {
    const a = qrEncodeMatrix('/pair/PAIR-VP-0001');
    const b = qrEncodeMatrix('/pair/PAIR-VP-0001');
    expect(a).toEqual(b);
    expect(a.version).toBe(2);
    expect(a.size).toBe(25);
    expect(a.modules.length).toBe(25);
    expect(a.modules[0]?.length).toBe(25);
    // Finder-pattern corners stay dark in every mask outcome.
    expect(a.modules[0]?.[0]).toBe(true);
    expect(a.modules[0]?.[a.size - 1]).toBe(true);
    expect(a.modules[a.size - 1]?.[0]).toBe(true);
    const svg = qrMatrixToSvg(a, 76);
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="76"');
    expect(svg).toContain('aria-label="Pairing QR code"');
  });

  it('evaluates the embedded browser source with matrix parity (node:vm)', () => {
    const direct = qrEncodeMatrix('/pair/PAIR-VP-0042');
    const viaVm = JSON.parse(
      runInNewContext(`${QR_CLIENT_JS};JSON.stringify(qrEncodeMatrix("/pair/PAIR-VP-0042"));`) as string,
    ) as { version: number; size: number; modules: boolean[][] };
    expect(viaVm).toEqual({ version: direct.version, size: direct.size, modules: direct.modules });
    const svg = runInNewContext(
      `${QR_CLIENT_JS};qrMatrixToSvg(qrEncodeMatrix("/pair/PAIR-VP-0042"),76);`,
    ) as string;
    expect(svg).toBe(qrMatrixToSvg(direct, 76));
  });

  it('renders pending vs approved pair pages without unescaped injection', () => {
    const pending: PairingSession = {
      sessionId: 'PAIR-VP-0007',
      qrPairUrl: '/pair/PAIR-VP-0007',
      pairingCode: '123456',
      status: 'PENDING_SCAN',
      createdAtUtc: '2026-11-06T00:00:00.000Z',
      expiresAtUtc: '2026-11-06T00:15:00.000Z',
      transportMode: 'DETERMINISTIC_SANDBOX_REPLAY',
    };
    const html = renderPairPage(pending);
    expect(html).toContain('123456');
    expect(html).toContain('id="btn-pair-ok"');
    expect(html).toContain('<div id="pair-action"><button');
    const approvedHtml = renderPairPage({ ...pending, status: 'APPROVED' });
    expect(approvedHtml).toContain(
      '<div id="pair-action"><div class="done">Connected! Desktop Workbench Updated</div></div>',
    );
    expect(approvedHtml).not.toContain('id="btn-pair-ok"');
    const evil = renderPairPage({ ...pending, pairingCode: '<script>alert(1)</script>' });
    expect(evil).not.toContain('<script>alert(1)</script>');
    expect(evil).toContain('&lt;script&gt;');
  });
});

describe('@veripact/workbench v5 byte-cleanliness guards', () => {
  it('serves an index page with zero NBSP and zero redactor tokens', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.body.match(/\u00a0/g) ?? []).toHaveLength(0);
    const redactorToken = '[' + 'REDACTED' + ']';
    expect(res.body).not.toContain(redactorToken);
  });

  it('renders the v5 wallet DOM ids on first paint', async () => {
    const res = await get('/');
    for (const id of [
      'wallet-card',
      'rb-partition',
      'connectors-row',
      'ds-sync',
      'sync-shell',
      'ag-sync-payments-grid',
      'btn-pair-start',
      'btn-part-spend',
      'btn-part-refund',
      'btn-part-config',
      'btn-mint-chatgpt',
      'btn-mint-mcp',
      'sniper-box',
      'sniper-target-input',
      'btn-sniper-run',
      'btn-open-anywhere',
      'sniper-results',
    ]) {
      expect(res.body).toContain(`id="${id}"`);
    }
    expect(res.body).toContain('Autonomous Deal &amp; Voucher Sniper (@veripact)');
    expect(res.body).toContain('Hunt Vouchers &amp; Auto-Buy Under $300');
  });

  it('compiles inline client script without standalone event token and exposes runSniperFlow', async () => {
    const res = await get('/');
    const scriptMatch = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/.exec(res.body);
    expect(scriptMatch).not.toBeNull();
    const script = scriptMatch?.[1] ?? '';
    expect(script).toContain('function runSniperFlow(');
    expect(script).toContain('function renderSniperResults(');
    expect(script).toContain('function sniperPillFor(');
    expect(script).toContain('function resetSniperUi(');
    const stripped = script
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:/])\/\/.*$/gm, '$1');
    expect(stripped).not.toMatch(/(?<![A-Za-z0-9_$])event(?![A-Za-z0-9_$])/);
  });
});

describe('POST /api/wallet/sniper', () => {
  it('captures the Apex voucher deal, then blocks the second sweep on the partition wall', async () => {
    const first = await post('/api/wallet/sniper', {
      sku: 'APEX-27-4K-IPS',
      targetMaxAllInUsd: 300,
    });
    expect(first.status).toBe(200);
    const captured = json<{
      outcome: string;
      trapsRejectedCount: number;
      totalSavedUsd: number;
      partitionAfter: { availableUsd: number };
    }>(first);
    expect(captured.outcome).toBe('DEAL_CAPTURED');
    expect(captured.trapsRejectedCount).toBe(5);
    expect(captured.totalSavedUsd).toBe(50);
    expect(captured.partitionAfter.availableUsd).toBe(53);
    const second = await post('/api/wallet/sniper', {
      sku: 'APEX-27-4K-IPS',
      targetMaxAllInUsd: 300,
    });
    expect(second.status).toBe(200);
    const walled = json<{ outcome: string; partitionAfter: { availableUsd: number } }>(second);
    expect(walled.outcome).toBe('BLOCKED_BY_PARTITION_WALL');
    expect(walled.partitionAfter.availableUsd).toBe(53);
    expect(
      (walled as { trapsRejectedCount?: number }).trapsRejectedCount,
    ).toBe(5);
  });

  it('rejects invalid targets, skus, and voucher codes, and rejects GET', async () => {
    for (const target of [0, -10, 99999, 'bad']) {
      const res = await post('/api/wallet/sniper', { targetMaxAllInUsd: target });
      expect(res.status).toBe(400);
      expect(json<{ error: string }>(res).error).toContain('targetMaxAllInUsd');
    }
    for (const sku of ['<script>', 'UNKNOWN-SKU-999']) {
      const res = await post('/api/wallet/sniper', { sku });
      expect(res.status).toBe(400);
      expect(json<{ error: string }>(res).error).toBe('Invalid or unknown Channel3 SKU');
    }
    const voucher = await post('/api/wallet/sniper', { customVoucherCode: 'BAD CODE!' });
    expect(voucher.status).toBe(400);
    expect(json<{ error: string }>(voucher).error).toBe('Invalid voucher code format');
    const getRes = await get('/api/wallet/sniper');
    expect(getRes.status).toBe(405);
  });

  it('resolves SKU and target ceiling automatically when prompt is passed', async () => {
    const res = await post('/api/wallet/sniper', {
      prompt: 'Buy wireless headphones under $120',
    });
    expect(res.status).toBe(200);
    const data = json<{
      outcome: string;
      sku: string;
      targetMaxAllInUsd: number;
      winningCandidate: { voucherCode?: string; allInTotalUsd: number };
    }>(res);
    expect(data.sku).toBe('KANSO-Q35');
    expect(data.targetMaxAllInUsd).toBe(120);
    expect(data.outcome).toBe('DEAL_CAPTURED');
    expect(data.winningCandidate.voucherCode).toBe('AUDIO67');
    expect(data.winningCandidate.allInTotalUsd).toBe(100);
  });
});

describe('POST /api/agents/parse-intent', () => {
  it('parses natural-language prompts across Channel3 SKUs', async () => {
    const res = await post('/api/agents/parse-intent', {
      prompt: 'Keychron mechanical keyboard under $150',
    });
    expect(res.status).toBe(200);
    const data = json<{
      matchedSku: string;
      targetMaxAllInUsd: number;
      detectedVoucherCode: string;
      parserEngine: string;
    }>(res);
    expect(data.matchedSku).toBe('KEYCHRON-K8-PRO');
    expect(data.targetMaxAllInUsd).toBe(150);
    expect(data.detectedVoucherCode).toBe('MECH30');
    expect(data.parserEngine).toBe('DETERMINISTIC_SEMANTIC_CATALOG');
  });

  it('rejects GET with 405', async () => {
    const res = await get('/api/agents/parse-intent');
    expect(res.status).toBe(405);
  });
});

describe('GET /embed/veripact-anywhere.js', () => {
  it('serves a syntax-clean overlay and embeds it on the storefront', async () => {
    const res = await get('/embed/veripact-anywhere.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/javascript');
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(() => new Script(res.body)).not.toThrow();
    const stripped = res.body
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/'(?:\\.|[^'\\])*'/g, "''")
      .replace(/"(?:\\.|[^"\\])*"/g, '""');
    expect(stripped).not.toMatch(/(?:^|[^\w$])event(?:[^\w$]|$)/);
    expect(res.body).toContain('host.id="veripact-anywhere-host"');
    expect(res.body).toContain('targetMaxAllInUsd must be between 1 and 10000');
    expect(res.body).toContain('return null;');
    expect(res.body).toContain('function(e)');
    expect(res.body).not.toMatch(/\beval\s*\(/);
    const store = await get('/store/normal');
    expect(store.status).toBe(200);
    expect(store.body).toContain('<script src="/embed/veripact-anywhere.js" defer></script>');
  });
});

describe('@veripact/workbench Onboarding & Multi-Agent Fleet Routes', () => {
  it('POST /api/onboarding/complete sets up a Clerk/Google user session, links PayPal Vault with a $350 master partition, and creates 3 sub-agents ($200 + $100 + $50 = $350)', async () => {
    // Check initial state before onboarding
    const initialRes = await get('/api/onboarding/state');
    expect(initialRes.status).toBe(200);
    const initialFleet = json<FleetStateSnapshot>(initialRes);
    expect(initialFleet.user).toBeNull();
    expect(initialFleet.masterPartitionUsd).toBe(350);
    expect(initialFleet.agents.length).toBe(3);

    // Complete onboarding with 3 sub-agents ($200 + $100 + $50 = $350)
    const res = await post('/api/onboarding/complete', {
      email: 'alex.chen@example.com',
      displayName: 'Alex Chen',
      authProvider: 'CLERK_GOOGLE_OAUTH',
      clerkToken: 'clerk_test_token_987',
      paypalPayerEmail: 'alex.chen.paypal@example.com',
      masterPartitionUsd: 350,
      initialAgents: [
        {
          name: 'Monitor Sniper',
          sku: 'APEX-27-4K-IPS',
          targetMaxAllInUsd: 300,
          subAllocationUsd: 200,
          autoBuyEnabled: true,
        },
        {
          name: 'Kanso Audio Bot',
          sku: 'KANSO-Q35',
          targetMaxAllInUsd: 100,
          subAllocationUsd: 100,
          autoBuyEnabled: true,
        },
        {
          name: 'Dock Deal Bot',
          sku: 'VIREO-DOCK-C',
          targetMaxAllInUsd: 60,
          subAllocationUsd: 50,
          autoBuyEnabled: true,
        },
      ],
    });

    expect(res.status).toBe(200);
    const fleet = json<FleetStateSnapshot>(res);
    expect(fleet.user).not.toBeNull();
    expect(fleet.user?.email).toBe('alex.chen@example.com');
    expect(fleet.user?.displayName).toBe('Alex Chen');
    expect(fleet.user?.authProvider).toBe('CLERK_GOOGLE_OAUTH');
    expect(fleet.user?.clerkSessionId).toBe('clerk_test_token_987');
    expect(fleet.user?.paypalConnected).toBe(true);
    expect(fleet.user?.paypalVaultTokenId).toMatch(/^PM-VP-VAULT-/);
    expect(fleet.masterPartitionUsd).toBe(350);
    expect(fleet.totalSubAllocatedUsd).toBe(350);
    expect(fleet.unallocatedMasterUsd).toBe(0);
    expect(fleet.agents.length).toBe(3);

    // Verify GET /api/onboarding/state returns identical state
    const checkRes = await get('/api/onboarding/state');
    expect(checkRes.status).toBe(200);
    const checkFleet = json<FleetStateSnapshot>(checkRes);
    expect(checkFleet.user?.email).toBe('alex.chen@example.com');
    expect(checkFleet.totalSubAllocatedUsd).toBe(350);
    expect(checkFleet.unallocatedMasterUsd).toBe(0);
  });

  it('POST /api/agents/spawn rejects a sub-agent whose subAllocationUsd exceeds the unallocated master partition balance with 400', async () => {
    // Clean state has 2 sub-agents ($220 + $100 = $320), master partition = $350, unallocated = $30.00
    const stateRes = await get('/api/onboarding/state');
    const state = json<FleetStateSnapshot>(stateRes);
    expect(state.totalSubAllocatedUsd).toBe(320);
    expect(state.unallocatedMasterUsd).toBe(30);

    // Try to allocate $50 when only $30 is available
    const failRes = await post('/api/agents/spawn', {
      name: 'Greedy Bot',
      sku: 'VIREO-DOCK-C',
      targetMaxAllInUsd: 70,
      subAllocationUsd: 50,
      autoBuyEnabled: true,
    });
    expect(failRes.status).toBe(400);
    const failBody = json<{ error: string }>(failRes);
    expect(failBody.error).toBe(
      'wallet: sub-allocation ($50.00) exceeds unallocated master partition balance ($30.00 available of $350.00 master cap).',
    );

    // Also test onboarding setup where initial agents exceed master partition ($150 + $150 + $100 = $400 with $350 master partition)
    const failOnboarding = await post('/api/onboarding/complete', {
      email: 'exceed@example.com',
      displayName: 'Exceed User',
      authProvider: 'DEMO_PASSKEY',
      masterPartitionUsd: 350,
      initialAgents: [
        { name: 'Bot 1', sku: 'APEX-27-4K-IPS', targetMaxAllInUsd: 200, subAllocationUsd: 150 },
        { name: 'Bot 2', sku: 'KANSO-Q35', targetMaxAllInUsd: 200, subAllocationUsd: 150 },
        { name: 'Bot 3', sku: 'VIREO-DOCK-C', targetMaxAllInUsd: 150, subAllocationUsd: 100 },
      ],
    });
    expect(failOnboarding.status).toBe(400);
    const failOnboardingBody = json<{ error: string }>(failOnboarding);
    expect(failOnboardingBody.error).toBe(
      'wallet: sub-allocation ($100.00) exceeds unallocated master partition balance ($50.00 available of $350.00 master cap).',
    );
  });

  it('POST /api/agents/webhook/price-drop for KANSO-Q35 (newBasePriceUsd: 82, $100.00 all-in) wakes up the $100 ARMED_WATCHING Kanso sub-agent, verifies WIT terms, captures $100.00 via PayPal with a VP1: commitment, and reduces that sub-agent\'s remainingSubAllocationUsd from $100.00 to $0.00!', async () => {
    // Initial clean reset state has Agent-02: Kanso Audio Bot with $100.00 sub-allocation / $100.00 target
    const preRes = await get('/api/onboarding/state');
    const preFleet = json<FleetStateSnapshot>(preRes);
    const kansoPre = preFleet.agents.find((a) => a.sku === 'KANSO-Q35');
    expect(kansoPre).toBeDefined();
    expect(kansoPre!.status).toBe('ARMED_WATCHING');
    expect(kansoPre!.subAllocationUsd).toBe(100);
    expect(kansoPre!.remainingSubAllocationUsd).toBe(100);
    expect(kansoPre!.spentUsd).toBe(0);

    // Trigger price drop: new base price $82.00 + $11.50 shipping + $6.50 tax = $100.00 all-in
    const dropRes = await post('/api/agents/webhook/price-drop', {
      sku: 'KANSO-Q35',
      newBasePriceUsd: 82,
      triggerType: 'CHANNEL3_PRICE_DROP_WEBHOOK',
    });
    expect(dropRes.status).toBe(200);
    const dropBody = json<{
      triggeredAgents: AutonomousSubAgent[];
      fleet: FleetStateSnapshot;
    }>(dropRes);

    const triggeredKanso = dropBody.triggeredAgents.find((a) => a.sku === 'KANSO-Q35');
    expect(triggeredKanso).toBeDefined();
    expect(triggeredKanso!.status).toBe('GOAL_CAPTURED');
    expect(triggeredKanso!.capturedAmountUsd).toBe(100);
    expect(triggeredKanso!.commitment).toMatch(/^VP1:/);
    expect(triggeredKanso!.capturedOrderId).toBeDefined();
    expect(triggeredKanso!.capturedOrderId).toMatch(/^ORD-VP-/);
    expect(triggeredKanso!.remainingSubAllocationUsd).toBe(0);
    expect(triggeredKanso!.spentUsd).toBe(100);
    expect(triggeredKanso!.savedUsd).toBeGreaterThanOrEqual(0);

    // Verify in updated fleet snapshot as well
    const kansoPost = dropBody.fleet.agents.find((a) => a.sku === 'KANSO-Q35');
    expect(kansoPost?.status).toBe('GOAL_CAPTURED');
    expect(kansoPost?.remainingSubAllocationUsd).toBe(0);
    expect(kansoPost?.spentUsd).toBe(100);
  });

  it('POST /api/agents/webhook/price-drop blocks when the price drop ($120.00 all-in) exceeds the agent\'s $100.00 sub-allocation wall (BLOCKED_SUB_ALLOCATION_WALL)', async () => {
    // Initial state has Agent-02: Kanso Audio Bot with $100 sub-allocation.
    // Trigger price drop with newBasePriceUsd: 102 ($102 + $11.50 shipping + $6.50 tax = $120.00 all-in).
    const dropRes = await post('/api/agents/webhook/price-drop', {
      sku: 'KANSO-Q35',
      newBasePriceUsd: 102,
      triggerType: 'CHANNEL3_PRICE_DROP_WEBHOOK',
    });
    expect(dropRes.status).toBe(200);
    const dropBody = json<{
      triggeredAgents: AutonomousSubAgent[];
      fleet: FleetStateSnapshot;
    }>(dropRes);

    const kansoAgent = dropBody.triggeredAgents.find((a) => a.sku === 'KANSO-Q35');
    expect(kansoAgent).toBeDefined();
    expect(kansoAgent!.status).toBe('BLOCKED_SUB_ALLOCATION_WALL');
    expect(kansoAgent!.spentUsd).toBe(0);
    expect(kansoAgent!.remainingSubAllocationUsd).toBe(100);
    expect(kansoAgent!.capturedOrderId).toBeUndefined();
    expect(kansoAgent!.lastEventSummary).toContain('Blocked by sub-allocation wall');
  });

  it('POST /api/onboarding/complete allows 1-step direct PayPal onboarding with optional budget (skipBudgetAllocation: true)', async () => {
    const res = await post('/api/onboarding/complete', {
      paypalPayerEmail: 'bhavik@paypal.com',
      skipBudgetAllocation: true,
    });
    expect(res.status).toBe(200);
    const fleet = json<FleetStateSnapshot>(res);
    expect(fleet.user).not.toBeNull();
    expect(fleet.user?.paypalConnected).toBe(true);
    expect(fleet.user?.paypalVaultTokenId).toBe('PM-VP-VAULT-0001');
    expect(fleet.user?.fetchedBalanceUsd).toBe(1250.0);
    expect(fleet.user?.masterPartitionUsd).toBe(0);
    expect(fleet.user?.displayName).toBe('Bhavik');
  });

  it('POST /api/agents/poll-now polls background ARMED_WATCHING agents, increments pollCount, and auto-captures on price drop', async () => {
    resetDemoState();
    const pollRes = await post('/api/agents/poll-now', {
      simulatedCatalogPrices: {
        'KANSO-Q35': { basePriceUsd: 82, voucherCode: 'AUDIO67' },
      },
    });
    expect(pollRes.status).toBe(200);
    const body = json<{
      polledAgents: AutonomousSubAgent[];
      capturedOrders: Array<{ agentId: string; orderId: string; amountUsd: number }>;
      fleet: FleetStateSnapshot;
    }>(pollRes);
    expect(body.polledAgents.length).toBeGreaterThanOrEqual(1);
    const polledKanso = body.polledAgents.find((a) => a.sku === 'KANSO-Q35');
    expect(polledKanso).toBeDefined();
    expect(polledKanso!.pollCount).toBeGreaterThanOrEqual(1);
    expect(polledKanso!.lastPolledAtUtc).toBeDefined();
    expect(body.capturedOrders.length).toBeGreaterThanOrEqual(1);
    expect(body.capturedOrders[0]?.amountUsd).toBe(100.0);
  });
});

describe('POST /api/agents/web-hunt (live web coupon & wild-URL hunter)', () => {
  it('is mounted on ROUTES and rejects GET with 405', async () => {
    expect(ROUTES).toContain('/api/agents/web-hunt');
    const res = await get('/api/agents/web-hunt');
    expect(res.status).toBe(405);
  });

  it('discovers verified coupons and rejects policy-voiding ones for a catalog query', async () => {
    resetDemoState();
    const res = await post('/api/agents/web-hunt', {
      queryOrUrl: 'wireless headphones under $120',
      targetMaxAllInUsd: 120,
    });
    expect(res.status).toBe(200);
    const body = json<LiveWebHuntResult>(res);
    expect(body.mode).toBe('CATALOG_AND_COUPON_SEARCH');
    expect(body.huntId.startsWith('HUNT-VP-')).toBe(true);
    expect(body.commitment.startsWith('VP1:')).toBe(true);
    expect(body.tlsVerified).toBe(false);
    expect(body.domIntegrity).toBe('CLEAN');
    expect(body.observedCondition).toBe('NEW');
    expect(body.extractedBasePriceUsd).toBe(82);
    const codes = body.discoveredCoupons.map((coupon) => coupon.code);
    expect(codes).toContain('PAYPAL50');
    expect(codes).toContain('AUDIO67');
    expect(codes).toContain('MECH30');
    const clearance = body.discoveredCoupons.find((coupon) => coupon.code === 'CLEARANCE70');
    expect(clearance?.verifiedTermsIntact).toBe(false);
    expect(clearance?.rejectionReason).toContain('return');
    const vip = body.discoveredCoupons.find((coupon) => coupon.code === 'VIP60');
    expect(vip?.verifiedTermsIntact).toBe(false);
    expect(vip?.rejectionReason).toContain('$500');
    // Highest intact discount wins: 82 + 18 ship/tax - 67 = 33.
    expect(body.appliedCoupon?.code).toBe('AUDIO67');
    expect(body.appliedCoupon?.verifiedTermsIntact).toBe(true);
    expect(body.bestAllInUsd).toBe(33);
    // No merchant page observed in catalog mode: return terms stay
    // unknown, and the witness gate hard-BLOCKs indeterminate required
    // terms ("core terms indeterminate: return_window_days").
    expect(body.observedReturnDays).toBe(0);
    expect(body.gateDecision).toBe('BLOCK');
  });

  it('rejects SSRF targets and dangerous schemes with 400', async () => {
    resetDemoState();
    const blocked = [
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:22',
      'http://10.0.0.5/admin',
      'http://192.168.1.1/',
      'http://[::1]:8080/',
      'https://user:pass@store.example.com/',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<h1>x</h1>',
      'http://example.com/plain-http-not-allowed',
    ];
    for (const queryOrUrl of blocked) {
      const res = await post('/api/agents/web-hunt', { queryOrUrl });
      expect(res.status).toBe(400);
    }
  });

  it('validates input shape and target range with 400', async () => {
    resetDemoState();
    expect((await post('/api/agents/web-hunt', {})).status).toBe(400);
    expect((await post('/api/agents/web-hunt', { queryOrUrl: '' })).status).toBe(400);
    expect((await post('/api/agents/web-hunt', { queryOrUrl: 'x'.repeat(513) })).status).toBe(400);
    expect(
      (await post('/api/agents/web-hunt', { queryOrUrl: 'headphones', targetMaxAllInUsd: 0 }))
        .status,
    ).toBe(400);
    expect(
      (
        await post('/api/agents/web-hunt', {
          queryOrUrl: 'headphones',
          targetMaxAllInUsd: 99999,
        })
      ).status,
    ).toBe(400);
  });
});

describe('Vercel serverless adapter (run 41)', () => {
  it('GET /api/agents/poll-now (Vercel Cron) and POST /api/agents/poll-now both return 200', async () => {
    resetDemoState();
    const getRes = await get('/api/agents/poll-now');
    expect(getRes.status).toBe(200);
    const getBody = json<{ polledAgents: AutonomousSubAgent[] }>(getRes);
    expect(Array.isArray(getBody.polledAgents)).toBe(true);
    const postRes = await post('/api/agents/poll-now', {});
    expect(postRes.status).toBe(200);
  });

  it("process.env.VERCEL = '1' resolves wallet/fleet state files into os.tmpdir()", () => {
    const savedVercel = process.env['VERCEL'];
    const savedWallet = process.env['VERIPACT_WALLET_STATE_FILE'];
    const savedFleet = process.env['VERIPACT_FLEET_STATE_FILE'];
    try {
      delete process.env['VERIPACT_WALLET_STATE_FILE'];
      delete process.env['VERIPACT_FLEET_STATE_FILE'];
      process.env['VERCEL'] = '1';
      expect(resolveWalletStateFile()).toBe(join(tmpdir(), '.veripact-wallet-state.json'));
      expect(resolveFleetStateFile()).toBe(join(tmpdir(), '.veripact-fleet-state.json'));
      // Explicit paths still win on Vercel (no silent rerouting).
      expect(resolveWalletStateFile('/tmp/custom.json')).toBe('/tmp/custom.json');
      expect(resolveFleetStateFile('/tmp/custom.json')).toBe('/tmp/custom.json');
    } finally {
      if (savedVercel === undefined) {
        delete process.env['VERCEL'];
      } else {
        process.env['VERCEL'] = savedVercel;
      }
      if (savedWallet === undefined) {
        delete process.env['VERIPACT_WALLET_STATE_FILE'];
      } else {
        process.env['VERIPACT_WALLET_STATE_FILE'] = savedWallet;
      }
      if (savedFleet === undefined) {
        delete process.env['VERIPACT_FLEET_STATE_FILE'];
      } else {
        process.env['VERIPACT_FLEET_STATE_FILE'] = savedFleet;
      }
    }
  });
});
