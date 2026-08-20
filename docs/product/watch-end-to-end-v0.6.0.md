# FindCheap Agent v0.6.0: Watch End to End

## Goal

A Watch is active only when one persistent Watch rule is bound to one native Codex Automation. Rule creation alone is not monitoring.

## Lifecycle

1. `create_watch` validates product identity, condition, threshold, variants, merchant context, interval, and expiration. Generation or named-style rules without model/GTIN require a merchant.
2. New valid rules return `READY_TO_SCHEDULE`, an exact `automationPrompt`, and `intervalMinutes`.
3. Codex creates one recurring heartbeat Automation with those values.
4. `bind_watch_automation` durably records the returned Automation ID. Only `ACTIVE` confirms monitoring.
5. Each Automation run calls `check_watch` exactly once. Only a false-to-true transition returns `TRIGGERED`; persistent satisfaction returns `NOT_TRIGGERED`. Triggered output carries the observed value, merchant or source link, and `checkedAt` evidence for the notification.
6. Pause, resume, and delete update the Automation first, then call the matching Watch tool with the same Automation ID.

If Automation creation succeeds but binding fails, Codex deletes the new Automation. A new unbound rule returns `NOT_SCHEDULED` without contacting a merchant.

## Restock

Inventory Watch checks omit the Shopify Catalog `available: true` filter and retain returned `OUT_OF_STOCK` variants. `RESTOCKED` requires an observed non-stock baseline followed by `IN_STOCK`. Product identity, requested variant, merchant, condition, and evidence freshness still have to match. Cross-merchant model/GTIN watches require `EXACT`; a merchant-bound named style may use `DISCOVERY_MATCH` only when the full style and variants match.

Shopify may omit unavailable products from a result even when the filter is absent. That case remains `DATA_SOURCE_UNAVAILABLE`; it is not treated as proof of out-of-stock inventory.

## Migration

Pre-v0.6.0 JSON records have no Automation ID. They remain checkable so existing reminders do not stop, but list as `LEGACY_UNVERIFIED`. Bind them to their existing Automation before pause, resume, or delete. Never create a second Automation until reconciliation proves none exists.

## Supported conditions

- `PRICE_BELOW`
- `IN_STOCK`
- `RESTOCKED`
- `DISCOUNT_AT_LEAST`
- `COUPON_AVAILABLE`
- `CASHBACK_AT_LEAST`

Coupon, promotion, and Cashback checks remain fail-closed until an approved Deals API is configured. Watch never authorizes purchase, reservation, checkout, form submission, payment, or automated Chrome use.

## Verification

- Source tests cover pending, binding, duplicate-binding rejection, transition deduplication, pause/delete synchronization, and out-of-stock Catalog requests.
- Stdio smoke creates and binds a Watch, restarts the bundled MCP server, verifies the binding, pauses it, and deletes it.
- Existing v0.5.4 search and matching gates remain required.
