# Shopify Cart quote v0.6.6

FindCheap Agent keeps Shopify Global Catalog as the discovery source. When the user supplies a US
ZIP, the plugin can enrich each returned exact variant through that merchant's tokenless Shopify
Storefront Cart API.

## Behavior

1. Search Shopify Global Catalog once and select at most three products.
2. Use the exact Shopify variant ID and the merchant host returned by the catalog.
3. Create a short-lived anonymous Cart containing one unit and a one-time US ZIP.
4. Select the cheapest delivery option offered by each delivery group.
5. Return the verified item subtotal, estimated shipping, and Shopify estimated total.
6. Keep the original item-price result when any merchant quote fails.

`SHOPIFY_CART_ESTIMATE` means Shopify returned a current estimate. `MIXED` means only some returned
merchants supplied one. `ITEM_PRICE_ONLY` means none did or no ZIP was supplied.

For an explicit cheapest request, delivered-price ranking is used only when every selected merchant
successfully returns a Cart estimate. Partial quote coverage never silently changes the original
ranking.

## Safety and privacy boundaries

- fixed HTTPS port 443 and `/api/2026-07/graphql.json` path
- exact catalog merchant host and exact numeric variant ID
- all DNS answers validated; private, local, metadata, reserved, or mixed public/private sets fail
  closed
- DNS-pinned TLS request with the original hostname used for SNI and certificate verification
- 2.5 second default request deadline, 32 KiB request cap, and 512 KiB streamed response cap
- ZIP is used only as a one-time delivery preference; no name, email, street address, account, or
  payment data is sent
- no checkout, purchase, reservation, payment, affiliate claim, or commission claim

Shopify may include tax or mandatory fees in its estimated total without returning a separate
breakdown. FindCheap Agent never invents those components and labels the result as an estimate.

## Runtime configuration

The distributable plugin enables this bounded path with:

```text
SHOPIFY_CART_QUOTE_MODE=tokenless
SHOPIFY_CART_QUOTE_TIMEOUT_MS=2500
```

Removing or changing `SHOPIFY_CART_QUOTE_MODE` disables Cart quotes and preserves item-price-only
discovery.
