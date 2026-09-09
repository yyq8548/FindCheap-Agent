---
name: deals-and-watch
description: Verified Coupons, deals and shopping watches.
---

# FindCheap Agent v0.18.6 Deals and Watch

Follow host requirements; announcements once. Skip optional file/Memory reads. Use receipts; no optional progress/tool narration. Retain limitations.

## Coupon

Call `find_coupons` once with current-message `responseLocale`. `INVALID_ARGUMENTS` + `details.phase=INPUT_VALIDATION` + `recovery.action=CORRECT_ARGUMENTS`: correct once using field issues, never identical args. No network/safety retry. Awin Promotions works without Feeds. `productQuery`: user-named product only; ranks, never discards merchant-wide offers. Joined Awin merchant ≠ active offer. Return source/terms/scope/expiry/checked time. Distinguish types and product-confirmed/merchant-wide/unconfirmed. Never invent code/stacking/discount/Cashback. `UNAVAILABLE` ≠ no Coupon; `PARTIAL`=incomplete. Chrome: explicit one-use authorization, public HTTPS only. Never apply codes/sign in/enter checkout.

## Current deal check

Selected: `research_selected_product_deal` + prior `renderId` alone for one synced UI choice. Explicit ordinal → `position`; specified card → same-receipt `selectionId` (`findcheapContext` JSON text/`structuredContent`). Unsynced: selection not received. Empty: select one. Multiple: specify which. Never default first or title-search. `MISSING_REFERENCE_CONTEXT`/`REUSE_ORIGINAL_REFERENCE`: correct once from original unexpired receipt. Missing receipt: unavailable; no latest-guess/log scan/`NEW_PRODUCT`. Pass current-message `responseLocale`, user-supplied ZIP/memberships. Best Coupon: code/benefit from `dealSummary.recommendedDealId`; scope—customer/products/exclusions. Others on request. No recommended ID: no best offer. Assessment governs eligibility; merchant-wide is not product-confirmed. Estimate only product-confirmed. Checkout confirms scope/stacking/final amount. Return product/price/stock. No history/forecast/Watch.

## Create Watch

Risk `R2`: “tell me”/“notify me”/“watch” authorizes Watch + recurring Codex Automation, never purchase/reservation/checkout/payment.

1. One condition: `PRICE_BELOW`, `DISCOUNT_AT_LEAST`, `CASHBACK_AT_LEAST`, `COUPON_AVAILABLE`, `IN_STOCK`, or `RESTOCKED`. `PRICE_BELOW`: exclusive integer-cent `threshold`; below $40 = `4000`, excludes $40.00. Require `ITEM_PRICE`; DELIVERED_TOTAL Watch is unavailable; do not request ZIP. One-shot host form approval never authorizes recurring Cart quotes.
2. Exact generation/model/GTIN, variants; explicit condition: `NEW`, `USED`, `REFURBISHED`, `OPEN_BOX`, or `ANY`. Named style: merchant. Never infer identity/condition/merchant/membership/threshold/expiration/price basis; never title-search or request street address.
3. `create_watch` once; selected WooCommerce: original `quoteReference`. `NEEDS_CLARIFICATION`: ask/stop. `ACTIVE`/`PAUSED`: no duplicate. `DATA_SOURCE_UNAVAILABLE`: no Automation. `LEGACY_UNVERIFIED`: read below. `READY_TO_SCHEDULE`: native `automation_update` tool creates one heartbeat with returned prompt/interval; then `bind_watch_automation`. BOUND is only a local reference, not host proof. Failure: verify scope, delete the newly created Automation.
4. Scheduled `check_watch` once. `TRIGGERED`: notify value/merchant/link/`checkedAt`, deduplicate `completionEventId`. `NOT_TRIGGERED`: silent. `COMPLETED/EXPIRED/PAUSED/NOT_FOUND`: no product alert. `STOP_REQUIRED`: read below; no host ACK. Automated Watch checks never use Chrome.

Pause/resume/delete/legacy/STOP_REQUIRED: read [watch-lifecycle.md](references/watch-lifecycle.md) fully. No travel/ticket/appointment/automatic buying.
