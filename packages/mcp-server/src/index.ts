/**
 * @veripact/mcp-server — stdio JSON-RPC 2.0 MCP server (agent 03).
 * Pure `handleMessage()` (tested) plus a thin readline `start()` loop.
 */
import { createInterface } from 'node:readline';
import { formatCommitmentPrefix } from '@veripact/core';
import { SDK_VERSION } from '@veripact/sdk';

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

/** Tool catalog from `skills/veripact-witness/SKILL.md`. */
export const TOOLS: ToolDef[] = [
  {
    name: 'witness_terms',
    description: 'Witness merchant terms at a URL against a mandate (Prompt #2+).',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
  },
  {
    name: 'verify_receipt',
    description: 'Verify a receipt against a PayPal order custom_id (Prompt #2+).',
    inputSchema: { type: 'object', properties: { receipt: { type: 'object' } } },
  },
  {
    name: 'format_commitment',
    description: 'Format/validate a VP1: commitment from a sha256 hex digest.',
    inputSchema: { type: 'object', properties: { sha256Hex: { type: 'string' } } },
  },
];

function ok(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function err(id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function callTool(id: JsonRpcRequest['id'], params: unknown): JsonRpcResponse {
  const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
  if (typeof p.name !== 'string') {
    return err(id, -32602, 'tools/call requires params.name (string)');
  }
  if (p.name === 'format_commitment') {
    const args = (p.arguments ?? {}) as { sha256Hex?: unknown };
    if (typeof args.sha256Hex !== 'string') {
      return err(id, -32602, 'format_commitment requires arguments.sha256Hex (string)');
    }
    try {
      return ok(id, { commitment: formatCommitmentPrefix(args.sha256Hex) });
    } catch (e) {
      return err(id, -32602, e instanceof Error ? e.message : 'invalid digest');
    }
  }
  const tool = TOOLS.find((t) => t.name === p.name);
  if (tool === undefined) {
    return err(id, -32601, `unknown tool: ${p.name}`);
  }
  return err(id, -32000, `not implemented (foundation stub): ${p.name}`);
}

/** Handle one JSON-RPC message. No I/O side effects. */
export function handleMessage(msg: JsonRpcRequest): JsonRpcResponse {
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
    let response: JsonRpcResponse;
    try {
      response = handleMessage(JSON.parse(line) as JsonRpcRequest);
    } catch {
      response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } };
    }
    process.stdout.write(`${JSON.stringify(response)}\n`);
  });
}
