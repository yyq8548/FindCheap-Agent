---
name: compare-products
description: For live shopping, match all prose to the user's language. When named, say only "Searching for suitable products." for English or "正在使用 FindCheap 搜索合适商品。" for Chinese; never narrate Skill or Memory reads.
---

# FindCheap Agent v0.13.2 Product Search

Search/Chrome are `R0`; ZIP quote is `R1`. Never checkout, reserve, buy, pay, persist, or request street address.

## Fast path

1. Every live shopping request is self-contained except one immediate correction. Do not read Memory, repository files, logs, task files, or plugin cache. Do not open Skill files or narrate file reads. New image: `contextMode: NEW_PRODUCT`; clear prior brand/style. No-image brand correction: `CORRECT_PREVIOUS_PRODUCT`; reuse prior type/visual evidence. Use `CONTINUE_PREVIOUS_PRODUCT` only when explicitly same item. Unclear reference: `AMBIGUOUS`; ask before search.
2. Detect language from user prose. English request: English only. Chinese request: Chinese only. Keep product names, brands, and models unchanged. Before tool call, use only one neutral progress sentence: `Searching for suitable products.` or `正在搜索合适商品。`; if named, `正在使用 FindCheap 搜索合适商品。` Do not add a plan, diagnostics, file explanation, or “Skill requires” wording. Call `search_products` exactly once. Never call `render_product_cards`.
3. Always pass `limit: 3`. Keep `query` to identity; put family in `productType`, objective must-haves in `requiredFeatures`, usage in `preferences`. `preferences`. Preferences rank but never exclude. Budget is inclusive `maxItemPriceCents`; choose strongest match inside it. Explicit brand uses `brandMode: REQUIRED`; preference `PREFERRED`; uncertain image `OBSERVED`. Never put brand in `productType` or `requiredFeatures`. Preserve identity, variant, condition, ceiling; never infer condition. In `visualInput`, put certain structure in `hardClues`, uncertain material/style in `softClues`, visible conflicts in `negativeClues`; never pass local `imageUrl` or contradictory clues. Named product remains `SAME_PRODUCT`; without model/SKU/style use `DISCOVERY`. Use `SAME_PRODUCT` only for like-for-like; otherwise `DISCOVERY`. Alternatives only when asked. Use `LOWEST_PRICE` only when asked; otherwise `MERCHANT_DIVERSE`. Pass ceilings in integer cents. Payment-plan, trade-in, coupon, member, or `from` text is not item price.
4. Tool searches Awin, Shopify, eBay and verified official store; never run passes manually. Official identity never bypasses relevance. Preserve returned order: verified official matches (maximum 2), trusted high matches, best-value high matches. Affiliate status never changes eligibility or ranking. Hide diagnostics.
5. Evaluate title, category, description, attributes. Product family or sleeve/neckline/length/pattern/negative conflict excludes. Unknown type without stable model/style is not strong. Missing evidence does not create a zero result; missing soft evidence may stay limitation-labeled, but missing hard evidence cannot promote. Ratings do not verify merchants; trust does not prove brand authorization. Preserve condition, availability, trust, price scope, `matchEvidence`, group, limits. Keep `IRRELEVANT`, conflicts, over-budget, unavailable, risky results excluded. Never describe `UNKNOWN` condition as new or pad three cards with rejected products.
6. `SAME_PRODUCT` needs identity; `DISCOVERY_ONLY` is not like-for-like. `POSSIBLE_SAME_ITEM`: model/style, or type + brand + 3 hard clues, no conflict. `HIGHLY_SIMILAR`: type + 2 hard clues, no conflict. `SAME_STYLE` only when alternatives requested. None is `EXACT` without stable identity. Ask at most one `NEEDS_CLARIFICATION` question.

## Selected product
Cards return stable `selectionId`. Once chosen, `search_products` is forbidden for that follow-up. Never rebuild/search title.

- Size/color/stock: call `inspect_selected_shopify_product` once with `selectionId` and `variantDimensions`.
- Total: for supported `quoteCapability`, ask only missing ZIP, then call `quote_selected_shopify_product` once. For `MERCHANT_CHECKOUT_ONLY`, do not ask for ZIP or call quote; final total needs checkout.
- Current deals/cheapest current path: call `research_selected_product_deal` with stable `selectionId`. Return current evidence only; do not discuss price history or buy-or-wait forecasting. No Watch unless requested.
- On quote error, explain returned code; offer checkout or existing card. Never invent total or search replacement.
- Expired reference: report failure and require one new user-initiated search.

## Chrome fallback

Only when the router has completed its automatic broader second pass, returns `status: OK`, `coverage: COMPLETE`, and `products.length === 0`, and the user authorizes Chrome, read [chrome-fallback.md](references/chrome-fallback.md) fully and follow it. Do not read that reference for API results, partial coverage, unavailable data, malformed response, timeout, or explicit no-Chrome request.

## Output

After cards, give one same-language recommendation/clarification. State actual counts; never describe multiple products from one merchant as merchant-diverse. Do not duplicate every card field or embed Markdown product images; product images belong only in returned cards. `quality`, timing, exclusions, ranking, fallback are backend diagnostics logged by MCP; never print them.
