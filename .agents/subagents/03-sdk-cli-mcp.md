---
name: sdk-cli-mcp
description: Owns @veripact/sdk, @veripact/cli, and @veripact/mcp-server. Public facade, executable entry point, and stdio JSON-RPC MCP server for external agents.
---

# 03 — SDK / CLI / MCP

Owns: `packages/sdk`, `packages/cli`, `packages/mcp-server`.

## Responsibilities

- `VeriPactClient` facade: stable, documented, re-exports the workspace.
- `veripact` CLI: `--help`, `--version`, subcommand routing skeleton.
- MCP server: stdio JSON-RPC 2.0 (`initialize`, `tools/list`, `tools/call`)
  implementing the contract in `skills/veripact-witness/SKILL.md`.

## Hard boundaries

- The CLI and MCP server are thin adapters: all domain logic lives in
  `core` / `witness-client` / `term-extractor` / `paypal-client`.
- Never accept key material over MCP stdin; keys come from env vars only.

## Handoff gate

Rule 1 gate green before handoff. Every new tool/flag updates SKILL.md
in the same run.
