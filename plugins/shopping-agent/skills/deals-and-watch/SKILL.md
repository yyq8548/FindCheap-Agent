---
name: deals-and-watch
description: Find verified Coupon, promotion, membership, Cashback, and offline-barcode evidence, or create and manage persistent shopping watches with Codex Automation.
---

# FindCheap-Agent v0.5.0 Deals and Watch

Use this workflow when the user asks for a Coupon before paying or asks to monitor a future purchase.

## Coupon

1. Call `find_coupons` once with the merchant, optional product, explicit memberships, and channel.
2. Return only deals from `deals`. Keep Coupon, Promo Code, brand promotion, membership, Cashback, and offline barcode labels distinct.
3. Show the source link, eligibility, expiry, and checked time. Never invent a code, assume stacking, estimate Cashback, or describe `DATA_SOURCE_UNAVAILABLE` as no Coupon.
4. If the Deals API is unavailable and the user explicitly authorizes Chrome for this lookup, inspect only public HTTPS merchant promotion or Coupon pages. Treat visible evidence as a one-time browser observation; never apply a code, enter checkout, sign in, read account data, or persist the page. Automated Watch checks never use Chrome.

## Watch

Risk tier: creating a recurring notification is `R2`. The user's direct request to "tell me", "notify me", or "watch" authorizes creating that watch and its recurring Codex Automation. It never authorizes purchase, reservation, checkout, or payment.

1. Normalize the request into one condition:
   - `PRICE_BELOW`: threshold is integer USD cents.
   - `DISCOUNT_AT_LEAST` or `CASHBACK_AT_LEAST`: threshold is percentage points and merchant is required.
   - `COUPON_AVAILABLE`: merchant is required.
   - `IN_STOCK` or `RESTOCKED`.
2. Call `create_watch`. Never infer ZIP, membership, threshold, or expiration. Ask one concise question when a required value is missing.
3. After `create_watch` succeeds, create a recurring Codex Automation using exactly the returned `automationPrompt` and `intervalMinutes`. Do not claim monitoring is active until both steps succeed.
4. Each scheduled run calls `check_watch` once. Notify only for `TRIGGERED`. `NOT_TRIGGERED` is a silent check; `DATA_SOURCE_UNAVAILABLE` is not a deal or stock result.
5. Use `list_watches`, `pause_watch`, and `delete_watch` for management. When deleting, also remove the matching Codex Automation.

Current live conditions are product price, verified promotion/Coupon/Cashback, stock, and restock. Travel, hotel, ticket, appointment, and automatic-buy execution remain unavailable until dedicated authorized sources and transaction controls exist.
