# Run 01 — Monorepo Foundation, Skills, Sub-Agents & GitHub Sync

Date: 2026-11-01. Scope: Atomic Prompt #1 (foundation only, no product code).
Repo: `https://github.com/Bhav-ikkk/VeriPact.git` (was empty; this run creates `main`).

> Correction (run 01b, 2026-11-01): skill/subagent paths below were migrated
> to `.agents/skills/` and `.agents/subagents/` (Muse Spark toolchain).
> Counts and content are unchanged.

## 1. What was created

Spectra-style npm-workspaces TypeScript monorepo (CommonJS, strict, composite
project references). Exact tree of new tracked files:

```text
veripact/
├── packages/
│   ├── core/                 # @veripact/core — canonical types + VP1 formatter
│   │   ├── package.json  tsconfig.json  src/index.ts  test/core.test.ts (3 tests)
│   ├── witness-client/       # TSA / Channel3 / snapshotter interfaces + stubs
│   │   ├── package.json  tsconfig.json  src/index.ts  test/witness-client.test.ts (3)
│   ├── term-extractor/       # hidden-DOM + substring + SufficiencyGate (real pure fns)
│   │   ├── package.json  tsconfig.json  src/index.ts  test/term-extractor.test.ts (6)
│   ├── paypal-client/        # Orders v2 builders + HATEOAS map (real) + client stub
│   │   ├── package.json  tsconfig.json  src/index.ts  test/paypal-client.test.ts (6)
│   ├── sdk/                  # VeriPactClient facade + re-exports
│   │   ├── package.json  tsconfig.json  src/index.ts  test/sdk.test.ts (3)
│   ├── cli/                  # veripact bin + pure run() router
│   │   ├── package.json  tsconfig.json  src/index.ts  test/cli.test.ts (4)  bin/veripact.js
│   ├── mcp-server/           # stdio JSON-RPC 2.0 (initialize/list/call)
│   │   ├── package.json  tsconfig.json  src/index.ts  test/mcp-server.test.ts (5)
│   └── workbench/            # single-process HTTP server + route handler
│       ├── package.json  tsconfig.json  src/index.ts  test/workbench.test.ts (4)
├── benchmark/
│   ├── scenarios/{README.md,schema.json}  responses/README.md  results/README.md
├── .veripact/mandates.json   # sample buyer mandate (signature placeholder marked)
├── .agents/subagents/01..05-*.md
├── .agents/skills/           # 7 skill dirs, 34 SKILL.md files (nested .git stripped)
├── skills/veripact-witness/SKILL.md
├── docs/agent-runs/01-monorepo-foundation-and-skills.md (this file)
├── package.json  package-lock.json  tsconfig.{json,base.json,typecheck.json}
├── vitest.config.ts  eslint.config.js  .prettierrc  .prettierignore
├── AGENTS.md  LICENSE (MIT)  .env.example  .gitignore  render.yaml
```

Package dependency graph: `core` ← {witness-client, term-extractor,
paypal-client} ← `sdk` ← {cli, mcp-server}; `workbench` ← core.
Every package except `core` imports a sibling by workspace name in its tests,
and `require.resolve('@veripact/core')` was proven to land on
`packages/core/dist/index.js` through the npm workspace symlink.

## 2. Skills, plugins, agents, AGENTS.md

| Skill / plugin | Method | Result |
|---|---|---|
| `context-plugins install paypal` | npx ×2 (2nd with `NODE_USE_ENV_PROXY=1`) | FAILED — named gap (below) |
| `ag-grid/skills` | npx attempt → shallow git clone | OK (`skills/ag-dev`, `skills/ag-update`) |
| `dickwu/apple-design-skill` | npx attempt → shallow git clone | OK (top-level `SKILL.md`) |
| `emilkowalski/skill` | shallow git clone | OK (16 animation/UI skills) |
| `anthropics/skills@frontend-design` | shallow clone, copied 1 subdir | OK |
| `vercel-labs/agent-skills` ×2 | shallow clone, copied `react-best-practices` + `web-design-guidelines` | OK |
| `cloudflare/security-audit-skill` | npx attempt → shallow git clone | OK (`skills/security-audit`) |

- The `skills` (SKILLS banner) CLI runs but installs nothing without an
  interactive session (stdin was closed to prevent hangs), so every required
  skill fell through to its spec'd git-clone fallback. All nested `.git`
  dirs were stripped so skill markdown commits into this repo.
