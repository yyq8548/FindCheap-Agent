# FindCheap Agent v0.5.4: Search and Match Trust

## Delivered

- `EXACT` requires Shopify UPID, GTIN plus requested variant, or brand plus MPN/SKU plus requested variant.
- Relevant keyword-only results use `DISCOVERY_MATCH`.
- Missing or conflicting identity or variant terms use `SIMILAR`; unrelated accessories remain excluded.
- Product cards render exact, discovery, and similar results in separate sections.
- Cards show available brand, model/SKU, variants, condition, availability, identity evidence, and observation date.
- Matching evaluation contains 30 deterministic cases covering model, accessory, condition, color, size, and capacity boundaries.

## Non-goals

- Discovery evidence is not delivered-price evidence.
- Public item prices still exclude shipping, tax, fees, membership pricing, and unverified Coupon data.
- Affiliate links remain disabled until the relationship is approved.
