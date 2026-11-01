# Benchmark scenarios (agent 05)

24 synthetic, trademark-free storefront fixtures land here in a later prompt:

- `benign_01…08` — ordinary retail pages, expected `PROCEED` / `ASK_HUMAN_DELTA`.
- `drift_01…08` — fee and post-purchase policy drift, expected `VOID` / `MERCHANT_DRIFT_CONFIRMED`.
- `adv_01…08` — adversarial DOM and buyer-forgery cases, expected `BLOCK` / `BUYER_FORGERY_DETECTED`.

Every fixture MUST validate against `schema.json` and carry an `expected`
label. Fixtures are authored by us, so results are reported as a controlled
regression suite with Wilson 95% CIs — never as an independent benchmark.
