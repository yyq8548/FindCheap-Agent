# Shopify Global Catalog runbook

FindCheap Agent v0.4.1 uses Shopify Global Catalog MCP as its default Shopify discovery source.
It searches merchants eligible for Shopify catalog inclusion; it does not represent whole-web,
legal, Coupon, or affiliate approval coverage.

## Runtime configuration

The installed plugin sets:

```text
SHOPIFY_CATALOG_MODE=global
SHOPIFY_AGENT_PROFILE_URL=https://cdn.jsdelivr.net/gh/yyq8548/FindCheap-Agent@24267014f0433adefb89181e4123d7b785e30285/plugins/findcheap-agent/ucp-agent-profile.json
SHOPIFY_GLOBAL_CATALOG_TIMEOUT_MS=10000
```

The endpoint is fixed in code to `https://catalog.shopify.com/api/ucp/mcp`. It cannot be replaced
through environment variables. The checked-in Agent Profile advertises only catalog search/lookup
and Shopify Global Catalog capabilities; it does not advertise cart, checkout, payment, or orders.

## Data rules

- Send one live `search_catalog` request per user lookup.
- Filter for US shipping and currently available variants.
- Do not reuse catalog results for another search or download images. The in-memory `renderId`
  snapshot exists only to deliver the current result to MCP Apps UI.
- Accept only USD minor-unit prices and exact HTTPS seller/product host binding.
- Render images only from `cdn.shopify.com`.
- Treat inferred condition as unverified unless product or variant text explicitly identifies it.
- Reject defective, damaged, or parts-only inventory from normal results.
- Use a Shopify Universal Product ID only when it groups offers from at least two distinct merchants.
- Keep shipping, tax, fees, Coupon, membership, and delivered price unavailable without separate evidence.
- Apply affiliate rewriting only after selection; without an approved relationship, preserve the canonical merchant URL.

## Validation

Run with Node 22:

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build:mcp
pnpm test:mcp-stdio
```

For a manual live smoke, override `SHOPIFY_AGENT_PROFILE_URL` with Shopify's documented profile
fixture before the repository profile is published. After merge, verify the checked-in profile URL
returns HTTP 200 before installing the release plugin.
