# Shopify tax estimate v0.6.7

With a supplied US ZIP, FindCheap Agent creates a short-lived anonymous Shopify Cart for each returned variant. Product cards separate:

- item subtotal
- selected shipping, including `免费配送 $0.00`
- tax
- estimated total

Tax evidence order:

1. Use Shopify Storefront `CartCost.totalTaxAmount` when it is explicitly returned. Preserve `totalTaxAmountEstimated` so an estimated Shopify amount is not labeled verified.
2. When Shopify returns no tax amount, infer the state from the ZIP and estimate tax on the item subtotal using Tax Foundation's January 1, 2026 combined state and population-weighted average local rate.
3. Unsupported, military, territorial, or malformed ZIPs fail closed instead of receiving a fabricated tax.

The ZIP fallback is not an exact jurisdiction calculation. Product exemptions, merchant nexus, shipping taxability, and local rates can differ. Some merchants require a full address or checkout before calculating final tax. Cart totals remain estimates and no checkout, reservation, purchase, or payment occurs.