- `context-plugins` (v0.12.0) fails even with `NODE_USE_ENV_PROXY=1`: its
  fetch stack ignores the env proxy while the sandbox proxy is mandatory.
  Raw-host access itself works (python `GET raw.githubusercontent.com` → 200).
  Gap accepted: PayPal API shapes for agent 02 come from official docs
  already verified in `VERIPACT_V4_JUDGE_AUDIT.md`.
- `AGENTS.md` encodes the 4 non-negotiable rules + the sandbox-tested
  toolchain block. `.agents/subagents/01..05` own the package map.
  `skills/veripact-witness/SKILL.md` publishes the CLI/MCP contract
  (v0.1.0 skeleton status stated honestly).

## 3. Architectural decisions & self-corrections

1. **npm workspaces + CommonJS + `tsc -b` project references** (not pnpm/ESM):
   zero extra toolchain downloads, deterministic composite builds, and Vitest
   runs CJS dist without loader flags. Vitest 3 chosen over node:test-runner
   for workspace-wide reporting.
2. **`workspace:^` → `^0.1.0`**: npm 10 rejects the `workspace:` protocol
   (`EUNSUPPORTEDPROTOCOL`). Plain semver ranges still link workspaces.
3. **Portable Node 22.13.1 in `.tools/` (gitignored)**: the system node lives
   under the sandbox-blocked user profile and cannot load npm (`EPERM`).
   The portable tree + `NPM_CONFIG_CACHE`/`NPM_CONFIG_USERCONFIG` in-repo
   makes every npm/npx call work. Network flows only via proxy env vars.
4. **`test` = `tsc -b . && vitest run`** (not `npm run build && …`): nested
   `npm` resolves to the broken system npm. The flattened form is identical
   on normal machines.
5. **ESLint `no-require-imports` off for `**/*.js`**: config/shim files under
   `type: commonjs` legitimately use `require()`.
6. **`NotImplementedError` moved to `@veripact/core`**: shared scaffolding
   belongs in core; leaf packages import and re-export it.
7. **Workbench tests drive an exported `handleWorkbenchRequest(req, res)`**
   with fake req/res instead of binding sockets: the sandbox denies
   `listen()` (`EACCES` on 127.0.0.1). Same routing coverage, no sockets,
   plus a new 405 case. Vitest also needs `$env:TEMP/TMP` pointed at
   gitignored `.vitest-tmp/` (workers use `os.tmpdir()`).
8. **Single-process demo packaging pre-decided** (audit directive): Render
   runs one process (`node packages/workbench/dist/index.js`); Rule 2 key
   boundaries stay as separate route modules with disjoint env readers.
9. **Git identity**: commits author as the repo owner's existing global
   identity (`Bhav-ikkk <bhavik.joshi.x.4605@gmail.com>`); every git call
   carries the `safe.directory` env triplet (sandbox ownership mismatch).

## 4. Verification output (final full gate sequence, exit codes verbatim)

```text
=== LINT ===
> veripact@0.1.0 lint
> eslint .
LINT_EXIT:0
=== TYPECHECK ===
> veripact@0.1.0 typecheck
> tsc --noEmit -p tsconfig.typecheck.json
TYPECHECK_EXIT:0
=== BUILD ===
> veripact@0.1.0 build
> tsc -b .
BUILD_EXIT:0
=== TEST ===
 RUN  v3.2.7 D:/Bhavik/VerdiPact
 ✓ packages/term-extractor/test/term-extractor.test.ts (6 tests) 15ms
 ✓ packages/paypal-client/test/paypal-client.test.ts (6 tests) 20ms
 ✓ packages/workbench/test/workbench.test.ts (4 tests) 27ms
 ✓ packages/core/test/core.test.ts (3 tests) 14ms
 ✓ packages/mcp-server/test/mcp-server.test.ts (5 tests) 12ms
 ✓ packages/sdk/test/sdk.test.ts (3 tests) 13ms
 ✓ packages/witness-client/test/witness-client.test.ts (3 tests) 13ms
 ✓ packages/cli/test/cli.test.ts (4 tests) 12ms
 Test Files  8 passed (8)
      Tests  34 passed (34)
   Duration  5.89s
TEST_EXIT:0
```

Extra proofs: `require.resolve('@veripact/core')` →
`D:\Bhavik\VerdiPact\packages\core\dist\index.js`;
`node packages/cli/bin/veripact.js --version` → `veripact 0.1.0`.
`npm install` noted 14 moderate/critical advisories in the eslint/vitest
chains — accepted for the foundation, no `audit fix` (version churn risk).
Two transient `write_file` EEXIST (os 183) races on new files succeeded on
plain retry; no content was lost or duplicated.

Rule 1 gate: PASS (0 errors, 4/4 green). Ready for commit + push.
