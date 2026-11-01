import { describe, expect, it } from 'vitest';
import { formatCommitmentPrefix } from '@veripact/core';
import { SDK_VERSION } from '@veripact/sdk';
import { handleMessage, MCP_SERVER_NAME, MCP_SERVER_VERSION, TOOLS } from '../src/index';

const HEX = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

describe('@veripact/mcp-server', () => {
  it('resolves core and sdk across workspace boundaries', () => {
    expect(formatCommitmentPrefix(HEX)).toBe(`VP1:${HEX}`);
    expect(MCP_SERVER_VERSION).toBe(SDK_VERSION);
    expect(MCP_SERVER_NAME).toBe('veripact-mcp');
  });

  it('answers initialize and ping', () => {
    const init = handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect((init.result as { serverInfo: { name: string } }).serverInfo.name).toBe('veripact-mcp');
    expect(handleMessage({ jsonrpc: '2.0', id: 2, method: 'ping' }).result).toEqual({});
  });

  it('lists the three witness tools', () => {
    const res = handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const names = ((res.result as { tools: typeof TOOLS }).tools ?? []).map((t) => t.name);
    expect(names).toEqual(['witness_terms', 'verify_receipt', 'format_commitment']);
  });

  it('calls format_commitment for real and rejects bad input', () => {
    const good = handleMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'format_commitment', arguments: { sha256Hex: HEX } },
    });
    expect((good.result as { commitment: string }).commitment).toBe(`VP1:${HEX}`);
    const bad = handleMessage({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'format_commitment', arguments: { sha256Hex: 'nope' } },
    });
    expect(bad.error?.code).toBe(-32602);
  });

  it('errors on unknown tools and methods', () => {
    const unknownTool = handleMessage({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'mint_money', arguments: {} },
    });
    expect(unknownTool.error?.code).toBe(-32601);
    expect(handleMessage({ jsonrpc: '2.0', id: 7, method: 'nope' }).error?.code).toBe(-32601);
  });
});
