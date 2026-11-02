/**
 * @veripact/mcp-server — stdio JSON-RPC 2.0 MCP server (agent 03).
 *
 * Thin adapter: `handleMessage()` routes to `VeriPactClient` flows and wraps
 * results in MCP `content[]` envelopes. Sync for `initialize`/`ping`/
 * `tools/list`, async for `tools/call` — callers `await` uniformly.
 * Agent-03 boundary: key material is NEVER accepted over stdin — any arg
 * key resembling a private key or secret is rejected before dispatch.
 */
import { createInterface } from 'node:readline';
import {
  DISPUTE_CASE_NAMES,
  SCENARIO_NAMES,
  SDK_VERSION,
  VeriPactClient,
  verifyTransactionBundle,
  type DisputeCaseName,
  type ScenarioName,
  type TransactionBundleInput,
} from '@veripact/sdk';

export const MCP_SERVER_NAME = 'veripact-mcp';
export const MCP_SERVER_VERSION = SDK_VERSION;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Production tool catalog (mirrors `skills/veripact-witness/SKILL.md`). */
export const TOOLS: ToolDef[] = [
  {
    name: 'veripact_witness_offer',
    description:
      'Witness a scenario storefront: hidden-DOM scan, verified quotes, Channel3 cross-check, TSA anchor. Zero PayPal calls.',
    inputSchema: {
      type: 'object',
      properties: { scenario: { type: 'string', enum: [...SCENARIO_NAMES] } },
      required: ['scenario'],
    },
  },
  {
    name: 'veripact_execute_guarded_checkout',
    description:
      'Run a bilateral witnessed checkout: snapshot → gate → AUTHORIZE → patch → authorize → re-gate → CAPTURE | AUTO_VOIDED.',
    inputSchema: {
      type: 'object',
      properties: { scenario: { type: 'string', enum: [...SCENARIO_NAMES] } },
      required: ['scenario'],
    },
  },
  {
    name: 'veripact_verify_order_receipt',
    description:
      'Verify a transaction bundle: recompute the VP1 commitment, match the PayPal custom_id, verify buyer/witness/merchant signatures and the TSA anchor. Pass scenario for the self-contained demo or bundle for an explicit bundle.',
    inputSchema: {
      type: 'object',
      properties: {
        scenario: { type: 'string', enum: [...SCENARIO_NAMES] },
        bundle: { type: 'object' },
      },
    },
  },
  {
    name: 'veripact_adjudicate_contested_dispute',
    description:
      'Audit a contested dispute: referee the buyer/seller receipts against the PayPal-anchored commitment and drive the dispute to RESOLVED via HATEOAS-gated actions.',
    inputSchema: {
      type: 'object',
      properties: { case: { type: 'string', enum: [...DISPUTE_CASE_NAMES] } },
      required: ['case'],
    },
  },
];

