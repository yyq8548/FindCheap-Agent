# FindCheap Agent v0.5.0 — Coupon + Watch

Watch scheduling lifecycle is superseded by [v0.6.0 Watch End to End](watch-end-to-end-v0.6.0.md). v0.5.0 rules without a stored Automation ID are treated as legacy records.

## Delivered

- `find_coupons`: current verified Coupon, Promo Code, brand promotion, membership offer, Cashback, and offline barcode evidence.
- `create_watch`, `check_watch`, `list_watches`, `pause_watch`, `delete_watch`.
- Conditions: item price below a USD-cent threshold, verified discount/Cashback percentage, verified Coupon availability, in-stock, and restocked transition.
- Persistent local watch state with duplicate-rule suppression and one notification per false-to-true transition.
- Codex Automation handoff through the `automationPrompt` returned by `create_watch`.

## Data routing

- Price and inventory: Shopify Global Catalog.
- Coupon, promotion, membership, Cashback, and barcode: an approved Deals API configured through `FINDCHEAP_DEALS_API_URL` and `FINDCHEAP_DEALS_API_TOKEN`.
- Without the Deals API, Coupon-related calls return `DATA_SOURCE_UNAVAILABLE`; this is different from a verified zero-result response.
- Authorized Chrome may support a one-time public Coupon lookup, but automated Watch checks never use interactive Chrome.

The Deals API is a strict HTTPS `POST` endpoint. It receives merchant, optional product query, explicit memberships, and channel. Responses must contain `VERIFIED` evidence with HTTPS source URLs, checked time, validity window, eligibility, and typed benefit fields. Requests time out after five seconds and responses are streamed with a 512 KiB limit.

## Watch lifecycle

1. `create_watch` validates and persists the rule.
2. Codex creates a recurring Automation using the returned interval and prompt.
3. The Automation calls `check_watch` once per run.
4. Only `TRIGGERED` produces a user alert. Persistent satisfaction is deduplicated.
5. Pause or delete both the local watch and its corresponding Automation.

Watch state defaults to `~/.findcheap-agent/watches-v1`. Override with `FINDCHEAP_STATE_DIR`.

## Explicit limits

- No guessed Coupon, stacking rule, membership eligibility, Cashback, commission, shipping, tax, or delivered price.
- No login, cart mutation, checkout, reservation, purchase, or payment.
- Airline, hotel, ticket, appointment, and automatic-buy monitors remain unavailable until dedicated authorized sources and transaction controls exist.
- The local JSON store assumes one active MCP server process. Production multi-instance deployment should replace it with a transactional shared store.
