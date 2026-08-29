---
name: deals-and-watch
description: Find verified Coupon, promotion, membership, Cashback, and offline-barcode evidence, or create and manage shopping watches with Codex Automation.
---

# FindCheap Agent v0.15.1 Deals and Watch

A live Coupon or Watch request is self-contained. MCP tools are loaded. Do not read Memory, repository files, logs, task files, or plugin cache. Do not reopen this Skill. Send at most one short progress sentence before the first tool call; do not narrate the tool sequence between calls.

## Coupon

Call `find_coupons` once. It includes active Awin Promotions without Product Feeds. Pass `productQuery` only when current user explicitly names that product or refers to stable selected card; never narrow merchant-wide request using Agent suggestions or an earlier category. Return verified source, eligibility, expiry, checked time. Keep Coupon, Promo Code, membership, Cashback, barcode distinct. Never invent code, stacking, discount, Cashback. `DATA_SOURCE_UNAVAILABLE` is not “no Coupon.” Chrome needs explicit one-use authorization; inspect public HTTPS promotion pages only. Never apply codes, sign in, or enter checkout.

## Current deal check

For selected-card deals, call `research_selected_product_deal` with stable `selectionId`; never search title. Pass supplied ZIP/memberships only. Return product, merchant, price basis/amount/time, inventory, verified source/eligibility/expiry, limits. Never answer only “price checked” or “no Coupon.” No history, sale cadence, forecast, or Watch unless requested. Deal does not prove eligibility or stacking.

## Create Watch

Risk tier `R2`. A direct “tell me,” “notify me,” or “watch” request authorizes Watch plus recurring Codex Automation, never purchase, reservation, checkout, or payment.

1. Normalize one condition: `PRICE_BELOW`, `DISCOUNT_AT_LEAST`, `CASHBACK_AT_LEAST`, `COUPON_AVAILABLE`, `IN_STOCK`, or `RESTOCKED`. `PRICE_BELOW` uses exclusive integer-cent `threshold`; “below $40” passes `4000`, so $39.99 triggers and $40.00 does not. Set `priceBasis` to `ITEM_PRICE` or `DELIVERED_TOTAL`.
2. Product Watch requires exact generation/model/GTIN and explicit condition preference: `NEW`, `USED`, `REFURBISHED`, `OPEN_BOX`, or `ANY`. Named style without model/GTIN also requires merchant. `DELIVERED_TOTAL` additionally requires prior stable `selectionId` and US ZIP. Preserve variant dimensions. Never infer identity, condition, merchant, ZIP, membership, threshold, expiration, or price basis; never search selected title or request street address.
3. Call `create_watch` once. `NEEDS_CLARIFICATION`: ask and stop. `ACTIVE`/`PAUSED`: no duplicate. `DATA_SOURCE_UNAVAILABLE`: no Automation. `LEGACY_UNVERIFIED`: read [watch-lifecycle.md](references/watch-lifecycle.md). `READY_TO_SCHEDULE`: create one heartbeat with native `automation_update` tool, exact prompt/interval, then call `bind_watch_automation`. Never claim monitoring is active until binding succeeds; on failure delete the newly created Automation.
4. Scheduled run calls `check_watch` once. Notify only for `TRIGGERED`, including observed value, merchant/link, and `checkedAt`. `NOT_TRIGGERED` stays silent. Automated Watch checks never use Chrome.

For pause, resume, delete, or legacy reconciliation, read [watch-lifecycle.md](references/watch-lifecycle.md) fully. Travel, hotel, ticket, appointment, and automatic buying remain unavailable.
