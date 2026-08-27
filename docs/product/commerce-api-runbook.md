# Commerce API runbook

The Commerce API is the authenticated boundary for audited Commerce reads and the append-only
price-observation ledger. The repository currently has **0 enabled comparison merchants**. Do not turn a merchant on until its separate business,
legal, affiliate, robots/terms, data-quality, and operations audit is approved.

## Data boundary

- Only current `EXACT_PROMOTED` offer revisions and their `QUOTE_PROMOTED` quotes are eligible.
- Prices come from the immutable validated quote snapshot in the promotion ledger, not mutable
  operational quote rows; pre-snapshot decisions fail closed.
- Only strong identity queries resolve: canonical product ID, a valid whole-input GTIN, complete
  normalized brand plus MPN, or the exact normalized title plus all variant values. Weak title,
  brand, or MPN substrings ask for clarification.
- The runtime loads the same all-or-nothing audited merchant gate as ingestion. Search and quote
  reads are restricted to that immutable startup allowlist; zero enabled merchants serve no data.
- ZIP and normalized membership context must match the stored quote exactly.
- Offers and quotes must both be fresh at the single request clock time.
- Similar, ambiguous, pending, staging, expired, or old-revision records are excluded.
- Affiliate URLs do not participate in product matching, pricing, or ranking.
- No endpoint orders, starts checkout, or submits payment.
- `/v1/price-observations` accepts only a recent, stable merchant/product identity and verified
  current item-price or Shopify cart-estimate observation. ZIP and memberships are stored only as
  an irreversible context hash. `/v1/price-history` returns at most one observation per UTC day
  for that exact identity, basis, and context.

## Commerce API

Build with `pnpm build:commerce` and run `node apps/commerce-api/dist/main.js`, or build the
deployable image with:

```sh
docker build -f infra/docker/commerce-api.Dockerfile -t shopping-commerce-api .
```

The image is digest-pinned to Node.js 24, runs as the non-root `node` user, includes a health
check, and supports a read-only root filesystem. Mount the approved `config/merchants` and
`docs/product/merchant-decisions` directories read-only at their matching `/app` paths. The
`commerce` Compose profile is a development convenience, not a production deployment template.

Production requires:

- `NODE_ENV=production`
- `DATABASE_URL` with a password and `sslmode=verify-full`. Railway private DNS may instead use
  `sslmode=require&uselibpqcompat=true`; this exception is accepted only for a
  `*.railway.internal` hostname.
- `COMMERCE_API_TOKEN` containing 32 through 512 characters

The bearer token is required whenever the API starts, including development/test and loopback
binds. The server binds to `127.0.0.1:3000` by default. `COMMERCE_API_HOST` accepts only explicit IP
bind targets (`127.0.0.1`, `::1`, `0.0.0.0`, or `::`); put TLS and network policy at the service
edge when using a non-loopback bind. Every `/v1` request requires the bearer token. `GET /health`
is the only unauthenticated endpoint and returns only `{ "status": "ok" }`; it is a process
liveness check, not a database-readiness guarantee.

With zero gate-approved merchants and no database, the executable exits without listening. With
the database and token configured, it starts in price-history-only mode while comparison reads
remain empty. Gate validation errors fail startup. Production also fails startup without the
database URL and token.

## Codex MCP connection

Set both variables in the MCP process environment:

- `SHOPPING_COMMERCE_API_URL`: an HTTPS origin only, or numeric loopback HTTP for local use
- `SHOPPING_COMMERCE_API_TOKEN`: the matching bearer token

Deal Concierge price history uses a separate fixed route and the same protected service:

- `FINDCHEAP_PRICE_HISTORY_URL`: `https://<commerce-host>/v1/price-history`
- `FINDCHEAP_PRICE_HISTORY_TOKEN`: the matching bearer token

The MCP records the verified current observation before reading prior evidence. A new installation
therefore begins with insufficient evidence and safely returns `WATCH / LOW`; historical-low and
sale-cadence claims become available only after the stated multi-day sample thresholds are met.

The MCP client always calls the fixed `/v1/comparisons` path, rejects redirects, bounds time and
response size, validates the response schema, and strips internal product, offer, merchant,
quote, evidence, and membership IDs from its public tool output. Missing, partial, invalid, or
unavailable configuration produces `DATA_SOURCE_UNAVAILABLE` with no fabricated offers.
