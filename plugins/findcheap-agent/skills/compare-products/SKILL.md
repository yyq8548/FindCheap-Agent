---
name: compare-products
description: For live shopping, match all prose to the user's language. When named, say only "Searching for suitable products." for English or "正在使用 FindCheap 搜索合适商品。" for Chinese; never narrate Skill or Memory reads.
---

# FindCheap Agent v0.10.5 Product Search

Search and authorized Chrome fallback are `R0`; ZIP quote is `R1` because it creates an anonymous short-lived Shopify cart. Never checkout, reserve, purchase, pay, persist, or request a street address.

## Fast path

1. Every live shopping request is self-contained. Do not read Memory, repository files, logs, task files, or plugin cache. Do not open Skill files or narrate file reads. Ask one compact question only when product type or a decision-critical constraint is missing. MCP is auto-loaded; never locate or launch it.
2. Detect language from user prose, ignoring brand/model text. English request: English only. Chinese request: Chinese only. Mixed: follow the shopping instruction. Keep product names, brands, and models unchanged. Before the tool call use only one neutral progress sentence: English `Searching for suitable products.`; Chinese `正在搜索合适商品。`; name the Skill only when required: `正在使用 FindCheap 搜索合适商品。` Never switch language unless asked. Do not add a plan, result count, diversity, availability, trust, exact-match promise, file-read explanation, or “Skill requires” wording. Call `search_products` exactly once; cards render directly. Never call `render_product_cards`, legacy source tools, or repeat a successful search.
3. Always pass `limit: 3`; it is a ceiling, not a quota. Put family in `productType`, objective must-haves in `requiredFeatures`, and subjective intent in `preferences`. Preferences rank but never exclude. Must-haves are explicit size, color, material, capacity, count, power, generation, or compatibility; never invent them. Preserve brand, line, model/style, SKU/GTIN, condition, variant, and price ceiling. Never infer condition: absent an explicit state, use `ANY` and keep `UNKNOWN`. Translate common Chinese product terms. Use `SAME_PRODUCT` only for like-for-like; otherwise `DISCOVERY`. Set `allowAlternatives: true` only for an explicit similar/substitute request. Use `LOWEST_PRICE` only when requested; otherwise `MERCHANT_DIVERSE`. Pass ceilings in integer cents. Payment-plan, trade-in, coupon, member, or `from` text is not item price.
4. Router searches Awin, Shopify, and configured eBay in parallel, then merges one ranked result. Default order: identity, match evidence, merchant reliability, availability, preferences, verified Coupon, lower item price. `LOWEST_PRICE` moves price first only after eligibility gates. Never subtract a Coupon without proven value and applicability. Commercial relationship never changes ranking. Preserve returned order and required affiliate disclosure. Do not expose routing or diagnostics.
5. Evaluate title, category, description, and attributes. Explicit contradiction excludes. Exact mode rejects similar identity unless alternatives were requested; return 0–3 cards without substitutes. Missing evidence does not create a zero result: missing non-identity evidence may remain limited `DISCOVERY_MATCH`. Preserve merchant tiers: reviewed registry/Awin; Shopify rating `>3.8` with `>=2` reviews; limited-trust Shopify/eBay. EPN does not verify sellers; ratings do not verify merchants; trust does not prove brand authorization. Preserve identity, condition, availability, trust, price scope, `matchEvidence`, result group, and limitations. Keep `IRRELEVANT`, conflicting, over-budget, unavailable, and risky results excluded. Never describe `UNKNOWN` condition as new or pad three cards with rejected products.
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

Cards contain product details. After cards, return one compact same-language recommendation or clarification. State actual card and merchant counts; never describe multiple products from one merchant as merchant-diverse. Do not duplicate every card field. `quality`, `coverage`, source status, timing, query counts, exclusions, registry versions, ranking policy, and fallback state are backend diagnostics logged by MCP; never print them.
