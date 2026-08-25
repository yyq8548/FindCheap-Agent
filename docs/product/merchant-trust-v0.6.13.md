# Merchant trust v0.6.13

Shopify Global Catalog supplies seller identity and URLs but does not supply a merchant trust or official-seller flag. FindCheap therefore uses a separate checked-in exact-domain evidence registry.

## Policy

- `OFFICIAL`: independently reviewed brand-owned domain.
- `AUTHORIZED_RETAILER`: independently reviewed authorization evidence.
- `ESTABLISHED_RETAILER`: independently reviewed retailer identity evidence.
- `UNKNOWN`: no independent evidence. Merchant names containing “official” do not qualify.
- `RISKY`: IP literal, localhost, or punycode host; excluded before ranking.

Product identity, required features, condition, availability, and price remain hard gates. Affiliate commission never changes eligibility or relevance.

Eligible customer-facing results are ordered in three merchant tiers:

1. Reviewed `OFFICIAL`, `AUTHORIZED_RETAILER`, and `ESTABLISHED_RETAILER` merchants, together with approved Affiliate Program merchants.
2. `UNKNOWN` Shopify merchants whose product rating is strictly above `3.8` with at least `2` reviews. Product rating is not merchant verification.
3. Other relevant `UNKNOWN` Shopify merchants with a prominent limited-trust warning.

`RISKY` candidates remain excluded. Within each tier, match evidence, requested features, rating, availability, and price determine order.

## Reviewed merchant-domain evidence

Registry contains 46 exact domains across official brand stores, authorized Apple retailers, electronics, general retail, home, apparel, beauty, pets, outdoor, office, and books. Open marketplace domains remain excluded until individual seller identity can be verified.

Registry version: `merchant-trust-2026-08-24`.
