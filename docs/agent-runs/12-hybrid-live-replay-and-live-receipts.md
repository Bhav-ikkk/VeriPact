# Run 12 — Hybrid live/replay harmony, dispute filing on live orders & live sandbox receipts

Parent: run 11 (187/187 unit tests, 18/18 E2E, live OAuth + order `56A58181H7229193E`
verified). Prompt: atomic prompt #12.

## 1. What was built

**FIX 1 — Dispute filing works with live credentials on disk.**
- `POST /api/merchant/disputes/create-from-order` no longer 400s when the
  server can reach `LIVE_PAYPAL_SANDBOX`. Filings register in the shared
  local dispute-desk engine anchored to the exact `orderId` + `VP1:`
  commitment and return 200 with a new honest `simulationDesk: true` flag.
- The whole desk went local: dispute list, canned + live resolve, and
  granular HATEOAS actions all run on the shared deterministic engine
  (`demoClientFor('replay')` / `demoPayPalFor('replay')`), so View 2
  inspects and resolves with zero errors in both modes. `demoEngine()` is
  now always available (previously `undefined` in live mode).

**FIX 2 — Per-request `executionMode` + instant landing/tour + live badge.**
- `POST /api/merchant/checkout`, `/finalize`, and `/api/verify` honor
  `executionMode?: 'replay' | 'live' | 'auto'` (default `auto` = legacy
  credential-aware routing). `replay` forces the fast deterministic engine
  without touching `.env`; `live` forces the real sandbox and 400s without
  credentials. Explicit `live` bypasses the live→replay fallback latch
  (a forced live call that fails must surface, never silently replay).
- `DOMContentLoaded` auto-populate and the guided tour pin `replay`
  (tour forces it via `tourRunning` even if the user left the toggle on),
  so first paint is the green `Purchase Captured ($297.00)` +
  `JCS-PARITY MATCH` state and the tour runs 6/6 with no popup stall.
- Header pill is now driven by `hasPayPalCredentials` from
  `/api/system/status`: green `● Live Sandbox Ready` when credentials are
  present. The two-step checkbox becomes `Two-step approval (Live PayPal
  checkoutnow)` with credentials (= `executionMode: 'live'` on Authorize),
  and the checkout button reads `1-Click Instant Checkout` vs
  `Authorize with PayPal` accordingly. Finalize echoes the awaiting
  order's transport; the auditor pins `replay` and now prints the verified
  transport. Popup/approve routes route `ORD-VP-*` tokens to the desk
  engine deterministically (hybrid-safe).

**FIX 3 — Real live receipts stamped.**
- `npm run seed:sandbox` against `api-m.sandbox.paypal.com` minted
  `1D1495603B138083R` ($297.00, CREATED, `custom_id` read-back match=true)
  and `1DM45086A58528407` ($340.50, CREATED, read-back verified).
  `docs/sandbox-receipts.json`, the README strip, and the Devpost strip now
  carry the real order IDs + full `VP1:` hashes (TBD placeholders removed).

**FIX 4 — Tests + gate + commit.**
- 2 new unit tests: live-creds dispute filing end-to-end (health=LIVE,
  replay checkout, drift+forgery file, desk list, granular action, live
  resolve) and `executionMode` semantics (live-without-creds 400, invalid
  400, replay-with-creds capture, verify + two-step finalize override,
  explicit-live failure 500 with no fallback latch).

## 2. Skills / tools consulted

- `paypal-api-context` (project skill, read before touching checkout/dispute
  routes): confirmed `custom_id` 255-char fit, PATCH op enums, Disputes v1
  `OTHER` evidence + 2000-char notes, HATEOAS rel-gating, and the
  no-file-dispute-API fact that justifies the labeled local desk.
- `bundled:git` before the history write (commit explicitly requested).
- No subagents: single-session implementation + verification.

## 3. Architectural decisions & self-corrections

1. **Desk-always-local (decision).** The alternative — real PayPal dispute
   calls for live-anchored filings — is impossible (no file-dispute API)
   and would be dishonest. The desk is now explicitly a local simulation
   surface with `simulationDesk: true` + replay-labeled records.
2. **Explicit live bypasses fallback (decision).** Silently replaying a call
   the user forced to live would violate Rule 3; the 500 + cold latch is
   asserted by test.
3. **UI always sends explicit mode (decision).** Default manual checkout is
   `replay` even with credentials (no live spam on refresh); `auto`
   remains the API default for SDK/CLI compatibility.
4. **Removed `demoClient()` (correction).** After the refactor it had zero
   callers; lint flagged it — deleted instead of kept as dead code.
5. **Withheld an unverified match claim (correction).** I initially stamped
   `customIdMatch: true` on the surcharge order, then proved I could not
   substantiate it (the commitment covers a real-clock TSA timestamp, so a
   re-witness cannot reproduce the seed-time snapshot). Replaced with the
   verified facts only: `readBackCustomId` + `CREATED`.
6. **Reverted benchmark-report timestamp churn (correction).** `npm test`
   rewrites `generatedAtUtc`; reverted so the commit holds only real changes.

## 4. Verification output (Rule-1 gate, repo root, in order)

- `npm run lint` → exit 0 (after removing dead `demoClient`).
- `npm run typecheck` → exit 0.
- `npm run build` → exit 0.
- `npm test` → exit 0, **189/189 passed** (9 files; workbench 42 incl. 2
  new). Note: the explicit-live test reached the real sandbox through the
  proxy and surfaced `HTTP 401 invalid_client` → 500 with a cold latch,
  exactly as designed.
- `npm run seed:sandbox` → exit 0, `transport: LIVE_PAYPAL_SANDBOX`,
  orders `1D1495603B138083R` / `1DM45086A58528407`.
- `npm run verify:e2e` (real `.env` present) → exit 0,
  **E2E RESULT: PASS** — 18/18 checks, zero 4xx/5xx, zero console/page
  errors, zero overflow (4 viewports).

Commit: `feat(workbench,docs): enable hybrid live/replay checkout, allow
dispute simulation on live orders, and stamp live PayPal Sandbox receipts`.
