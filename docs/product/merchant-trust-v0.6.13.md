# Merchant trust v0.6.13

Shopify Global Catalog supplies seller identity and URLs but does not supply a merchant trust or official-seller flag. FindCheap therefore uses a separate checked-in exact-domain evidence registry.

## Policy

- `OFFICIAL`: independently reviewed brand-owned domain.
- `AUTHORIZED_RETAILER`: independently reviewed authorization evidence.
- `ESTABLISHED_RETAILER`: independently reviewed retailer identity evidence.
- `UNKNOWN`: no independent evidence. Merchant names containing “official” do not qualify.
- `RISKY`: IP literal, localhost, or punycode host; excluded before ranking.

Trust records affect ranking only; they never restrict Shopify Global Catalog search coverage. Product identity remains a separate gate. Affiliate status and commission never affect ranking.

If at least one trusted candidate exists, unverified candidates are excluded rather than used to fill three cards. If no trusted candidate exists, a bounded set of `UNKNOWN` candidates may be shown in a separate unverified section.

## Initial official-domain evidence

- https://electronics.sony.com/
- https://www.shopdoen.com/
- https://www.deathwishcoffee.com/
- https://blkandbold.com/
- https://www.vervecoffee.com/
- https://www.fashionnova.com/
- https://www.stevemadden.com/

Registry version: `merchant-trust-2026-08-20`.
