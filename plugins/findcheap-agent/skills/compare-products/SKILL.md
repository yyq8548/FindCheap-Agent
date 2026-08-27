---
name: compare-products
description: For live shopping, match all prose to the user's language. When named, say only "Searching for suitable products." for English or "正在使用 FindCheap 搜索合适商品。" for Chinese; never narrate Skill or Memory reads.
---

# FindCheap Agent v0.12.0 Product Search

Search and authorized Chrome fallback are `R0`; ZIP quote is `R1`. Never checkout, reserve, purchase, pay, persist, or request a street address.

## Fast path

1. Every live shopping request is self-contained. Do not read Memory, repository files, logs, task files, or plugin cache. Do not open Skill files or narrate file reads. Ask one compact question only for missing product type or a critical constraint. MCP is auto-loaded; never locate or launch it.
2. Detect language from user prose, ignoring brand/model text. English request: English only. Chinese request: Chinese only. Mixed: follow the shopping instruction. Keep product names, brands, and models unchanged. Before the tool call use only one neutral progress sentence: English `Searching for suitable products.`; Chinese `正在搜索合适商品。`; name the Skill only when required: `正在使用 FindCheap 搜索合适商品。` Never switch language unless asked. Do not add a plan, result count, diversity, availability, trust, exact-match promise, file-read explanation, or “Skill requires” wording. Call `search_products` exactly once; cards render directly. Never call `render_product_cards`, legacy source tools, or repeat a successful search.
3. Always pass `limit: 3`; it is a ceiling. Put family in `productType`, objective must-haves in `requiredFeatures`, and subjective intent in `preferences`. Preferences rank but never exclude. Preserve identity, variant, condition and price ceiling; never invent or infer condition. For an attached image, inspect it and pass `visualInput` with only visible type, brand/logo, model/style, color, material, pattern, silhouette and length. Do not infer unclear evidence. Visual discovery includes separated same-style results. Use `SAME_PRODUCT` only for like-for-like; otherwise `DISCOVERY`. Set alternatives only when requested. Use `LOWEST_PRICE` only when requested; otherwise `MERCHANT_DIVERSE`. Pass ceilings in integer cents. Payment-plan, trade-in, coupon, member, or `from` text is not item price.
4. Router searches Awin, Shopify and configured eBay in parallel. Rank identity, evidence, trust, availability, preferences, verified Coupon, then price; `LOWEST_PRICE` moves price first after gates. Never subtract an unproven Coupon. Commercial relationship never changes ranking. Preserve returned order and disclosure. Hide routing and diagnostics.
5. Evaluate title, category, description and attributes. Contradiction excludes. Exact mode rejects similar identity unless requested. Missing evidence does not create a zero result: limited non-identity evidence may stay `DISCOVERY_MATCH`. Keep merchant tiers; ratings do not verify merchants and trust does not prove brand authorization. Preserve condition, availability, trust, price scope, `matchEvidence`, result group and limitations. Keep `IRRELEVANT`, conflicting, over-budget, unavailable and risky results excluded. Never describe `UNKNOWN` condition as new or pad three cards with rejected products.
6. `SAME_PRODUCT` requires returned identity evidence; `DISCOVERY_ONLY` means relevant choices, not like-for-like offers. Visual results must remain separated as `POSSIBLE_SAME_ITEM`, `HIGHLY_SIMILAR`, and `SAME_STYLE`; none is `EXACT` without stable identity. Ask at most one returned `NEEDS_CLARIFICATION` question for the most decision-critical product type, size, budget, color, or occasion, then stop.

## Selected product
Every card returns stable `selectionId`. Once user chooses a card, `search_products` is forbidden for that follow-up. Never rebuild or search its title.

- Size, color, variant, or stock: call `inspect_selected_shopify_product` once with `selectionId` and requested `variantDimensions`.
- Shipping, tax, or estimated total: inspect the selected card's `quoteCapability`. For `DELIVERED_TOTAL_SUPPORTED` or `ZIP_ESTIMATE_ONLY`, ask only for ZIP when missing, then call `quote_selected_shopify_product` once with `{ selectionId, zipCode }`. For `MERCHANT_CHECKOUT_ONLY`, do not ask for ZIP and do not call the quote tool; say shipping, tax, and final total require merchant checkout.
- Buy/wait: call `research_selected_product_deal` with stable `selectionId`. No Watch unless requested.
- On `FULL_ADDRESS_REQUIRED`, `NO_DELIVERY_OPTIONS`, `MERCHANT_CART_UNAVAILABLE`, `VARIANT_REJECTED`, or `QUOTE_TIMEOUT`, explain returned reason briefly and offer merchant checkout or another existing card. Never invent a total or search a replacement.
- Expired reference: report failure and require one new user-initiated search.

## Chrome fallback

Only when the router has completed its automatic broader second pass, returns `status: OK`, `coverage: COMPLETE`, and `products.length === 0`, and the user authorizes Chrome, read [chrome-fallback.md](references/chrome-fallback.md) fully and follow it. Do not read that reference for API results, partial coverage, unavailable data, malformed response, timeout, or explicit no-Chrome request.

## Output

Cards contain product details. After cards, return one compact same-language recommendation or clarification. State actual card and merchant counts; never describe multiple products from one merchant as merchant-diverse. Do not duplicate every card field. `quality`, `coverage`, source status, timing, query counts, exclusions, registry versions, ranking policy, and fallback state are backend diagnostics logged by MCP; never print them.
