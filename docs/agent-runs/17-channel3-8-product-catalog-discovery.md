# Run 17 — Atomic Task 2: Wire Channel3 8-Product Catalog Discovery into Workbench (`routes.ts` & `ui-template.ts`)

Parent: run 16 (Stream binding fix, 239/239 unit tests, live server verified).
Prompt: Atomic Task 2: Wire Channel3 8-Product Catalog Discovery into Workbench (`routes.ts` & `ui-template.ts`).

## 1. Problem and Objective

VeriPact previously hardcoded a single monitor product (`APEX-27-4K-IPS`) into the storefront preview. Channel3 was represented only as a passive badge on that single product, rather than showcasing its full multi-category product catalog and offer oracle discovery capabilities across normal, refurbished, and over-cap merchandise.

The goal was to upgrade Channel3 into an interactive **Channel3 Catalog & Offer Discovery** selector across all 8 products in `benchmark/responses/channel3_catalog_cache.json`, wired directly into the storefront renderer, the witness flow, and the sufficiency gate.

## 2. What was built

1. **`GET /api/catalog` Endpoint (`packages/workbench/src/routes.ts`):**
   - Added `'/api/catalog'` to `ROUTES` and `knownPaths`.
   - Handled via `handleCatalog(res)` which calls `loadChannel3CacheFromDisk(getCatalogCachePath())`.
   - Returns `200 OK` with JSON payload `{ products: Channel3CatalogProduct[], source: 'CHANNEL3_ORACLE_CATALOG' }`.
   - Updated `handleStore(scenarioId, sku, res)` and URL parsing in `handleWorkbenchRequest` to support `?sku=<productId>` query parameter (defaulting to `APEX-27-4K-IPS`).
   - Updated `handleWitnessSnapshot` to read `body['sku']`, load the full 8-product cache (`getCatalogCachePath()`), and synthesize dynamic HTML via `renderStorefront(scenario, sku)` when `sku` is supplied, allowing the witness DOM extractor and oracle verification to operate synchronously over whichever catalog item is active.

2. **Dynamic Storefront Renderer (`packages/workbench/src/storefront-template.ts`):**
   - Added `findCatalogProduct(sku)` to look up products in the 8-product catalog fallback with matching specs and prices.
   - Added `artworkFor(category)` rendering custom SVG illustrations for Monitors, Laptops, Audio, and Accessories.
   - Added `copyFor(scenario, product)` rendering dynamic marketing descriptions, condition labels (`NEW` vs `CERTIFIED REFURBISHED`), and warranty terms.
   - Added dynamic `fixtureBadges(scenario, product)` that runs the extraction engine over the synthesized HTML to expose identical block boundaries.
   - Exported `renderStorefront(scenario: ScenarioId, sku = 'APEX-27-4K-IPS'): string`.

3. **Interactive UI Selector (`packages/workbench/src/ui-template.ts`):**
   - Added `.channel3-catalog-bar` with `<select id="channel3-sku-select">` above the storefront iframe preview in View 1.
   - Implemented `initChannel3Catalog()` which fetches `GET /api/catalog` on page load, dynamically creating `<option>` elements with SKU, price, condition, and title.
   - Added an event listener on `#channel3-sku-select` that:
     1. Updates `state.sku`.
     2. Reloads the `#store-frame` with `/store/<scenario>?sku=<sku>`.
     3. Executes `runWitnessFlow()` automatically.
   - Updated `selectScenario(scn)` to retain `state.sku`.
   - Updated `runWitnessFlow()` to pass `{ scenario: state.scenario, sku: state.sku || 'APEX-27-4K-IPS' }` to `POST /api/witness/snapshot`.
   - Updated `resetDemo()` to restore `state.sku = 'APEX-27-4K-IPS'`.

4. **Monorepo Unit Tests (`packages/workbench/test/workbench.test.ts`):**
   - Added test: `'serves the 8-product Channel3 catalog cache via GET /api/catalog'` (verifies 8 products and `source: 'CHANNEL3_ORACLE_CATALOG'`).
   - Added test: `'renders dynamic storefront with ?sku parameter for different Channel3 products'` (tests `NORTHLOOP-14-AIR` and `APEX-27-4K-IPS-RB`).
   - Added test: `'POST /api/witness/snapshot runs Sufficiency Gate and Channel3 Oracle on selected catalog SKU'` (tests `BLOCK` on over-cap laptop, `BLOCK` on refurbished condition conflict, and `ASK_HUMAN_DELTA` on compliant headphones).
   - Added index HTML template assertions verifying `#channel3-sku-select`.
   - Total test count across monorepo increased to **240/240 across 16 files**.

5. **Live Chrome DevTools Browser Verification:**
   - Started live HTTP server via `npm start` on port 3000.
   - Navigated to `http://localhost:3000/` using `navigate_page`.
   - Inspected `#channel3-sku-select`: verified 8 options loaded from `/api/catalog`.
   - Dispatched selection for `NORTHLOOP-14-AIR` ($899 laptop):
     - `frameSrc`: `"/store/normal?sku=NORTHLOOP-14-AIR"`
     - `gateBadge`: `"✕ BLOCKED · base price $899.00 exceeds mandate cap …"` (`pill-bad`)
     - `oracleLine`: `"✓ Policy aligned · NORTHLOOP-14-AIR"` (`pill-ok`)
     - `checkoutStatus`: `"Gate decision: BLOCK — base price $899.00 exceeds mandate cap $320.00"`
   - Dispatched selection for `APEX-27-4K-IPS-RB` ($219 certified refurbished monitor):
     - `frameSrc`: `"/store/normal?sku=APEX-27-4K-IPS-RB"`
     - `gateBadge`: `"✕ BLOCKED · condition conflict: observed REFURBISHED …"` (`pill-bad`)
     - `oracleLine`: `"✓ Policy aligned · APEX-27-4K-IPS-RB"` (`pill-ok`)
     - `checkoutStatus`: `"Gate decision: BLOCK — condition conflict: observed REFURBISHED but mandate requires NEW"`
   - Dispatched selection for `APEX-27-4K-IPS` ($279 new monitor):
     - `gateBadge`: `"ASK_HUMAN_DELTA · $41.00 headroom"` (`pill-warn`)
     - `checkoutStatus`: `"Gate decision: ASK_HUMAN_DELTA — post-approval delta pending: shipping_usd and tax_usd indeterminate (calculated at checkout)"`
   - Verified browser console: **0 errors, 0 warnings**.

## 3. Marketplace Skills & Tools Consulted

- `chrome-devtools-mcp`: `list_pages`, `navigate_page`, `evaluate_script`, `list_console_messages` to verify DOM rendering and live API calls in browser.
- `@veripact/witness-client`: `loadChannel3CacheFromDisk`, `Channel3CatalogProduct`.
- `vitest`: unit test verification across 16 test files.

## 4. Verification Output

Full Rule 1 Zero-Broken-Push Gate passed with code 0:
```
> veripact@0.1.0 lint
> eslint .

> veripact@0.1.0 typecheck
> tsc --noEmit -p tsconfig.typecheck.json

> veripact@0.1.0 build
> tsc -b .

> veripact@0.1.0 test
> tsc -b . && vitest run

 Test Files  16 passed (16)
      Tests  240 passed (240)
```

