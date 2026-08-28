---
name: deals-and-watch
description: Find verified Coupon, promotion, membership, Cashback, and offline-barcode evidence, or create and manage shopping watches with Codex Automation.
---

# FindCheap Agent v0.14.0 Deals and Watch

A live Coupon or Watch request is self-contained. MCP tools are loaded. Do not read Memory, repository files, logs, task files, or plugin cache. Do not reopen this Skill. Send at most one short progress sentence before the first tool call; do not narrate the tool sequence between calls.

## Coupon

Call `find_coupons` once. It includes active Awin Promotions for joined advertisers without Product Feeds. Return only verified deals with source, eligibility, expiry, checked time. Keep Coupon, Promo Code, promotion, membership, Cashback, offline barcode distinct. Never invent code, stacking, discount, Cashback. `DATA_SOURCE_UNAVAILABLE` is not “no Coupon.” Chrome requires explicit single-use authorization and may inspect only public HTTPS promotion pages; never apply codes, sign in, enter checkout, or persist data.

## Current deal check

For a selected-card deal question, call `research_selected_product_deal` with stable `selectionId`; never search title. Pass only supplied ZIP and memberships. Return product, merchant, price basis/amount/checked time, inventory, each verified deal's source/eligibility/expiry, and limits. Never answer only “price checked” or “no Coupon.” No price history, sale cadence, buy-or-wait forecast, or Watch unless requested. Deal does not prove eligibility or stacking.

## Create Watch

Risk tier `R2`. A direct “tell me,” “notify me,” or “watch” request authorizes Watch plus recurring Codex Automation, never purchase, reservation, checkout, or payment.

1. Normalize one condition: `PRICE_BELOW`, `DISCOUNT_AT_LEAST`, `CASHBACK_AT_LEAST`, `COUPON_AVAILABLE`, `IN_STOCK`, or `RESTOCKED`. `PRICE_BELOW` uses exclusive integer-cent `threshold`; “below $40” passes `4000`, so $39.99 triggers and $40.00 does not. Set `priceBasis` to `ITEM_PRICE` or `DELIVERED_TOTAL`.
2. Product Watch requires exact generation/model/GTIN and explicit condition preference: `NEW`, `USED`, `REFURBISHED`, `OPEN_BOX`, or `ANY`. Named style without model/GTIN also requires merchant. `DELIVERED_TOTAL` additionally requires prior stable `selectionId` and US ZIP. Preserve variant dimensions. Never infer identity, condition, merchant, ZIP, membership, threshold, expiration, or price basis; never search selected title or request street address.
3. Call `create_watch` once. For `NEEDS_CLARIFICATION`, ask returned question and stop. For `ACTIVE` or `PAUSED`, create no duplicate. For `DATA_SOURCE_UNAVAILABLE`, create no Automation. For `LEGACY_UNVERIFIED`, read [watch-lifecycle.md](references/watch-lifecycle.md). For `READY_TO_SCHEDULE`, create one heartbeat using native `automation_update` tool with exact returned prompt and interval, then call `bind_watch_automation`. Never claim monitoring is active until binding succeeds; on failure, delete the newly created Automation.
4. Scheduled run calls `check_watch` once. Notify only for `TRIGGERED`, including observed value, merchant/link, and `checkedAt`. `NOT_TRIGGERED` stays silent. Automated Watch checks never use Chrome.

For pause, resume, delete, or legacy reconciliation, read [watch-lifecycle.md](references/watch-lifecycle.md) fully. Travel, hotel, ticket, appointment, and automatic buying remain unavailable.
