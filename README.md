# FindCheap-Agent

Product form: **Codex Plugin Agent**.

The shipped Codex plugin lives at `plugins/shopping-agent/`. Codex orchestrates two bounded paths:

- an authorized Chrome skill for a read-only, web-wide v0.2.1 fallback search;
- a local stdio MCP server for audited Commerce data, the credential-gated Best Buy pilot, and a
  fixed ten-store tokenless Shopify Storefront Beta registry with one-call deduplication,
  exact-first merchant-diverse Top 3 selection, labeled similar alternatives, variant evidence,
  clarification questions, and API diagnostics.

The Chrome path discovers up to eight merchant product pages, verifies five first, inspects up to
three reserves only when needed, and returns no more than three exact, source-linked offers. It
does not order, check out, or submit payment.

The approved product specification and implementation plans live under `docs/superpowers/`.

Current merchant status: **0 merchants are enabled**. Commerce API and Codex MCP results are
served only from fresh, exact, audit-promoted Commerce records. Staging records, similar-item
matches, expired prices, and quotes for another ZIP or membership context are never presented as
exact comparisons. With no approved merchant configuration, MCP data access fails closed while the
user-authorized Chrome v0.2.1 fallback path remains available.

See `docs/product/commerce-api-runbook.md` for deployment configuration.

Best Buy official Products API pilot setup lives in
`docs/product/best-buy-products-api-runbook.md`. It remains disabled until real audit approval.

The Shopify Storefront PoC lives in `docs/product/shopify-storefront-poc.md`. Its fixed ten-store
tool is a one-user, read-only technical pilot; it does not enable the merchant in Commerce or claim
shipping, tax, Coupon, membership, or delivered-price coverage.

v0.2.1 classifies Shopify candidates as `EXACT`, `SIMILAR`, or internal `IRRELEVANT`. Irrelevant
products never enter Top 3. Exact matches rank before cheaper similar products. When only similar
products remain, the tool requests an exact model, SKU, GTIN, color, size, or capacity.

