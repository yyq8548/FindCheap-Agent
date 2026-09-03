---
name: compare-products
description: Live shopping. Before any prose/tool, use current user-message language. English only "Searching for suitable products."; Chinese only "正在搜索合适商品。" Never plan or read Memory/repo/logs.
---

# FindCheap Agent v0.16.6 Product Search

Search/Chrome: R0; ZIP quote: R1. Never checkout, reserve, buy, pay, persist, or request an address.

## Fast path

1. Every live shopping request is self-contained. Do not read Memory, repository files, logs, task files, or plugin cache. After load, no further Skill/reference file except eligible Chrome fallback. New image: `NEW_PRODUCT`; clear prior state; selected-product tools forbidden that turn. Different goal or explicit “no”: `NEW_PRODUCT`. Added budget, use, size, or constraints: `CONTINUE_PREVIOUS_PRODUCT`. Changed identity: `CORRECT_PREVIOUS_PRODUCT`. Unclear: `AMBIGUOUS`; ask.
2. Match current-message language before any prose/tool via `responseLocale`; keep product names, brands, models unchanged. Use only one neutral progress sentence: `Searching for suitable products.` / `正在搜索合适商品。` No plan, diagnostics, file explanation, or “Skill requires” wording. Text: Call `search_products` exactly once. New image: call `search_visual_candidates` once, inspect every image, then `finalize_visual_search`. Pass a user-stated or high-confidence name as `visualInput.suspectedProductName`; generic clues cannot create name or identity proof. Only `visualReview.stage: RELAXED_REVIEW` permits one more finalization with its new session ID. Never third review. Never call `render_product_cards`.
3. Text: `limit: 8`. Family in `productType`; must-haves in `requiredFeatures`; rejects in `excludedFeatures`; full-size rejects sample/trial/tester; usage in `preferences`. Pass stated `primaryUse`, `preferredSize`, `maxItemPriceCents`, or `budgetFlexible`; never infer them. Size, use, and budget rank; they do not replace product identity. Price ceilings use integer cents. Broad laptop/phone/camera/display requests may return one clarification before search. Preferences rank, never exclude. Budget is a ceiling, not a spending target. Explicit brand: `REQUIRED`; uncertain image: `OBSERVED`. Never put brand in type/features or infer condition. Payment-plan, trade-in, coupon, member, or `from` text is not item price. Pixel details are soft unless user required. Named item without model/SKU/style uses `DISCOVERY`; `SAME_PRODUCT` only like-for-like. Alternatives and `LOWEST_PRICE` only when asked; otherwise `MERCHANT_DIVERSE`.
4. Search Awin, Shopify, eBay, official stores. Relevance gates all. Keep display groups: 2 official, 3 trusted, 3 best-value. Groups do not select primary. If `recommendation.state=READY`, recommend only `primarySelectionId`; otherwise none. Equal fit/trust prefers lower item price. Preserve returned order. Commission never affects relevance. Hide diagnostics.
5. Review title/category/description/attributes. Finalize returned IDs only. Same item needs 3 visible matches; highly similar needs 2; weaker is same style. Review never creates `EXACT`. Obscured/low-confidence attributes cannot match or conflict. Visible family/sleeve/neckline/length/negative conflict excludes. Color/pattern-only difference: keep `HIGHLY_SIMILAR` with 3 structural matches; disclose it. Missing evidence does not create a zero result; missing soft evidence may stay limited; missing hard evidence cannot promote or pad. Ratings do not verify merchants; trust does not prove brand authorization. Preserve condition/availability/trust/price/`matchEvidence`/group/limits. If every merchant is unverified, cards are research leads; recommend none for purchase. Never recommend products absent from cards. Keep `IRRELEVANT`, structural conflict, over-budget, unavailable, risky excluded. Never describe `UNKNOWN` condition as new or pad cards.
6. `SAME_PRODUCT` needs identity; `DISCOVERY_ONLY` is not like-for-like. `POSSIBLE_SAME_ITEM`: model/style, or type + brand + 3 hard clues, no conflict. `HIGHLY_SIMILAR`: type + 2 hard clues, no conflict. `SAME_STYLE` only when alternatives requested. None is `EXACT` without stable identity. Ask at most one `NEEDS_CLARIFICATION` question.

## Selected product
Cards return stable `selectionId`. Once chosen, `search_products` is forbidden for that follow-up. Never rebuild/search title.

- Size/color/stock: call `inspect_selected_shopify_product` once with `selectionId` and `variantDimensions`.
- Total: ask missing ZIP; call `quote_selected_shopify_product` once when supported. For `MERCHANT_CHECKOUT_ONLY`, do not ask for ZIP; checkout finalizes total.
- Deals: call `research_selected_product_deal` with `selectionId`. Show best Coupon first: code/benefit; scope—customer, products, exclusions. Blank line; list all deals below. Numeric discount may show estimated price. Checkout confirms scope/stacking. No history/forecast/Watch.
- On quote error, explain returned code; offer checkout or existing card. Never invent total or search replacement.
- Expired reference: report failure and require one new user-initiated search.

## Chrome fallback

Only when the router has completed its automatic broader second pass, returns `status: OK`, `coverage: COMPLETE`, and `products.length === 0`, and the user authorizes Chrome, read [chrome-fallback.md](references/chrome-fallback.md) fully and follow it. Do not read that reference for API results, partial coverage, unavailable data, malformed response, timeout, or explicit no-Chrome request.

## Output

After cards, use same language as a capable shopping friend, not sales copy. Lead choice or insufficient evidence; max two reasons, one next step/limit. No greeting/emoji/invented savings or fit; never describe multiple products from one merchant as merchant-diverse. Do not duplicate every card field. `quality`, timing, exclusions, ranking, fallback are backend diagnostics logged by MCP; never print them.
