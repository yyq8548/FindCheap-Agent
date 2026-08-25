---
name: compare-products
description: For live shopping, say only "正在使用 FindCheap 搜索合适商品。" when this Skill is named; never narrate Skill or Memory reads. Search through one constrained router, render evidence-labeled cards, quote one selected item by ZIP, and use authorized Chrome only after complete API zero results.
---

# FindCheap Agent v0.9.4 Product Search

Risk tier: search and authorized Chrome fallback are `R0`; ZIP quote is `R1` because it creates one anonymous short-lived Shopify cart. Never checkout, reserve, purchase, pay, persist an address, or request a street address.

## Fast path

1. Every live shopping request, including a broad or ambiguous request, is self-contained. Do not read Memory, repository files, logs, task files, or plugin cache. Never open or explain this Skill file through shell when its content is already present in the current task. If the request lacks a product type or decision-critical constraint, ask one compact clarification question directly. The MCP server is auto-loaded; never locate or launch it manually.
2. Before a tool call, use only one neutral progress sentence. Chinese: `正在搜索合适商品。` If the host requires naming the Skill: `正在使用 FindCheap 搜索合适商品。` Do not add a plan, result count, merchant diversity, availability, trust, exact-match promise, file-read explanation, or “Skill requires” wording. Call `search_products` exactly once; its result renders cards directly. Never call `render_product_cards`, source-specific legacy tools, or repeat a successful search.
3. Always pass `limit: 3`. Put every explicit non-price constraint—size, memory/storage, pack count, volume/weight, resolution/refresh rate/power, apparel/shoe size, color, generation, compatibility—in `features` with `featureMode: REQUIRED`, preserving wording. Preserve brand, model, SKU/GTIN, condition, and price ceiling. Never infer condition: unless new, used, refurbished, open-box, or unknown is explicit, use `ANY`; keep `UNKNOWN` eligible. Translate generic Chinese terms, but never append a generic category when a product family or model is clear. Use `comparisonMode: SAME_PRODUCT` only for like-for-like; otherwise `DISCOVERY`. `LOWEST_PRICE` only when requested; otherwise `MERCHANT_DIVERSE`. Pass price ceilings in integer cents. Use structured item price only; monthly payment, trade-in, coupon, member, or `from` text is not ordinary item price.
4. Router owns Awin, Shopify, the automatic second-pass expansion, and fallback order. Commercial relationship or commission never changes eligibility, relevance, features, or ranking. Preserve returned order. Do not expose affiliate status, provider, commission, source routing, or internal diagnostics to customer.
5. After product identity, required features, condition, price, and availability gates, preserve the returned merchant tiers: (1) independently reviewed registry merchants and approved Awin programs; (2) Shopify products rated above `3.8` with at least `2` reviews; (3) other relevant Shopify merchants with an explicit limited-trust warning. A product rating never verifies the merchant. Merchant trust labels never prove manufacturer or brand authorization; never call a merchant an authorized retailer unless returned evidence explicitly states that authorization. Preserve labels: `EXACT`, `DISCOVERY_MATCH`, `SIMILAR`, condition, availability, merchant trust, verified price scope, and `matchEvidence`. Keyword overlap alone is `DISCOVERY_MATCH`. Keep `IRRELEVANT`, condition-conflicting, over-budget, unavailable, and risky results excluded. Never describe `UNKNOWN` condition as new or pad three cards with rejected products.
6. `SAME_PRODUCT` requires returned identity evidence; `DISCOVERY_ONLY` means relevant choices, not like-for-like offers. Ask returned `NEEDS_CLARIFICATION` question once and stop.

## Selected product

Every card returns stable `selectionId`. Once user chooses a card, `search_products` is forbidden for that follow-up. Never rebuild or search its title.

- Size, color, variant, or stock: call `inspect_selected_shopify_product` once with `selectionId` and requested `variantDimensions`.
- Shipping, tax, or estimated total: inspect the selected card's `quoteCapability`. For `DELIVERED_TOTAL_SUPPORTED` or `ZIP_ESTIMATE_ONLY`, ask only for ZIP when missing, then call `quote_selected_shopify_product` once with `{ selectionId, zipCode }`. For `MERCHANT_CHECKOUT_ONLY`, do not ask for ZIP and do not call the quote tool; say shipping, tax, and final total require merchant checkout.
- On `FULL_ADDRESS_REQUIRED`, `NO_DELIVERY_OPTIONS`, `MERCHANT_CART_UNAVAILABLE`, `VARIANT_REJECTED`, or `QUOTE_TIMEOUT`, explain returned reason briefly and offer merchant checkout or another existing card. Never invent a total or search a replacement.
- Expired reference: report failure and require one new user-initiated search.

## Chrome fallback

Only when the router has completed its automatic broader second pass, returns `status: OK`, `coverage: COMPLETE`, and `products.length === 0`, and the user authorizes Chrome, read [chrome-fallback.md](references/chrome-fallback.md) fully and follow it. Do not read that reference for API results, partial coverage, unavailable data, malformed response, timeout, or explicit no-Chrome request.

## Output

Cards contain product details. After cards, return one compact recommendation or one clarification question. State only the actual number of cards and merchants returned; never describe multiple products from one merchant as merchant-diverse. Do not duplicate every card field. `quality`, `coverage`, source status, API timing, query counts, exclusions, registry versions, ranking policy, and fallback state are backend diagnostics logged by MCP; never print or summarize them.
