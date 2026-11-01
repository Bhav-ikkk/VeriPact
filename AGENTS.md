# AGENTS.md — VeriPact Developer & Agent Constitution

Spectra-style npm-workspaces TypeScript monorepo for the **Build What's Next with PayPal and AI**
hackathon (`paypalaihackathon.devpost.com`).

> Buyer guardrails control what an agent is allowed to spend.
> VeriPact proves what the merchant actually promised.

## Rule 1 — Zero-Broken-Push Gate (non-negotiable)

No commit or push is permitted unless ALL of the following exit with code 0,
run from the repo root in this order, across all 8 workspace packages:

```bash
npm run lint && npm run typecheck && npm run build && npm test
```

A red gate blocks the push. Fix the code, never weaken the gate.

## Rule 2 — Three-Key Cryptographic Isolation (non-negotiable)

- `BUYER_ED25519_PRIVATE_KEY` → buyer-side code only (Rung 1 SELF).
- `WITNESS_ED25519_PRIVATE_KEY` → witness route/service only (Rung 2 WIT).
- `MERCHANT_ED25519_PRIVATE_KEY` + PayPal credentials → merchant route/service only (Rung 3 SIGN).

Never import a foreign key into another boundary. The single-process demo
packaging MUST keep these boundaries as separate route modules with disjoint
environment-variable readers (see `docs/agent-runs/` for the packaging rationale).

## Rule 3 — Epistemic & Sandbox Honesty (non-negotiable)

- An RFC 3161 timestamp proves that a hash existed at time T, plus independent
  witness observation of the source page. It NEVER proves content truth.
  State this in code comments, UI copy, README, and video.
- Live sandbox mode MUST call the real PayPal Sandbox. No mocked PayPal calls
  on any live path. Deterministic replay fixtures are allowed ONLY inside
  `benchmark/responses/` and unit tests, and MUST be labeled `REPLAY`.
- Every external claim (API behavior, competitor capability, citation) needs a
  fetched source or an explicitly named gap. No fabricated URLs, IDs, or stats.

## Rule 4 — Mandatory Atomic Run Ledger (non-negotiable)

Every prompt execution MUST conclude by creating
`docs/agent-runs/<NN>-<slug>.md` documenting: what was built, which
marketplace skills/tools were consulted, architectural decisions and
self-corrections with rationale, and the full verification output.

## Toolchain (sandbox-tested 2026-11-01)

- Node/npm live in the portable toolchain at `.tools/node-v22.13.1-win-x64/`
  (gitignored). The system node cannot load npm (sandbox EPERM on the user profile).
- Always set before any npm/npx call (PowerShell):
  `$env:NPM_CONFIG_CACHE='<repo>\.npm-cache'; $env:NPM_CONFIG_USERCONFIG='<repo>\.tools\npmrc'`
- Prepend the portable node dir to PATH (`$env:PATH="<repo>\.tools\node-v22.13.1-win-x64;$env:PATH"`)
  so bin shims resolve a working node first, and set `$env:TEMP`/`$env:TMP` to
  `<repo>\.vitest-tmp` (gitignored) before `npm test` — Vitest workers need a
  writable temp dir. Tests never bind sockets (sandbox blocks `listen()`);
  the workbench suite drives the exported request handler with fake req/res.
- Shell network works ONLY through the `http_proxy`/`https_proxy` env vars.
  Python, npm, and git honor them automatically; `Invoke-WebRequest` needs
  an explicit `-Proxy` argument. Node-based CLIs run via npx additionally
  need `$env:NODE_USE_ENV_PROXY='1'` or their `fetch()` calls bypass the proxy.
- Git: prefix every command with the safe.directory env triplet (sandbox
  ownership mismatch), e.g.
  `$env:GIT_CONFIG_COUNT=1; $env:GIT_CONFIG_KEY_0='safe.directory'; $env:GIT_CONFIG_VALUE_0='<repo>'`.

## Workspace map

| Package | Responsibility |
|---|---|
| `packages/core` | Canonical domain types, commitment IDs, referee interfaces |
| `packages/witness-client` | RFC 3161 TSA, Channel3 oracle, HTTPS snapshotter interfaces |
| `packages/term-extractor` | Hidden-DOM scanner, quote verifier, sufficiency gate |
| `packages/paypal-client` | Orders v2, webhooks, Disputes v1 HATEOAS engine |
| `packages/sdk` | `VeriPactClient` facade re-exporting the workspace |
| `packages/cli` | `veripact` executable entry point |
| `packages/mcp-server` | Stdio JSON-RPC 2.0 MCP server |
| `packages/workbench` | Sequoia 2-view web UI + single-process HTTP server |

Sub-agent ownership lives in `.claude/agents/`.
The external-agent contract lives in `skills/veripact-witness/SKILL.md`.
