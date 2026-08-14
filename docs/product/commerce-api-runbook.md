# Commerce API runbook

The Commerce API is a read-only boundary over audited, promoted Commerce data. The repository
currently has **0 enabled merchants**. Do not turn a merchant on until its separate business,
legal, affiliate, robots/terms, data-quality, and operations audit is approved.

## Data boundary

- Only current `EXACT_PROMOTED` offer revisions and their `QUOTE_PROMOTED` quotes are eligible.
- Prices come from the immutable validated quote snapshot in the promotion ledger, not mutable
  operational quote rows; pre-snapshot decisions fail closed.
- Product queries that resolve to zero or multiple canonical products ask for clarification.
- ZIP and normalized membership context must match the stored quote exactly.
- Offers and quotes must both be fresh at the single request clock time.
- Similar, ambiguous, pending, staging, expired, or old-revision records are excluded.
- Affiliate URLs do not participate in product matching, pricing, or ranking.
- No endpoint orders, starts checkout, or submits payment.

## Commerce API

Build with `pnpm build:commerce` and run `node apps/commerce-api/dist/main.js`.

Production requires:

- `NODE_ENV=production`
- `DATABASE_URL` with a password and `sslmode=verify-full`
- `COMMERCE_API_TOKEN` containing 32 through 512 characters

The server binds to `127.0.0.1:3000` by default. `COMMERCE_API_HOST` accepts only explicit IP
bind targets (`127.0.0.1`, `::1`, `0.0.0.0`, or `::`); put TLS and network policy at the service
edge when using a non-loopback bind. `POST /v1/comparisons` requires the bearer token. `GET
/health` returns only `{ "status": "ok" }`.

With no `DATABASE_URL` in development, the executable exits without listening and prints a
deterministic disabled event. Production fails startup instead.

## Codex MCP connection

Set both variables in the MCP process environment:

- `SHOPPING_COMMERCE_API_URL`: an HTTPS origin only, or numeric loopback HTTP for local use
- `SHOPPING_COMMERCE_API_TOKEN`: the matching bearer token

The MCP client always calls the fixed `/v1/comparisons` path, rejects redirects, bounds time and
response size, validates the response schema, and strips internal product, offer, merchant,
quote, evidence, and membership IDs from its public tool output. Missing, partial, invalid, or
unavailable configuration produces `DATA_SOURCE_UNAVAILABLE` with no fabricated offers.
