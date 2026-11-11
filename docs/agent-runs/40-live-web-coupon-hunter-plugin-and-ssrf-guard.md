# Run Ledger 40 -- Live Web Coupon Hunter Plugin and SSRF Guard

**Date:** 2026-11-11
**Prompt Target:** Step 2A (`packages/sdk/src/web-hunter.ts` + `@veripact/sdk` export), Step 2B (`POST /api/agents/web-hunt` in `wallet-routes.ts` + `openapi-route.ts`, Find Deal wiring in `ui-template.ts` with zero CSS/layout change), Step 2C (coupon + SSRF unit tests), gates, ledger, atomic commit/push. No README update, no `demo:record` (founder sign-off pending).
**Parent State:** Run 39 complete (monochrome UI, `343/343` unit tests, E2E PASS across 28 steps).
**Result:** Run 40 complete. Gate green: `lint` 0, `typecheck` 0, `build` 0, `347/347` unit tests across 19 files (4 new), E2E `PASS` across 28 steps. Committed locally; push blocked on sandbox GitHub auth (user pushes manually, as in run 39).

---

## 1. What Was Built

### A. Step 2A -- `packages/sdk/src/web-hunter.ts` (new, exported from `@veripact/sdk`)

- Exact spec types: `DiscoveredWebCoupon`, `LiveWebHuntResult`, plus `WebHuntInput`, `WebHuntHost` (structural subset satisfied by `VeriPactClient`), and `WebHuntInputError` (route maps to 400) / `WebHuntFetchError` (route maps to 502).
- `runLiveWebAndCouponHunt(host, input)`:
  - Input validation (non-empty string, 512-char cap, target 1..10000 default 300).
  - Mode classification: scheme-bearing input must be http(s) (else 400-class error); `https://` (or http for the local workbench test origin) goes `LIVE_URL_FETCH`, plain queries go `CATALOG_AND_COUPON_SEARCH` (zero network).
  - SSRF guard: refuses non-http schemes, embedded userinfo, cloud metadata hosts, loopback/private/link-local/reserved IP literals (IPv4 incl. single-number form, IPv6 incl. `::1`, `fe80::/10`, `fc00::/7`, v4-mapped), and plain http except `localhost`/`127.0.0.1` on the workbench port (`PORT` env or 3000). DNS hostnames are not resolved-and-rechecked: documented as a known limitation (DNS rebinding out of scope).
  - Live fetch: `AbortSignal.timeout(4000)`, manual redirects (max 3, guard re-applied per hop), 512 KB cap (content-length precheck + post-read check), honest `tlsVerified` from the final protocol.
  - Meta parsing (dependency-free): JSON-LD `Product` (name, offers.price, USD-or-unspecified currency guard), `og:title`, `product:price:amount`, `<title>`.
  - Witness pipeline: the HTML (fetched or catalog-synthesized) goes through `createWitnessSnapshot` (13-rule DOM scan, quote extraction, sufficiency gate, Channel3 oracle, Ed25519 signature, local RFC 3161 anchor) with an in-memory `htmlFetcher`; mandate re-signed to `min(320, target)` exactly like the sniper.
  - `discoverCouponsForProduct` (9-code registry: PAYPAL50, AUDIO67, MECH30, NVME25, CAM40, DOCK45, WELCOME15, CLEARANCE70 flagged terms-voiding, VIP60 flagged under-$500), SKU-mapped voucher first then discount-desc; `selectAppliedCoupon` picks the highest intact discount.
  - Gemini live coupon suggestions double-gated exactly like the intent planner (`GEMINI_API_KEY` + `VERIPACT_ENABLE_LIVE_LLM=true`), silent `[]` on any failure, always `verifiedTermsIntact: false` (listed, never applied).
  - Conservative decision overlay: witness gate leads; integrity/condition conflicts BLOCK; unknown return terms or over-target couponed total cap at ASK (the gate itself hard-BLOCKs indeterminate required terms, so catalog mode deterministically BLOCKs).
- Honesty (Rule 3): catalog-mode HTML contains catalog-known facts ONLY (title, price, condition) so return terms stay INDETERMINATE; timestamp/observation claims unchanged.

### B. Step 2B -- Route, OpenAPI, search-bar wiring

