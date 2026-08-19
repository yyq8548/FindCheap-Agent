# FindCheap-Agent

Product form: **Codex Plugin Agent**.

The shipped Codex plugin lives at `plugins/shopping-agent/`. Codex orchestrates two bounded paths:

- an authorized Chrome skill for a read-only, web-wide fallback search;
- a local stdio MCP server for audited Commerce data, the credential-gated Best Buy pilot, and
  Shopify Global Catalog search across eligible merchants,
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
user-authorized Chrome fallback path remains available.

See `docs/product/commerce-api-runbook.md` for deployment configuration.

Best Buy official Products API pilot setup lives in
`docs/product/best-buy-products-api-runbook.md`. It remains disabled until real audit approval.

The legacy Shopify Storefront PoC lives in `docs/product/shopify-storefront-poc.md`. v0.4.1 uses
Shopify Global Catalog as the plugin's production discovery path. It does not claim whole-web,
shipping, tax, Coupon, membership, delivered-price, legal, or affiliate approval coverage.
Deployment and validation rules live in `docs/product/shopify-global-catalog-runbook.md`.

v0.3.0 classifies Shopify candidates as `EXACT`, `SIMILAR`, or internal `IRRELEVANT`. It groups
offers across merchants only when exact GTIN and variant or exact brand, MPN/SKU, and variant
evidence agrees. Otherwise results remain explicitly `DISCOVERY_ONLY`. Irrelevant
products never enter Top 3. Exact matches rank before cheaper similar products. When only similar
products remain, the tool requests an exact model, SKU, GTIN, color, size, or capacity.
Shopify results also expose `NEW`, `USED`, `REFURBISHED`, `OPEN_BOX`, or `UNKNOWN` condition.
Default and explicit-new searches retain `NEW` and clearly labeled `UNKNOWN`; explicit used,
refurbished/renewed, and open-box inventory is returned only when requested.
Explicit cheapest requests use literal price order and may include several products from one merchant;
recommendation requests prefer merchant diversity. Codex must preserve the tool's returned order.
The legacy v3 registry contains forty-five technically verified pilots and accepts at most fifty checked-in
entries. Its release audit requires 45/45 non-empty schema-valid probes, at most two attempts per
store, a three-second attempt budget, and p95 latency at or below 2.5 seconds. Per-store failures and timeouts are isolated and
reported through coverage diagnostics. Technical verification is not merchant, legal, or affiliate approval.

v0.3.1 accepts an optional US ZIP and membership identifiers. It exposes a structured pricing and
freshness contract: the public regular item price is verified at query time; ZIP shipping, tax,
mandatory fees, member price, and delivered price are explicitly unavailable unless independently
verified. Missing charges are never estimated or replaced with zero.

v0.3.2 adds dynamic product-card data, explicit verified-or-unavailable Coupon status, safe purchase
links, and a compact quality summary. The public Shopify registry currently has no audited Coupon
or affiliate relationship, so it returns no codes and preserves each canonical merchant URL. Tagged
affiliate links are emitted only by an independently approved source.

v0.3.3 makes the plugin MCP server explicitly auto-start with inherited `PATH`, removing cache and
bundle-location work from normal searches. Shopify results now attach a versioned MCP Apps UI
resource that renders up to three verified product cards while preserving the complete text and
structured result for clients without UI support.

v0.3.4 removes pre-search narration and separates retrieval from presentation: one Shopify search
returns a short-lived `renderId`, then `render_product_cards` renders the immutable result through the
MCP Apps UI resource. Search remains independently usable by clients without UI support.

v0.3.5 rotates the MCP Apps UI resource URI to invalidate stale host caches, reads both standard tool
result notifications and ChatGPT compatibility metadata, and replaces silent blank cards with a
visible fallback while preserving the complete text response.

v0.3.6 follows the Codex sandbox's real late-data lifecycle: product cards render from the standard
MCP tool-result notification or the `openai:set_globals` compatibility event. The resource URI is
rotated again, and CSP image access is reduced to Shopify's CDN only.

v0.3.7 also handles Codex code-mode calls that preserve the UI resource and tool input but consume
the nested tool's structured result. The card uses `toolInput.renderId` to load its immutable
snapshot through the standard MCP Apps `tools/call` bridge, while retaining direct-result rendering.

v0.4.0 adds an Affiliate-ready Shopify purchase-link boundary without enabling any relationship by
default. A checked-in `APPROVED` relationship, exact affiliate origin and template, and a non-empty
runtime campaign credential are all required before an `APPROVED_AFFILIATE` link can be emitted.
Otherwise each CTA remains the canonical merchant URL. Affiliate disclosures render beside the CTA,
no commission amount is inferred, and affiliate state is applied only after product selection so it
cannot affect ranking.

v0.4.1 replaces the plugin's fixed 45-store runtime enumeration with Shopify Global Catalog MCP.
One live `search_catalog` request searches eligible Shopify merchants and returns current product,
variant, seller, item-price, availability, image, and canonical-link data. Results are not reused
across searches and images are not downloaded. The old audited Storefront registry remains available only as an explicit compatibility and
diagnostic mode. Authorized Chrome remains the bounded fallback after a successful zero-result
Global Catalog response.

