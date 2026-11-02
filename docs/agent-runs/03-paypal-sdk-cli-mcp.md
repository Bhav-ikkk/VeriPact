# Run 03 — Production `paypal-client`, `sdk`, `cli` & `mcp-server` (zero paid keys)

Parent state: Run 02 complete (core, term-extractor, witness-client green,
75/75). This run replaces the Prompt #1 stubs in the remaining four
packages with production implementations: a dual-mode PayPal client (live
sandbox + deterministic replay), the bilateral `VeriPactClient` SDK, a real
CLI, and 4 MCP tools — all operable with zero paid API keys.

## 1. Mandatory skill & sub-agent mapping (how each shaped the code)

- `.agents/skills/paypal-api-context/SKILL.md` → `packages/paypal-client`.
  Every endpoint encodes the spec-verified constraints: AUTHORIZE intent +
  single `reference_id: "default"` unit + `custom_id` ≤ 255 (`orders.ts`);
  the exact RFC 6901 patch path `/purchase_units/@reference_id=='default'/amount`
  (`DEFAULT_UNIT_AMOUNT_PATH`); capture with NO `custom_id` — the addendum
  hash travels as `invoice_id: "VPA-" + sha256.slice(0, 28)` (32 chars ≤ 127)
  with `final_capture: true` + `note_to_payer` ≤ 255 (`authorizations.ts`);
  `require-evidence` action enum, `provide-evidence` `OTHER` + notes ≤ 2000,
  `adjudicate` outcome enum (`disputes.ts`); all 7 webhook fields with spec
  maxLengths and `verification_status === "SUCCESS"` (`webhooks.ts`); and the
  HATEOAS rule "the links ARE the state machine" — the replay engine derives
  each dispute's rel set purely from (stage, state, evidence) and every
  action re-reads the dispute and throws
  `DisputeActionNotPermittedByHateoasError` when its rel is absent.
- `.agents/skills/security-audit/.../SKILL.md` (guidance mode) +
  `WEB-PROTOCOL-AND-AUTH.md` → hardening across all four packages. Applied
  as construction rules, not a post-hoc audit: the client secret crosses
  exactly one boundary (OAuth token fetch); `PayPalHttpError` carries
  method/path/status/server-snippet only and `toJSON()` redacts credentials
  (API-key exposure class); `PayPal-Request-Id` on every mutating call with
  replay-side dedupe; the one-way authorization lock enforced at BOTH the
  client session layer and the server/replay layer (weakest-parallel-path
  thinking — either layer alone would leave a double-capture door open);
  `resolveKeys` refuses partial demo/env key mixes (fail closed); MCP
  rejects private-key/secret argument keys before dispatch (agent-03
  boundary); dispute evidence notes carry verdicts and order ids only.
- `.agents/subagents/02-extractor-and-paypal.md` → paypal-client: sandbox
  host allowlist kept (`isSandboxBaseUrl`, constructor throws otherwise),
  no mocked responses on live paths (replay is a separate labeled engine,
  never inline mocks), credentials confined to the client (merchant
  boundary), Rule-1 gate green.
- `.agents/subagents/03-sdk-cli-mcp.md` → sdk/cli/mcp-server: CLI and MCP
  are thin adapters (parse → delegate → format; zero domain logic),
  `SKILL.md` updated to v1.0.0 in the same run, no key material over MCP
  stdin, zero-paid-key default (demo seeds + local TSA + demo cache +
  replay when env/credentials are absent).

## 2. What was built

### 2.1 `@veripact/paypal-client` (7 modules)

- `src/oauth.ts` — `PayPalApi` seam (the one interface every module programs
  against), `HttpTransport` + proxy-aware `nodeHttpTransport` (CONNECT
  tunneling, `NO_PROXY`, pure `resolveProxyForUrl` for tests),
  `fetchAccessToken` (client-credentials), `TokenCache` (60s skew),
  sanitized `PayPalHttpError`.
