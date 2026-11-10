# Run 33 — Neon DB Serverless Adapter, Clerk Auth, Multi-Agent Sub-Allocations & Background Price-Drop Daemon

**Date:** 2026-11-10  
**Status:** Complete & Verified Green  
**Verification Gate:** `npm run lint` (0 errors) | `npm run typecheck` (0 errors) | `npm run build` (0 errors) | `npm test` (269/269 passing across 17 files) | `npm run verify:e2e` (26/26 checks passing)

---

## 1. What Was Built

Implemented **Part 1 of 2: Antigravity Onboarding & Autonomous Fleet Backend**:

1. **`packages/workbench/src/fleet-store.ts`**:
   - **Data Models**:
     - `OnboardingUserSession`: Stores `userId`, `email`, `displayName`, `authProvider` (`CLERK_GOOGLE_OAUTH` | `CLERK_SESSION` | `DEMO_PASSKEY`), `clerkSessionId`, `paypalConnected`, `paypalPayerEmail`, `paypalVaultTokenId`, `masterPartitionUsd`, `onboardingCompletedAtUtc`.
     - `AutonomousSubAgent`: Stores `agentId`, `name`, `sku`, `productTitle`, `retailPriceUsd`, `targetMaxAllInUsd`, `subAllocationUsd`, `spentUsd`, `remainingSubAllocationUsd`, `autoBuyEnabled`, `status` (`ARMED_WATCHING` | `EXECUTING` | `GOAL_CAPTURED` | `BLOCKED_TRAP` | `BLOCKED_SUB_ALLOCATION_WALL`), `lastEventSummary`, `capturedOrderId`, `capturedAmountUsd`, `savedUsd`, `commitment`, timestamps.
     - `FleetStateSnapshot`: Surfaces `storageEngine` (`NEON_SERVERLESS_POSTGRES` | `LOCAL_HERMETIC_MIRROR`), `clerkConfigured`, `neonConfigured`, `user`, `masterPartitionUsd`, `totalSubAllocatedUsd`, `unallocatedMasterUsd`, `agents`, `recentBackgroundEvents`.
   - **Neon Serverless Postgres Sync (`syncWithNeonDb`)**:
     - Detects `process.env.NEON_DATABASE_URL || process.env.DATABASE_URL`.
     - Provides non-blocking HTTP POST synchronization over Neon's serverless `/sql` endpoint.
     - Transparently falls back to deterministic local disk persistence (`.veripact-fleet-state.json`, overridable via `VERIPACT_FLEET_STATE_FILE`) with zero network failures when offline or in hermetic test mode.
   - **Clerk Authentication Detection**:
     - `isClerkConfigured()` inspecting `CLERK_PUBLISHABLE_KEY` / `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
   - **Sub-Allocation Mathematical Enforcement (`createSubAgent`)**:
     - Strictly enforces: `existingTotalSubAllocatedUsd + subAllocationUsd <= masterPartitionUsd`.
     - Rejects any allocation exceeding available master partition cap with HTTP 400:
       `wallet: sub-allocation ($X.XX) exceeds unallocated master partition balance ($Y.YY available of $Z.ZZ master cap).`
   - **Background Price-Drop Trigger & Autonomous Settlement (`triggerBackgroundPriceDrop`)**:
     - Wakes matching `ARMED_WATCHING` sub-agents watching target SKU.
     - Computes all-in price (`newBasePriceUsd + $11.50 ship + $6.50 tax`).
     - Real 3-Rung verification: runs `buildDemoMandate`, signs buyer target cap (Rung 1 SELF), executes `createWitnessSnapshot` with RFC 3161 TSA and term extractor (Rung 2 WIT).
     - If price still above target: remains `ARMED_WATCHING`.
     - If price under target but exceeds sub-allocation balance: transitions to `BLOCKED_SUB_ALLOCATION_WALL` with $0 spent.
     - If under target and within remaining sub-allocation: executes `wallet.executePartitionedAgentPayment({ scenarioId: 'normal', requestedOverrideUsd: allInUsd, preWitnessedSnapshot: snapshot })`, captures vaulted PayPal payment (Rung 3 SIGN), binds `VP1:` commitment into `custom_id`, deducts from both `remainingSubAllocationUsd` and the master partition, and transitions to `GOAL_CAPTURED`.

2. **Route Mounting in `packages/workbench/src/wallet-routes.ts` & `routes.ts`**:
   - `GET /api/onboarding/state`: Returns `FleetStateSnapshot` seeded with default Agent-01 (Monitor Sniper, $220 sub-alloc / $300 target) and Agent-02 (Kanso Audio Bot, $100 sub-alloc / $100 target).
   - `POST /api/onboarding/complete`: Connects session, pairs PayPal Vault, provisions Master Partition, configures initial sub-agents (enforcing sub-allocation sum <= master cap), and returns updated snapshot.
   - `POST /api/agents/spawn`: Validates sub-allocation against available master partition, arms new sub-agent, and returns `{ agent, fleet }`.
   - `POST /api/agents/webhook/price-drop`: Simulates webhook event or poll tick, drives headless 3-rung execution, and returns `{ triggeredAgents, fleet }`.
   - `resetWalletRouteState()` hooked into `resetDemoState()`.

3. **OpenAPI 3.1.0 Documentation (`packages/workbench/src/openapi-route.ts`)**:
   - Documented all 4 endpoints and schemas (`OnboardingUserSession`, `AutonomousSubAgent`, `FleetStateSnapshot`).

4. **Hermetic Test Suite (`packages/workbench/test/wallet-routes.test.ts`)**:
   - 4 new unit tests covering:
     1. `POST /api/onboarding/complete` setting up Clerk session and 3 sub-agents ($200 + $100 + $50 = $350).
     2. `POST /api/agents/spawn` rejecting sub-agents exceeding unallocated master partition with 400.
     3. `POST /api/agents/webhook/price-drop` for `KANSO-Q35` capturing $100.00 with `VP1:` commitment and reducing sub-allocation to $0.00.
     4. `POST /api/agents/webhook/price-drop` blocking on sub-allocation wall (`BLOCKED_SUB_ALLOCATION_WALL`) when $120.00 all-in exceeds $100.00 cap.

---

## 2. Tools & Marketplace Skills Consulted

- **`AGENTS.md`**: Cryptographic Three-Rung key isolation (Rule 2), Epistemic Honesty (Rule 3), Zero-Broken-Push gate (Rule 1), Mandatory Atomic Run Ledger (Rule 4).
- **`paypal-api-context`**: PayPal Vault payment tokens (`PM-VP-VAULT-*`), Orders v2 `custom_id` commitment binding, and partitioned payment flows.
- **`apple-design` / `web-design-guidelines`**: Clean response payloads, status constants, and UX consistency.

---

## 3. Architectural Decisions & Self-Corrections

1. **Routing in `routes.ts`**:
   - *Discovery*: Initial call to `GET /api/onboarding/state` yielded 404 because `routes.ts` had a path prefix check restricting wallet route delegation strictly to `/pair/` and `/api/wallet/`.
   - *Fix*: Added `pathname.startsWith('/api/onboarding/') || pathname.startsWith('/api/agents/')` to the wallet route delegation block in `routes.ts`.
2. **Sub-Allocation Wall vs Price-Above-Target Logic**:
   - Handled edge cases where an agent's `targetMaxAllInUsd === subAllocationUsd` (e.g. $100 target / $100 sub-allocation) when a price drop to $120 exceeds both the sub-allocation and target, ensuring proper categorization as `BLOCKED_SUB_ALLOCATION_WALL` when triggered by an active price drop webhook.
3. **Vitest Temporary File Isolation**:
   - Added `VERIPACT_FLEET_STATE_FILE` alongside `VERIPACT_WALLET_STATE_FILE` to `beforeEach` in `wallet-routes.test.ts`, writing to `.vitest-tmp/fleet-routes-state.json` so unit tests execute with zero disk leaks into the root worktree.

---

## 4. Verification Output

### `npm test`
```
 RUN  v3.2.7 D:/Bhavik/VerdiPact

 Test Files  17 passed (17)
      Tests  269 passed (269)
   Start at  16:35:36
   Duration  39.97s (transform 11.29s, setup 0ms, collect 19.50s, tests 47.73s, environment 10ms, prepare 15.85s)
