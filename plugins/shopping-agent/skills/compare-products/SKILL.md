---
name: compare-products
description: Search Best Buy official product data and compare exact products across approved US merchants. Use for shopping, product search, SKU lookup, comparison, price, delivered-price, coupon, regular-price, or member-price requests.
---

# Compare products

1. Identify the exact item. Ask for model, variant, size, color, capacity, SKU, UPC, or product URL when the request is ambiguous. Do not treat similar products as exact matches.
2. When the user requests delivered price, collect a US ZIP code before comparing. Ask about membership only when it affects a requested member price.
3. For a Best Buy product search or SKU lookup, call `search_bestbuy_products` first. Treat its price as `ITEM_PRICE_ONLY`: it excludes shipping, tax, coupons, and member pricing. Never relabel it as delivered price. If the tool is unavailable, explain that `BEST_BUY_API_KEY` must be configured; do not ask the user to paste the key into chat.
4. For an exact delivered-price comparison, call `compare_products`. Do not invent merchants, prices, coupons, stock, taxes, delivery, or eligibility. If no approved comparison data is available, say: "Live comparison is unavailable because no approved shopping data source is connected."
5. If member pricing or a current product-page detail is missing, offer to verify it through an available user-authorized Chrome or Browser tool. Use the user's existing authenticated session only after permission. Never extract, display, store, or request account credentials. Label browser-observed member prices with the observation time and conditions; do not merge them into an API item price.
6. For live comparison results, show each exact match with merchant, regular price, eligible member price (separate from regular price), shipping, tax, delivered price, coupon terms, and source evidence when available. State the evidence time or freshness only when the source provides it.
7. Put similar or alternative items in a separately labeled section. Exclude them from the exact-product ranking.
8. Clearly disclose any affiliate link before presenting it. Never auto-order, start checkout, submit payment, or imply a purchase was made.