- `wallet-routes.ts`: `POST /api/agents/web-hunt` (405 on other methods), request validation with sniper-style 400 messages, `demoClientFor('replay')` host, error mapping (Input->400, Fetch->502), session ledger append (`kind: 'web-hunt'`, summary + `VP1:` commitment), 200 JSON result. Added to `WALLET_ROUTES` (flows into `ROUTES` automatically; no `routes.ts` change needed since `/api/agents/*` delegates).
- `openapi-route.ts`: documented the endpoint (queryOrUrl/target schema, 200/400/502 responses).
- `ui-template.ts` (zero CSS/layout change): when the prompt starts with `https://`, Find Deal chains `/api/agents/web-hunt` after the sniper call and `renderWebHuntResults` renders a compact banner + coupon pills + `VP1:` chip into a new `#web-hunt-results` block inside `#sniper-box` (details modal) and appends the coupon/total/commitment to `#checkout-status` (Deal card). Inert for non-URL input, so all existing E2E behavior is unchanged.

### C. Step 2C -- Tests (`packages/workbench/test/wallet-routes.test.ts`, +4)

- Mounted-on-ROUTES + GET-405.
- Catalog query discovers PAYPAL50/AUDIO67/MECH30, rejects CLEARANCE70 (returns-voiding) and VIP60 (under $500), applies AUDIO67 with `bestAllInUsd 33` (82 + 18 - 67), `VP1:` commitment, `HUNT-VP-` id, and gate `BLOCK` (unknown required terms).
- SSRF/scheme blocklist (10 URLs incl. the three spec cases) all 400.
- Input-shape/target-range validation all 400.

## 2. Skills / Tools Consulted

- No marketplace skill applied to this backend change: no PayPal API logic was touched (the `paypal-api-context` reminder's condition did not hold), and no UI/visual work was in scope. Precedents were taken from in-repo code instead: the intent planner's Gemini double-gate, the sniper's mandate-cap/voucher/TSA-local patterns, and the wallet route handler/ledger/405 conventions.
- Independent oracle: the repo's own test suite served as oracle, and it caught two real defects (below).

## 3. Architectural Decisions and Self-Corrections

1. **Catalog HTML contains no return claims.** Synthesizing "Free 30-day returns" would manufacture extractor evidence. Catalog mode therefore always yields INDETERMINATE terms and the gate BLOCKs — honest by construction.
2. **LLM coupons can never apply.** Gemini suggestions are unverified by definition, so they merge as `verifiedTermsIntact: false` (visible, never selected). The deterministic registry alone decides `appliedCoupon`.
3. **Manual redirect loop.** Default fetch follows redirects (SSRF bypass via 302 to metadata IP); the hunter follows at most 3 hops manually with the full guard re-applied per hop.
4. **Test expectation corrected by the gate contract.** My new test first asserted catalog mode yields `ASK_HUMAN_DELTA`; the suite reported `BLOCK`. Reading `sufficiency-gate.ts` confirmed BLOCK is the established contract for indeterminate required terms ("core terms indeterminate: return_window_days") — the test was fixed, not the code.
5. **tsc emit strips `\/` inside the outer template literal.** My first wiring used a `/^https:\/\//i` regex literal; the source was correct but `tsc -b` emit normalized `\/` to `/`, commenting out the rest of the line and breaking the inline script (2 test failures, `Unexpected token 'return'`). Fixed by switching to an emit-proof `(promptVal||'').toLowerCase().indexOf('https://')===0` check — no backslash-dependent syntax inside emitted template literals from now on. (Related tooling note: `String.replace` with `$'` in the replacement string duplicates file content; the Node injector now uses `split/join`.)
6. **`desk-view.ts`/README untouched, no demo recording**, per the brief's explicit deferrals.

## 4. Verification Output

Gate (repo root, portable toolchain, in order):

```
npm run lint       -> exit 0 (eslint, clean)
npm run typecheck  -> exit 0 (tsc --noEmit, clean)
npm run build      -> exit 0 (tsc -b, clean)
npm test           -> Test Files 19 passed (19) / Tests 347 passed (347)
```

`npm run verify:e2e` -> `E2E RESULT: PASS -- zero 4xx/5xx, zero console/page errors, zero overflow` (exit 0, 28 steps, geometry lines unchanged).

Commit: `feat(sdk,workbench): add live web coupon and wild-URL hunter plugin with SSRF guard` (scoped add of `packages/sdk/src/`, `packages/workbench/src/`, `packages/workbench/test/`, this ledger). Push: sandbox has no GitHub auth (established in run 39; user pushes manually).