- `src/sandbox-replay.ts` — `SandboxReplayEngine`: stateful deterministic
  sandbox. Realistic IDs (`ORD/AUTH/CAP-VP-…`), order lifecycle
  (CREATED→APPROVED→COMPLETED), Payments v2 one-way lock
  (CREATED→CAPTURED|VOIDED), `PayPal-Request-Id` dedupe store, two pre-seeded
  disputes (`PP-D-CASE-B-FORGERY`, `PP-D-CASE-A-DRIFT`) with a full
  INQUIRY→CHARGEBACK→RESOLVED HATEOAS transition table, `stats()` for tests.
- `src/orders.ts` — kept run-01 builders; added `CreateOrderInput`
  (commitment regex enforced pre-transport), `createAuthorizeOrder`,
  `patchOrderShippingAndTax` (deterministic `finalTotalUsd`), `authorizeOrder`,
  `getOrder`, normalized `OrderRecord` parser (live + replay shapes).
- `src/authorizations.ts` — `AuthorizationStateConflictError`,
  `buildCaptureInvoiceId`, `captureAuthorizationExact`, `voidAuthorization`.
- `src/disputes.ts` — kept link helpers; added `parseDisputeRecord`
  (derives `allowedActions` from links), `list/getDisputes`, and the five
  HATEOAS-gated actions. Each action re-GETs afterwards, so live and replay
  share one code path regardless of action-response body shapes.
- `src/webhooks.ts` — `verifyPayPalWebhookSignature` (7 fields + maxLengths
  pre-transport, strict SUCCESS check).
- `src/index.ts` — `PayPalClient`: mode resolution (auto→creds?live:replay),
  token/cache/request plumbing, idempotency-key generation, in-session
  one-way auth lock, full replay path router, replay-only
  `simulatePayerApproval`/`resetReplay` (throw in live mode), redacted
  `toJSON`, full method surface + re-exports.

### 2.2 `@veripact/sdk`

- `src/scenarios.ts` — `normal` ($279→$297 CAPTURE), `surcharge_void`
  ($279→$340.50 VOID), `adversarial_hidden_dom` (BLOCK, zero PayPal calls);
  really-signed demo mandate ($320/30-day/0%), in-memory Channel3 demo cache,
  `getScenario` validation.
- `src/client.ts` — `resolveKeys` (explicit→env→demo, partial refused),
  `runWitnessedCheckoutFlow` (snapshot→gate→buyer+merchant countersignatures→
  AUTHORIZE→patch→approve→authorize→re-gate→CAPTURE|VOID; BLOCK returns
  before the first PayPal call; ASK_HUMAN_DELTA proceeds by design since the
  re-gate enforces the cap), `auditAndResolveDispute` (self-contained Case B
  → SELLER_FAVOR via require/provide/escalate/adjudicate, Case A →
  BUYER_FAVOR via accept-claim, max-8-step HATEOAS driver, refuses
  accept-claim on forgery), `verifyTransactionBundle` +
  `verifyCheckoutBundle` (commitment recompute, custom_id exact match, 3
  signatures, TSA ±5min), `buildForensicNotes` (≤2000 chars, no secrets),
  `witnessScenario` (zero-PayPal by construction).
- Behavioral change from run 01 (documented): `client.paypal` is now always
  present (replay by default) instead of null without options — required for
  zero-key operation. `gate`, `version`, `formatCommitment`, null-by-default
  `witness` are unchanged.

### 2.3 `@veripact/cli`, `@veripact/mcp-server`, skill

- CLI: `witness|checkout --scenario`, `audit-dispute --case`,
  `verify --scenario`, each with `--json`; `run()` is sync for help/version/
  parse errors and async for flows (`await` uniformly); `main()` is
  promise-aware. Human output prints decisions, ids, totals, and
  `demoKeys`/transport labels — never key material.
- MCP: exactly 4 tools (`veripact_witness_offer`,
  `veripact_execute_guarded_checkout`, `veripact_verify_order_receipt`
  with scenario-demo OR explicit-bundle paths, 
...[truncated 4115 chars]