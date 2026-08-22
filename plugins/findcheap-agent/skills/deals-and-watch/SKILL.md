---
name: deals-and-watch
description: Find verified Coupon, promotion, membership, Cashback, and offline-barcode evidence, or create and manage persistent shopping watches with Codex Automation.
---

# FindCheap Agent v0.7.1 Deals and Watch

Use this workflow when the user asks for a Coupon before paying or asks to monitor a future purchase.

## Coupon

1. If `find_coupons` is available, call it once with the merchant, optional product, explicit memberships, and channel. Its absence means no verified Deals provider is configured; do not invent or silently replace it with another API.
2. Return only deals from `deals`. Keep Coupon, Promo Code, brand promotion, membership, Cashback, and offline barcode labels distinct.
3. Show the source link, eligibility, expiry, and checked time. Never invent a code, assume stacking, estimate Cashback, or describe `DATA_SOURCE_UNAVAILABLE` as no Coupon.
4. If the Deals API is unavailable and the user explicitly authorizes Chrome for this lookup, inspect only public HTTPS merchant promotion or Coupon pages. Treat visible evidence as a one-time browser observation; never apply a code, enter checkout, sign in, read account data, or persist the page. Automated Watch checks never use Chrome.

## Watch

Risk tier: creating a recurring notification is `R2`. The user's direct request to "tell me", "notify me", or "watch" authorizes creating that watch and its recurring Codex Automation. It never authorizes purchase, reservation, checkout, or payment.

1. Normalize the request into one condition:
   - `PRICE_BELOW`: `threshold` is the exclusive ceiling in integer USD cents. Convert the user's stated price directly without subtracting one cent: “below $40” means `threshold: 4000`, so `$39.99` triggers and `$40.00` does not.
   - `DISCOUNT_AT_LEAST` or `CASHBACK_AT_LEAST`: threshold is percentage points and merchant is required.
   - `COUPON_AVAILABLE`: merchant is required.
   - `IN_STOCK` or `RESTOCKED`.
2. For `PRICE_BELOW`, `IN_STOCK`, or `RESTOCKED`, require a generation, exact model number, or GTIN and an explicit condition preference: `NEW`, `USED`, `REFURBISHED`, `OPEN_BOX`, or `ANY`. A generation or named style without model/GTIN also requires an explicit merchant. Never interpret omission as any generation, merchant, or condition. Preserve requested size, color, capacity, and other variant dimensions.
3. Call `create_watch`. Never infer product identity, condition, ZIP, membership, threshold, or expiration. Before calling it, verify that the spoken dollar ceiling converts directly to integer cents (`$X.YZ` → `XYZ` cents); strictness is applied by the Watch evaluator, not by reducing the threshold. Handle its status exactly:
   - `NEEDS_CLARIFICATION`: ask its questions; create no Automation.
   - `ACTIVE`: the duplicate rule is already bound; create no duplicate Automation.
   - `PAUSED`: the duplicate rule already exists but is paused; create no duplicate Automation.
   - `LEGACY_UNVERIFIED`: locate the existing Automation that references the returned watch ID and call `bind_watch_automation`; create no duplicate until reconciliation proves none exists.
   - `READY_TO_SCHEDULE`: continue below.
   - `DATA_SOURCE_UNAVAILABLE`: do not create an Automation; explain that this condition requires a configured verified Deals provider.
4. For `READY_TO_SCHEDULE`, use the native `automation_update` tool to create one recurring heartbeat Automation in the current task. Use exactly the returned `automationPrompt` and `intervalMinutes`. Then call `bind_watch_automation` with the returned Automation ID. If binding does not return `ACTIVE`, delete the newly created Automation. Never claim monitoring is active until binding succeeds.
5. Each scheduled run calls `check_watch` exactly once. Notify only for `TRIGGERED`, including the observed merchant/value, `checkedAt`, and direct source or merchant link from `observation`. `NOT_TRIGGERED` is a silent check. `NOT_SCHEDULED` means setup is incomplete. `NEEDS_CLARIFICATION` requires replacement of the broad legacy watch. `DATA_SOURCE_UNAVAILABLE` is not a deal or stock result. Automated Watch checks never use Chrome.
6. Manage both sides as one lifecycle:
   - Pause/resume: call `list_watches`, update the bound Automation first, then call `pause_watch` with the same `automationId`. Roll back the Automation update if the Watch update fails.
   - Delete: call `list_watches`, delete the bound Automation first, then call `delete_watch` with the same `automationId`.
   - A `LEGACY_UNVERIFIED` Watch must be bound to its existing Automation before pause, resume, or delete.

Current live conditions are product price, verified promotion/Coupon/Cashback, stock, and restock. Travel, hotel, ticket, appointment, and automatic-buy execution remain unavailable until dedicated authorized sources and transaction controls exist.
