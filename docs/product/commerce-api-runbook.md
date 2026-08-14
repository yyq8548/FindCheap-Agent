# Commerce API runbook

The Commerce API is a read-only boundary over audited, promoted Commerce data. The repository
currently has **0 enabled merchants**. Do not turn a merchant on until its separate business,
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

## Commerce API

Build with `pnpm build:commerce` and run `node apps/commerce-api/dist/main.js`, or build the
deployable image with:

```sh
docker build -f infra/docker/commerce-api.Dockerfile -t shopping-commerce-api .
```

The image is digest-pinned to Node.js 22, runs as the non-root `node` user, includes a health
check, and supports a read-only root filesystem. Mount the approved `config/merchants` and
`docs/product/merchant-decisions` directories read-only at their matching `/app` paths. The
`commerce` Compose profile is a development convenience, not a production deployment template.

Production requires:

- `NODE_ENV=production`
- `DATABASE_URL` with a password and `sslmode=verify-full`
- `COMMERCE_API_TOKEN` containing 32 through 512 characters

The bearer token is required whenever the API starts, including development/test and loopback
binds. The server binds to `127.0.0.1:3000` by default. `COMMERCE_API_HOST` accepts only explicit IP
bind targets (`127.0.0.1`, `::1`, `0.0.0.0`, or `::`); put TLS and network policy at the service
edge when using a non-loopback bind. Every `/v1` request requires the bearer token. `GET /health`
is the only unauthenticated endpoint and returns only `{ "status": "ok" }`; it is a process
liveness check, not a database-readiness guarantee.

With zero gate-approved merchants, the executable exits without listening and prints a
deterministic disabled event without opening PostgreSQL. Gate validation errors fail startup.
Production also fails startup without the database URL and token.

## Codex MCP connection

Set both variables in the MCP process environment:

- `SHOPPING_COMMERCE_API_URL`: an HTTPS origin only, or numeric loopback HTTP for local use
- `SHOPPING_COMMERCE_API_TOKEN`: the matching bearer token

The MCP client always calls the fixed `/v1/comparisons` path, rejects redirects, bounds time and
response size, validates the response schema, and strips internal product, offer, merchant,
quote, evidence, and membership IDs from its public tool output. Missing, partial, invalid, or
unavailable configuration produces `DATA_SOURCE_UNAVAILABLE` with no fabricated offers.
