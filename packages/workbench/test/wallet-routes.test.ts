import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ConnectorScope,
  PairingSession,
  PartitionSpec,
  PartitionSpendCheckVerdict,
  SyncPaymentRecord,
} from '@veripact/core';
import {
  handleWorkbenchRequest,
  resetDemoState,
  ROUTES,
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
] as const;

// Hermetic env (mirrors workbench.test.ts) + an isolated wallet store file
// so wallet route tests never touch the repo-root demo store.
const ABSENT_ENV = join(process.cwd(), '.vitest-tmp', 'absent-credentials.env');
const WALLET_STATE = join(process.cwd(), '.vitest-tmp', 'wallet-routes-state.json');

const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of ENV_VARS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.VERIPACT_ENV_FILE = ABSENT_ENV;
  process.env.VERIPACT_WALLET_STATE_FILE = WALLET_STATE;
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
    ]) {
      expect(res.body).toContain(`id="${id}"`);
    }
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
});
