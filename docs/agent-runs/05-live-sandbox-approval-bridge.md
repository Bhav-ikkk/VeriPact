# Run 05 — Two-Step Buyer Approval Popup, Live Sandbox Bridge & Hot-Swap Credentials

Parent state: Run 04 complete (124/124 tests, 72/72 regression runs). This
run unblocks live PayPal Sandbox checkouts (where `simulatePayerApproval`
throws by design) with a unified two-step architecture: replay mode gets an
interactive zero-key approval popup, live mode gets the real `checkoutnow`
HATEOAS link, and credentials dropped into `.env` mid-session flip the next
checkout live with no restart.

## 1. Skill & sub-agent mapping (what each changed in the code)

- `paypal-api-context/SKILL.md` → `parseOrderRecord` accepts both `approve`
  and `payer-action` rels (PayPal ships either across order shapes); replay
  links mirror the Orders v2 HATEOAS contract (`rel`/`href`/`method`).
- `apple-design/SKILL.md` → approval popup: system type stack, 44px minimum
  touch target on the approve button, `:focus-visible` ring, semantic
  `<dl>` totals, `prefers-color-scheme` dark mode, tabular numerals.
- `security-audit` (guidance) → `ORDER_TOKEN_RE` allowlist on every
  orderId/token intake (400 on hostile input), `<`-escaped `orderIdJs` so a
  token can never break out of the popup script block, `esc()` on all popup
  interpolations, secrets never serialized (hot-reload helper returns to
  the constructor only), prior echo verified against live `custom_id`
  before authorize.
- `02-extractor-and-paypal` → `orderLinksFor`/`stamped()` refresh keeps
  links status-accurate; `approveUrl` parsed by the same code path live
  and replay.
- `03-sdk-cli-mcp` → 1-click default preserved (0 existing tests touched
  behaviorally), `completeApprovedCheckout` re-gates from the patched
  order breakdown (source of truth, no callback override).

## 2. What was built

### 2.1 `@veripact/paypal-client` — approve links + hot-reload

- `src/orders.ts` — `OrderRecord.approveUrl` + `description`;
  `RawOrderJson.links` parsed for `rel === 'approve' | 'payer-action'`.
- `src/sandbox-replay.ts` — `orderLinksFor()` emits
  `{ rel: 'approve', href: '/sandbox/paypal-checkout?token=<id>', method: 'GET' }`
  while `CREATED`, self-only afterwards; `stamped()` refreshes on read.
- `src/env.ts` (new) — zero-dependency `.env` reader: `readDotEnvFile`
  (comments, `export`, quotes), `defaultEnvFilePath()`
  (`VERIPACT_ENV_FILE` override or `<cwd>/.env`),
  `resolvePaypalCredentials(explicit?, envFilePath?)` (explicit → env →
  disk, empty counts as absent).
- `src/index.ts` — `envFilePath` client option; constructor re-resolves
  on every construction (hot-reload); new exports.

### 2.2 `@veripact/sdk` — two-step approval + completion

- `src/client.ts` — `CheckoutOutcome` gains `AWAITING_BUYER_APPROVAL`;
  `CheckoutFlowInput.twoStepApproval`; result gains `approveUrl`,
  `expectedPostApprovalAction`, `headroomRemainingUsd`.
- Step 1 returns AWAITING when the flag is set OR a live order is still
  `CREATED` (checked via `getOrder` after PATCH — never simulated live),
  with a deterministic re-gate preview (CAPTURE $297 / VOID $340.50).
- `completeApprovedCheckout({ orderId, scenario|scenarioId,
  approveInReplay?, prior? })` — verifies echoed evidence against live
  `custom_id` pre-authorize (throws on mismatch), tolerates already-
  approved replay orders, re-gates from the patched breakdown, then
  CAPTURE (`final_capture`, `VPA-` invoice) or VOID.

### 2.3 `@veripact/workbench` — popup, finalize, View 1 dual flows

