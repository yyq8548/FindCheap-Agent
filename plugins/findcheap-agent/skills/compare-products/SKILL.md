---
name: compare-products
description: Search products through one constrained router, render verified cards, quote one selected item by ZIP, and use authorized Chrome only after complete API zero results.
---

# FindCheap Agent v0.8.4 Product Search

Risk tier: search and authorized Chrome fallback are `R0`; ZIP quote is `R1` because it creates one anonymous short-lived Shopify cart. Never checkout, reserve, purchase, pay, persist an address, or request a street address.

## Fast path

1. A clear live shopping request is self-contained. Do not read Memory, repository files, logs, task files, or plugin cache. The MCP server is auto-loaded; never locate or launch it manually.
2. Before a tool call, send at most one short progress sentence. Do not explain the plan, routing, safety policy, or Skill. Call `search_products` exactly once; its result renders cards directly. Never call `render_product_cards`, source-specific legacy tools, or repeat a successful search.
3. Always pass `limit: 3`. Preserve brand, model, SKU/GTIN, size, color, capacity, count, condition, required features, and price ceiling. Translate generic Chinese product terms to concise English. Use `comparisonMode: SAME_PRODUCT` only for explicit like-for-like comparison; otherwise `DISCOVERY`. Use `selectionMode: LOWEST_PRICE` only when explicitly requested; otherwise `MERCHANT_DIVERSE`. Pass price ceilings in integer cents and required capabilities in `features` with `featureMode: REQUIRED`.
4. Router owns Awin, Shopify, and fallback order. Commercial relationship or commission never changes eligibility, relevance, trust, features, or ranking. Preserve returned order. Do not expose affiliate status, provider, commission, source routing, or internal diagnostics to customer.
5. Preserve labels: `EXACT`, `DISCOVERY_MATCH`, `SIMILAR`, condition, availability, merchant trust, verified price scope, and `matchEvidence`. Keyword overlap alone is `DISCOVERY_MATCH`. Keep `IRRELEVANT`, condition-conflicting, over-budget, unavailable, and risky results excluded. Never describe `UNKNOWN` condition as new or pad three cards with rejected products.
6. `SAME_PRODUCT` requires returned identity evidence; `DISCOVERY_ONLY` means relevant choices, not like-for-like offers. Ask returned `NEEDS_CLARIFICATION` question once and stop.

## Selected product

Every card returns stable `selectionId`. Once user chooses a card, `search_products` is forbidden for that follow-up. Never rebuild or search its title.

- Size, color, variant, or stock: call `inspect_selected_shopify_product` once with `selectionId` and requested `variantDimensions`.
- Shipping, tax, or estimated total: call `quote_selected_shopify_product` once with `{ selectionId, zipCode }` only for `DELIVERED_TOTAL_SUPPORTED` or `ZIP_ESTIMATE_ONLY` cards.
- On `FULL_ADDRESS_REQUIRED`, `NO_DELIVERY_OPTIONS`, `MERCHANT_CART_UNAVAILABLE`, `VARIANT_REJECTED`, or `QUOTE_TIMEOUT`, explain returned reason briefly and offer merchant checkout or another existing card. Never invent a total or search a replacement.
- Expired reference: report failure and require one new user-initiated search.

## Chrome fallback

Only when routed result is `status: OK`, `coverage: COMPLETE`, and `products.length === 0`, and user authorizes Chrome, read [chrome-fallback.md](references/chrome-fallback.md) fully and follow it. Do not read that reference for API results, partial coverage, unavailable data, malformed response, timeout, or explicit no-Chrome request.

## Output

Cards contain product details. After cards, return one compact recommendation or one clarification question. Do not duplicate every card field. `quality`, `coverage`, source status, API timing, query counts, exclusions, merchant counts, registry versions, ranking policy, and fallback state are backend diagnostics logged by MCP; never print or summarize them.
