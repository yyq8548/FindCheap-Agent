# Shopify quote failures v0.6.15

`quote_shopify_selected_product` returns one stable, safe failure code when a merchant cannot quote the selected Shopify variant:

- `FULL_ADDRESS_REQUIRED`: ask for street, city, and two-letter state, then retry the same `renderId` and `variantId`. The address is sent only for this quote and is not saved in FindCheap state.
- `NO_DELIVERY_OPTIONS`: the merchant returned no delivery method for the selected variant and destination. Shipping, tax, and total remain unavailable.
- `MERCHANT_CART_UNAVAILABLE`: the merchant cart service is unavailable or incompatible. This is not proof that the item is out of stock or invalid.
- `VARIANT_REJECTED`: the merchant rejected the exact variant. It may be unavailable, sold out, or no longer purchasable.
- `QUOTE_TIMEOUT`: the merchant did not respond before the quote deadline.

The tool never changes products, searches by title, invents quote components, or exposes raw merchant errors. A retry always keeps the original stable product handle and variant ID.