- `src/approval-template.ts` (new) — zero-key popup: item + callback
  breakdown + `custom_id` + 1-click approve → `POST
  /api/sandbox/approve-order` → `postMessage({ type:
  'VERIPACT_ORDER_APPROVED' })` → auto-close; approved/error states.
- `src/routes.ts` — `GET /sandbox/paypal-checkout?token=` (400/404 HTML
  pages; live 302 to PayPal's own approve URL), `POST
  /api/sandbox/approve-order` (replay-only, idempotent), `POST
  /api/merchant/checkout/finalize` (echo → pending map → re-witness,
  refreshes `docs/sandbox-receipts.json` with a non-fatal
  `receiptsWarning`), checkout stores pending approvals for two-step,
  `resetDemoState` clears them.
- `src/ui-template.ts` — View 1 keeps 1-click default; adds the
  step-by-step checkbox (auto-on in live mode), the AWAITING card
  (order/approveUrl/preview/headroom), popup open, the
  `VERIPACT_ORDER_APPROVED` listener with auto-finalize, and a manual
  Finalize button rendering into `checkout-result`.

## 3. Design decisions & self-corrections

- Replay approve link is a *relative* popup path parsed by the same
  `parseOrderRecord` as live `checkoutnow` — one code path, both modes.
- Hot-reload resolves fresh per construction (no watcher, no restart);
  secrets never touch HTTP responses or logs.
- Two-step re-gate preview is computed at AWAITING time from PATCH
  totals; step 2 re-gates from the live order breakdown (the only value
  the buyer actually approved).
- Pending map is in-memory by design (restart loses AWAITING; documented
  risk). Receipts rewrite is best-effort with a surfaced warning.
- Test-side corrections this run: `resolvePaypalCredentials` takes
  positional `(explicit?, envFilePath?)` with no `source` field;
  `parseOrderRecord(mode, json)`; `orderLinksFor({id, status})`;
  `PayPalClient.transportMode` (not `.mode`); popup escapes `<` only
  (sufficient — kills `</script>` breakout); the vm JCS-parity stub
  needed `window.addEventListener` for the new top-level listener.

## 4. Verification (Rule-1 gate, verbatim tail)

- `npm run lint` → exit 0 (eslint, no warnings).
- `npm run typecheck` → exit 0 (`tsc --noEmit`).
- `npm run build` → exit 0 (`tsc -b`).
- `npm test` → 8 files, **144/144 passed** (+20 new: paypal-client 26,
  sdk 24 incl. scripted-live checkoutnow flow, workbench 22 incl. popup/
  finalize/receipts; core 19, term-extractor 19, witness-client 15,
  cli 10, mcp-server 9 unchanged and green).
- Hermetic isolation: all five PayPal-touching suites pin
  `PAYPAL_*` empty + `VERIPACT_ENV_FILE` to an absent path (save/restore
  around each test); finalize tests snapshot + restore
  `docs/sandbox-receipts.json` (verified byte-identical after the run).
- Regression report timestamp churn reverted; `git status` shows only
  the 15 intended files.

## 5. Files changed

New: `packages/paypal-client/src/env.ts`,
`packages/workbench/src/approval-template.ts`,
`docs/agent-runs/05-live-sandbox-approval-bridge.md`.
Modified: `paypal-client/src/{index,orders,sandbox-replay}.ts`,
`sdk/src/client.ts`, `workbench/src/{index,routes,ui-template}.ts`,
tests in `paypal-client`, `sdk`, `workbench`, `cli`, `mcp-server`.

## 6. Risks & follow-ups

- Live `approveUrl` shape varies (`approve` vs `payer-action`) — both
  parsed, but untested against a real sandbox order until credentials land.
- Popup `postMessage('*')` is intentionally broad (same-origin app);
  harden with an explicit origin allowlist before public demo.
- Pending map is in-memory; route-level re-witness (no echo + no
  pending) is covered at the SDK layer, not via HTTP.
- Next: drop `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET` into `.env` and
  run the live two-step end to end (step 1 auto-awaits, buyer approves
  at `sandbox.paypal.com`, finalize captures $297.00).