function ok(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function err(id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function toolResult(payload: unknown): unknown {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

const KEY_MATERIAL_RE =
  /private[_-]?key|client[_-]?secret|secret[_-]?key|api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|password|passwd|bearer/i;

/**
 * Reject key material over stdin (agent-03 boundary): any argument KEY —
 * top level or one object level down — resembling secret key material
 * aborts the call before dispatch. Values are never inspected (commitments
 * and signatures are hex by design and safe to carry).
 */
export function containsKeyMaterial(args: unknown): boolean {
  if (args === null || typeof args !== 'object') {
    return false;
  }
  const record = args as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (KEY_MATERIAL_RE.test(key)) {
      return true;
    }
    const nested = record[key];
    if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
      for (const nestedKey of Object.keys(nested as Record<string, unknown>)) {
        if (KEY_MATERIAL_RE.test(nestedKey)) {
          return true;
        }
      }
    }
  }
  return false;
}

function isScenarioName(value: unknown): value is ScenarioName {
  return typeof value === 'string' && (SCENARIO_NAMES as string[]).includes(value);
}

function isDisputeCaseName(value: unknown): value is DisputeCaseName {
  return typeof value === 'string' && (DISPUTE_CASE_NAMES as string[]).includes(value);
}

async function callTool(
  id: JsonRpcRequest['id'],
  params: unknown,
): Promise<JsonRpcResponse> {
  const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
  if (typeof p.name !== 'string') {
    return err(id, -32602, 'tools/call requires params.name (string)');
  }
  const tool = TOOLS.find((t) => t.name === p.name);
  if (tool === undefined) {
    return err(id, -32601, `unknown tool: ${p.name}`);
  }
  const args = (p.arguments ?? {}) as Record<string, unknown>;
  if (containsKeyMaterial(args)) {
    return err(id, -32602, 'key material is never accepted over MCP stdin (use env vars)');
  }
  const client = new VeriPactClient();
  try {
    switch (p.name) {
      case 'veripact_witness_offer': {
        if (!isScenarioName(args['scenario'])) {
          return err(id, -32602, `scenario must be one of ${SCENARIO_NAMES.join(', ')}`);
        }
        return ok(id, toolResult(await client.witnessScenario(args['scenario'])));
      }
      case 'veripact_execute_guarded_checkout': {
        if (!isScenarioName(args['scenario'])) {
          return err(id, -32602, `scenario must be one of ${SCENARIO_NAMES.join(', ')}`);
        }
        return ok(id, toolResult(await client.runWitnessedCheckoutFlow({ scenario: args['scenario'] })));
      }
      case 'veripact_verify_order_receipt': {
        if (args['bundle'] !== undefined && args['bundle'] !== null) {
          if (typeof args['bundle'] !== 'object') {
            return err(id, -32602, 'bundle must be an object when provided');
          }
          const bundle = args['bundle'] as Partial<TransactionBundleInput>;
          if (
            bundle.receiptCore === undefined ||
            typeof bundle.buyerSignatureHex !== 'string' ||
            typeof bundle.witnessSignatureHex !== 'string' ||
            typeof bundle.merchantSignatureHex !== 'string' ||
            typeof bundle.paypalOrderCustomId !== 'string'
          ) {
            return err(
              id,
              -32602,
              'bundle requires receiptCore, buyer/witness/merchant signatures + public keys, and paypalOrderCustomId',
            );
          }
          return ok(id, toolResult(verifyTransactionBundle(bundle as TransactionBundleInput)));
        }
        if (!isScenarioName(args['scenario'])) {
          return err(id, -32602, 'provide scenario or bundle');
        }
        const checkout = await client.runWitnessedCheckoutFlow({ scenario: args['scenario'] });
        if (checkout.outcome !== 'CAPTURED') {
          return err(
            id,
            -32000,
            `nothing to verify: scenario ended ${checkout.outcome} (need CAPTURED)`,
          );
        }
        return ok(id, toolResult(await client.verifyCheckoutBundle(checkout)));
      }
      case 'veripact_adjudicate_contested_dispute': {
        if (!isDisputeCaseName(args['case'])) {
          return err(id, -32602, `case must be one of ${DISPUTE_CASE_NAMES.join(', ')}`);
        }
        return ok(id, toolResult(await client.auditAndResolveDispute({ case: args['case'] })));
      }
      default:
        return err(id, -32601, `unknown tool: ${p.name}`);
    }
  } catch (e) {
    return err(id, -32000, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Handle one JSON-RPC message. Sync for initialize/ping/tools/list, async
 * for tools/call — `await` the return value uniformly. No I/O side effects.
 */
export function handleMessage(msg: JsonRpcRequest): JsonRpcResponse | Promise<JsonRpcResponse> {
  switch (msg.method) {
    case 'initialize':
      return ok(msg.id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        capabilities: { tools: {} },
      });
    case 'ping':
      return ok(msg.id, {});
    case 'tools/list':
      return ok(msg.id, { tools: TOOLS });
    case 'tools/call':
      return callTool(msg.id, msg.params);
    default:
      return err(msg.id, -32601, `method not found: ${msg.method}`);
  }
}

/** Serve newline-delimited JSON-RPC on stdio. */
export function start(): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line: string) => {
    if (line.trim().length === 0) {
      return;
    }
    Promise.resolve()
      .then(() => handleMessage(JSON.parse(line) as JsonRpcRequest))
      .then(
        (response) => {
          process.stdout.write(`${JSON.stringify(response)}\n`);
        },
        () => {
          const response: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'parse error' },
          };
          process.stdout.write(`${JSON.stringify(response)}\n`);
        },
      );
  });
}

const entrypoint = process.argv[1] ?? '';
if (entrypoint.endsWith('index.js')) {
  start();
}
