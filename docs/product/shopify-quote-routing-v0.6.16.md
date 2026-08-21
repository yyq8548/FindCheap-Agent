# Shopify quote routing v0.6.16

Delivery classification uses two stages without changing the selected product:

- ZIP-only request with an empty delivery group or option returns `FULL_ADDRESS_REQUIRED`.
- Retry with street, city, state, and the same ZIP; an empty result then returns `NO_DELIVERY_OPTIONS`.
- API rejection, invalid response, or incompatible Cart behavior returns `MERCHANT_CART_UNAVAILABLE`.

Retries preserve the original `renderId` and Shopify Variant ID. The plugin never searches a replacement by title.

Successful quote cards render a top summary before product images, then repeat item price, shipping, tax, and estimated total in the card breakdown. Tax remains Shopify-reported or explicitly labeled as a ZIP state-average estimate.
