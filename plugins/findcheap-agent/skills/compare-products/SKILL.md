---
name: compare-products
description: For live shopping, say only "正在使用 FindCheap 搜索合适商品。" when this Skill is named; never narrate Skill or Memory reads. Search through one constrained router, render evidence-labeled cards, quote one selected item by ZIP, and use authorized Chrome only after complete API zero results.
---

# FindCheap Agent v0.10.3 Product Search

Risk tier: search and authorized Chrome fallback are `R0`; ZIP quote is `R1` because it creates one anonymous short-lived Shopify cart. Never checkout, reserve, purchase, pay, persist an address, or request a street address.

## Fast path

1. Every live shopping request is self-contained. Do not read Memory, repository files, logs, task files, or plugin cache. Do not open Skill files or narrate file reads. Ask one compact question only when product type or a decision-critical constraint is missing. MCP is auto-loaded; never locate or launch it.
2. Before a tool call, use only one neutral progress sentence. Chinese: `正在搜索合适商品。` If the host requires naming the Skill: `正在使用 FindCheap 搜索合适商品。` Do not add a plan, result count, merchant diversity, availability, trust, exact-match promise, file-read explanation, or “Skill requires” wording. Call `search_products` exactly once; its result renders cards directly. Never call `render_product_cards`, source-specific legacy tools, or repeat a successful search.
3. Always pass `limit: 3`. Put the family in `productType`; objective must-haves in `requiredFeatures`; subjective intent such as `日常穿`, casual, stylish, versatile, comfortable, or office wear in `preferences`. Preferences rank but never exclude. Must-haves include explicit dimensions, capacity, count, resolution, power, size, color, generation, compatibility, or material. Never invent one. Preserve brand, model, SKU/GTIN, condition, and price ceiling. Never infer condition; absent an explicit state, use `ANY` and keep `UNKNOWN`. Translate common Chinese material/shoe/style terms. Use `SAME_PRODUCT` only for like-for-like; otherwise `DISCOVERY`. Use `LOWEST_PRICE` only when requested; otherwise `MERCHANT_DIVERSE`. Pass ceilings in integer cents. Payment-plan, trade-in, coupon, member, or `from` text is not item price.
4. Router starts Awin, Shopify, and configured eBay Browse in parallel on each search pass, then merges one ranked result. Default order is requirement evidence and match, merchant reliability, preferences, verified Coupon, then lower item price. `LOWEST_PRICE` keeps item price first. A Coupon may improve rank only when verified; never subtract it from displayed price unless value and applicability are proven. Commercial relationship or commission never changes eligibility, relevance, features, or ranking. Preserve returned order. Do not expose provider, source routing, or internal diagnostics. Preserve the required affiliate disclosure shown beside an approved purchase link.
5. Evaluate requirements across title, product type/category, description, and structured attributes. Explicit contradiction excludes. Missing evidence does not create a zero result: keep a limited `DISCOVERY_MATCH` with `requiredFeatureLimitations`. Preserve merchant tiers: (1) reviewed registry/Awin; (2) Shopify rating `>3.8` with `>=2` reviews; (3) limited-trust Shopify or eBay sellers. eBay is the marketplace and `sellerName` is the individual seller; EPN approval does not verify that seller. Ratings do not verify merchants; trust does not prove brand authorization. Preserve identity, condition, availability, trust, price scope, `matchEvidence`, and limitations. Keep `IRRELEVANT` excluded with conflicting, over-budget, unavailable, and risky results. Never describe `UNKNOWN` condition as new or pad three cards with rejected products.
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
