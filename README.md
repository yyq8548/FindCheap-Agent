# FindCheap-Agent

Product form: **Codex Plugin Agent**.

The shipped Codex plugin lives at `plugins/shopping-agent/`. Codex orchestrates two bounded paths:

- an authorized Chrome skill for a read-only, web-wide v0.1 product search;
- a local stdio MCP server for audited Commerce data, the credential-gated Best Buy pilot, and a
  fixed five-store tokenless Shopify Storefront Beta registry.

The Chrome path discovers up to eight merchant product pages, verifies five first, inspects up to
three reserves only when needed, and returns no more than three exact, source-linked offers. It
does not order, check out, or submit payment.

The approved product specification and implementation plans live under `docs/superpowers/`.

Current merchant status: **0 merchants are enabled**. Commerce API and Codex MCP results are
served only from fresh, exact, audit-promoted Commerce records. Staging records, similar-item
matches, expired prices, and quotes for another ZIP or membership context are never presented as
exact comparisons. With no approved merchant configuration, MCP data access fails closed while the
user-authorized Chrome v0.1 path remains available.

See `docs/product/commerce-api-runbook.md` for deployment configuration.

Best Buy official Products API pilot setup lives in
`docs/product/best-buy-products-api-runbook.md`. It remains disabled until real audit approval.

The Shopify Storefront PoC lives in `docs/product/shopify-storefront-poc.md`. Its fixed five-store
tool is a one-user, read-only technical pilot; it does not enable the merchant in Commerce or claim
shipping, tax, Coupon, membership, or delivered-price coverage.

