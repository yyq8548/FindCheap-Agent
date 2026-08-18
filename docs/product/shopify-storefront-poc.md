# Shopify Storefront API PoC

## Outcome and assumptions

- Outcome: add a reusable tokenless Shopify Storefront reader and expose one fixed, read-only five-store MCP Beta search.
- Risk tier: `R0`; inputs and outputs are public product data.
- Assumption: Shopify continues to permit tokenless access to published products for this storefront.
- Out of scope: account data, checkout, cart, shipping, tax, coupons, membership pricing, persistence, and automatic merchant approval.

## Architecture and selected patterns

- Use deterministic API tool calls, typed parsing, host allowlists, and failure isolation; no model planning or multi-agent workflow is needed.
- The reusable reader calls `https://<audited-host>/api/2026-07/graphql.json` with a fixed GraphQL document and encoded variables.
- The Codex MCP tool is fixed to Death Wish Coffee, Kith, Allbirds, Brooklinen, and Fashion Nova. It cannot accept an arbitrary host or URL.
- The formal ingestion path accepts the same `shopify-storefront` provider only after the existing catalog, legal, decision-record, and enablement gates pass.

## Data, tools, permissions, and human controls

- Allowed API host: `deathwishcoffee.com`.
- Allowed product host: `www.deathwishcoffee.com`.
- Returned fields: handle, title, selected variant title, vendor, SKU, numeric barcode when valid, image, public USD item price, public availability, canonical product URL, and observation time.
- The connection uses the existing DNS/IP validation, pinned TLS transport, redirect validation, response-size cap, and request timeout.
- No token, API key, cookie, browser account, or customer identity is used or stored.

## Failure and recovery design

- Reject arbitrary hosts, unsafe handles and search queries, non-USD prices, malformed GraphQL responses, GraphQL errors, external product URLs, non-JSON responses, redirects outside the allowlist, timeouts, and oversized responses.
- Return `DATA_SOURCE_UNAVAILABLE` through MCP instead of inventing products.
- Rollback: remove the MCP environment entry or revert the connector commit. Commerce and ingestion remain unaffected because no real merchant is enabled.

## Evaluation and release gates

- Deterministic tests cover search, handle lookup, mapping, invalid inputs, external URL rejection, unavailable configuration, MCP schema validation, and the merchant approval gate.
- A live probe must return public product records with source URL and timestamp without credentials.
- Hard invariants: zero arbitrary host access, zero secrets, zero purchase action, zero delivered-price claim, and zero automatic merchant enablement.

## Rollout, observability, and rollback

- Status: `LIMITED GO` for one-user local MCP Beta only.
- The current main comparison path still has zero enabled merchants and does not consume this PoC.
- Record only sanitized products, source URL, observation time, success/failure, and latency. Do not log raw evidence in the user-facing tool result.
- Disable immediately if the endpoint requires authentication, returns unstable schemas, changes terms, or repeatedly fails.

## Implementation milestones

1. Tokenless reader and CLI probe.
2. Fixed-host MCP Beta tool.
3. At least 100 manually reviewed product/variant identity samples and legal review.
4. Only after approval: add an enabled merchant configuration and connect it to audited comparison ingestion.

## Acceptance criteria and open decisions

- `pnpm merchants:shopify-probe -- --query "Valhalla Java" --limit 3` returns live products.
- Codex discovers `search_shopify_products`, calls it once per lookup, rejects unrelated results, and returns relevance-first merchant-diverse public item prices from the fixed five-store registry.
- The tool never accepts a caller-provided host.
- Open decision: whether each pilot's terms and data quality support production use. Owner approval is still required for every store.

## Live evidence

- On 2026-08-17 ET, the tokenless Storefront API returned three live results for `Valhalla Java`.
- The selected `Valhalla Java Single-Serve Pods — 10 count` variant returned SKU `5094SSC`, barcode `851552005094`, public item price `$14.99 USD`, and `availableForSale: true`.
- This verifies technical access only; it is not merchant or legal approval.
