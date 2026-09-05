---
name: deals-and-watch
description: Find verified Coupon, promotion, membership, or Cashback evidence, and manage shopping watches.
---

# FindCheap Agent v0.17.17 Deals and Watch

Live Coupon/Watch is self-contained. Do not read Memory, repository files, logs, task files, or plugin cache. One short progress sentence maximum; do not narrate the tool sequence between calls.

## Coupon

Call `find_coupons` once with current-message `responseLocale`. `INVALID_ARGUMENTS` + `details.phase=INPUT_VALIDATION` + `recovery.action=CORRECT_ARGUMENTS`: one corrected submission using field issues, never identical args. No agent retry for network/safety failures. Awin Promotions works without Feeds. Pass `productQuery` only when the user names that product; ranks but cannot discard merchant-wide offers. Joined Awin merchant does not imply an active offer. Return source/terms/scope/expiry/checked time. Distinguish offer types and product-confirmed/merchant-wide/unconfirmed. Never invent code/stacking/discount/Cashback. `UNAVAILABLE` is not “no Coupon”; `PARTIAL` is incomplete. Chrome: explicit one-use authorization, public HTTPS only. Never apply codes, sign in, or enter checkout.

## Current deal check

Selected card: `research_selected_product_deal` with prior `renderId` plus `selectionId` or `position`; never title-search. `MISSING_REFERENCE_CONTEXT`/`REUSE_ORIGINAL_REFERENCE`: retry once with original `renderId`, not expired. Pass ZIP/memberships. Be warm and direct, not salesy. Show best Coupon first: code/benefit from `summary.recommendedDealId`; scope—customer, products, exclusions. Other offers: collapsed or on request. No recommended ID: no best offer. Assessment governs eligibility; merchant-wide is not product-confirmed. Estimate only product-confirmed. Checkout confirms scope/stacking/final amount. Return product/price/stock. No history/forecast/Watch.

## Create Watch

Risk `R2`. Direct “tell me,” “notify me,” or “watch” authorizes Watch plus recurring Codex Automation, never purchase/reservation/checkout/payment.

1. One condition: `PRICE_BELOW`, `DISCOUNT_AT_LEAST`, `CASHBACK_AT_LEAST`, `COUPON_AVAILABLE`, `IN_STOCK`, or `RESTOCKED`. `PRICE_BELOW`: exclusive integer-cent `threshold`; below $40 = `4000`, excludes $40.00. `priceBasis`: `ITEM_PRICE` or `DELIVERED_TOTAL`.
2. Require exact generation/model/GTIN and explicit condition: `NEW`, `USED`, `REFURBISHED`, `OPEN_BOX`, or `ANY`. Named style without model/GTIN needs merchant. `DELIVERED_TOTAL` needs prior stable `selectionId` and US ZIP. Preserve variants. Never infer identity/condition/merchant/ZIP/membership/threshold/expiration/price basis; never search selected title or request street address.
3. Call `create_watch` once. `NEEDS_CLARIFICATION`: ask and stop. `ACTIVE`/`PAUSED`: no duplicate. `DATA_SOURCE_UNAVAILABLE`: no Automation. `LEGACY_UNVERIFIED`: read [watch-lifecycle.md](references/watch-lifecycle.md). `READY_TO_SCHEDULE`: create one heartbeat with native `automation_update` tool, exact prompt/interval, then call `bind_watch_automation`. Never claim monitoring is active until binding succeeds; on failure delete the newly created Automation.
4. Scheduled: `check_watch` once. `TRIGGERED`: notify value/merchant/link/`checkedAt`; `NOT_TRIGGERED`: silent. Automated Watch checks never use Chrome.

Pause/resume/delete/legacy: read [watch-lifecycle.md](references/watch-lifecycle.md) fully. No travel/hotel/ticket/appointment/automatic buying.
