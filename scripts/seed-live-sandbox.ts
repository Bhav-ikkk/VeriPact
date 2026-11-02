/**
 * `npm run seed:sandbox` — seed the PayPal Sandbox (or deterministic replay)
 * with witnessed VeriPact orders and write `docs/sandbox-receipts.json`.
 *
 * With `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` in `.env` (or the
 * environment) this talks to the real sandbox: witnessed snapshot →
 * AUTHORIZE order with `VP1:` custom_id → PATCH shipping/tax → read-back,
 * a second order for the surcharge flow, and a live dispute listing.
 * Approval + authorize + capture stay manual (they need a browser payer).
 * Without credentials it runs the identical steps against
 * `DETERMINISTIC_SANDBOX_REPLAY` and prints setup instructions. Secrets are
 * never printed — only presence and PayPal-issued ids.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VeriPactClient } from '@veripact/sdk';

/** Parse `.env` into process.env (real environment always wins). */
function loadDotEnv(): boolean {
  const path = join(process.cwd(), '.env');
  if (!existsSync(path)) {
    return false;
  }
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match === null || match[1] === undefined) {
      continue;
    }
    if (process.env[match[1]] !== undefined) {
      continue;
    }
    let value = match[2] ?? '';
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
  return true;
}

function shortCommitment(commitment: string): string {
  return commitment.length > 20 ? `${commitment.slice(0, 18)}…` : commitment;
}

async function main(): Promise<void> {
  const envFile = loadDotEnv();
  const clientId = process.env['PAYPAL_CLIENT_ID'] ?? '';
  const clientSecret = process.env['PAYPAL_CLIENT_SECRET'] ?? '';
  const live = clientId !== '' && clientSecret !== '';
  console.log(`PayPal credentials: ${live ? 'present (LIVE sandbox)' : 'absent (deterministic replay)'}`);
  if (!live && !envFile) {
    console.log('No .env file found — copy .env.example to .env to go live.');
  }
  const client = new VeriPactClient(live ? { paypal: { clientId, clientSecret } } : {});

  // Scenario 1: witnessed snapshot → AUTHORIZE → PATCH → read-back.
  const snap = await client.witnessScenario('normal');
  console.log(`witness: ${snap.snapshot.commitment} (${snap.snapshot.gateResult.decision})`);
  const order = await client.paypal.createAuthorizeOrder({
    commitment: snap.snapshot.commitment,
    description: 'VeriPact witnessed checkout: Apex ProView 27 4K IPS Monitor',
    itemTotalUsd: 279,
  });
  const patched = await client.paypal.patchOrderShippingAndTax(order.orderId, {
    itemTotalUsd: 279,
    shippingUsd: 11.5,
    taxUsd: 6.5,
  });
  const readback = await client.paypal.getOrder(order.orderId);
  const match = readback.customId === snap.snapshot.commitment;
  console.log(`order: ${order.orderId} status=${readback.status} total=$${patched.finalTotalUsd.toFixed(2)} custom_id_match=${match}`);

  // Scenario 2: surcharge-flow order (created + patched, approval manual).
  const snap2 = await client.witnessScenario('surcharge_void');
  const order2 = await client.paypal.createAuthorizeOrder({
    commitment: snap2.snapshot.commitment,
    description: 'VeriPact witnessed checkout (surcharge flow)',
    itemTotalUsd: 279,
  });
  const patched2 = await client.paypal.patchOrderShippingAndTax(order2.orderId, {
    itemTotalUsd: 279,
    shippingUsd: 55,
    taxUsd: 6.5,
  });
  console.log(`order2: ${order2.orderId} total=$${patched2.finalTotalUsd.toFixed(2)} (surcharge demo)`);

  // Live dispute listing (whatever the account holds).
  let disputes: unknown = [];
  try {
    disputes = (await client.paypal.listDisputes()).map((d) => ({
      disputeId: d.disputeId,
      stage: d.lifeCycleStage,
      state: d.disputeState,
      status: d.status,
    }));
  } catch (e) {
    disputes = { error: e instanceof Error ? e.message : String(e) };
  }

  const receipts = {
    generatedAtUtc: new Date().toISOString(),
    transportMode: client.paypal.transportMode,
    orders: [
      {
        scenario: 'normal',
        orderId: order.orderId,
        customId: order.customId,
        readBackCustomId: readback.customId,
        customIdMatch: match,
        finalTotalUsd: patched.finalTotalUsd,
        status: readback.status,
      },
      {
        scenario: 'surcharge_void',
        orderId: order2.orderId,
        customId: order2.customId,
        finalTotalUsd: patched2.finalTotalUsd,
      },
    ],
    disputes,
    notes: live
      ? 'Live sandbox run. Approve each order in a browser (PayPal sandbox buyer), then authorize/capture via the workbench or SDK.'
      : 'Replay run. Drop PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET into .env and re-run for live sandbox receipts.',
  };
  mkdirSync(join(process.cwd(), 'docs'), { recursive: true });
  const outPath = join(process.cwd(), 'docs', 'sandbox-receipts.json');
  writeFileSync(outPath, `${JSON.stringify(receipts, null, 2)}\n`, 'utf8');

  console.log('');
  console.log('Sandbox Receipts Strip (paste into README.md):');
  console.log('');
  console.log(`transport: \`${receipts.transportMode}\` · generated ${receipts.generatedAtUtc}`);
  console.log('');
  console.log('| Scenario | Order ID | custom_id | Total | Status |');
  console.log('|---|---|---|---|---|');
  console.log(`| normal | \`${order.orderId}\` | \`${shortCommitment(order.customId)}\` | $${patched.finalTotalUsd.toFixed(2)} | ${readback.status} (match=${match}) |`);
  console.log(`| surcharge_void | \`${order2.orderId}\` | \`${shortCommitment(order2.customId)}\` | $${patched2.finalTotalUsd.toFixed(2)} | created |`);
  console.log('');
  console.log(`Full receipts: docs/sandbox-receipts.json`);
  if (!live) {
    console.log('');
    console.log('To go live:');
    console.log('  1. Copy .env.example to .env');
    console.log('  2. Set PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET (sandbox REST app)');
    console.log('  3. Re-run: npm run seed:sandbox');
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
