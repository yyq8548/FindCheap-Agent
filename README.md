# FindCheap-Agent

Product form: **Codex Plugin Agent**.

The shipped Codex plugin lives at `plugins/shopping-agent/`. Codex orchestrates two bounded paths:

- an authorized Chrome skill for a read-only, web-wide v0.2.3 fallback search;
- a local stdio MCP server for audited Commerce data, the credential-gated Best Buy pilot, and a
  bounded configuration-driven Shopify Storefront Beta registry with one-call deduplication,
  exact-first intent-aware Top 3 selection (literal lowest price or merchant-diverse recommendations), labeled similar alternatives, variant evidence,
  clarification questions, and API diagnostics.

The Chrome path discovers up to eight merchant product pages, verifies five first, inspects up to
three reserves only when needed, and returns no more than three exact, source-linked offers. It
does not order, check out, or submit payment.

The approved product specification and implementation plans live under `docs/superpowers/`.

Current merchant status: **0 merchants are enabled**. Commerce API and Codex MCP results are
served only from fresh, exact, audit-promoted Commerce records. Staging records, similar-item
matches, expired prices, and quotes for another ZIP or membership context are never presented as
exact comparisons. With no approved merchant configuration, MCP data access fails closed while the
user-authorized Chrome v0.2.3 fallback path remains available.

See `docs/product/commerce-api-runbook.md` for deployment configuration.

Best Buy official Products API pilot setup lives in
`docs/product/best-buy-products-api-runbook.md`. It remains disabled until real audit approval.

The Shopify Storefront PoC lives in `docs/product/shopify-storefront-poc.md`. Its audited registry
tool is a one-user, read-only technical pilot; it does not enable the merchant in Commerce or claim
shipping, tax, Coupon, membership, or delivered-price coverage.

v0.2.3 classifies Shopify candidates as `EXACT`, `SIMILAR`, or internal `IRRELEVANT`. Irrelevant
products never enter Top 3. Exact matches rank before cheaper similar products. When only similar
products remain, the tool requests an exact model, SKU, GTIN, color, size, or capacity.
Shopify results also expose `NEW`, `USED`, `REFURBISHED`, `OPEN_BOX`, or `UNKNOWN` condition.
Default and explicit-new searches retain `NEW` and clearly labeled `UNKNOWN`; explicit used,
refurbished/renewed, and open-box inventory is returned only when requested.
Explicit cheapest requests use literal price order and may include several products from one merchant;
recommendation requests prefer merchant diversity. Codex must preserve the tool's returned order.
The v2 registry contains twenty technically verified pilots and accepts at most fifty checked-in
entries. Its release audit requires 20/20 non-empty schema-valid probes, a three-second per-store
budget, and p95 latency at or below 2.5 seconds. Per-store failures and timeouts are isolated and
reported through coverage diagnostics. Technical verification is not merchant, legal, or affiliate approval.

