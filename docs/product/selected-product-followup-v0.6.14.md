# Selected-product follow-up v0.6.14

## Goal

Keep every follow-up bound to one product already returned by Shopify Global Catalog.

## Behavior

- Search returns an immutable `quoteReference` containing `renderId` and Shopify `variantId`.
- Size, color, option, and stock checks call `inspect_selected_shopify_product`.
- The inspector opens only the exact prior merchant product JSON path, confirms the original Variant ID belongs to that product, and returns at most three exact matching variants.
- A returned sibling variant receives a new stable `quoteReference`; later ZIP quotes must use it.
- Shipping, tax, and estimated-total checks call `quote_selected_shopify_product`.
- Follow-ups never reconstruct a Catalog query from product title, never substitute another product, and fail closed when the reference expires or identity changes.

## Non-goals

- No checkout, reservation, purchase, or payment.
- No inventory guarantee beyond observation time.
- No cross-domain redirect or replacement search.
