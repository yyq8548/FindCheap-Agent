---
name: compare-products
description: For live shopping, match all prose to the user's language. When named, say only "Searching for suitable products." for English or "正在使用 FindCheap 搜索合适商品。" for Chinese; never narrate Skill or Memory reads.
---

# FindCheap Agent v0.12.6 Product Search

Search/Chrome are `R0`; ZIP quote is `R1`. Never checkout, reserve, buy, pay, persist, or request street address.

## Fast path

1. Every live shopping request is self-contained except one immediate correction. Do not read Memory, repository files, logs, task files, or plugin cache. Do not open Skill files or narrate file reads. MCP auto-loads. `it is DOEN`, `brand is DÔEN`, or `品牌是 DÔEN` corrects brand, not completion; reuse only preceding type/visual evidence. New image starts new product and clears prior brand/style unless user says same.
2. Detect language from user prose, not brand/model. English request: English only. Chinese request: Chinese only. Keep product names, brands, and models unchanged. Before tool call, use only one neutral progress sentence: `Searching for suitable products.` or `正在搜索合适商品。`; if named, `正在使用 FindCheap 搜索合适商品。` Do not add a plan, promise, file explanation, diagnostics, or “Skill requires” wording. Call `search_products` exactly once. Never call `render_product_cards` or repeat success.
3. Always pass `limit: 3`. Put family in `productType`, objective must-haves in `requiredFeatures`, intent in `preferences`. Preferences rank but never exclude. Explicit brand uses `brandMode: REQUIRED`; preference uses `PREFERRED`, uncertain image uses `OBSERVED`. Never put brand in `productType` or `requiredFeatures`. Preserve identity, variant, condition, ceiling; never infer condition. Image evidence belongs only in `visualInput`; pass extracted attributes, never a local file path as `imageUrl`. An explicit product name stays `SAME_PRODUCT` even when visual evidence is retained. Without stable model/SKU/style, stay `DISCOVERY`. Use `SAME_PRODUCT` only for like-for-like; otherwise `DISCOVERY`. Alternatives only when asked. Use `LOWEST_PRICE` only when asked; otherwise `MERCHANT_DIVERSE`. Pass ceilings in integer cents. Payment-plan, trade-in, coupon, member, or `from` text is not item price.
4. Search Awin, Shopify, eBay in parallel. After required-brand Catalog miss, tool searches one verified official Shopify store: full traits, category/core traits, category. Never run passes manually. Rank recalled products by visual evidence, then identity, trust, availability, preferences, verified Coupon, price. Preserve returned order; hide diagnostics. Commercial relationships never rank results.
5. Evaluate title, category, description, attributes. Contradiction excludes. Missing evidence does not create a zero result; limited evidence may stay `DISCOVERY_MATCH`. Keep merchant tiers; ratings do not verify merchants and trust does not prove brand authorization. Preserve condition, availability, trust, price scope, `matchEvidence`, group, limits. Keep `IRRELEVANT`, conflicts, over-budget, unavailable, risky results excluded. Never describe `UNKNOWN` condition as new or pad three cards with rejected products.
6. `SAME_PRODUCT` needs identity evidence; `DISCOVERY_ONLY` is not like-for-like. Separate `POSSIBLE_SAME_ITEM`, `HIGHLY_SIMILAR`, `SAME_STYLE`; none is `EXACT` without stable identity. Ask at most one returned `NEEDS_CLARIFICATION` question, then stop.

## Selected product
Cards return stable `selectionId`. Once chosen, `search_products` is forbidden for that follow-up. Never rebuild/search title.

- Size/color/stock: call `inspect_selected_shopify_product` once with `selectionId` and `variantDimensions`.
- Total: for supported `quoteCapability`, ask only missing ZIP, then call `quote_selected_shopify_product` once. For `MERCHANT_CHECKOUT_ONLY`, do not ask for ZIP or call quote; final total needs checkout.
- Buy/wait: call `research_selected_product_deal` with stable `selectionId`. No Watch unless requested.
- On quote error, explain returned code; offer checkout or existing card. Never invent total or search replacement.
- Expired reference: report failure and require one new user-initiated search.

## Chrome fallback

Only when the router has completed its automatic broader second pass, returns `status: OK`, `coverage: COMPLETE`, and `products.length === 0`, and the user authorizes Chrome, read [chrome-fallback.md](references/chrome-fallback.md) fully and follow it. Do not read that reference for API results, partial coverage, unavailable data, malformed response, timeout, or explicit no-Chrome request.

## Output

After cards, give one same-language recommendation/clarification. State actual counts; never describe multiple products from one merchant as merchant-diverse. Do not duplicate every card field. `quality`, timing, exclusions, ranking, fallback are backend diagnostics logged by MCP; never print them.