```

### `npm run verify:e2e`
```
E2E 01 :: load / (auto-populate captured)
  view1@1600: scrollWidth=1600 clientWidth=1600
E2E 02 :: Autonomous Shopping Agent Studio & 3D robot canvas rendered
E2E 03 :: favicon routes serve SVG
E2E 04 :: reset demo via real button
E2E 05 :: scenario 1 witness + authorize (real clicks)
E2E 06 :: auditor shows JCS-PARITY MATCH
E2E 07 :: scenario 2 surcharge auto-voids
E2E 08 :: scenario 3 injection blocks pre-checkout
E2E 09 :: store iframes fit 310px with zero inner scroll
  store/normal: scrollHeight=310 scrollWidth=646 clientWidth=646
  store/surcharge_void: scrollHeight=310 scrollWidth=646 clientWidth=646
  store/adversarial_hidden_dom: scrollHeight=310 scrollWidth=646 clientWidth=646
E2E 10 :: two-step popup approval end-to-end
E2E 11 :: dispute desk: inspect + resolve both cases
  view2@1600: scrollWidth=1600 clientWidth=1600
E2E 12 :: regression suite + studio chart
E2E 13 :: live mandate edit flips checkout outcomes (UI)
E2E 14 :: View 1 → View 2 live dispute filing (drift + forgery)
E2E 15 :: audit ledger + custom HTML witness APIs
E2E 16 :: guided autopilot tour completes with spotlight
E2E 17 :: v5 wallet clean load: null-safe partitions + wallet DOM present
E2E 18 :: v5 QR pairing ceremony end-to-end
E2E 19 :: v5 partition spend, wall block, refund undo
E2E 20 :: v5 sync grid: legacy vs protected
E2E 21 :: v5 connectors mint one-time credentials
E2E 22 :: Channel3 multi-SKU selection: refurbished blocked on spend, compliant captured, resets to default
E2E 23 :: v6 autonomous deal & voucher sniper end-to-end
E2E 24 :: viewport 1366x768 overflow sweep
  view1@1366: scrollWidth=1366 clientWidth=1366
  view2@1366: scrollWidth=1366 clientWidth=1366
  store/normal: scrollHeight=310 scrollWidth=476 clientWidth=476
  store/surcharge_void: scrollHeight=310 scrollWidth=476 clientWidth=476
  store/adversarial_hidden_dom: scrollHeight=310 scrollWidth=476 clientWidth=476
E2E 25 :: viewport 1050x800 overflow sweep
  view1@1050: scrollWidth=1050 clientWidth=1050
  view2@1050: scrollWidth=1050 clientWidth=1050
  store/normal: scrollHeight=310 scrollWidth=459 clientWidth=459
  store/surcharge_void: scrollHeight=310 scrollWidth=459 clientWidth=459
  store/adversarial_hidden_dom: scrollHeight=310 scrollWidth=459 clientWidth=459
E2E 26 :: viewport 768x1024 overflow sweep
  view1@768: scrollWidth=768 clientWidth=768
  view2@768: scrollWidth=768 clientWidth=768
  store/normal: scrollHeight=310 scrollWidth=692 clientWidth=692
  store/surcharge_void: scrollHeight=310 scrollWidth=692 clientWidth=692
  store/adversarial_hidden_dom: scrollHeight=310 scrollWidth=692 clientWidth=692
E2E RESULT: PASS — zero 4xx/5xx, zero console/page errors, zero overflow
```
